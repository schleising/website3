import logging

from fastapi import FastAPI, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from .database.database import Database

from .account.router import account_router
from .account.admin import get_current_active_user

from .aircraft_db.router import aircraft_router

from .markdown.router import markdown_router

from .blog.router import blog_router

# Initialise logging
logging.basicConfig(format='Website: %(asctime)s - %(levelname)s - %(message)s', level=logging.INFO)

# Set the base template location
TEMPLATES = Jinja2Templates('/app/templates')

# Instantiate the application object, ensure every request sets the user into Request.state.user
app = FastAPI(dependencies=[
        Depends(get_current_active_user),
    ])

# Include the account router
app.include_router(account_router)

# Include the IRCA database router
app.include_router(aircraft_router)

# Include the markdown router
app.include_router(markdown_router)

# Include the blog router
app.include_router(blog_router)

# Get an instance of the Database class
MONGODB = Database()

# Set the database in use
MONGODB.set_database('item_database')

# Set the collection in use
COLLECTION = MONGODB.get_collection('item_collection')

# Gets the homepage
@app.get('/', response_class=HTMLResponse)
async def root(request: Request):
    return TEMPLATES.TemplateResponse('index.html', {'request': request})

# Close the connection when the app shuts down
@app.on_event('shutdown')
def close_db_connection() -> None:
    print('Closing DB Connection')
    MONGODB.client.close()
    print('Closed DB Connection')
