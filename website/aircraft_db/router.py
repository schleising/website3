from fastapi import APIRouter, Request, WebSocket, Depends
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from starlette.websockets import WebSocketDisconnect

from bson.regex import Regex

from .aircraft_model import AircraftModel, TailNumberLookup, TailNumbersResponse
from .aircraft_reader import IrcaReader
from . import irca_collection

from ..account.user_model import User
from ..account.admin import ws_get_current_active_user

TEMPLATES = Jinja2Templates('/app/templates')

aircraft_router = APIRouter(prefix='/aircraft')

@aircraft_router.get('/', response_class=HTMLResponse)
async def get_aircraft_page(request: Request):
    return TEMPLATES.TemplateResponse('aircraft_db/aircraft_template.html', {'request': request})

@aircraft_router.get('/tail_no/{tail_no}', response_model=AircraftModel | None)
async def get_ac(tail_no: str | None = None):
    reader = IrcaReader()

    if tail_no is not None:
        # Get the aircraft with the registration field equal to the requested tail number
        ac = await reader.get_ac_by_tail_no(tail_no.upper())
        return ac

@aircraft_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, user: User | None = Depends(ws_get_current_active_user)):
    await websocket.accept()

    try:
        while True:
            # Wait for a message from the client
            data = await websocket.receive_text()

            # Parse the data into a model
            tail_no_msg = TailNumberLookup.parse_raw(data)

            # Create a regex to search the database
            tail_no_regex = Regex(f'^{tail_no_msg.tail_no.upper()}')

            # Create an empty response
            response_msg = TailNumbersResponse()

            if irca_collection is not None:
                # Get the first ten tail number matches
                results = irca_collection.find({ "registration": tail_no_regex }).limit(10)

                async for result in results:
                    # Parse the result into an Aircraft Model
                    aircraft = AircraftModel(**result)

                    # Append the tail number to the response list
                    if aircraft.registration != '':
                        response_msg.tail_numbers.append(aircraft.registration)

            # Send the response back to the client
            await websocket.send_text(response_msg.json())

    except WebSocketDisconnect:
        print('Socket Closed')
