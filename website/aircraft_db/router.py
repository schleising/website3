from fastapi import APIRouter

from .aircraft_model import AircraftModel
from .aircraft_reader import IrcaReader

aircraft_router = APIRouter(prefix='/aircraft')

@aircraft_router.get('/', response_model=AircraftModel | None)
async def get_ac(tail_no: str | None = None):
    reader = IrcaReader()

    if tail_no is not None:
        # Get the aircraft with the registration field equal to the requested tail number
        ac = await reader.get_ac_by_tail_no(tail_no)
        return ac
