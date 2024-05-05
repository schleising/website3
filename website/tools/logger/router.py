from datetime import datetime, UTC
import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from pydantic import BaseModel

from . import event_collection, event_log_collection

# Set the base template location
TEMPLATES = Jinja2Templates("/app/templates")

# Instantiate the router object, ensure every request checks the user can use the tools
logger_router = APIRouter(prefix="/logger")


# Define the request body model for the PUT request
class Event(BaseModel):
    event: str


# Define the request body model for the POST request
class Log(BaseModel):
    event: str
    log_date: datetime | str


# Gets the Logger page
@logger_router.get("/", response_class=HTMLResponse)
async def logger(request: Request):
    logging.info("Logger page requested")

    # Get the event types from the database
    if event_collection is not None:
        event_types_from_db = event_collection.find()
        event_types = [Event(**event).event async for event in event_types_from_db]
    else:
        event_types = []

    # For each event type, get the last log entry
    last_logs = []
    for event in event_types:
        if event_log_collection is not None:
            last_log = await event_log_collection.find_one({"event": event}, sort=[("log_date", -1)])
            if last_log is not None:
                last_logs.append(last_log)
            else:
                last_logs.append(Log(event=event, log_date='Never'))
        else:
            last_logs.append(Log(event=event, log_date='Never'))

    return TEMPLATES.TemplateResponse(
        "tools/logger/logger.html", {"request": request, "last_logs": last_logs}
    )


# PUT request to create a new logging type
@logger_router.put("/create/", response_class=JSONResponse)
async def create_logging_type(request: Request):
    # Get the JSON data from the request
    data = await request.json()

    # Get the event type from the JSON data
    event = data["event"]

    # Log the new event type
    logging.info(f"New event type requested: {event}")

    # Insert the new event type into the database
    if event_collection is not None:
        # Create a new event type
        event = Event(event=event)

        # Insert the new event type into the database
        result = await event_collection.insert_one(event.model_dump())

        # Log the result of the insert operation
        logging.info(f"New event type inserted: {result.inserted_id}")

        # Return a 201 status code to indicate the resource was created
        return JSONResponse(
            content={"type": event},
            status_code=201,
            headers={"Content-Type": "application/json"},
        )
    else:
        # Return a 500 status code to indicate an internal server error
        return JSONResponse(
            content={"error": "Internal server error"},
            status_code=500,
            headers={"Content-Type": "application/json"},
        )


# POST request to log an event
@logger_router.post("/log/", response_class=JSONResponse)
async def log_event(request: Request):
    # Get the JSON data from the request
    data = await request.json()

    # Get the event log from the JSON data
    event: str = data["log"]

    # Log the new event
    logging.info(f"New event logged: {event}")

    # Insert the new event log into the database
    if event_collection is not None and event_log_collection is not None:
        # Check the event type exists
        event_type = await event_collection.find_one({"event": event})

        # If the event type does not exist, return a 400 status code
        if event_type is None:
            return JSONResponse(
                content={"error": "Event type does not exist"},
                status_code=400,
                headers={"Content-Type": "application/json"},
            )

        # Create a new event log
        log = Log(event=event, log_date=datetime.now().astimezone(UTC))

        # Insert the new event log into the database
        result = await event_log_collection.insert_one(log.model_dump())

        # Log the result of the insert operation
        logging.info(f"New event log inserted: {result.inserted_id}")
    else:
        # Return a 500 status code to indicate an internal server error
        return JSONResponse(
            content={"error": "Internal server error"},
            status_code=500,
            headers={"Content-Type": "application/json"},
        )

    # Return a 201 status code to indicate the resource was created
    return JSONResponse(
        content=json.loads(log.model_dump_json()),
        status_code=201,
        headers={"Content-Type": "application/json"},
    )
