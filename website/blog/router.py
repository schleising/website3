from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
# from bson.objectid import ObjectId
# from pymongo import 
from markdown import markdown

from ..account import user_collection
from ..account.user_model import User

from . import blog_collection
from ..markdown.models import MarkdownDataFromDb, BlogEntry

from ..database.models import PyObjectId

TEMPLATES = Jinja2Templates('/app/templates')

blog_router = APIRouter(prefix='/blog')

@blog_router.get('/', response_class=HTMLResponse)
async def get_aircraft_page(request: Request):
    # Create an empty list
    blog_list = []

    # Check we have connected to the database
    if blog_collection is not None:
        # Get all blog entries
        blog_cursor = blog_collection.find({})

        # Convert the cursor to a list
        blog_list = await blog_cursor.to_list(None)

        # Convert the list to a list of Markdown Data from DB objects
        blog_list = [MarkdownDataFromDb(**blog) for blog in blog_list]

    # Create and return the HTML
    return TEMPLATES.TemplateResponse('blog/blog_template.html', {'request': request, 'blog_list': blog_list})

@blog_router.get('/blog_id/{blog_id}', response_model=BlogEntry | None)
async def get_blog(blog_id: str | None = None):
    # Check we have connected to the database
    if blog_collection is not None:
        # Get the item from the DB
        item = await blog_collection.find_one({'_id': PyObjectId(blog_id)})

        # Convert the item to a blog entry
        blog_entry = BlogEntry(**item)

        # Check we have access to the user collection
        if user_collection is not None:
            # Get the user and convert it to a User type
            user: User = User(**await user_collection.find_one({'username': blog_entry.username}))

            # Set the first and lat name in the blog entry
            blog_entry.first_name = user.first_name
            blog_entry.last_name = user.last_name

        # Convert the markdown text to formatted text
        blog_entry.text = markdown(blog_entry.text, extensions=[
            'markdown.extensions.admonition',
            'pymdownx.extra',
            'md_mermaid',
        ])

        # Return the blog entry
        return blog_entry
