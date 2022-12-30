from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

TEMPLATES = Jinja2Templates('/app/templates')

app = FastAPI()

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    print('Hello')
    return TEMPLATES.TemplateResponse('index.html', {'request': request})
