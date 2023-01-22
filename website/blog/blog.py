from markdown import markdown

from . import blog_collection

from ..markdown.models import MarkdownDataFromDb

from ..database.models import PyObjectId

from ..account import user_collection

from ..account.user_model import User

async def get_blog_list() -> list[MarkdownDataFromDb]:
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

        # Sort the blog list by date
        blog_list = sorted(blog_list, key=lambda blog: blog.last_updated, reverse=True)

    return blog_list

async def get_blog_by_id(id: str) -> MarkdownDataFromDb | None:
    # Check we are connected to the database
    if blog_collection is not None:
        # Get the blog
        blog = MarkdownDataFromDb(**await blog_collection.find_one({'_id': PyObjectId(id)}))

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
        # Get the user
        user = User(**await user_collection.find_one({'username': current_blog.username}))

        # Return the first and last names
        if user is not None:
            return user.first_name, user.last_name

    # Return empty strings
    return '', ''
