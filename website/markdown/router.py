from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse

# Set the Jinja template location
TEMPLATES = Jinja2Templates('/app/templates')

# Create an account router
markdown_router = APIRouter(prefix='/markdown')

@markdown_router.get('/', response_class=HTMLResponse)
async def editor(request: Request):
    return TEMPLATES.TemplateResponse('/markdown/editor.html', {'request': request})
