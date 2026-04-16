import re
from asyncio import gather

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from .blog import get_blog_list, get_blog_by_id, get_blog_html, get_blog_author

TEMPLATES = Jinja2Templates("/app/templates")

blog_router = APIRouter(prefix="/blog")


@blog_router.get("/", response_class=HTMLResponse)
async def get_aircraft_page(request: Request):
    # Get the blog list
    blog_list = await get_blog_list()

    card_authors = await gather(*(get_blog_author(blog) for blog in blog_list)) if blog_list else []
    blog_cards = []
    for blog, (first_name, last_name) in zip(blog_list, card_authors):
        preview_text = _markdown_preview(blog.text)
        blog_cards.append(
            {
                "id": str(blog.id),
                "title": blog.title,
                "last_updated": blog.last_updated,
                "author": _display_author(first_name, last_name),
                "preview_text": preview_text,
            }
        )

    # Create and return the HTML
    return TEMPLATES.TemplateResponse(
        request,
        r"blog/blog_template.html",
        {
            "request": request,
            "blog_list": blog_list,
            "blog_entry": None,
            "blog_html": None,
            "first_name": "",
            "last_name": "",
            "is_blog_index": True,
            "blog_cards": blog_cards,
        },
    )


@blog_router.get("/{blog_id}", response_class=HTMLResponse)
@blog_router.get("/{blog_id}/", response_class=HTMLResponse)
async def get_blog_page(request: Request, blog_id: str):
    # Get the blog list
    blog_list = await get_blog_list()

    # Get the requested blog post
    current_blog = await get_blog_by_id(blog_id)

    # Get the blog HTML
    blog_html = get_blog_html(current_blog)

    # Get the user first and last name
    first_name, last_name = await get_blog_author(current_blog)

    # Create and return the HTML
    return TEMPLATES.TemplateResponse(
        request,
        r"blog/blog_template.html",
        {
            "request": request,
            "blog_list": blog_list,
            "blog_entry": current_blog,
            "blog_html": blog_html,
            "first_name": first_name,
            "last_name": last_name,
            "is_blog_index": False,
            "blog_cards": [],
        },
    )


def _display_author(first_name: str, last_name: str) -> str:
    full_name = f"{first_name} {last_name}".strip()
    if full_name != "":
        return full_name
    return "Unknown Author"


def _markdown_preview(text: str, max_length: int = 220) -> str:
    if text.strip() == "":
        return "No preview available."

    plain_text = re.sub(r"`{1,3}[^`]*`{1,3}", " ", text)
    plain_text = re.sub(r"!\[[^\]]*\]\([^\)]*\)", " ", plain_text)
    plain_text = re.sub(r"\[[^\]]*\]\([^\)]*\)", " ", plain_text)
    plain_text = re.sub(r"^[#>\-\*\s]+", "", plain_text, flags=re.MULTILINE)
    plain_text = re.sub(r"\s+", " ", plain_text).strip()

    if plain_text == "":
        return "No preview available."

    if len(plain_text) <= max_length:
        return plain_text

    clipped = plain_text[:max_length].rsplit(" ", 1)[0].strip()
    if clipped == "":
        clipped = plain_text[:max_length].strip()
    return f"{clipped}..."
