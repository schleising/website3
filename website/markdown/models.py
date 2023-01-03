from pydantic import BaseModel

from ..account.user_model import User

class DataToConvert(BaseModel):
    # user: User
    text: str
