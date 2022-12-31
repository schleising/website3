from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from .aircraft_model import AircraftModel
from .aircraft_reader import IrcaReader

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
