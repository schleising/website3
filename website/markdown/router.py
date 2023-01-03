from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse

from markdown import markdown

from .models import DataToConvert

# Set the Jinja template location
TEMPLATES = Jinja2Templates('/app/templates')

# Create an account router
markdown_router = APIRouter(prefix='/markdown')

@markdown_router.get('/', response_class=HTMLResponse)
async def editor(request: Request):
    return TEMPLATES.TemplateResponse('/markdown/editor.html', {'request': request})

@markdown_router.post('/convert/')
async def convert(data_to_convert: DataToConvert):
    return markdown(data_to_convert.text)
