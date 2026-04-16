from urllib.parse import urlencode, urlparse
from collections import deque
from time import time

from fastapi import APIRouter, Request, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from starlette.responses import RedirectResponse

from .admin import authenticate_user, create_new_user, get_login_response
from .csrf import validate_csrf
from .user_model import User, CreateUserForm

# Set the Jinja template location
TEMPLATES = Jinja2Templates("/app/templates")

# Create an account router
account_router = APIRouter(prefix="/account")

SIGNUP_WINDOW_SECONDS = 15 * 60
SIGNUP_MAX_ATTEMPTS_PER_WINDOW = 6
SIGNUP_MIN_FORM_FILL_SECONDS = 2.5
SIGNUP_MAX_FORM_AGE_SECONDS = 2 * 60 * 60

signup_attempts_by_ip: dict[str, deque[float]] = {}


def _client_ip(request: Request) -> str:
    client = request.client
    host = getattr(client, "host", None)
    if isinstance(host, str) and host.strip() != "":
        return host.strip()
    return "unknown"


def _prune_signup_attempts(now_ts: float, attempts: deque[float]) -> None:
    cutoff = now_ts - SIGNUP_WINDOW_SECONDS
    while len(attempts) > 0 and attempts[0] < cutoff:
        attempts.popleft()


def _is_signup_rate_limited(request: Request) -> bool:
    now_ts = time()
    ip = _client_ip(request)
    attempts = signup_attempts_by_ip.setdefault(ip, deque())
    _prune_signup_attempts(now_ts, attempts)
    return len(attempts) >= SIGNUP_MAX_ATTEMPTS_PER_WINDOW


def _record_signup_attempt(request: Request) -> None:
    now_ts = time()
    ip = _client_ip(request)
    attempts = signup_attempts_by_ip.setdefault(ip, deque())
    _prune_signup_attempts(now_ts, attempts)
    attempts.append(now_ts)


def _is_bot_like_create_submission(form_data: CreateUserForm) -> bool:
    # Honeypot should stay empty for human users.
    if form_data.website.strip() != "":
        return True

    now_ts = time()
    try:
        loaded_at = float(form_data.form_loaded_at)
    except (TypeError, ValueError):
        return True

    elapsed = now_ts - loaded_at
    if elapsed < SIGNUP_MIN_FORM_FILL_SECONDS:
        return True
    if elapsed > SIGNUP_MAX_FORM_AGE_SECONDS:
        return True

    return False


def _safe_next_path(raw_next: str | None) -> str | None:
    if raw_next is None:
        return None

    candidate = raw_next.strip()
    if candidate == "":
        return None

    parsed = urlparse(candidate)

    # Allow only local relative paths (or path+query+fragment forms without scheme/netloc).
    if parsed.scheme != "" or parsed.netloc != "":
        return None

    if not candidate.startswith("/"):
        return None

    # Avoid protocol-relative redirects.
    if candidate.startswith("//"):
        return None

    # Prevent redirect loops back into login/token endpoints.
    blocked_prefixes = (
        "/account/login",
        "/account/token",
    )
    lower_path = parsed.path.lower()
    if any(lower_path.startswith(prefix) for prefix in blocked_prefixes):
        return None

    return candidate


def _build_login_url(result: str | None, next_path: str | None) -> str:
    params: list[tuple[str, str]] = []
    if result:
        params.append(("result", result))
    if next_path:
        params.append(("next", next_path))

    if len(params) == 0:
        return "/account/login/"

    return f"/account/login/?{urlencode(params)}"


@account_router.get("/login", response_class=HTMLResponse)
@account_router.get("/login/", response_class=HTMLResponse)
async def get_login_page(
    request: Request,
    result: str | None = None,
    next: str | None = None,
):
    next_path = _safe_next_path(next)

    # Render the login page
    return TEMPLATES.TemplateResponse(
        request,
        "account/login.html",
        {
            "request": request,
            "result": result,
            "next_path": next_path,
        },
    )


@account_router.get("/logout", response_class=HTMLResponse)
@account_router.get("/logout/", response_class=HTMLResponse)
async def get_logout_page(request: Request, result: str | None = None):
    # Clear the user from the request
    request.state.user = None

    # Get the response
    response = TEMPLATES.TemplateResponse(
        request, "account/logout.html", {"request": request, "result": result}
    )

    # Ensure the cookie gets deleted
    response.delete_cookie("token")

    # Render the logout page
    return response


@account_router.post("/token", response_class=HTMLResponse)
@account_router.post("/token/", response_class=HTMLResponse)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    _: None = Depends(validate_csrf),
):
    submitted_form = await request.form()
    submitted_next = submitted_form.get("next")
    next_path = _safe_next_path(submitted_next if isinstance(submitted_next, str) else None)

    # Check the username and password, if valid the user will be returned, if not it will be None
    user = await authenticate_user(form_data.username, form_data.password)

    if user is None:
        # If the user has not beee authenticated, redirect back to the lgin page
        response = RedirectResponse(_build_login_url("login_failed", next_path), status_code=status.HTTP_303_SEE_OTHER)

        # Ensure that the response deletes any cookie which may still be in the browser
        response.delete_cookie("token")

        # Return the redirect response
        return response

    # Get the login response
    redirect_target = next_path or "/account/login_success/"
    response = get_login_response(user, redirect_target)

    # Return the response
    return response


@account_router.get("/login_success", response_class=HTMLResponse)
@account_router.get("/login_success/", response_class=HTMLResponse)
async def login_success(request: Request):
    # Render the login success page
    return TEMPLATES.TemplateResponse(
        request, r"account/login_success.html", {"request": request}
    )


@account_router.get("/create", response_class=HTMLResponse)
@account_router.get("/create/", response_class=HTMLResponse)
async def get_create_page(request: Request, result: str | None = None):
    # Render the create account page
    return TEMPLATES.TemplateResponse(
        request,
        "account/create.html",
        {
            "request": request,
            "result": result,
            "form_loaded_at": f"{time():.6f}",
        },
    )


@account_router.post("/create_user")
@account_router.post("/create_user/")
async def create_user(
    request: Request,
    form_data: CreateUserForm = Depends(),
    _: None = Depends(validate_csrf),
):
    if _is_signup_rate_limited(request):
        return RedirectResponse(
            "/account/create/?result=create_failed",
            status_code=status.HTTP_303_SEE_OTHER,
        )

    _record_signup_attempt(request)

    if _is_bot_like_create_submission(form_data):
        return RedirectResponse(
            "/account/create/?result=create_failed",
            status_code=status.HTTP_303_SEE_OTHER,
        )

    # Try to create the new user
    user = await create_new_user(
        form_data.firstname, form_data.lastname, form_data.username, form_data.password
    )

    if user is not None:
        # Set the user as the Request,state,user object
        request.state.user = user

        # Get the login response
        response = get_login_response(user, "create_success/")

        # Return the response
        return response
    else:
        # Redirect to the create page
        return RedirectResponse(
            "/account/create/?result=create_failed",
            status_code=status.HTTP_303_SEE_OTHER,
        )


@account_router.get("/create_success", response_class=HTMLResponse)
@account_router.get("/create_success/", response_class=HTMLResponse)
async def create_success(request: Request):
    # Render the login success page
    return TEMPLATES.TemplateResponse(
        request, "account/create_success.html", {"request": request}
    )


@account_router.get("/protected")
@account_router.get("/protected/")
async def protected(request: Request) -> User | None:
    user: User = request.state.user
    if user is not None:
        return user
    else:
        return None
