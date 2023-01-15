from datetime import datetime

from fastapi import APIRouter, Request, WebSocket, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from starlette.websockets import WebSocketDisconnect

from pymongo.results import UpdateResult
from pymongo.errors import DuplicateKeyError, WriteError

from markdown import markdown

from ..account.user_model import User
from ..account.admin import ws_get_current_active_user

from . import markdown_collection

from .models import MarkdownDataMessage, MarkdownDataToDb, MarkdownResponse

# Set the Jinja template location
TEMPLATES = Jinja2Templates('/app/templates')

# Create an account router
markdown_router = APIRouter(prefix='/markdown')

@markdown_router.get('/', response_class=HTMLResponse)
async def editor(request: Request):
    return TEMPLATES.TemplateResponse('/markdown/editor.html', {'request': request})

@markdown_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, user: User | None = Depends(ws_get_current_active_user)):
    await websocket.accept()

    try:
        while True:
            # Indicates whether data has been saved to the DB
            data_saved = None

            # Wait for a message from the client
            data = await websocket.receive_text()

            # Get the message text into a Pydantic model
            data_to_convert = MarkdownDataMessage.parse_raw(data)

            # Convert the markdown text to formatted text
            converted_text = markdown(data_to_convert.text, extensions=[
                'markdown.extensions.admonition',
                'pymdownx.extra',
                'md_mermaid',
            ])

            # Check whether the data should be saved to the DB
            if data_to_convert.save_data and user is not None:
                if markdown_collection is not None:
                    # Create a database type
                    db_input = MarkdownDataToDb(**data_to_convert.dict(), username=user.username, last_updated=datetime.utcnow())

                    try:
                        # Add the data to the database
                        result: UpdateResult = await markdown_collection.replace_one({'title': data_to_convert.title, 'username': user.username}, jsonable_encoder(db_input), upsert=True)

                        # If the transaction was successful, set data_savedd to True
                        if result.modified_count > 0 or result.upserted_id is not None:
                            data_saved = True
                        else:
                            data_saved = False
                    except DuplicateKeyError:
                        data_saved = False
                    except WriteError:
                        data_saved = False

            # Create a response message
            responseMsg = MarkdownResponse(
                markdown_text = converted_text,
                data_saved = data_saved
            )

            # Send the response back to the client
            await websocket.send_text(responseMsg.json())

    except WebSocketDisconnect:
        print('Socket Closed')
