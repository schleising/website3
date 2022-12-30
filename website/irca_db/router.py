from fastapi import APIRouter

from .irca_model import IrcaModel
from .irca_reader import IrcaReader

irca_router = APIRouter(prefix='/irca')

@irca_router.get('/', response_model=IrcaModel | None)
async def get_ac(tail_no: str | None = None):
    reader = IrcaReader()

    if tail_no is not None:
        # Get the aircraft with the registration field equal to the requested tail number
        ac = await reader.get_ac_by_tail_no(tail_no)
        return ac
