from bson import ObjectId
from markdown import markdown

from . import blog_collection

from ..markdown.models import MarkdownDataFromDb

from ..database.models import ObjectIdPydanticAnnotation

from ..account import user_collection

from ..account.user_model import User

async def get_blog_list() -> list[MarkdownDataFromDb]:
    # Check we have connected to the database
    if blog_collection is not None:
        # Get all blog entries
        blog_cursor = blog_collection.find({})

        # Convert the list to a list of Markdown Data from DB objects
        blog_list = [MarkdownDataFromDb(**blog) async for blog in blog_cursor]

        # Sort the blog list by date
        blog_list = sorted(blog_list, key=lambda blog: blog.last_updated, reverse=True)
    else:
        # Return an empty list
        blog_list: list[MarkdownDataFromDb] = []

    return blog_list

async def get_blog_by_id(id: str) -> MarkdownDataFromDb | None:
    # Check we are connected to the database
    if blog_collection is not None:
        # Get the blog
        item_db = await blog_collection.find_one({'_id': ObjectId(id)})

        if item_db is not None:
            # Convert the blog to a Markdown Data from DB object
            blog = MarkdownDataFromDb(**item_db)
        else:
            # Set the blog to None
            blog = None

        # Return the blog
        return blog
    
    return None

def get_blog_html(current_blog: MarkdownDataFromDb | None) -> str | None:
    # Check we got a blog
    if current_blog != None:
        # Convert the markdown text to formatted text
        blog_html = markdown(current_blog.text, extensions=[
            'markdown.extensions.admonition',
            'pymdownx.extra',
            'md_mermaid',
        ])
    else:
        # Set the HTML to None
        blog_html = None

    # Return the HTML
    return blog_html

async def get_blog_author(current_blog: MarkdownDataFromDb | None) -> tuple[str, str]:
    # Check we have a connection to the database
    if user_collection is not None and current_blog is not None:
        # Get the user from the database
        user_db = await user_collection.find_one({'username': current_blog.username})

        # Convert the user to a User object
        if user_db is not None:
            user = User(**user_db)
        else:
            user = None

        # Return the first and last names
        if user is not None:
            return user.first_name, user.last_name

    # Return empty strings
    return '', ''
