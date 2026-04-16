from importlib import import_module
from typing import Any

bleach: Any = import_module("bleach")

ALLOWED_TAGS = sorted(
    set(bleach.sanitizer.ALLOWED_TAGS).union(
        {
            "p",
            "pre",
            "code",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "hr",
            "br",
            "blockquote",
            "ul",
            "ol",
            "li",
            "strong",
            "em",
            "table",
            "thead",
            "tbody",
            "tr",
            "th",
            "td",
            "img",
            "div",
            "span",
            "details",
            "summary",
        }
    )
)

ALLOWED_ATTRIBUTES = {
    "*": ["class", "id", "aria-label", "aria-hidden"],
    "a": ["href", "title", "target", "rel"],
    "img": ["src", "alt", "title", "width", "height", "loading"],
    "code": ["class"],
    "pre": ["class"],
    "div": ["class", "id"],
    "span": ["class", "id"],
    "th": ["colspan", "rowspan"],
    "td": ["colspan", "rowspan"],
}

ALLOWED_PROTOCOLS = ["http", "https", "mailto", "data"]


def sanitize_html(html: str) -> str:
    return bleach.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )
