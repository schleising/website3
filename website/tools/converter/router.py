import asyncio
import json
import logging
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Request, Response, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.templating import Jinja2Templates

from pymongo.errors import DuplicateKeyError

from .database.database import DatabaseTools
from .messages.messages import (
    ConvertingFilesMessage,
    ConvertingFileData,
    ConvertedFilesMessage,
    CoverArtUpdatedData,
    FilesToConvertMessage,
    StatisticsMessage,
    MessageTypes,
    Message,
)
from ..utils import calculate_time_remaining
from .cover_art_runtime import (
    PLACEHOLDER_ART_URL,
    refresh_art_for_path,
    resolve_art_for_display_many,
    serve_cached_poster,
)

from .database import push_collection

# Initialise the database
database_tools = DatabaseTools()

# Set the base template location
TEMPLATES = Jinja2Templates("/app/templates")

# Instantiate the router object, ensure every request checks the user can use the tools
converter_router = APIRouter(prefix="/converter")


# Gets the Converter
@converter_router.get("/", response_class=HTMLResponse)
async def converter(request: Request):
    logging.info("Converter page requested")
    return TEMPLATES.TemplateResponse(
        request, "tools/converter/converter.html", {"request": request}
    )


@converter_router.get("/art/{cache_key:path}", response_model=None)
async def converter_cover_art(cache_key: str) -> Response:
    """Serve a cached poster, or redirect to the placeholder."""
    art_logger = logging.getLogger("converter.cover_art")
    decoded_key = unquote(cache_key).strip()
    if not decoded_key or ".." in decoded_key or decoded_key.startswith("/"):
        art_logger.warning("Art request rejected bad key=%r", cache_key)
        return Response(status_code=status.HTTP_404_NOT_FOUND)

    record = await serve_cached_poster(decoded_key)
    if record is not None:
        local_path, media_type = record
        art_logger.debug(
            "Art serve hit key=%s path=%s type=%s",
            decoded_key,
            local_path,
            media_type,
        )
        return FileResponse(
            local_path,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )
    art_logger.debug("Art serve miss key=%s", decoded_key)

    return Response(
        status_code=status.HTTP_302_FOUND,
        headers={"Location": PLACEHOLDER_ART_URL},
    )


_cover_art_refresh_tasks: set[asyncio.Task[None]] = set()


def _remember_cover_art_refresh(task: asyncio.Task[None]) -> None:
    _cover_art_refresh_tasks.add(task)
    task.add_done_callback(_cover_art_refresh_tasks.discard)


def _as_str_dict(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, Any] = {}
    for key, item in value.items():
        if isinstance(key, str):
            result[key] = item
    return result


def _text_field(payload: Mapping[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        return ""
    return value.strip()


def _cover_art_refresh_target_ok(cache_key: str, filename: str) -> bool:
    if (
        cache_key == ""
        or filename == ""
        or len(cache_key) > 300
        or len(filename) > 512
    ):
        return False
    if any(token in cache_key for token in ("..", "/", "\\", "\x00")):
        return False
    if any(character.isspace() for character in cache_key):
        return False
    if any(token in filename for token in ("/", "\\", "\x00")) or filename in {
        ".",
        "..",
    }:
        return False
    return True


async def _cover_art_refresh_result(
    cache_key: str, filename: str
) -> CoverArtUpdatedData:
    """Look up the stored path and force a new poster resolve."""
    art_logger = logging.getLogger("converter.cover_art")
    if not _cover_art_refresh_target_ok(cache_key, filename):
        return CoverArtUpdatedData(
            filename=filename,
            cover_art_key=cache_key,
            ok=False,
            error="Invalid cover art refresh request.",
        )

    source_path = await database_tools.find_source_path_for_cover_art(
        cache_key, filename
    )
    if source_path is None:
        art_logger.info(
            "Cover art refresh missed key=%s file=%s", cache_key, filename
        )
        return CoverArtUpdatedData(
            filename=filename,
            cover_art_key=cache_key,
            ok=False,
            error="Could not find that file.",
        )

    art_logger.info("Cover art refresh started key=%s file=%s", cache_key, filename)
    try:
        fields = await refresh_art_for_path(source_path)
    except Exception as exc:  # noqa: BLE001
        art_logger.warning(
            "Cover art refresh failed key=%s file=%s: %s",
            cache_key,
            filename,
            exc,
        )
        return CoverArtUpdatedData(
            filename=filename,
            cover_art_key=cache_key,
            ok=False,
            error="Cover art lookup failed.",
        )

    art_logger.info(
        "Cover art refresh finished key=%s status=%s",
        fields.cache_key,
        fields.cover_art_status,
    )
    return CoverArtUpdatedData(
        filename=fields.filename,
        cover_art_url=fields.cover_art_url,
        cover_art_status=fields.cover_art_status,
        cover_art_key=fields.cache_key,
        ok=True,
    )


async def _run_cover_art_refresh(
    send_payload: Callable[[Mapping[str, Any]], Awaitable[None]],
    cache_key: str,
    filename: str,
) -> None:
    body = await _cover_art_refresh_result(cache_key, filename)
    message = Message(
        messageType=MessageTypes.COVER_ART_UPDATED,
        messageBody=body,
    )
    try:
        await send_payload(message.model_dump())
    except (WebSocketDisconnect, RuntimeError) as exc:
        logging.info("Cover art refresh result not sent: %s", exc)


@converter_router.websocket("/ws/")
async def converter_websocket(websocket: WebSocket):
    # Accept the websocket connection
    await websocket.accept()

    # Log the connection
    logging.info("Websocket Opened")

    # Variable to store the last converted files message
    last_converted_files_message: ConvertedFilesMessage | None = None

    # Variable to store the last files-to-convert message
    last_files_to_convert_message: FilesToConvertMessage | None = None

    # Variable to store the last statistics message
    last_statistics_message: StatisticsMessage | None = None

    # Track which card view this websocket wants.
    files_view = MessageTypes.CONVERTED_FILES

    # Cover-art refresh runs off this loop so Arr/TMDB lookups do not stall pings.
    send_lock = asyncio.Lock()

    async def send_payload(payload: Mapping[str, Any]) -> None:
        async with send_lock:
            await websocket.send_json(dict(payload))

    try:
        # Loop forever
        while True:
            # Wait for a message from the client
            recv = await websocket.receive_text()

            # Load the json
            msg = json.loads(recv)

            # Get the type of message
            match msg["messageType"]:
                case "ping":
                    # Log the ping
                    logging.debug("Ping received")

                    # Get the current conversion status
                    current_conversion_status_db_list = (
                        await database_tools.get_converting_files()
                    )

                    if current_conversion_status_db_list is not None:
                        # Create a ConvertingFilesMessage list
                        current_conversion_status_list: list[ConvertingFileData] = []
                        prediction_context = await database_tools.get_prediction_context()
                        art_fields = await resolve_art_for_display_many(
                            [
                                current_conversion_status_db.filename
                                for current_conversion_status_db
                                in current_conversion_status_db_list
                            ]
                        )

                        for index, current_conversion_status_db in enumerate(
                            current_conversion_status_db_list
                        ):
                            art = art_fields[index]
                            active_start_time = (
                                current_conversion_status_db.start_copy_time
                                if current_conversion_status_db.copying
                                and current_conversion_status_db.start_copy_time
                                is not None
                                else current_conversion_status_db.start_conversion_time
                            )

                            # Get the time since the conversion started
                            if active_start_time is not None:
                                time_since_start = (
                                    datetime.now().astimezone(UTC)
                                    - active_start_time
                                )
                            else:
                                time_since_start = timedelta(seconds=0)

                            # Convert the time since the conversion started to a string discarding the microseconds
                            time_since_start_str = str(time_since_start).split(".")[0]

                            # Get the conversion time remaining
                            time_remaining = calculate_time_remaining(
                                start_time=active_start_time,
                                progress=current_conversion_status_db.percentage_complete,
                            )

                            # Create a ConvertingFileMessage from the database object
                            estimated_percentage_saved = (
                                await database_tools.get_estimated_percentage_saved_for_file(
                                    current_conversion_status_db,
                                    prediction_context,
                                )
                            )

                            current_conversion_status = ConvertingFileData(
                                filename=art.filename,
                                display_title=art.display_title,
                                media_kind=art.media_kind,
                                cover_art_url=art.cover_art_url,
                                cover_art_status=art.cover_art_status,
                                cover_art_key=art.cache_key,
                                progress=current_conversion_status_db.percentage_complete,
                                time_since_start=time_since_start_str,
                                time_remaining=time_remaining,
                                backend_name=current_conversion_status_db.backend_name,
                                speed=current_conversion_status_db.speed,
                                copying=current_conversion_status_db.copying,
                                estimated_percentage_saved=estimated_percentage_saved,
                            )

                            # Add the ConvertingFileMessage to the list
                            current_conversion_status_list.append(
                                current_conversion_status
                            )

                        # Create a ConvertingFilesMessage from the list
                        current_conversion_status = ConvertingFilesMessage(
                            converting_files=current_conversion_status_list
                        )

                        # Create a Message from the ConvertingFileMessage
                        message = Message(
                            messageType=MessageTypes.CONVERTING_FILES,
                            messageBody=current_conversion_status,
                        )

                        # Log the conversion status
                        logging.debug(f"Current conversion status: {message}")

                        # Send the conversion status
                        await send_payload(message.model_dump())
                    else:
                        # Send the conversion status as None
                        await send_payload(
                            Message(
                                messageType=MessageTypes.CONVERTING_FILES,
                                messageBody=None,
                            ).model_dump()
                        )

                    if files_view == MessageTypes.FILES_TO_CONVERT:
                        files_to_convert = await database_tools.get_files_to_convert()
                        files_to_convert_message = FilesToConvertMessage(
                            files_to_convert=files_to_convert
                        )

                        if files_to_convert_message != last_files_to_convert_message:
                            message = Message(
                                messageType=MessageTypes.FILES_TO_CONVERT,
                                messageBody=files_to_convert_message,
                            )

                            logging.debug(f"Files to convert: {message}")
                            await send_payload(message.model_dump())
                            last_files_to_convert_message = files_to_convert_message
                    else:
                        # Get the files converted
                        converted_files = await database_tools.get_converted_files()

                        # Create a ConvertedFilesMessage from the database objects
                        files_converted_message = ConvertedFilesMessage(
                            converted_files=converted_files
                        )

                        # If the files converted message has changed send an update
                        if files_converted_message != last_converted_files_message:
                            # Create a Message from the ConvertedFilesMessage
                            message = Message(
                                messageType=MessageTypes.CONVERTED_FILES,
                                messageBody=files_converted_message,
                            )

                            # Log the files converted
                            logging.debug(f"Files converted: {message}")

                            # Send the files converted
                            await send_payload(message.model_dump())

                            # Set the last converted files message
                            last_converted_files_message = files_converted_message

                    # Get the statistics
                    statistics = await database_tools.get_statistics()

                    # If the statistics have changed send an update
                    if statistics != last_statistics_message:
                        # Create a Message from the StatisticsMessage
                        message = Message(
                            messageType=MessageTypes.STATISTICS, messageBody=statistics
                        )

                        # Log the statistics
                        logging.debug(f"Statistics: {message}")

                        # Send the statistics
                        await send_payload(message.model_dump())

                        # Set the last statistics message
                        last_statistics_message = statistics

                case "retry":
                    # Log the retry
                    logging.debug("Retry received")

                    # Retry the conversion
                    await database_tools.retry_conversion_errors()

                case "refresh_cover_art":
                    logging.debug("Cover art refresh received")
                    payload = _as_str_dict(msg)
                    refresh_task = asyncio.create_task(
                        _run_cover_art_refresh(
                            send_payload,
                            _text_field(payload, "cover_art_key"),
                            _text_field(payload, "filename"),
                        )
                    )
                    _remember_cover_art_refresh(refresh_task)

                case "set_files_view":
                    requested_view = msg.get("view", MessageTypes.CONVERTED_FILES)

                    if requested_view == MessageTypes.FILES_TO_CONVERT:
                        files_view = MessageTypes.FILES_TO_CONVERT
                    else:
                        files_view = MessageTypes.CONVERTED_FILES

                    # Reset last payload cache so next ping sends the selected view.
                    last_converted_files_message = None
                    last_files_to_convert_message = None

                case _:
                    # Log an error
                    logging.error(f'Unknown message type: {msg["messageType"]}')

    except WebSocketDisconnect:
        # Log the disconnection
        logging.info("Websocket Closed")


# Endpoint to subscribe to push notifications
@converter_router.post("/subscribe", status_code=201)
@converter_router.post("/subscribe/", status_code=201)
async def subscribe(request: Request, response: Response):
    data = await request.json()
    logging.debug(data)

    # Insert the subscription into the database
    if push_collection is not None:
        try:
            result = await push_collection.insert_one(data)
            logging.debug(result)
        except DuplicateKeyError as ex:
            logging.error(f"Error inserting subscription: {ex}")
            response.status_code = status.HTTP_400_BAD_REQUEST
            return {"status": "error", "message": "Subscription already exists"}

    # Send a 201 response
    return {"status": "success"}


# Endpoint to unsubscribe from push notifications
@converter_router.delete("/unsubscribe", status_code=204)
@converter_router.delete("/unsubscribe/", status_code=204)
async def unsubscribe(request: Request):
    data = await request.json()
    logging.debug(data)

    # Remove the subscription from the database
    if push_collection is not None:
        result = await push_collection.delete_one(data)
        logging.debug(result)

    # Send a 204 response
    return {"status": "success"}
