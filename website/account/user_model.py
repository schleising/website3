from pydantic import BaseModel

# Class for the user
class User(BaseModel):
    username: str
    first_name: str
    last_name: str
    disabled: bool

# The class as stored in the database with added salted and hashed password
class UserInDB(User):
    hashed_password: str
