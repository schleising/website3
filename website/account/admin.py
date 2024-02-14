from datetime import datetime, timedelta
import logging
from typing import Any, Dict, Optional, cast

from fastapi import Depends, status
from starlette.requests import HTTPConnection

from fastapi.security import OAuth2
from fastapi.openapi.models import OAuthFlows as OAuthFlowsModel

from starlette.responses import RedirectResponse

from pymongo.errors import DuplicateKeyError

from jose import JWTError, jwt

from passlib.context import CryptContext

from pydantic import BaseModel

from .user_model import User, UserInDB

from . import user_collection

# to get a string like this run:
# openssl rand -hex 32
with open('/app/secrets/secret_key.txt', encoding='utf8') as secret_file:
    SECRET_KEY = secret_file.read().strip()

# Use the HS256 signing algorithm for the JWT token
ALGORITHM = "HS256"

# Class describing the token and token type
class Token(BaseModel):
    access_token: str
    token_type: str

# Class for the token data
class TokenData(BaseModel):
    username: str | None = None

# This class is a copy of the FastAPI OAuth2PasswordBearer to check for a cookie
# rather than the Authorization header as this does not work in a web app
class CookieOAuth2PasswordBearer(OAuth2):
    def __init__(
        self,
        tokenUrl: str,
        scheme_name: Optional[str] = None,
        scopes: Optional[Dict[str, str]] = None,
        description: Optional[str] = None,
        auto_error: bool = True,
    ):
        if not scopes:
            scopes = {}
        flows = OAuthFlowsModel(
            password=cast(Any, {"tokenUrl": tokenUrl, "scopes": scopes})
        )
        super().__init__(
            flows=flows,
            scheme_name=scheme_name,
            description=description,
            auto_error=auto_error,
        )

    async def __call__(self, request: HTTPConnection) -> Optional[str]:
        logging.debug(f'CookieOAuth2PasswordBearer: {request}')
        scheme = 'bearer'
        param = request.cookies.get('token')

        if param is None or scheme.lower() != "bearer":
            if self.auto_error:
                return None
            else:
                return None
        return param

# Use bcrypt to hash the password
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Use the bespoke Cookie OAuth2 scheme
oauth2_scheme = CookieOAuth2PasswordBearer(tokenUrl="/account/token")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    # Veryfy the plain and hashed passwords match
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    # Get the hashed version of the plaintext password 
    return pwd_context.hash(password)

async def get_user_in_db(username: str) -> UserInDB | None:
    if user_collection is not None:
        # If the user collection exists try to get the user
        dbuser = await user_collection.find_one({'username': username})

        if dbuser is not None:
            # If the user exists, return it with the hashed password
            return UserInDB(**dbuser)
        else:
            # If the user does not exist return None
            return None
    else:
        # If the collectiion does not exist, return None
        return None

async def get_user(username: str) -> User | None:
    if user_collection is not None:
        # If the user collection exists try to get the user
        dbuser = await user_collection.find_one({'username': username})

        if dbuser is not None:
            # If the user exists, return it without the hashed password
            return User(**dbuser)
        else:
            # If the user does not exist return None
            return None
    else:
        # If the collectiion does not exist, return None
        return None

async def authenticate_user(username: str, password: str) -> User | None:
    # Try to get the user
    user = await get_user_in_db(username)

    if user is None:
        # Return None if the user is not found
        return None
    elif not verify_password(password, user.hashed_password):
        # Return None if the password is not verified
        return None
    else:
        # Return the valid User without the hashed password
        return User(**user.model_dump())

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    # Copy the data to be encoded
    to_encode = data.copy()

    # Set the expiry time to the requested time or 15 minutes if it is not set
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)

    # Add this to the data to be encoded
    to_encode.update({"exp": expire})

    # Encode the JSON Web Token
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

    # Return the token
    return encoded_jwt

async def get_current_user(token: str | None = Depends(oauth2_scheme)) -> User | None:
    # Check whether there is a token
    if token is not None:
        try:
            # Attempt to decode the token
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

            # If successfully decoded get the username
            username: str = str(payload.get("sub"))

            # If there is no username present return None
            if username is None:
                return None

            # Set the username in the token data structure, not sure this is really needed
            token_data = TokenData(username=username)
        except JWTError:
            # If the token could not be decoded return None
            return None

        # If the username is not present return None
        if token_data.username is None:
            return None
        else:
            # Get the user from the database
            user = await get_user(username=token_data.username)

        # If the user does not exist return None
        if user is None:
            return None

        # Return the user
        return user
    else:
        # Return None if there is no Token
        return None

async def get_current_active_user(request: HTTPConnection, current_user: User | None = Depends(get_current_user)) -> None:
    logging.debug(f'get_current_active_user - request: {request}')
    logging.debug(f'get_current_active_user - current_user: {current_user}')

    # Check whether we have got a user
    if current_user is not None:
        if current_user.disabled:
            # If the user is disabled set request.state.user to None
            request.state.user = None

        # If the user exists set request.state.user to be the user
        request.state.user = current_user
    else:
        # If we have not got a user set request.state.user to None
        request.state.user = None

async def create_new_user(firstname: str, lastname: str, username: str, password: str) -> User | None:
    # Hash the password
    hashed_password = get_password_hash(password)

    # Create a new user object for the database with the hashed password
    new_user = UserInDB(
        first_name=firstname,
        last_name=lastname,
        username=username,
        hashed_password=hashed_password,
        disabled=False
    )

    # Check we have a collection
    if user_collection is not None:
        try:
            # Insert the new user
            await user_collection.insert_one(new_user.model_dump())
        except DuplicateKeyError:
            # If the username already exists return None
            return None

        # Get the new user
        user = await get_user(username)

        if user is not None:
            # Return the user
            return user
        else:
            # Return None
            return None
    else:
            # Return None
        return None

def get_login_response(user: User, url: str) -> RedirectResponse:
    # If the user is valid, create a JWT token
    access_token_expires = timedelta(seconds=user.token_expiry) if user.token_expiry is not None else None

    # Create the token
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )

    # Create a redirect response to the login success page
    response = RedirectResponse(f'/account/{url}', status_code=status.HTTP_303_SEE_OTHER)

    # Set a cookie on the response with the contents as the JWT token
    response.set_cookie(
        key="token",
        max_age=user.token_expiry,
        value=access_token,
        secure=True,
        httponly=True,
        samesite='lax'
    )

    # Return the reponse
    return response
