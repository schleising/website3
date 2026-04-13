import logging
from datetime import datetime, timedelta, timezone

import aiohttp
from skyfield.api import EarthSatellite, load, wgs84

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates


TEMPLATES = Jinja2Templates("/app/templates")
TIMESCALE = load.timescale()

SATELLITE_CATALOG = {
    "25544": {"name": "ISS", "color": "#ffb866"},
    "48274": {"name": "Tiangong", "color": "#7fe3ff"},
    "20580": {"name": "Hubble", "color": "#bfa9ff"},
}

astronomy_router = APIRouter(prefix="/astronomy")


async def fetch_satellite_tle(
    session: aiohttp.ClientSession, norad_id: str
) -> tuple[str, str, str]:
    tle_url = f"https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=TLE"

    async with session.get(tle_url) as response:
        response.raise_for_status()
        tle_text = await response.text()

    tle_lines = [line.strip() for line in tle_text.splitlines() if line.strip()]
    if len(tle_lines) < 3:
        raise ValueError(f"Unexpected TLE payload for NORAD {norad_id}")

    return tle_lines[0], tle_lines[1], tle_lines[2]


def build_satellite_segments(
    satellite: EarthSatellite,
    observer,
    now_utc: datetime,
    sample_start: datetime,
    sample_end: datetime,
    sample_step_minutes: int = 6,
) -> dict:
    topocentric_difference = satellite - observer
    sample_times: list[datetime] = []
    sample_time = sample_start
    while sample_time <= sample_end:
        sample_times.append(sample_time)
        sample_time += timedelta(minutes=sample_step_minutes)

    if now_utc not in sample_times:
        sample_times.append(now_utc)
        sample_times.sort()

    segments: list[list[dict[str, float]]] = []
    current_segment: list[dict[str, float]] = []
    previous_azimuth = None

    for sample in sample_times:
        altitude, azimuth, _ = topocentric_difference.at(
            TIMESCALE.from_datetime(sample)
        ).altaz()
        altitude_degrees = altitude.degrees
        azimuth_degrees = azimuth.degrees % 360

        if altitude_degrees < 0:
            if len(current_segment) > 1:
                segments.append(current_segment)
            current_segment = []
            previous_azimuth = None
            continue

        if previous_azimuth is not None:
            azimuth_jump = abs(azimuth_degrees - previous_azimuth)
            wraps_north = (
                azimuth_jump > 180
                and min(azimuth_degrees, previous_azimuth) < 40
                and max(azimuth_degrees, previous_azimuth) > 320
            )
            if wraps_north:
                if len(current_segment) > 1:
                    segments.append(current_segment)
                current_segment = []

        current_segment.append(
            {
                "altitudeDegrees": altitude_degrees,
                "azimuthDegrees": azimuth_degrees,
            }
        )
        previous_azimuth = azimuth_degrees

    if len(current_segment) > 1:
        segments.append(current_segment)

    current_altitude, current_azimuth, _ = topocentric_difference.at(
        TIMESCALE.from_datetime(now_utc)
    ).altaz()

    current_horizontal = None
    if current_altitude.degrees >= 0:
        current_horizontal = {
            "altitudeDegrees": current_altitude.degrees,
            "azimuthDegrees": current_azimuth.degrees % 360,
        }

    return {
        "segments": segments,
        "currentHorizontal": current_horizontal,
    }


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


@astronomy_router.get("/satellite-tracks", response_class=JSONResponse)
@astronomy_router.get("/satellite-tracks/", response_class=JSONResponse)
async def satellite_tracks(lat: float, lon: float) -> JSONResponse:
    now_utc = datetime.now(timezone.utc)
    sample_start = now_utc - timedelta(minutes=90)
    sample_end = now_utc + timedelta(minutes=90)
    observer = wgs84.latlon(latitude_degrees=lat, longitude_degrees=lon)

    try:
        satellites_payload = []
        async with aiohttp.ClientSession() as session:
            for norad_id, metadata in SATELLITE_CATALOG.items():
                name, line1, line2 = await fetch_satellite_tle(session, norad_id)
                satellite = EarthSatellite(line1, line2, name, TIMESCALE)
                geometry = build_satellite_segments(
                    satellite=satellite,
                    observer=observer,
                    now_utc=now_utc,
                    sample_start=sample_start,
                    sample_end=sample_end,
                )
                satellites_payload.append(
                    {
                        "name": metadata["name"],
                        "color": metadata["color"],
                        "segments": geometry["segments"],
                        "currentHorizontal": geometry["currentHorizontal"],
                    }
                )

        return JSONResponse(
            content={
                "status": "OK",
                "generatedAt": now_utc.isoformat(),
                "satellites": satellites_payload,
            }
        )
    except Exception as error:
        logging.error("Error fetching satellite track data: %s", error)
        return JSONResponse(
            status_code=502,
            content={
                "status": "ERROR",
                "message": "Failed to fetch satellite track data",
            },
        )
