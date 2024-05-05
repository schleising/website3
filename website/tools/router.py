import logging

from fastapi import APIRouter, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from .utils import check_user_can_use_tools

from .converter.router import converter_router
from .transcoder.router import transcoder_router
from .logger.router import logger_router

# Set the base template location
TEMPLATES = Jinja2Templates('/app/templates')

# Instantiate the router object, ensure every request checks the user can use the tools
tools_router = APIRouter(prefix='/tools', dependencies=[Depends(check_user_can_use_tools)])

# Add the converter router
tools_router.include_router(converter_router)

# Add the transcoder router
tools_router.include_router(transcoder_router)

# Add the logger router
tools_router.include_router(logger_router)

# Gets the Tools page
@tools_router.get('/', response_class=HTMLResponse)
async def tools_root(request: Request):
    logging.info('Tools page requested')
    return TEMPLATES.TemplateResponse('tools/tools.html', {'request': request})
