import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from ..account.csrf import validate_csrf
from .access import require_media_access
from .database import MediaDatabase


TEMPLATES = Jinja2Templates("/app/templates")

media_router = APIRouter(prefix="/media")
media_database = MediaDatabase()


class MediaFileActionRequest(BaseModel):
    filename: str


def _action_response(status_name: str, filename: str, success_message: str) -> JSONResponse:
    if status_name == "updated":
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"ok": True, "filename": filename, "message": success_message},
        )

    if status_name == "not_found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Media file not found.",
        )

    if status_name == "unavailable":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Media database is unavailable.",
        )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Requested action does not apply to the current file state.",
    )


@media_router.get("/", response_class=HTMLResponse)
async def media_manager(request: Request) -> HTMLResponse:
    require_media_access(request)
    logging.info("Media manager page requested")

    return TEMPLATES.TemplateResponse(
        request,
        "media/media.html",
        {"request": request},
    )


@media_router.get("/api/files/")
async def get_media_files(
    request: Request,
    conversion_required: bool | None = Query(default=None),
    conversion_error: bool | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
) -> dict[str, Any]:
    require_media_access(request)

    return await media_database.list_media_files(
        conversion_required=conversion_required,
        conversion_error=conversion_error,
        limit=limit,
    )


@media_router.get("/api/files/detail/")
async def get_media_file_detail(
    request: Request,
    filename: str = Query(..., min_length=1),
) -> JSONResponse:
    require_media_access(request)

    media_file = await media_database.get_media_file(filename)
    if media_file is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Media file not found.",
        )

    return JSONResponse(content=jsonable_encoder({"file": media_file}))


@media_router.post("/api/files/queue/", dependencies=[Depends(validate_csrf)])
async def queue_media_file(
    request: Request,
    action: MediaFileActionRequest,
) -> JSONResponse:
    require_media_access(request)

    action_status = await media_database.queue_media_file(action.filename)
    return _action_response(
        action_status,
        action.filename,
        "File queued for conversion.",
    )


@media_router.post(
    "/api/files/restart-error/",
    dependencies=[Depends(validate_csrf)],
)
async def restart_media_error(
    request: Request,
    action: MediaFileActionRequest,
) -> JSONResponse:
    require_media_access(request)

    action_status = await media_database.restart_media_error_file(action.filename)
    return _action_response(
        action_status,
        action.filename,
        "Conversion error cleared.",
    )