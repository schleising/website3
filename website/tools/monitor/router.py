import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from . import sensors_collection, sensor_data_collection
from .models import SensorDataPoints, SensorData, SensorDataMessage, TimeseriesDataPoint, TimeseriesData, TimeseriesDataResponse

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
        # Get the most recent entry for each device_name sorted by device_name
        latest_data_db = sensor_data_collection.aggregate(
            [
                {"$sort": {"device_name": 1, "timestamp": -1}},
                {
                    "$group": {
                        "_id": "$device_name",
                        "data": {"$first": "$$ROOT"},
                    }
                },
            ]
        )

        # Convert the data to a list
        latest_data = [SensorData(**item["data"]) async for item in latest_data_db if item["data"]["device_name"] != "Office Thermometer"]

        # Sort the data by device_name
        latest_data.sort(key=lambda x: x.device_name)

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


# Endpoint to get the timeseries data
@monitor_router.get("/timeseries/", response_class=JSONResponse)
async def timeseries() -> TimeseriesDataResponse:
    logging.info("Timeseries data requested")

    if sensor_data_collection is None:
        return TimeseriesDataResponse(data=[])

    # Get the device names
    device_names: list[str] = await sensor_data_collection.distinct("device_name")

    # Remove the Office Thermometer from the list
    device_names.remove("Office Thermometer")

    logging.debug(f"Device names: {device_names}")

    # Create a list to store the timeseries data
    timeseries_data: list[TimeseriesData] = []

    # Get the timeseries data for each device over the last 24 hours
    for device_name in device_names:
        # Get the data for the device
        data = sensor_data_collection.find(
            {"device_name": device_name, "timestamp": {"$gte": datetime.now() - timedelta(days=1)}}
        ).sort([("timestamp", 1)])

        # Parse the data into a list of SensorData objects
        data_list = [SensorData(**item) async for item in data]

        # Create a list of TimeseriesDataPoint objects
        timeseries_data_points = [
            TimeseriesDataPoint(
                timestamp=item.timestamp.astimezone(timezone.utc).isoformat(),
                temp=item.temperature,
                humidity=item.humidity,
            )
            for item in data_list
        ]

        # Add the timeseries data to the list
        timeseries_data.append(TimeseriesData(device_id=device_name.lower().replace(" ", "-"), data=timeseries_data_points))

    # Return the timeseries data
    return TimeseriesDataResponse(data=timeseries_data)
