from . import irca_collection
from .irca_model import IrcaModel

class IrcaReader:
    def __init__(self) -> None:
        self.collection = irca_collection

    async def get_ac_by_tail_no(self, tail_no: str) -> IrcaModel | None:
        if irca_collection is not None:
            # Get the aircraft with the registration field equal to the requested tail number
            ac: IrcaModel | None = await irca_collection.find_one({'registration': tail_no})
            return ac
        else:
            return None
