from datetime import timedelta

from fastapi import APIRouter, Request, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from starlette.responses import RedirectResponse

from .admin import authenticate_user, create_access_token, ACCESS_TOKEN_EXPIRE_SECONDS
from .user_model import User

# Set the Jinja template location
TEMPLATES = Jinja2Templates('/app/templates')

# Create an account router
account_router = APIRouter(prefix='/account')

@account_router.get('/login', response_class=HTMLResponse)
async def get_login_page(request: Request):
    # Render the login page
    return TEMPLATES.TemplateResponse('account/login.html', {'request': request, 'login_failed': False})

@account_router.post('/token')
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    # Check the username and password, if valid the user will be returned, if not it will be None
    user = await authenticate_user(form_data.username, form_data.password)

    if user is None:
        # If the user has not beee authenticated, redirect back to the lgin page
        response = RedirectResponse('/account/login', status_code=status.HTTP_303_SEE_OTHER)

        # Ensure that the response deletes any cookie which may still be in the browser
        response.delete_cookie('token')

        # Return the redirect response
        return response

    # If the user is valid, create a JWT token
    access_token_expires = timedelta(seconds=ACCESS_TOKEN_EXPIRE_SECONDS)

    # Create the token
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )

    # Create a redirect response to the login success page
    response = RedirectResponse('/account/login_success', status_code=status.HTTP_303_SEE_OTHER)

    # Set a cookie on the response with the contents as the JWT token
    response.set_cookie(
        key="token",
        max_age=ACCESS_TOKEN_EXPIRE_SECONDS,
        value=access_token,
        secure=True,
        httponly=True,
        samesite='strict'
    )

    # Return the response
    return response

@account_router.get('/login_success', response_class=HTMLResponse)
async def login_success(request: Request):
    # Render the login success page
    return TEMPLATES.TemplateResponse('account/login_success.html', {'request': request})

@account_router.get('/create', response_class=HTMLResponse)
async def get_create_page(request: Request):
    # Render the create account page
    return TEMPLATES.TemplateResponse('account/create.html', {'request': request})

@account_router.get('/protected')
async def protected(request: Request) -> User | None:
    user: User = request.state.user
    if user is not None:
        return user
    else:
        return None
