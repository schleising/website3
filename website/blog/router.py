from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
# from bson.objectid import ObjectId
# from pymongo import 
from markdown import markdown

from . import blog_collection
from ..markdown.models import MarkdownDataFromDb, MarkdownDataToDb

from ..database.models import PyObjectId

TEMPLATES = Jinja2Templates('/app/templates')

blog_router = APIRouter(prefix='/blog')

@blog_router.get('/', response_class=HTMLResponse)
async def get_aircraft_page(request: Request):
    blog_list = []

    if blog_collection is not None:
        blog_cursor = blog_collection.find({})

        blog_list = await blog_cursor.to_list(None)

        blog_list = [MarkdownDataFromDb(**blog) for blog in blog_list]

    return TEMPLATES.TemplateResponse('blog/blog_template.html', {'request': request, 'blog_list': blog_list})

@blog_router.get('/blog_id/{blog_id}', response_model=MarkdownDataToDb | None)
async def get_blog(blog_id: str | None = None):
    if blog_collection is not None:
        item = await blog_collection.find_one({'_id': PyObjectId(blog_id)})
        markdown_data = MarkdownDataToDb(**item)

        # Convert the markdown text to formatted text
        markdown_data.text = markdown(markdown_data.text, extensions=[
            'markdown.extensions.admonition',
            'pymdownx.extra',
            'md_mermaid',
        ])

        return markdown_data
