import logging
import os
from contextlib import asynccontextmanager

from starlette.types import ASGIApp, Receive, Scope, Send

from fastapi import FastAPI, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.exceptions import RequestValidationError
from fastapi.templating import Jinja2Templates

from .database.database import Database

from .account.router import account_router
from .account.admin import get_current_active_user
from .account.csrf import CSRF_COOKIE_NAME, ensure_csrf_token

from .aircraft_db.router import aircraft_router

from .markdown.router import markdown_router

from .blog.router import blog_router

from .football.router import football_router
from .football.football_db import initialise_teams_cache

from .feeds.router import feeds_router

from .tools.router import tools_router


class RealIPMiddleware:
    """
    ASGI middleware to set request.client.host from X-Real-IP or X-Forwarded-For.
    Works over Unix sockets or TCP proxies.
    """

    def __init__(self, app: ASGIApp, trusted_proxies=None):
        self.app = app
        # List of trusted proxy IPs/CIDRs allowed to set forwarded IP headers.
        self.trusted_proxies = trusted_proxies or []

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] == "http":
            headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
            real_ip = headers.get("x-real-ip")
            xff = headers.get("x-forwarded-for")

            client_ip = None

            if real_ip:
                client_ip = real_ip
            elif xff:
                # X-Forwarded-For may contain a comma-separated list; take first
                client_ip = xff.split(",")[0].strip()

            # Trust forwarded headers only from explicitly configured proxies.
            if scope.get("client"):
                remote_ip = scope["client"][0]
                if remote_ip not in self.trusted_proxies:
                    client_ip = None
            else:
                client_ip = None

            if client_ip:
                # Patch the ASGI client tuple (ip, port)
                scope["client"] = (client_ip, 0)

        await self.app(scope, receive, send)


# Initialise logging
logging.basicConfig(
    format="Website: %(asctime)s - %(levelname)s - %(message)s", level=logging.INFO
)

# Set the base template location
TEMPLATES = Jinja2Templates("/app/templates")

# Get an instance of the Database class
MONGODB = Database()

# Set the database in use
MONGODB.set_database("item_database")

# Set the collection in use
COLLECTION = MONGODB.get_collection("item_collection")


# Close the connection when the app shuts down
@asynccontextmanager
async def lifespan(app: FastAPI):
    await initialise_teams_cache()
    yield
    logging.debug("Closing DB Connection")
    MONGODB.client.close()
    logging.info("Closed DB Connection")


# Instantiate the application object, ensure every request sets the user into Request.state.user
app = FastAPI(
    dependencies=[
        Depends(get_current_active_user),
    ],
    lifespan=lifespan,
)

# Add the Real IP middleware
trusted_proxy_list = [
    proxy.strip()
    for proxy in os.getenv("TRUSTED_PROXY_IPS", "").split(",")
    if proxy.strip() != ""
]
app.add_middleware(RealIPMiddleware, trusted_proxies=trusted_proxy_list)


@app.middleware("http")
async def csrf_cookie_middleware(request: Request, call_next):
    csrf_token = ensure_csrf_token(request)
    request.state.csrf_token = csrf_token

    response = await call_next(request)

    existing = request.cookies.get(CSRF_COOKIE_NAME)
    if existing != csrf_token:
        response.set_cookie(
            key=CSRF_COOKIE_NAME,
            value=csrf_token,
            secure=True,
            httponly=False,
            samesite="lax",
            path="/",
        )

    return response

# Include the account router
app.include_router(account_router)

# Include the IRCA database router
app.include_router(aircraft_router)

# Include the markdown router
app.include_router(markdown_router)

# Include the blog router
app.include_router(blog_router)

# Include the blog router
app.include_router(football_router)

# Include the feeds router
app.include_router(feeds_router)

# Include the tools router
app.include_router(tools_router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    return TEMPLATES.TemplateResponse(
        request,
        "error.html",
        {"request": request, "error_str": str(exc)},
        status_code=400,
    )


# Gets the homepage
@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return TEMPLATES.TemplateResponse(request, "index.html", {"request": request})
