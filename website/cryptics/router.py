"""Public Cryptics pages. No login and no tools privilege."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TypedDict

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from starlette.exceptions import HTTPException as StarletteHTTPException


TEMPLATES = Jinja2Templates("/app/templates")
WEBSITE_ROOT = Path(__file__).resolve().parents[1]
CRYPTICS_MANIFEST_PATH = WEBSITE_ROOT / "static" / "manifests" / "cryptics" / "cryptics.webmanifest"
CRYPTICS_SERVICE_WORKER_PATH = WEBSITE_ROOT / "static" / "cryptics" / "sw.js"
CRYPTICS_WEB_APP_HOST = "cryptics.schleising.net"

cryptics_router = APIRouter(prefix="/cryptics")

_ABBREVIATION_KINDS = frozenset(
    {"general", "chemistry", "roman", "chess", "compass", "foreign", "rank"}
)
_QUERY_LIMIT = 80


def _query_text(request: Request, name: str, limit: int = _QUERY_LIMIT) -> str:
    value = request.query_params.get(name)
    if not isinstance(value, str):
        return ""
    cleaned = " ".join(value.split())
    if len(cleaned) > limit:
        return cleaned[:limit]
    return cleaned


def _abbreviation_kind(request: Request) -> str:
    kind = _query_text(request, "kind", limit=20).lower()
    if kind in _ABBREVIATION_KINDS:
        return kind
    return ""


def _request_host(request: Request) -> str:
    raw_host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    host = raw_host.split(",")[0].strip().lower()
    return host.split(":")[0]


def _is_web_app_request(request: Request) -> bool:
    web_app_header = request.headers.get("x-is-web-app", "").strip().lower()
    if web_app_header in {"1", "true", "yes", "on"}:
        return True
    return _request_host(request) == CRYPTICS_WEB_APP_HOST


class _CrypticsPaths(TypedDict):
    is_web_app: bool
    render_left_sidebar: bool
    cryptics_base_path: str
    cryptics_root_path: str


def _cryptics_path_context(request: Request) -> _CrypticsPaths:
    is_web_app = _is_web_app_request(request)
    return {
        "is_web_app": is_web_app,
        "render_left_sidebar": not is_web_app,
        "cryptics_base_path": "" if is_web_app else "/cryptics",
        "cryptics_root_path": "/" if is_web_app else "/cryptics/",
    }


def _canonical_url(request: Request, page: str) -> str:
    context = _cryptics_path_context(request)
    host = CRYPTICS_WEB_APP_HOST if context["is_web_app"] else "www.schleising.net"
    path = f"{context['cryptics_root_path']}{page}"
    query = request.url.query
    if query:
        path = f"{path}?{query}"
    return f"https://{host}{path}"


@cryptics_router.get("/", response_class=HTMLResponse, response_model=None)
@cryptics_router.get("", response_class=HTMLResponse, response_model=None)
async def cryptics_root(request: Request) -> RedirectResponse:
    logging.info("Cryptics index requested: %s", request.url.path)
    root_path = _cryptics_path_context(request)["cryptics_root_path"]
    return RedirectResponse(url=f"{root_path}anagrams/", status_code=302)


@cryptics_router.get("/manifest.webmanifest", response_class=Response, response_model=None)
@cryptics_router.get("/manifest.webmanifest/", response_class=Response, response_model=None)
async def cryptics_manifest(request: Request) -> Response:
    if not _is_web_app_request(request):
        raise StarletteHTTPException(status_code=404, detail="Not Found")
    return FileResponse(
        CRYPTICS_MANIFEST_PATH,
        media_type="application/manifest+json",
    )


@cryptics_router.get("/sw.js", response_class=Response, response_model=None)
@cryptics_router.get("/sw.js/", response_class=Response, response_model=None)
async def cryptics_service_worker(request: Request) -> Response:
    if not _is_web_app_request(request):
        raise StarletteHTTPException(status_code=404, detail="Not Found")
    return FileResponse(
        CRYPTICS_SERVICE_WORKER_PATH,
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )


@cryptics_router.get("/anagrams", response_class=HTMLResponse, response_model=None)
@cryptics_router.get("/anagrams/", response_class=HTMLResponse, response_model=None)
async def cryptics_anagrams(request: Request) -> HTMLResponse:
    logging.info("Cryptics anagrams page requested")
    return TEMPLATES.TemplateResponse(
        request,
        "cryptics/anagrams.html",
        {
            "request": request,
            "canonical_url": _canonical_url(request, "anagrams/"),
            "cryptics_tool": "anagrams",
            **_cryptics_path_context(request),
        },
    )


@cryptics_router.get("/thesaurus", response_class=HTMLResponse, response_model=None)
@cryptics_router.get("/thesaurus/", response_class=HTMLResponse, response_model=None)
async def cryptics_thesaurus(request: Request) -> HTMLResponse:
    logging.info("Cryptics thesaurus page requested")
    return TEMPLATES.TemplateResponse(
        request,
        "cryptics/thesaurus.html",
        {
            "request": request,
            "canonical_url": _canonical_url(request, "thesaurus/"),
            "cryptics_tool": "thesaurus",
            "q": _query_text(request, "q"),
            "n": _query_text(request, "n", limit=40),
            **_cryptics_path_context(request),
        },
    )


@cryptics_router.get("/abbreviations", response_class=HTMLResponse, response_model=None)
@cryptics_router.get("/abbreviations/", response_class=HTMLResponse, response_model=None)
async def cryptics_abbreviations(request: Request) -> HTMLResponse:
    logging.info("Cryptics abbreviations page requested")
    return TEMPLATES.TemplateResponse(
        request,
        "cryptics/abbreviations.html",
        {
            "request": request,
            "canonical_url": _canonical_url(request, "abbreviations/"),
            "cryptics_tool": "abbreviations",
            "q": _query_text(request, "q"),
            "letters": _query_text(request, "letters", limit=8),
            "kind": _abbreviation_kind(request),
            **_cryptics_path_context(request),
        },
    )
