import logging

import aiohttp

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

# Set the base template location
TEMPLATES = Jinja2Templates('/app/templates')

# Instantiate the router object, ensure every request checks the user can use the tools
transcoder_router = APIRouter(prefix='/transcoder')

# Gets the Transcoder Router
@transcoder_router.get('/', response_class=HTMLResponse)
async def converter(request: Request):
    logging.info('Transcoder page requested')
    return TEMPLATES.TemplateResponse('tools/transcoder/transcoder.html', {'request': request})

# Gets the progress details for the transcoder
@transcoder_router.get('/progress/')
async def get_progress():
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get('http://host.docker.internal:8020/') as response:
                return await response.json()
    except Exception as e:
        logging.error(f'Error getting progress: {e}')
        return {'error': 'Error getting progress'}
