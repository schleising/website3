from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from .blog import get_blog_list, get_blog_by_id, get_blog_html, get_blog_author

TEMPLATES = Jinja2Templates('/app/templates')

blog_router = APIRouter(prefix='/blog')

@blog_router.get('/', response_class=HTMLResponse)
async def get_aircraft_page(request: Request):
    # Get the blog list
    blog_list = await get_blog_list()

    # Get the latest blog
    if blog_list:
        latest_blog = blog_list[0]
    else:
        latest_blog = None

    # Get the blog HTML
    blog_html = get_blog_html(latest_blog)

    # Get the user first and last name
    first_name, last_name = await get_blog_author(latest_blog)

    # Create and return the HTML
    return TEMPLATES.TemplateResponse('blog/blog_template.html', {
        'request': request,
        'blog_list': blog_list,
        'blog_entry': latest_blog,
        'blog_html': blog_html,
        'first_name': first_name,
        'last_name': last_name
    })

@blog_router.get('/{blog_id}/', response_class=HTMLResponse)
async def get_blog_page(request: Request, blog_id: str):
    # Get the blog list
    blog_list = await get_blog_list()

    # Get the requested blog post
    current_blog = await get_blog_by_id(blog_id)

    # Get the blog HTML
    blog_html = get_blog_html(current_blog)

    # Get the user first and last name
    first_name, last_name = await get_blog_author(current_blog)

    # Create and return the HTML
    return TEMPLATES.TemplateResponse('blog/blog_template.html', {
        'request': request,
        'blog_list': blog_list,
        'blog_entry': current_blog,
        'blog_html': blog_html,
        'first_name': first_name,
        'last_name': last_name
    })
