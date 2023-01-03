from fastapi import APIRouter, Request, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from starlette.responses import RedirectResponse

from .admin import authenticate_user, create_new_user, get_login_response
from .user_model import User, CreateUserForm

# Set the Jinja template location
TEMPLATES = Jinja2Templates('/app/templates')

# Create an account router
account_router = APIRouter(prefix='/account')

@account_router.get('/login', response_class=HTMLResponse)
async def get_login_page(request: Request, result: str| None = None):
    # Render the login page
    return TEMPLATES.TemplateResponse('account/login.html', {'request': request, 'result': result})

@account_router.get('/logout', response_class=HTMLResponse)
async def get_logout_page(request: Request, result: str| None = None):
    # Clear the user from the request
    request.state.user = None

    # Get the response
    response = TEMPLATES.TemplateResponse('account/logout.html', {'request': request, 'result': result})

    # Ensure the cookie gets deleted
    response.delete_cookie('token')

    # Render the logout page
    return response

@account_router.post('/token')
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    # Check the username and password, if valid the user will be returned, if not it will be None
    user = await authenticate_user(form_data.username, form_data.password)

    if user is None:
        # If the user has not beee authenticated, redirect back to the lgin page
        response = RedirectResponse('/account/login?result=login_failed', status_code=status.HTTP_303_SEE_OTHER)

        # Ensure that the response deletes any cookie which may still be in the browser
        response.delete_cookie('token')

        # Return the redirect response
        return response

    # Get the login response
    response = get_login_response(user, 'login_success')

    # Return the response
    return response

@account_router.get('/login_success', response_class=HTMLResponse)
async def login_success(request: Request):
    # Render the login success page
    return TEMPLATES.TemplateResponse('account/login_success.html', {'request': request})

@account_router.get('/create', response_class=HTMLResponse)
async def get_create_page(request: Request, result: str | None = None):
    # Render the create account page
    return TEMPLATES.TemplateResponse('account/create.html', {'request': request, 'result': result})

@account_router.post('/create_user')
async def create_user(request: Request, form_data: CreateUserForm = Depends()):
    # Try to create the new user
    user = await create_new_user(form_data.firstname, form_data.lastname, form_data.username, form_data.password)

    if user is not None:
        # Set the user as the Request,state,user object
        request.state.user = user

        # Get the login response
        response = get_login_response(user, 'create_success')

        # Return the response
        return response
    else:
        # Redirect to the create page
        return RedirectResponse('/account/create?result=create_failed', status_code=status.HTTP_303_SEE_OTHER)

@account_router.get('/create_success', response_class=HTMLResponse)
async def create_success(request: Request):
    # Render the login success page
    return TEMPLATES.TemplateResponse('account/create_success.html', {'request': request})

@account_router.get('/protected')
async def protected(request: Request) -> User | None:
    user: User = request.state.user
    if user is not None:
        return user
    else:
        return None
