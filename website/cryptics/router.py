"""Public Cryptics pages. No login and no tools privilege."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates


TEMPLATES = Jinja2Templates("/app/templates")

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


@cryptics_router.get("/", response_class=HTMLResponse, response_model=None)
@cryptics_router.get("", response_class=HTMLResponse, response_model=None)
async def cryptics_root(request: Request) -> RedirectResponse:
    logging.info("Cryptics index requested: %s", request.url.path)
    return RedirectResponse(url="/cryptics/anagrams/", status_code=302)


@cryptics_router.get("/anagrams", response_class=HTMLResponse, response_model=None)
@cryptics_router.get("/anagrams/", response_class=HTMLResponse, response_model=None)
async def cryptics_anagrams(request: Request) -> HTMLResponse:
    logging.info("Cryptics anagrams page requested")
    return TEMPLATES.TemplateResponse(
        request,
        "cryptics/anagrams.html",
        {"request": request, "cryptics_tool": "anagrams"},
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
            "cryptics_tool": "thesaurus",
            "q": _query_text(request, "q"),
            "n": _query_text(request, "n", limit=40),
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
            "cryptics_tool": "abbreviations",
            "q": _query_text(request, "q"),
            "letters": _query_text(request, "letters", limit=8),
            "kind": _abbreviation_kind(request),
        },
    )
