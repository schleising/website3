import logging
from datetime import timezone

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from . import sensor_data_collection
from .models import SensorDataPoints, SensorData, SensorDataMessage

# Set the base template location
TEMPLATES = Jinja2Templates("/app/templates")

# Instantiate the router object, ensure every request checks the user can use the tools
monitor_router = APIRouter(prefix="/monitor")


# Gets the Monitor Router
@monitor_router.get("/", response_class=HTMLResponse)
async def monitor(request: Request) -> HTMLResponse:
    logging.info("Monitor page requested")
    sensor_data = await get_data()
    return TEMPLATES.TemplateResponse(
        "tools/monitor/monitor.html", {"request": request, "sensor_data": sensor_data}
    )


# Endpoint to get the monitor data
@monitor_router.get("/latest_data/", response_class=JSONResponse)
async def latest_data() -> SensorDataPoints:
    logging.info("Monitor data requested")

    # Get the latest data
    return await get_data()


async def get_data() -> SensorDataPoints:
    # Get the latest data
    if sensor_data_collection is not None:
        # Get the most recent two data points ignoring the _id field
        latest_data_db = (
            sensor_data_collection.find(
                {},
                {
                    "_id": 0,
                },
            )
            .sort([("timestamp", -1)])
            .limit(2)
        )

        # Convert the data to a list
        latest_data = [SensorData(**data) async for data in latest_data_db]

        # Create a message for each data point
        latest_data_messages = SensorDataPoints(
            data=[
                SensorDataMessage(
                    device_name=data.device_name,
                    timestamp=data.timestamp.astimezone(timezone.utc),
                    online=data.online,
                    temperature=data.temperature,
                    humidity=data.humidity,
                    device_id=data.device_name.lower().replace(" ", "-"),
                )
                for data in latest_data
            ]
        )

        # Return the data
        return latest_data_messages
    else:
        return SensorDataPoints(data=[])
