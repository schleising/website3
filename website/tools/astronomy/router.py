import logging

import aiohttp

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates


TEMPLATES = Jinja2Templates("/app/templates")

astronomy_router = APIRouter(prefix="/astronomy")


@astronomy_router.get("/", response_class=HTMLResponse)
async def astronomy(request: Request) -> HTMLResponse:
    logging.info("Astronomy page requested")
    return TEMPLATES.TemplateResponse(
        request,
        "tools/astronomy/astronomy.html",
        {"request": request},
    )


@astronomy_router.get("/sun-times", response_class=JSONResponse)
@astronomy_router.get("/sun-times/", response_class=JSONResponse)
async def sun_times(lat: float, lon: float) -> JSONResponse:
    sunrise_api_url = f"https://api.sunrise-sunset.org/json?lat={lat}&lng={lon}&formatted=0"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(sunrise_api_url) as response:
                payload = await response.json()
                return JSONResponse(status_code=response.status, content=payload)
    except Exception as error:
        logging.error("Error fetching sunrise data: %s", error)
        return JSONResponse(
            status_code=502,
            content={
                "status": "ERROR",
                "message": "Failed to fetch sunrise/sunset data",
            },
        )
