from asyncio import gather

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from .blog import get_blog_list, get_blog_by_id, get_blog_html, get_blog_author
from ..utils.markdown_preview import build_markdown_preview, extract_first_mermaid_preview

TEMPLATES = Jinja2Templates("/app/templates")

blog_router = APIRouter(prefix="/blog")


@blog_router.get("/", response_class=HTMLResponse)
async def get_aircraft_page(request: Request):
    # Get the blog list
    blog_list = await get_blog_list()

    card_authors = await gather(*(get_blog_author(blog) for blog in blog_list)) if blog_list else []
    blog_cards = []
    has_mermaid_previews = False
    for blog, (first_name, last_name) in zip(blog_list, card_authors):
        preview_text = build_markdown_preview(blog.text)
        mermaid_preview = extract_first_mermaid_preview(blog.text)
        if mermaid_preview is not None:
            has_mermaid_previews = True
        blog_cards.append(
            {
                "id": str(blog.id),
                "title": blog.title,
                "last_updated": blog.last_updated,
                "author": _display_author(first_name, last_name),
                "preview_text": preview_text,
                "mermaid_preview": mermaid_preview,
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
            "has_mermaid_previews": has_mermaid_previews,
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
            "has_mermaid_previews": False,
        },
    )


def _display_author(first_name: str, last_name: str) -> str:
    full_name = f"{first_name} {last_name}".strip()
    if full_name != "":
        return full_name
    return "Unknown Author"
