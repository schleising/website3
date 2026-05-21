from importlib import import_module
import re
from typing import Any

bleach: Any = import_module("bleach")
bleach_css_sanitizer: Any = import_module("bleach.css_sanitizer")

ALLOWED_TAGS = sorted(
    set(bleach.sanitizer.ALLOWED_TAGS).union(
        {
            "b",
            "i",
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
            "figure",
            "figcaption",
            "ul",
            "ol",
            "li",
            "strong",
            "em",
            "sub",
            "sup",
            "table",
            "caption",
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

ALLOWED_ATTRIBUTES_WITH_STYLE = {
    **ALLOWED_ATTRIBUTES,
    "*": [*ALLOWED_ATTRIBUTES["*"], "style"],
}

SAFE_INLINE_STYLE_SANITIZER = bleach_css_sanitizer.CSSSanitizer(
    allowed_css_properties=[
        "font-weight",
        "font-style",
        "font-size",
        "text-decoration",
        "text-align",
        "text-indent",
        "margin-left",
        "margin-right",
        "padding-left",
        "padding-right",
        "list-style-type",
        "white-space",
    ]
)

ALLOWED_PROTOCOLS = ["http", "https", "mailto", "data"]

EMPTY_INLINE_EMPHASIS_TAG_RE = re.compile(
    r"<(?:em|i|strong|b)\b[^>]*>\s*</(?:em|i|strong|b)>",
    re.IGNORECASE,
)

INLINE_WORD_BOUNDARY_TAGS = "a|abbr|acronym|b|code|em|i|span|strong|sub|sup"

INLINE_TAG_WORD_GLUE_BEFORE_RE = re.compile(
    rf"(\w)(<(?:{INLINE_WORD_BOUNDARY_TAGS})\b)",
    re.IGNORECASE,
)

INLINE_TAG_WORD_GLUE_AFTER_RE = re.compile(
    rf"(</(?:{INLINE_WORD_BOUNDARY_TAGS})>)(\w)",
    re.IGNORECASE,
)


def restore_inline_word_spacing(html: str) -> str:
    normalized = INLINE_TAG_WORD_GLUE_BEFORE_RE.sub(r"\1 \2", str(html or ""))
    return INLINE_TAG_WORD_GLUE_AFTER_RE.sub(r"\1 \2", normalized)


def sanitize_html(html: str, allow_inline_styles: bool = False) -> str:
    normalized_html = EMPTY_INLINE_EMPHASIS_TAG_RE.sub(" ", str(html or ""))

    clean_kwargs: dict[str, Any] = {
        "tags": ALLOWED_TAGS,
        "attributes": ALLOWED_ATTRIBUTES_WITH_STYLE if allow_inline_styles else ALLOWED_ATTRIBUTES,
        "protocols": ALLOWED_PROTOCOLS,
        "strip": True,
    }

    if allow_inline_styles:
        clean_kwargs["css_sanitizer"] = SAFE_INLINE_STYLE_SANITIZER

    return restore_inline_word_spacing(bleach.clean(normalized_html, **clean_kwargs))
