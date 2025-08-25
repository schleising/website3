from . import irca_collection
from .aircraft_model import AircraftModel

class IrcaReader:
    def __init__(self) -> None:
        self.collection = irca_collection

    async def get_ac_by_tail_no(self, tail_no: str) -> AircraftModel | None:
        if irca_collection is not None:
            # Get the aircraft with the registration field equal to the requested tail number
            ac_db = await irca_collection.find_one({'registration': tail_no})

            # If we got an aircraft, convert it to an AircraftModel
            if ac_db is not None:
                ac = AircraftModel.model_validate(ac_db)
            else:
                ac = None

            return ac
        else:
            return None
