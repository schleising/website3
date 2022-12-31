from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from .database.database import Database

from .aircraft_db.router import aircraft_router

TEMPLATES = Jinja2Templates('/app/templates')

app = FastAPI()

# Include the IRCA database router
app.include_router(aircraft_router)

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
