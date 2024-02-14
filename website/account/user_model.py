from typing import Optional
from fastapi.param_functions import Form

from pydantic import BaseModel

# Class for the user
class User(BaseModel):
    username: str
    first_name: str
    last_name: str
    disabled: bool
    can_use_tools: bool = False
    token_expiry: Optional[int] = 60 * 60 * 24 * 3

# The class as stored in the database with added salted and hashed password
class UserInDB(User):
    hashed_password: str

class CreateUserForm:
    def __init__(
        self,
        firstname: str = Form(),
        lastname: str = Form(),
        username: str = Form(),
        password: str = Form(),
    ):
        self.firstname = firstname
        self.lastname = lastname
        self.username = username
        self.password = password
