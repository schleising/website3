"""Public Cryptics pages. No login and no tools privilege."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates


TEMPLATES = Jinja2Templates("/app/templates")

cryptics_router = APIRouter(prefix="/cryptics")


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
        {"request": request},
    )
