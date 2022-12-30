from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from .database.database import Database
from .database.models.item_model import ItemModel

TEMPLATES = Jinja2Templates('/app/templates')

app = FastAPI()

# Get an instance of the Database class
MONGODB = Database()

# Set the database in use
MONGODB.set_database('item_database')

# Set the collection in use
COLLECTION = MONGODB.get_collection('item_collection')

# Gets the homepage
@app.get('/', response_class=HTMLResponse)
async def root(request: Request):
    print('Hello')
    return TEMPLATES.TemplateResponse('index.html', {'request': request})

# Dirty attempt to add test items to the database
@app.get('/items/{item_id}', response_model=ItemModel)
async def post_item(item_id: int):
    # Create an instance of ItemModel
    item = ItemModel(name=str(item_id), number=item_id)

    if COLLECTION is not None:
        # If we have got a collection, insert the new item
        result = await COLLECTION.insert_one(item.dict())

        # Print the result
        print(f'{item_id} Added as {result.inserted_id}')

        # Return the item as a json string to the browser
        return item
    else:
        # Log that the item was not added
        print(f'{item_id} NOT Added')

        # Return the item as a json string to the browser
        return item

# Close the connection when the app shuts down
@app.on_event('shutdown')
def close_db_connection() -> None:
    print('Closing DB Connection')
    MONGODB.client.close()
    print('Closed DB Connection')
