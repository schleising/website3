from fastapi import APIRouter, Request, WebSocket
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from starlette.websockets import WebSocketDisconnect

from markdown import markdown

from .models import DataToConvert

# Set the Jinja template location
TEMPLATES = Jinja2Templates('/app/templates')

# Create an account router
markdown_router = APIRouter(prefix='/markdown')

@markdown_router.get('/', response_class=HTMLResponse)
async def editor(request: Request):
    return TEMPLATES.TemplateResponse('/markdown/editor.html', {'request': request})

@markdown_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    try:
        while True:
            data = await websocket.receive_text()
            data_to_convert = DataToConvert.parse_raw(data)
            await websocket.send_text(markdown(data_to_convert.text))
    except WebSocketDisconnect:
        print('Socket Closed')
