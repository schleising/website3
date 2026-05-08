from datetime import UTC, datetime
from typing import Optional
from fastapi.param_functions import Form

from pydantic import BaseModel, Field


def _utc_now() -> datetime:
    return datetime.now(tz=UTC)


class PasskeyCredential(BaseModel):
    credential_id: str
    public_key: str
    sign_count: int = 0
    transports: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utc_now)
    last_used_at: Optional[datetime] = None
    revoked: bool = False

# Class for the user
class User(BaseModel):
    username: str
    first_name: str
    last_name: str
    disabled: bool
    can_use_tools: bool = False
    token_expiry: Optional[int] = 60 * 60 * 24 * 3
    user_handle_b64url: Optional[str] = None
    passkey_credentials: list[PasskeyCredential] = Field(default_factory=list)

# The class as stored in the database with added salted and hashed password
class UserInDB(User):
    # Legacy accounts may still carry a password hash until migration completes.
    hashed_password: Optional[str] = None

class CreateUserForm:
    def __init__(
        self,
        firstname: str = Form(),
        lastname: str = Form(),
        username: str = Form(),
        password: str = Form(),
        website: str = Form(default=""),
        form_loaded_at: str = Form(default=""),
    ):
        self.firstname = firstname
        self.lastname = lastname
        self.username = username
        self.password = password
        self.website = website
        self.form_loaded_at = form_loaded_at
