from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import FileResponse, RedirectResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .files import resolve_toaster_file

toaster_router = APIRouter(prefix="/toaster", include_in_schema=False)


def toaster_file_response(filename: str) -> FileResponse:
    resolved = resolve_toaster_file(filename)
    if resolved is None:
        raise StarletteHTTPException(status_code=status.HTTP_404_NOT_FOUND)

    file_path, media_type = resolved
    return FileResponse(path=file_path, media_type=media_type)


@toaster_router.get("", include_in_schema=False)
async def toaster_redirect() -> RedirectResponse:
    return RedirectResponse(url="/toaster/", status_code=307)


@toaster_router.get("/", include_in_schema=False)
async def toaster_index() -> FileResponse:
    return toaster_file_response("index.html")


@toaster_router.get("/{filename}", include_in_schema=False)
async def toaster_asset(filename: str) -> FileResponse:
    return toaster_file_response(filename)
