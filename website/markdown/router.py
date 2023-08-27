import logging
from fastapi import APIRouter, Request, WebSocket
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from starlette.websockets import WebSocketDisconnect

from .models import BaseMessage, MessageType, MarkdownDataMessage, BlogRequest

from .markdown import convert_to_markdown, get_blog_list, get_blog_text

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

    # Get the current user
    user = websocket.state.user

    logging.debug(f'MD Websocket User: {user}')

    try:
        while True:
            # Wait for a message from the client
            recv = await websocket.receive_text()

            # Get the message type
            msg = BaseMessage.parse_raw(recv)

            match msg.message_type:
                case MessageType.MARKDOWN_UPDATE:
                    # Get the message body into a markdown data message
                    markdown_data_message = MarkdownDataMessage(**msg.body)

                    # Convert the markdown text to HTML
                    response_body = await convert_to_markdown(markdown_data_message, user)

                case MessageType.GET_BLOG_LIST:
                    # Get the blog list
                    response_body = await get_blog_list(user)
                case MessageType.GET_BLOG_TEXT:
                    # Get the request so we can get the ID
                    blog_text_request = BlogRequest(**msg.body)

                    # Get the blog title and text
                    response_body = await get_blog_text(blog_text_request.id)
                case _:
                    # Raise a Not Implemented exception
                    raise NotImplementedError

            # Generate the response message
            response_msg = BaseMessage(message_type=msg.message_type, body=response_body.model_dump())

            # Send the response back to the client
            await websocket.send_text(response_msg.model_dump_json())

    except WebSocketDisconnect:
        print('Socket Closed')
