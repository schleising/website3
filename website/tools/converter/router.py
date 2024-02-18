from datetime import UTC, datetime, timedelta
import logging
import json
from pathlib import Path

from fastapi import APIRouter, Request, Response, WebSocket, WebSocketDisconnect, Depends, status
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from pymongo.errors import DuplicateKeyError

from .database.database import DatabaseTools
from .messages.messages import ConvertingFilesMessage, ConvertingFileData, ConvertedFilesMessage, StatisticsMessage, MessageTypes, Message
from ..utils import calculate_time_remaining, check_user_can_use_tools

from .database import push_collection

# Initialise the database
database_tools = DatabaseTools()

# Set the base template location
TEMPLATES = Jinja2Templates('/app/templates')

# Instantiate the router object, ensure every request checks the user can use the tools
converter_router = APIRouter(prefix='/converter')

# Gets the Converter
@converter_router.get('/', response_class=HTMLResponse)
async def converter(request: Request):
    logging.info('Converter page requested')
    return TEMPLATES.TemplateResponse('tools/converter/converter.html', {'request': request})

@converter_router.websocket("/ws/")
async def converter_websocket(websocket: WebSocket):
    # Accept the websocket connection
    await websocket.accept()

    # Log the connection
    logging.info('Websocket Opened')

    # Variable to store the last converted files message
    last_converted_files_message: ConvertedFilesMessage | None = None

    # Variable to store the last statistics message
    last_statistics_message: StatisticsMessage | None = None

    try:
        # Loop forever
        while True:
            # Wait for a message from the client
            recv = await websocket.receive_text()

            # Load the json
            msg = json.loads(recv)

            # Get the type of message
            match msg['messageType']:
                case 'ping':
                    # Log the ping
                    logging.debug('Ping received')

                    # Get the current conversion status
                    current_conversion_status_db_list = await database_tools.get_converting_files()

                    if current_conversion_status_db_list is not None:
                        # Create a ConvertingFilesMessage list
                        current_conversion_status_list: list[ConvertingFileData] = []

                        for current_conversion_status_db in current_conversion_status_db_list:
                            # Get the time since the conversion started
                            if current_conversion_status_db.start_conversion_time is not None:
                                time_since_start = datetime.now().astimezone(UTC) - current_conversion_status_db.start_conversion_time
                            else:
                                time_since_start = timedelta(seconds=0)

                            # Convert the time since the conversion started to a string discarding the microseconds
                            time_since_start_str = str(time_since_start).split('.')[0]

                            # Get the conversion time remaining
                            time_remaining = calculate_time_remaining(
                                start_time=current_conversion_status_db.start_conversion_time,
                                progress=current_conversion_status_db.percentage_complete
                            )

                            # Create a ConvertingFileMessage from the database object
                            current_conversion_status = ConvertingFileData(
                                filename=Path(current_conversion_status_db.filename).name,
                                progress=current_conversion_status_db.percentage_complete,
                                time_since_start=time_since_start_str,
                                time_remaining=time_remaining,
                                backend_name=current_conversion_status_db.backend_name,
                                speed=current_conversion_status_db.speed,
                                copying=current_conversion_status_db.copying
                            )

                            # Add the ConvertingFileMessage to the list
                            current_conversion_status_list.append(current_conversion_status)

                        # Create a ConvertingFilesMessage from the list
                        current_conversion_status = ConvertingFilesMessage(
                            converting_files=current_conversion_status_list
                        )

                        # Create a Message from the ConvertingFileMessage
                        message = Message(
                            messageType=MessageTypes.CONVERTING_FILES,
                            messageBody=current_conversion_status
                        )

                        # Log the conversion status
                        logging.debug(f'Current conversion status: {message}')

                        # Send the conversion status
                        await websocket.send_json(message.model_dump())
                    else:
                        # Send the conversion status as None
                        await websocket.send_json(Message(
                            messageType=MessageTypes.CONVERTING_FILES,
                            messageBody=None
                        ).model_dump())

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
                            messageBody=files_converted_message
                        )

                        # Log the files converted
                        logging.debug(f'Files converted: {message}')

                        # Send the files converted
                        await websocket.send_json(message.model_dump())

                        # Set the last converted files message
                        last_converted_files_message = files_converted_message

                    # Get the statistics
                    statistics = await database_tools.get_statistics()

                    # If the statistics have changed send an update
                    if statistics != last_statistics_message:
                        # Create a Message from the StatisticsMessage
                        message = Message(
                            messageType=MessageTypes.STATISTICS,
                            messageBody=statistics
                        )

                        # Log the statistics
                        logging.debug(f'Statistics: {message}')

                        # Send the statistics
                        await websocket.send_json(message.model_dump())

                        # Set the last statistics message
                        last_statistics_message = statistics

                case _:
                    # Log an error
                    logging.error(f'Unknown message type: {msg["messageType"]}')


    except WebSocketDisconnect:
        # Log the disconnection
        logging.info('Websocket Closed')

# Endpoint to subscribe to push notifications
@converter_router.post('/subscribe/', status_code=201)
async def subscribe(request: Request, response: Response):
    data = await request.json()
    logging.debug(data)

    # Insert the subscription into the database
    if push_collection is not None:
        try:
            result = await push_collection.insert_one(data)
        except DuplicateKeyError as ex:
            logging.error(f'Error inserting subscription: {ex}')
            response.status_code = status.HTTP_400_BAD_REQUEST
            return {'status': 'error', 'message': 'Subscription already exists'}

    logging.debug(result)

    # Send a 201 response
    return {'status': 'success'}

# Endpoint to unsubscribe from push notifications
@converter_router.delete('/unsubscribe/', status_code=204)
async def unsubscribe(request: Request):
    data = await request.json()
    logging.debug(data)

    # Remove the subscription from the database
    if push_collection is not None:
        result = await push_collection.delete_one(data)

    logging.debug(result)

    # Send a 204 response
    return {'status': 'success'}
