import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.exceptions import RequestValidationError
from fastapi.templating import Jinja2Templates

from .database.database import Database

from .account.router import account_router
from .account.admin import get_current_active_user

from .aircraft_db.router import aircraft_router

from .markdown.router import markdown_router

from .blog.router import blog_router

from .football.router import football_router

from .tools.router import tools_router

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
    yield
    print("Closing DB Connection")
    MONGODB.client.close()
    print("Closed DB Connection")


# Instantiate the application object, ensure every request sets the user into Request.state.user
app = FastAPI(
    dependencies=[
        Depends(get_current_active_user),
    ],
    lifespan=lifespan,
)

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

# Include the tools router
app.include_router(tools_router)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    return TEMPLATES.TemplateResponse(
        "error.html", {"request": request, "error_str": str(exc)}, status_code=400
    )


# Gets the homepage
@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return TEMPLATES.TemplateResponse("index.html", {"request": request})
