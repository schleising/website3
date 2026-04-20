from __future__ import annotations

from functools import lru_cache
import hashlib
import ipaddress
import socket
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
import xml.etree.ElementTree as ET

from defusedxml import ElementTree as DefusedElementTree
from defusedxml.common import DefusedXmlException


LOCAL_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
}


def _parse_ip_address(candidate: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    """Return an IP address object when candidate is a literal address."""

    try:
        return ipaddress.ip_address(candidate)
    except ValueError:
        return None


@lru_cache(maxsize=2048)
def _resolve_hostname_addresses(
    hostname: str,
) -> tuple[ipaddress.IPv4Address | ipaddress.IPv6Address, ...]:
    """Resolve hostname to unique addresses for public-network checks."""

    normalized_hostname = hostname.strip().rstrip(".").lower()
    if normalized_hostname == "":
        return ()

    try:
        address_info = socket.getaddrinfo(normalized_hostname, None, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, OSError):
        return ()

    seen_addresses: set[str] = set()
    resolved_addresses: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []

    for _family, _socktype, _proto, _canonname, sockaddr in address_info:
        if not isinstance(sockaddr, tuple) or len(sockaddr) == 0:
            continue

        host_value = str(sockaddr[0]).strip()
        parsed_ip = _parse_ip_address(host_value)
        if parsed_ip is None:
            continue

        canonical_ip = str(parsed_ip)
        if canonical_ip in seen_addresses:
            continue

        seen_addresses.add(canonical_ip)
        resolved_addresses.append(parsed_ip)

    return tuple(resolved_addresses)


def is_public_http_url(url: str) -> bool:
    """Return True when URL is HTTP(S) and resolves to globally-routable hosts."""

    parsed = urlparse(str(url).strip())
    if parsed.scheme.lower() not in {"http", "https"}:
        return False

    hostname = (parsed.hostname or "").strip().rstrip(".").lower()
    if hostname == "":
        return False

    if hostname in LOCAL_HOSTNAMES:
        return False

    try:
        _ = parsed.port
    except ValueError:
        return False

    parsed_ip = _parse_ip_address(hostname)
    if parsed_ip is not None:
        return bool(parsed_ip.is_global)

    resolved_addresses = _resolve_hostname_addresses(hostname)
    if len(resolved_addresses) == 0:
        return False

    return all(address.is_global for address in resolved_addresses)


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
        root = DefusedElementTree.fromstring(opml_bytes)
    except (ET.ParseError, DefusedXmlException) as exc:
        raise ValueError(f"Invalid OPML XML: {exc}") from exc

    def matches_tag(element: ET.Element, local_name: str) -> bool:
        """Return True when an element tag matches a local name, with namespace support."""

        if not isinstance(element.tag, str):
            return False

        return element.tag.rsplit("}", 1)[-1].lower() == local_name.lower()

    body = next((child for child in root if matches_tag(child, "body")), None)
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

        child_outlines = [child for child in node if matches_tag(child, "outline")]
        if len(child_outlines) == 0:
            return

        next_category = current_category
        if xml_url == "":
            next_category = text or current_category

        for child in child_outlines:
            walk_outline(child, next_category)

    for outline in [child for child in body if matches_tag(child, "outline")]:
        walk_outline(outline, None)

    if len(entries) == 0:
        errors.append("No feed entries were found in the OPML document.")

    return entries, errors
