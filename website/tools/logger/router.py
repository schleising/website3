from datetime import datetime, timedelta, UTC
import json
import logging
from typing import Annotated

from bson import ObjectId

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from pydantic import BaseModel, Field

from ...database.models import ObjectIdPydanticAnnotation

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


class LogWithCount(Log):
    count: int


class LogWithID(Log):
    id: Annotated[ObjectId, ObjectIdPydanticAnnotation] = Field(..., alias='_id')


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
            # Get the last log entry for the event type
            last_log_from_db = await event_log_collection.find_one(
                {"event": event}, sort=[("log_date", -1)]
            )

            if last_log_from_db is not None:
                # Create a Log object from the last log entry
                last_log = Log(**last_log_from_db)

                # Get the count of logs for the event type in the last 24 hours
                log_count = await event_log_collection.count_documents(
                    {
                        "event": event,
                        "log_date": {
                            "$gte": datetime.now().astimezone(UTC) - timedelta(days=1),
                        },
                    }
                )

                # Create a LogWithCount object to include the count of logs
                last_logs.append(
                    LogWithCount(
                        event=last_log.event,
                        log_date=last_log.log_date,
                        count=log_count,
                    )
                )
            else:
                # If there are no logs for the event type, create a LogWithCount object with a count of 0
                last_logs.append(LogWithCount(event=event, log_date="Never", count=0))
        else:
            # If the collection does not exist, create a LogWithCount object with a count of 0
            last_logs.append(LogWithCount(event=event, log_date="Never", count=0))

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

        # Check the event type does not already exist
        event_type = await event_collection.find_one({"event": event.event})

        # If the event type already exists, return a 400 status code
        if event_type is not None:
            return JSONResponse(
                content={"error": "Event type already exists"},
                status_code=400,
                headers={"Content-Type": "application/json"},
            )

        # Insert the new event type into the database
        result = await event_collection.insert_one(event.model_dump())

        # Log the result of the insert operation
        logging.info(f"New event type inserted: {result.inserted_id}")

        # Return a 201 status code to indicate the resource was created
        return JSONResponse(
            content={"type": event.event},
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

        # Get the count of logs for the event type in the last 24 hours
        log_count = await event_log_collection.count_documents(
            {
                "event": event,
                "log_date": {
                    "$gte": datetime.now().astimezone(UTC) - timedelta(days=1),
                },
            }
        )

        # Create a LogWithCount object
        log_with_count = LogWithCount(
            event=log.event, log_date=log.log_date, count=log_count
        )

        # Log the result of the insert operation
        logging.info(f"New event log inserted: {result.inserted_id}")

        # Return a 201 status code to indicate the resource was created
        return JSONResponse(
            content=json.loads(log_with_count.model_dump_json()),
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


# Handler for the stats page
@logger_router.get("/stats/{event_type}", response_class=HTMLResponse)
async def stats(event_type: str, request: Request):
    logging.info(f"Logger stats page requested for {event_type}")

    # Get a list of logs for the event type in descending order
    logs = []
    if event_log_collection is not None:
        logs_from_db = event_log_collection.find({"event": event_type}).sort(
            "log_date", -1
        )
        logs = [LogWithID(**log).model_dump() async for log in logs_from_db]

    # Return a template response
    return TEMPLATES.TemplateResponse(
        "tools/logger/stats.html",
        {"request": request, "event": event_type, "logs": logs},
    )


# Handler for the charts page
@logger_router.get("/charts/{event_type}", response_class=HTMLResponse)
async def charts(event_type: str, request: Request):
    logging.info(f"Logger charts page requested for {event_type}")

    # Return a 404 response
    return JSONResponse(
        content={"error": "Not found"},
        status_code=404,
        headers={"Content-Type": "application/json"},
    )

# Handler for an edit event type request
@logger_router.put("/edit/{event_id}", response_class=JSONResponse)
async def edit_event_type(event_id: str, request: Request):
    # Get the JSON data from the request
    data = await request.json()

    # Get the event type from the JSON data
    event = data["event"]

    # Log the edit event type request
    logging.info(f"Edit event type requested: {event}")

    # Update the event type in the database
    if event_log_collection is not None:
        # Create a new event type
        event = Event(event=event)

        # Update the event type in the database
        result = await event_log_collection.update_one(
            {"_id": ObjectId(event_id)}, {"$set": {"event": event.event}}
        )

        # Check if the event type was updated
        if result.modified_count == 0:
            # Log an error if the event type was not found
            logging.error(f"Event not found: {event_id}")

            # Return a 404 status code to indicate the resource was not found
            return JSONResponse(
                content={"error": "Event not found"},
                status_code=404,
                headers={"Content-Type": "application/json"},
            )

        # Log the result of the update operation
        logging.info(f"Event type updated: {result.modified_count}")

        # Return a 201 status code to indicate the resource was updated
        return JSONResponse(
            content={"type": event.event},
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
    
# Handler for a delete event request
@logger_router.delete("/delete/{event_id}", response_class=JSONResponse)
async def delete_event(event_id: str, request: Request):
    # Log the delete event request
    logging.info(f"Delete event requested: {event_id}")

    # Delete the event type from the database
    if event_log_collection is not None:
        # Delete the event type from the database
        result = await event_log_collection.delete_one({"_id": ObjectId(event_id)})

        # Check if the event was deleted
        if result.deleted_count == 0:
            # Log an error if the event was not found
            logging.error(f"Event not found: {event_id}")

            # Return a 404 status code to indicate the resource was not found
            return JSONResponse(
                content={"error": "Event not found"},
                status_code=404,
                headers={"Content-Type": "application/json"},
            )

        # Log the result of the delete operation
        logging.info(f"Event deleted: {result.deleted_count}")

        # Return a 204 status code to indicate the resource was deleted
        return JSONResponse(
            content={},
            status_code=204,
            headers={"Content-Type": "application/json"},
        )
    else:
        # Return a 500 status code to indicate an internal server error
        return JSONResponse(
            content={"error": "Internal server error"},
            status_code=500,
            headers={"Content-Type": "application/json"},
        )
