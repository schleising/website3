from __future__ import annotations

import hashlib
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
import xml.etree.ElementTree as ET


def normalize_feed_url(feed_url: str) -> str:
    """Normalize feed URL for deduplication and storage."""

    candidate = feed_url.strip()
    parsed = urlparse(candidate)

    if parsed.scheme.lower() not in {"http", "https"}:
        raise ValueError("Feed URL must use http or https.")

    if parsed.netloc.strip() == "":
        raise ValueError("Feed URL must include a host.")

    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path[:-1]

    query = urlencode(sorted(parse_qsl(parsed.query, keep_blank_values=True)))

    return urlunparse((scheme, netloc, path, "", query, ""))


def normalize_color_hex(color_hex: str) -> str:
    """Validate and normalize a category color in #RRGGBB format."""

    value = color_hex.strip().upper()

    if value.startswith("#"):
        value = value[1:]

    if len(value) != 6 or any(ch not in "0123456789ABCDEF" for ch in value):
        raise ValueError("Color must be a valid 6-digit hexadecimal value.")

    return f"#{value}"


def deterministic_category_color(category_name: str) -> str:
    """Generate a stable fallback color for a category name."""

    palette = [
        "#1F6FEB",
        "#0F9D58",
        "#E37400",
        "#AF52DE",
        "#D73A49",
        "#1DA1A8",
        "#8A63D2",
        "#2E8B57",
        "#B7791F",
        "#3B82F6",
        "#059669",
        "#C2410C",
    ]

    digest = hashlib.sha256(category_name.strip().lower().encode("utf-8")).digest()
    index = digest[0] % len(palette)
    return palette[index]


def parse_opml_entries(opml_bytes: bytes) -> tuple[list[tuple[str, str, str]], list[str]]:
    """Parse OPML bytes into tuples of (feed_url, title, category_name)."""

    errors: list[str] = []

    try:
        root = ET.fromstring(opml_bytes)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid OPML XML: {exc}") from exc

    body = root.find("body")
    if body is None:
        raise ValueError("OPML document does not contain a body section.")

    entries: list[tuple[str, str, str]] = []

    def walk_outline(node: ET.Element, current_category: str | None) -> None:
        xml_url = (node.attrib.get("xmlUrl") or node.attrib.get("xmlurl") or "").strip()
        text = (node.attrib.get("text") or node.attrib.get("title") or "").strip()

        if xml_url != "":
            category_name = current_category or ""
            title = text or xml_url
            entries.append((xml_url, title, category_name))

        child_outlines = [child for child in node if child.tag.lower().endswith("outline")]
        if len(child_outlines) == 0:
            return

        next_category = current_category
        if xml_url == "":
            next_category = text or current_category

        for child in child_outlines:
            walk_outline(child, next_category)

    for outline in [child for child in body if child.tag.lower().endswith("outline")]:
        walk_outline(outline, None)

    if len(entries) == 0:
        errors.append("No feed entries were found in the OPML document.")

    return entries, errors
