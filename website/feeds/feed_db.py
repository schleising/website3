from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from html import unescape
import re
from typing import Any, Literal, cast
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlparse, urlunparse

import aiohttp
from bson import ObjectId
from defusedxml import ElementTree as DefusedElementTree
from defusedxml.common import DefusedXmlException
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

from ..utils.html_sanitizer import sanitize_html
from . import feed_utils
from . import (
    feed_articles_collection,
    feed_categories_collection,
    feed_sources_collection,
    user_article_states_collection,
    user_feed_subscriptions_collection,
)
from .models import (
    FeedArticleCard,
    FeedArticleListResponse,
    FeedArticleStatusItem,
    FeedCategoryDocument,
    FeedCategoryListResponse,
    FeedCategorySummary,
    FeedOpmlImportOptions,
    FeedOpmlImportResult,
    FeedReaderSyncRequest,
    FeedReaderSyncResponse,
    FeedSidebarMetaResponse,
    FeedStatsDailyPoint,
    FeedStatsOverall,
    FeedStatsResponse,
    FeedStatsRow,
)


READ_VISIBILITY_WINDOW = timedelta(minutes=2)
RECENTLY_READ_WINDOW = timedelta(days=7)
FEED_VALIDATION_MAX_REDIRECTS = 5
FEED_VALIDATION_REDIRECT_STATUSES = {301, 302, 303, 307, 308}
TRUNCATED_SUMMARY_PARAGRAPH_LIMIT = 5
SEARCH_QUERY_MAX_LENGTH = 160
FEED_ARTICLE_TEXT_INDEX_CACHE_TTL = timedelta(minutes=10)
CATEGORY_COUNTS_CACHE_TTL = timedelta(seconds=2)
HEAD_PROBE_MAX_LIMIT = 20
FEED_ARTICLE_TEXT_INDEX_KEYS: list[tuple[str, str]] = [
    ("title", "text"),
    ("summary_html", "text"),
]
SEARCH_TERM_IRREGULAR_VARIANTS: dict[str, tuple[str, ...]] = {
    "run": ("run", "runs", "running", "ran"),
}

_feed_article_text_index_available_cache: bool | None = None
_feed_article_text_index_checked_at: datetime | None = None
_category_counts_cache: dict[str, tuple[datetime, FeedCategoryListResponse]] = {}

SUMMARY_ANCHOR_HREF_RE = re.compile(
    r'(?P<prefix>\bhref\s*=\s*)(?P<quote>["\']?)(?P<href>[^"\'\s>]+)(?P=quote)',
    re.IGNORECASE,
)
SUMMARY_ELEMENT_ID_RE = re.compile(
    r'\bid\s*=\s*(?:"([^"]+)"|\'([^\']+)\'|([^\s"\'=<>`]+))',
    re.IGNORECASE,
)


def utc_now() -> datetime:
    """Return the current UTC timestamp with timezone information."""

    return datetime.now(UTC)


def normalize_article_search_query(search_query: str | None) -> str:
    """Normalize a free-text article search query."""

    if not isinstance(search_query, str):
        return ""

    normalized = " ".join(search_query.strip().split())
    if normalized == "":
        return ""

    return normalized[:SEARCH_QUERY_MAX_LENGTH]


def parse_article_search_components(search_query: str) -> list[tuple[str, str]]:
    """Parse normalized search text into ordered term/phrase components."""

    components: list[tuple[str, str]] = []
    seen_components: set[tuple[str, str]] = set()

    for match in re.finditer(r'"([^"]+)"|(\S+)', search_query):
        phrase_group = match.group(1)
        token_group = match.group(2)

        if isinstance(phrase_group, str):
            normalized_phrase = " ".join(phrase_group.strip().split()).casefold()
            if normalized_phrase == "":
                continue

            phrase_component = ("phrase", normalized_phrase)
            if phrase_component in seen_components:
                continue

            seen_components.add(phrase_component)
            components.append(phrase_component)
            continue

        if not isinstance(token_group, str):
            continue

        for token in re.findall(r"[A-Za-z0-9]+", token_group):
            normalized_token = token.casefold().strip()
            if normalized_token == "":
                continue

            token_component = ("term", normalized_token)
            if token_component in seen_components:
                continue

            seen_components.add(token_component)
            components.append(token_component)

    return components


def _is_cvc_search_term(term: str) -> bool:
    """Return True when a term ends in consonant-vowel-consonant."""

    if len(term) < 3 or not term.isalpha():
        return False

    vowels = "aeiou"
    if term[-1] in vowels or term[-1] in {"w", "x", "y"}:
        return False

    return term[-2] in vowels and term[-3] not in vowels


def build_search_term_variants(term: str) -> set[str]:
    """Generate inflection-aware variants for one unquoted search term."""

    normalized_term = str(term or "").casefold().strip()
    if normalized_term == "":
        return set()

    variants: set[str] = {normalized_term}
    irregular_forms = SEARCH_TERM_IRREGULAR_VARIANTS.get(normalized_term)
    if isinstance(irregular_forms, tuple):
        variants.update(form.casefold().strip() for form in irregular_forms if str(form).strip() != "")

    if not normalized_term.isalpha():
        return variants

    if normalized_term.endswith("y") and len(normalized_term) > 2 and normalized_term[-2] not in "aeiou":
        variants.add(f"{normalized_term[:-1]}ies")
    elif normalized_term.endswith(("s", "x", "z", "ch", "sh", "o")):
        variants.add(f"{normalized_term}es")
    else:
        variants.add(f"{normalized_term}s")

    if normalized_term.endswith("e") and len(normalized_term) > 2:
        variants.add(f"{normalized_term[:-1]}ing")
        variants.add(f"{normalized_term}d")
    else:
        variants.add(f"{normalized_term}ing")
        variants.add(f"{normalized_term}ed")

    if normalized_term.endswith("y") and len(normalized_term) > 2 and normalized_term[-2] not in "aeiou":
        variants.add(f"{normalized_term[:-1]}ied")

    if _is_cvc_search_term(normalized_term):
        doubled_term = f"{normalized_term}{normalized_term[-1]}"
        variants.add(f"{doubled_term}ing")
        variants.add(f"{doubled_term}ed")

    if normalized_term.endswith("f") and len(normalized_term) > 1:
        variants.add(f"{normalized_term[:-1]}ves")
    elif normalized_term.endswith("fe") and len(normalized_term) > 2:
        variants.add(f"{normalized_term[:-2]}ves")

    return {value for value in variants if value != ""}


def build_search_component_regex(component_kind: str, component_value: str) -> str:
    """Return regex pattern for one parsed search component."""

    normalized_value = str(component_value or "").strip()
    if normalized_value == "":
        return ""

    if component_kind == "phrase":
        phrase_tokens = [
            token.casefold()
            for token in re.findall(r"[A-Za-z0-9]+", normalized_value)
            if token.strip() != ""
        ]
        if len(phrase_tokens) == 0:
            return ""
        if len(phrase_tokens) == 1:
            return rf"\b{re.escape(phrase_tokens[0])}\b"

        return rf"\b{'\\s+'.join(re.escape(token) for token in phrase_tokens)}\b"

    term_variants = sorted(
        {re.escape(value) for value in build_search_term_variants(normalized_value)},
        key=len,
        reverse=True,
    )
    if len(term_variants) == 0:
        return rf"\b{re.escape(normalized_value.casefold())}\b"

    return rf"\b(?:{'|'.join(term_variants)})\b"


def build_search_component_field_filter(component_kind: str, component_value: str) -> dict[str, Any] | None:
    """Build a title/summary filter for one parsed search component."""

    component_regex = build_search_component_regex(component_kind, component_value)
    if component_regex == "":
        return None

    return {
        "$or": [
            {"title": {"$regex": component_regex, "$options": "i"}},
            {"summary_html": {"$regex": component_regex, "$options": "i"}},
        ]
    }


def build_article_fallback_search_filter(search_query: str | None) -> dict[str, Any] | None:
    """Return a minimal regex fallback when full-text search is unavailable."""

    normalized = normalize_article_search_query(search_query)
    if normalized == "":
        return None

    components = parse_article_search_components(normalized)
    if len(components) == 0:
        escaped = re.escape(normalized)
        return {
            "$or": [
                {"title": {"$regex": escaped, "$options": "i"}},
                {"summary_html": {"$regex": escaped, "$options": "i"}},
            ]
        }

    component_filters = [
        component_filter
        for component_filter in (
            build_search_component_field_filter(component_kind, component_value)
            for component_kind, component_value in components
        )
        if isinstance(component_filter, dict)
    ]

    if len(component_filters) == 0:
        return None

    if len(component_filters) == 1:
        return component_filters[0]

    return {
        "$and": component_filters,
    }


def build_article_text_search_filter(search_query: str | None) -> dict[str, Any] | None:
    """Return a MongoDB full-text query for natural-language matching."""

    normalized = normalize_article_search_query(search_query)
    if normalized == "":
        return None

    components = parse_article_search_components(normalized)

    text_query_filter: dict[str, Any] = {
        "$text": {
            "$search": normalized,
            "$caseSensitive": False,
            "$diacriticSensitive": False,
        }
    }

    # Mongo $text defaults to OR across space-delimited terms; enforce default
    # AND semantics by requiring each parsed component in title or summary.
    if len(components) <= 1:
        return text_query_filter

    component_filters = [
        component_filter
        for component_filter in (
            build_search_component_field_filter(component_kind, component_value)
            for component_kind, component_value in components
        )
        if isinstance(component_filter, dict)
    ]
    if len(component_filters) == 0:
        return text_query_filter

    return {
        **text_query_filter,
        "$and": component_filters,
    }


def build_article_search_filter(
    search_query: str | None,
    *,
    use_text_search: bool,
) -> dict[str, Any] | None:
    """Build article search filter using text search when available."""

    if use_text_search:
        return build_article_text_search_filter(search_query)

    return build_article_fallback_search_filter(search_query)


def merge_article_search_filter(
    base_query: dict[str, Any],
    search_filter: dict[str, Any] | None,
) -> dict[str, Any]:
    """Merge a search filter into a base MongoDB query."""

    if not isinstance(search_filter, dict):
        return base_query

    if "$text" in search_filter:
        merged_query = dict(base_query)
        merged_query["$text"] = search_filter["$text"]

        additional_and_filters = search_filter.get("$and")
        if isinstance(additional_and_filters, list) and len(additional_and_filters) > 0:
            return {
                "$and": [merged_query, *additional_and_filters],
            }

        return merged_query

    return {
        "$and": [base_query, search_filter],
    }


async def feed_articles_text_search_available() -> bool:
    """Return True when feed_articles has a usable text index."""

    global _feed_article_text_index_available_cache
    global _feed_article_text_index_checked_at

    now = utc_now()
    if (
        _feed_article_text_index_available_cache is not None
        and isinstance(_feed_article_text_index_checked_at, datetime)
        and now - _feed_article_text_index_checked_at <= FEED_ARTICLE_TEXT_INDEX_CACHE_TTL
    ):
        return _feed_article_text_index_available_cache

    if feed_articles_collection is None:
        _feed_article_text_index_available_cache = False
        _feed_article_text_index_checked_at = now
        return False

    try:
        index_info = await feed_articles_collection.index_information()
    except Exception as ex:
        logging.warning("Unable to inspect feed article indexes for text search: %s", ex)
        _feed_article_text_index_available_cache = False
        _feed_article_text_index_checked_at = now
        return False

    has_text_index = False
    for meta in index_info.values():
        key_spec = meta.get("key")
        if not isinstance(key_spec, list):
            continue

        for key_pair in key_spec:
            if not isinstance(key_pair, (list, tuple)) or len(key_pair) != 2:
                continue

            if str(key_pair[1]).lower() == "text":
                has_text_index = True
                break

        if has_text_index:
            break

    if not has_text_index:
        try:
            await feed_articles_collection.create_index(
                FEED_ARTICLE_TEXT_INDEX_KEYS,
                default_language="english",
                weights={"title": 8, "summary_html": 2},
            )
            has_text_index = True
        except Exception as ex:
            logging.warning("Unable to create feed article text index: %s", ex)

    _feed_article_text_index_available_cache = has_text_index
    _feed_article_text_index_checked_at = now
    return has_text_index


def format_datetime_utc_iso(value: Any) -> str:
    """Return an ISO-8601 UTC timestamp string for admin UI fields."""

    if not isinstance(value, datetime):
        return ""

    if value.tzinfo is None:
        normalized = value.replace(tzinfo=UTC)
    else:
        normalized = value.astimezone(UTC)

    return normalized.isoformat().replace("+00:00", "Z")


def normalize_feed_url(feed_url: str) -> str:
    """Normalize feed URL for deduplication and storage.

    Args:
        feed_url: Raw URL provided by a user or OPML document.

    Returns:
        Canonicalized HTTP(S) URL string.

    Raises:
        ValueError: If the URL is invalid or unsupported.
    """

    return feed_utils.normalize_feed_url(feed_url)


def normalize_color_hex(color_hex: str) -> str:
    """Validate and normalize a category color in #RRGGBB format."""

    return feed_utils.normalize_color_hex(color_hex)


def deterministic_category_color(category_name: str) -> str:
    """Generate a stable fallback color for a category name."""

    return feed_utils.deterministic_category_color(category_name)


def normalize_article_link(value: Any) -> str:
    """Return a safe outbound article link, or empty string when unavailable."""

    if not isinstance(value, str):
        return ""

    normalized = value.strip()
    if normalized == "" or normalized.lower() in {"none", "null", "undefined"}:
        return ""

    parsed = urlparse(normalized)
    if parsed.scheme.lower() not in {"http", "https"}:
        return ""

    if parsed.netloc.strip() == "":
        return ""

    return normalized


def normalize_article_navigation_link(value: Any) -> str:
    """Return a canonical article URL for user navigation and visited-link matching."""

    normalized = normalize_article_link(value)
    if normalized == "":
        return ""

    parsed = urlparse(normalized)

    scheme = parsed.scheme.lower()
    hostname = (parsed.hostname or "").strip().lower()
    if hostname == "":
        return ""

    try:
        port = parsed.port
    except ValueError:
        return ""

    if port is None or (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        netloc = hostname
    else:
        netloc = f"{hostname}:{port}"

    path = parsed.path or "/"
    return urlunparse((scheme, netloc, path, parsed.params, "", ""))


def _normalize_fragment_parent_url(value: str, source_url: str) -> str | None:
    """Return canonical parent document URL for fragment-link comparisons."""

    resolved = urljoin(source_url, value)
    parsed = urlparse(resolved)

    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        return None

    hostname = (parsed.hostname or "").strip().lower()
    if hostname == "":
        return None

    try:
        port = parsed.port
    except ValueError:
        return None

    if port is None or (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        netloc = hostname
    else:
        netloc = f"{hostname}:{port}"

    path = parsed.path or "/"
    if path != "/":
        path = path.rstrip("/") or "/"

    # Queries are not relevant for local in-document footnote anchors.
    return urlunparse((scheme, netloc, path, "", "", ""))


def normalize_summary_document_fragment_links(summary_html: str | None, article_url: str) -> str | None:
    """Collapse same-document absolute fragment links back to local anchors."""

    if summary_html is None or summary_html == "":
        return summary_html

    normalized_article_url = normalize_article_navigation_link(article_url)
    if normalized_article_url == "":
        return summary_html

    article_parent_url = _normalize_fragment_parent_url(normalized_article_url, normalized_article_url)
    if article_parent_url is None:
        return summary_html

    article_parent_host = urlparse(article_parent_url).hostname
    summary_local_ids = {
        unescape(
            next(
                value
                for value in (
                    id_match.group(1),
                    id_match.group(2),
                    id_match.group(3),
                )
                if value is not None
            )
        ).strip()
        for id_match in SUMMARY_ELEMENT_ID_RE.finditer(summary_html)
    }
    summary_local_ids.discard("")

    def _replace(match: re.Match[str]) -> str:
        prefix = match.group("prefix")
        quote = match.group("quote")
        raw_href = match.group("href")
        decoded_href = unescape(raw_href).strip()

        if decoded_href == "" or decoded_href.startswith("#"):
            return match.group(0)

        parsed_href = urlparse(decoded_href)
        if parsed_href.fragment == "":
            return match.group(0)

        normalized_href_parent = _normalize_fragment_parent_url(decoded_href, normalized_article_url)
        should_collapse = normalized_href_parent == article_parent_url

        if (
            not should_collapse
            and normalized_href_parent is not None
            and article_parent_host is not None
            and len(summary_local_ids) > 0
        ):
            parsed_href_parent = urlparse(normalized_href_parent)
            href_host = parsed_href_parent.hostname
            href_path = parsed_href_parent.path or "/"
            if (
                href_host is not None
                and href_host == article_parent_host
                and href_path == "/"
                and unescape(parsed_href.fragment).strip() in summary_local_ids
            ):
                should_collapse = True

        if not should_collapse:
            return match.group(0)

        fragment_href = f"#{parsed_href.fragment}"
        if quote == "":
            return f"{prefix}{fragment_href}"

        return f"{prefix}{quote}{fragment_href}{quote}"

    return SUMMARY_ANCHOR_HREF_RE.sub(_replace, summary_html)


def build_article_summary_html(
    article_doc: dict[str, Any],
    *,
    truncate_on_display: bool = False,
) -> tuple[str | None, str | None, bool]:
    """Return summary display HTML and optional full HTML for inline expansion."""

    raw_summary_html = article_doc.get("summary_html")
    if raw_summary_html is None:
        return None, None, False

    normalized_summary_html = normalize_summary_document_fragment_links(
        str(raw_summary_html),
        str(article_doc.get("canonical_url") or article_doc.get("link") or ""),
    )

    if normalized_summary_html is None or normalized_summary_html == "":
        return None, None, False

    sanitized = sanitize_html(
        normalized_summary_html,
        allow_inline_styles=True,
    )

    if not truncate_on_display:
        return sanitized, None, False

    truncated = feed_utils.truncate_html_to_paragraphs(
        sanitized,
        max_paragraphs=TRUNCATED_SUMMARY_PARAGRAPH_LIMIT,
    )

    is_truncated = truncated != sanitized
    if not is_truncated:
        return sanitized, None, False

    return truncated, sanitized, True


async def validate_feed_url(feed_url: str) -> tuple[str, str]:
    """Validate a feed URL by fetching and parsing minimal XML metadata.

    Returns:
        Tuple of normalized URL and best-effort source title.
    """

    normalized_url = normalize_feed_url(feed_url)
    if not feed_utils.is_public_http_url(normalized_url):
        raise ValueError("Feed URL must resolve to a public host.")

    timeout = aiohttp.ClientTimeout(12)
    headers = {
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9,*/*;q=0.8"
    }

    payload = b""
    current_url = normalized_url

    try:
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
            for _ in range(FEED_VALIDATION_MAX_REDIRECTS + 1):
                async with session.get(current_url, allow_redirects=False) as response:
                    if response.status in FEED_VALIDATION_REDIRECT_STATUSES:
                        redirect_location = str(response.headers.get("Location", "")).strip()
                        if redirect_location == "":
                            raise ValueError("Feed URL returned an invalid redirect response.")

                        redirected_url = normalize_feed_url(urljoin(current_url, redirect_location))
                        if not feed_utils.is_public_http_url(redirected_url):
                            raise ValueError("Feed URL redirects to a non-public host.")

                        current_url = redirected_url
                        continue

                    if response.status >= 400:
                        raise ValueError(f"Feed URL returned HTTP {response.status}.")

                    # Canonicalize the final URL so equivalent inputs dedupe to one source.
                    final_url = str(response.url).strip()
                    if final_url != "":
                        normalized_url = normalize_feed_url(final_url)
                        if not feed_utils.is_public_http_url(normalized_url):
                            raise ValueError("Feed URL resolved to a non-public host.")

                    payload = await response.read()
                    break
            else:
                raise ValueError(
                    f"Feed URL redirected too many times (>{FEED_VALIDATION_MAX_REDIRECTS})."
                )
    except aiohttp.ClientError as exc:
        raise ValueError(f"Unable to fetch feed URL: {exc}") from exc

    try:
        root = DefusedElementTree.fromstring(payload)
    except (ET.ParseError, DefusedXmlException) as exc:
        raise ValueError("Feed URL did not return valid XML.") from exc

    title = extract_feed_title(root, normalized_url)
    if title == "":
        title = normalized_url

    return normalized_url, title


def _is_bbc_feed_source_url(source_url: str) -> bool:
    """Return True when source URL points to BBC's feeds host."""

    hostname = (urlparse(str(source_url).strip()).hostname or "").strip().lower()
    return hostname == "feeds.bbci.co.uk"


def _humanize_bbc_feed_slug(value: str) -> str:
    """Convert BBC feed URL slugs into readable title segments."""

    normalized = str(value or "").strip().lower()
    if normalized == "":
        return ""

    normalized = re.sub(r"\.(xml|rss)$", "", normalized)
    normalized = normalized.replace("-", " ").replace("_", " ")
    normalized = re.sub(r"(?<=[a-z])(?=\d)", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()

    if normalized == "":
        return ""

    return normalized.title()


def _derive_bbc_display_title_from_url(source_url: str) -> str:
    """Derive a section-specific display title from a BBC feed URL path."""

    parsed = urlparse(str(source_url).strip())
    path_segments = [segment for segment in parsed.path.split("/") if segment != ""]
    if len(path_segments) == 0:
        return ""

    if path_segments[-1].lower() in {"rss", "rss.xml", "index.xml"}:
        path_segments = path_segments[:-1]

    if len(path_segments) == 0:
        return ""

    channel_name = _humanize_bbc_feed_slug(path_segments[0])
    if channel_name == "":
        return ""

    channel_title = f"BBC {channel_name}"
    if len(path_segments) == 1:
        return channel_title

    section_name = _humanize_bbc_feed_slug(path_segments[1])
    if section_name == "":
        return channel_title

    return f"{channel_title} - {section_name}"


def _is_generic_bbc_title(title: str) -> bool:
    """Return True when a stored BBC title is generic and non-section specific."""

    normalized = re.sub(r"\s+", " ", str(title or "").strip().lower())
    return normalized in {"bbc", "bbc sport", "bbc news"}


def resolve_source_display_title(source_doc: dict[str, Any]) -> str:
    """Return source display title with BBC section fallback for generic stored titles."""

    source_url = str(source_doc.get("normalized_url", "")).strip()
    stored_title = str(source_doc.get("title", source_url or "Feed")).strip()

    if (
        source_url != ""
        and _is_bbc_feed_source_url(source_url)
        and _is_generic_bbc_title(stored_title)
    ):
        derived_title = _derive_bbc_display_title_from_url(source_url)
        if derived_title != "":
            return derived_title

    if stored_title != "":
        return stored_title

    return source_url or "Feed"


def extract_feed_title(root: ET.Element, source_url: str = "") -> str:
    """Extract feed title from RSS or Atom root element."""

    tag = root.tag.lower()

    if tag.endswith("rss"):
        channel = root.find("channel")
        if channel is not None:
            title = str(channel.findtext("title", default="")).strip()
            description = str(channel.findtext("description", default="")).strip()

            if _is_bbc_feed_source_url(source_url) and description != "":
                return description

            if title != "":
                return title

            if description != "":
                return description

    if tag.endswith("feed"):
        for child in root:
            child_tag = child.tag.lower()
            if child_tag.endswith("title"):
                return (child.text or "").strip()

    for node in root.iter():
        if node.tag.lower().endswith("title"):
            value = (node.text or "").strip()
            if value != "":
                return value

    return ""


def _as_utc_datetime(value: Any) -> datetime | None:
    """Return a timezone-aware UTC datetime or None."""

    if not isinstance(value, datetime):
        return None

    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)

    return value.astimezone(UTC)


def read_visibility_cutoff(reference_time: datetime | None = None) -> datetime:
    """Return the UTC cutoff timestamp for read-article visibility."""

    base_time = _as_utc_datetime(reference_time) or utc_now()
    return base_time - READ_VISIBILITY_WINDOW


def recently_read_cutoff(reference_time: datetime | None = None) -> datetime:
    """Return the UTC cutoff timestamp for recently-read history."""

    base_time = _as_utc_datetime(reference_time) or utc_now()
    return base_time - RECENTLY_READ_WINDOW


def is_read_within_visibility_window(
    read_at: Any,
    *,
    reference_time: datetime | None = None,
) -> bool:
    """Return True when read_at is inside the read-visibility window."""

    normalized_read_at = _as_utc_datetime(read_at)
    if normalized_read_at is None:
        return False

    return normalized_read_at >= read_visibility_cutoff(reference_time)


def _latest_datetime(left: datetime | None, right: datetime | None) -> datetime | None:
    """Return whichever datetime is later, handling None values."""

    if left is None:
        return right
    if right is None:
        return left
    return left if left >= right else right


def _updated_timestamp(value: Any) -> datetime:
    """Return a sortable updated_at value fallback."""

    return _as_utc_datetime(value) or datetime.min.replace(tzinfo=UTC)


async def _merge_user_article_state(
    target_article_id: ObjectId,
    source_article_id: ObjectId,
) -> None:
    """Merge per-user state from source article into target article."""

    if (
        user_article_states_collection is None
        or target_article_id == source_article_id
    ):
        return

    cursor = user_article_states_collection.find({"article_id": source_article_id})
    now = utc_now()

    async for source_state in cursor:
        source_state_id = source_state.get("_id")
        user_id = source_state.get("user_id")

        if not isinstance(source_state_id, ObjectId) or not isinstance(user_id, str):
            continue

        target_state = await user_article_states_collection.find_one(
            {
                "user_id": user_id,
                "article_id": target_article_id,
            }
        )

        if target_state is None:
            await user_article_states_collection.update_one(
                {"_id": source_state_id},
                {
                    "$set": {
                        "article_id": target_article_id,
                        "updated_at": now,
                    }
                },
            )
            continue

        source_is_opened = bool(source_state.get("is_opened"))
        source_is_read = bool(source_state.get("is_read"))
        source_is_saved = bool(source_state.get("is_saved"))
        target_is_opened = bool(target_state.get("is_opened"))
        target_is_read = bool(target_state.get("is_read"))
        target_is_saved = bool(target_state.get("is_saved"))

        source_opened_at = _as_utc_datetime(source_state.get("opened_at"))
        target_opened_at = _as_utc_datetime(target_state.get("opened_at"))
        source_read_at = _as_utc_datetime(source_state.get("read_at"))
        target_read_at = _as_utc_datetime(target_state.get("read_at"))
        source_saved_at = _as_utc_datetime(source_state.get("saved_at"))
        target_saved_at = _as_utc_datetime(target_state.get("saved_at"))

        merged_is_opened = target_is_opened or source_is_opened
        merged_is_read = target_is_read or source_is_read
        merged_is_saved = target_is_saved or source_is_saved
        merged_opened_at = _latest_datetime(target_opened_at, source_opened_at)
        merged_read_at = _latest_datetime(target_read_at, source_read_at)
        merged_saved_at = _latest_datetime(target_saved_at, source_saved_at)

        await user_article_states_collection.update_one(
            {"_id": target_state["_id"]},
            {
                "$set": {
                    "is_opened": merged_is_opened,
                    "opened_at": merged_opened_at,
                    "is_read": merged_is_read,
                    "read_at": merged_read_at,
                    "is_saved": merged_is_saved,
                    "saved_at": merged_saved_at,
                    "updated_at": now,
                }
            },
        )
        await user_article_states_collection.delete_one({"_id": source_state_id})


async def _merge_duplicate_feed_articles(
    canonical_feed_id: ObjectId,
    duplicate_feed_ids: list[ObjectId],
) -> None:
    """Move duplicate-source articles into canonical feed and merge states."""

    if feed_articles_collection is None or len(duplicate_feed_ids) == 0:
        return

    cursor = feed_articles_collection.find({"feed_id": {"$in": duplicate_feed_ids}})

    async for article_doc in cursor:
        source_article_id = article_doc.get("_id")
        canonical_url = normalize_article_link(article_doc.get("canonical_url"))
        external_id = str(article_doc.get("external_id", "")).strip()
        dedupe_key = str(article_doc.get("dedupe_key", "")).strip()

        if not isinstance(source_article_id, ObjectId):
            continue

        if canonical_url != "":
            target_lookup: dict[str, Any] = {
                "feed_id": canonical_feed_id,
                "$or": [
                    {"canonical_url": canonical_url},
                    {"link": canonical_url},
                ],
            }
        elif external_id != "" and external_id.lower() not in {"none", "null", "undefined"}:
            target_lookup = {
                "feed_id": canonical_feed_id,
                "external_id": external_id,
            }
        elif dedupe_key != "":
            target_lookup = {
                "feed_id": canonical_feed_id,
                "dedupe_key": dedupe_key,
            }
        else:
            # No stable identity; keep historical row to avoid unsafe merges.
            continue

        target_article = await feed_articles_collection.find_one(
            target_lookup,
            {"_id": 1},
        )

        if target_article is None:
            cloned_article = dict(article_doc)
            cloned_article.pop("_id", None)
            cloned_article["feed_id"] = canonical_feed_id

            try:
                insert_result = await feed_articles_collection.insert_one(cloned_article)
                target_article_id = insert_result.inserted_id
            except DuplicateKeyError:
                existing_target = await feed_articles_collection.find_one(
                    target_lookup,
                    {"_id": 1},
                )
                target_article_id = (
                    existing_target.get("_id")
                    if isinstance(existing_target, dict)
                    else None
                )
        else:
            target_article_id = target_article.get("_id")

        if isinstance(target_article_id, ObjectId):
            await _merge_user_article_state(target_article_id, source_article_id)

        await feed_articles_collection.delete_one({"_id": source_article_id})


async def _merge_duplicate_subscriptions(
    canonical_feed_id: ObjectId,
    duplicate_feed_ids: list[ObjectId],
) -> None:
    """Repoint duplicate feed subscriptions to canonical feed, user-safe."""

    if user_feed_subscriptions_collection is None or len(duplicate_feed_ids) == 0:
        return

    now = utc_now()
    cursor = user_feed_subscriptions_collection.find(
        {"feed_id": {"$in": duplicate_feed_ids}}
    ).sort([("updated_at", DESCENDING), ("_id", ASCENDING)])

    async for sub_doc in cursor:
        sub_id = sub_doc.get("_id")
        user_id = sub_doc.get("user_id")
        category_id = sub_doc.get("category_id")

        if not isinstance(sub_id, ObjectId) or not isinstance(user_id, str):
            continue

        canonical_sub = await user_feed_subscriptions_collection.find_one(
            {
                "user_id": user_id,
                "feed_id": canonical_feed_id,
            }
        )

        if canonical_sub is None:
            await user_feed_subscriptions_collection.update_one(
                {"_id": sub_id},
                {
                    "$set": {
                        "feed_id": canonical_feed_id,
                        "updated_at": now,
                    }
                },
            )
            continue

        incoming_updated = _updated_timestamp(sub_doc.get("updated_at"))
        canonical_updated = _updated_timestamp(canonical_sub.get("updated_at"))

        if (
            isinstance(category_id, ObjectId)
            and incoming_updated > canonical_updated
            and canonical_sub.get("category_id") != category_id
        ):
            await user_feed_subscriptions_collection.update_one(
                {"_id": canonical_sub["_id"]},
                {
                    "$set": {
                        "category_id": category_id,
                        "updated_at": now,
                    }
                },
            )

        await user_feed_subscriptions_collection.delete_one({"_id": sub_id})


async def consolidate_duplicate_feed_sources(normalized_url: str) -> dict[str, Any] | None:
    """Merge duplicate source docs for one normalized URL into a canonical source."""

    if feed_sources_collection is None:
        return None

    source_docs = [
        dict(doc)
        async for doc in feed_sources_collection.find(
            {"normalized_url": normalized_url}
        ).sort([("created_at", ASCENDING), ("_id", ASCENDING)])
    ]

    if len(source_docs) == 0:
        return None

    canonical_source = source_docs[0]
    canonical_source_id = canonical_source.get("_id")

    if not isinstance(canonical_source_id, ObjectId):
        return canonical_source

    if len(source_docs) == 1:
        return canonical_source

    duplicate_source_ids: list[ObjectId] = []
    for source in source_docs[1:]:
        source_id = source.get("_id")
        if isinstance(source_id, ObjectId):
            duplicate_source_ids.append(source_id)

    if len(duplicate_source_ids) == 0:
        return canonical_source

    await _merge_duplicate_subscriptions(canonical_source_id, duplicate_source_ids)
    await _merge_duplicate_feed_articles(canonical_source_id, duplicate_source_ids)

    await feed_sources_collection.delete_many({"_id": {"$in": duplicate_source_ids}})

    refreshed = await feed_sources_collection.find_one({"_id": canonical_source_id})
    return dict(refreshed) if refreshed is not None else canonical_source


async def opportunistic_consolidate_duplicate_sources(max_urls: int = 2) -> None:
    """Consolidate a small batch of duplicate normalized URLs.

    This is intentionally bounded so request-path healing remains lightweight.
    """

    if feed_sources_collection is None or max_urls <= 0:
        return

    pipeline: list[dict[str, Any]] = [
        {
            "$group": {
                "_id": "$normalized_url",
                "count": {"$sum": 1},
            }
        },
        {
            "$match": {
                "_id": {"$type": "string"},
                "count": {"$gt": 1},
            }
        },
        {"$limit": int(max_urls)},
    ]

    duplicate_rows = [doc async for doc in feed_sources_collection.aggregate(pipeline)]

    for row in duplicate_rows:
        normalized_url = row.get("_id")
        if not isinstance(normalized_url, str) or normalized_url.strip() == "":
            continue
        await consolidate_duplicate_feed_sources(normalized_url.strip())


async def ensure_category(user_id: str, category_name: str) -> tuple[FeedCategoryDocument, bool]:
    """Ensure a user category exists and return the document and creation flag."""

    if feed_categories_collection is None:
        raise RuntimeError("Feed categories collection is not available.")

    trimmed_name = category_name.strip()
    if trimmed_name == "":
        raise ValueError("Category name is required.")

    existing_doc = await feed_categories_collection.find_one(
        {"user_id": user_id, "name": trimmed_name}
    )
    if existing_doc is not None:
        return FeedCategoryDocument.model_validate(existing_doc), False

    max_sort_doc = await feed_categories_collection.find_one(
        {"user_id": user_id}, sort=[("sort_order", DESCENDING)]
    )
    next_sort_order = int(max_sort_doc.get("sort_order", -1)) + 1 if max_sort_doc else 0

    category_doc = FeedCategoryDocument(
        user_id=user_id,
        name=trimmed_name,
        muted=False,
        color_hex=deterministic_category_color(trimmed_name),
        sort_order=next_sort_order,
        created_at=utc_now(),
        updated_at=utc_now(),
    )

    insert_result = await feed_categories_collection.insert_one(
        category_doc.model_dump(by_alias=True, exclude={"id"})
    )
    category_doc.id = insert_result.inserted_id
    return category_doc, True


async def ensure_feed_source(normalized_url: str, source_title: str) -> dict[str, Any]:
    """Ensure a deduplicated source exists for a normalized URL."""

    if feed_sources_collection is None:
        raise RuntimeError("Feed sources collection is not available.")

    existing_doc = await consolidate_duplicate_feed_sources(normalized_url)
    if existing_doc is not None:
        existing = dict(existing_doc)

        if source_title.strip() != "" and existing.get("title", "") != source_title.strip():
            await feed_sources_collection.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "title": source_title.strip(),
                        "updated_at": utc_now(),
                    }
                },
            )
            existing = {**existing, "title": source_title.strip()}

        return existing

    new_source = {
        "normalized_url": normalized_url,
        "title": source_title.strip() or normalized_url,
        "image_url": None,
        "etag": None,
        "last_modified": None,
        "last_fetched_at": None,
        "next_refresh_at": None,
        "refresh_interval_seconds": None,
        "fetch_status": "new",
        "last_error": None,
        "next_retry_at": None,
        "force_refresh_requested_at": None,
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }
    try:
        result = await feed_sources_collection.insert_one(new_source)
        new_source["_id"] = result.inserted_id
    except DuplicateKeyError:
        pass

    existing_after_insert = await consolidate_duplicate_feed_sources(normalized_url)
    if existing_after_insert is not None:
        existing = dict(existing_after_insert)

        if source_title.strip() != "" and existing.get("title", "") != source_title.strip():
            await feed_sources_collection.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "title": source_title.strip(),
                        "updated_at": utc_now(),
                    }
                },
            )
            existing = {**existing, "title": source_title.strip()}

        return existing

    raise RuntimeError("Unable to ensure feed source document.")


async def request_immediate_feed_refresh(feed_ids: set[ObjectId]) -> None:
    """Flag sources for an immediate backend refresh cycle.

    This sets a force-refresh marker consumed by the backend worker and clears
    retry deferrals so newly-added/imported subscriptions are fetched quickly.
    """

    if feed_sources_collection is None or len(feed_ids) == 0:
        return

    now = utc_now()
    await feed_sources_collection.update_many(
        {"_id": {"$in": list(feed_ids)}},
        {
            "$set": {
                "force_refresh_requested_at": now,
                "next_retry_at": None,
                "next_refresh_at": now,
                "updated_at": now,
            }
        },
    )


async def create_or_update_subscription(
    user_id: str,
    normalized_url: str,
    source_title: str,
    category_name: str,
    duplicate_policy: str = "skip",
) -> tuple[dict[str, Any], bool]:
    """Create or update a subscription for a user.

    Returns:
        Tuple of subscription document and whether a new subscription was created.
    """

    if user_feed_subscriptions_collection is None:
        raise RuntimeError("Feed subscriptions collection is not available.")

    category_doc, _ = await ensure_category(user_id, category_name)
    source_doc = await ensure_feed_source(normalized_url, source_title)

    existing_doc = await user_feed_subscriptions_collection.find_one(
        {"user_id": user_id, "feed_id": source_doc["_id"]}
    )

    if existing_doc is not None:
        existing = dict(existing_doc)

        if duplicate_policy == "refresh" and existing.get("category_id") != category_doc.id:
            await user_feed_subscriptions_collection.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "category_id": category_doc.id,
                        "updated_at": utc_now(),
                    }
                },
            )

            existing = {
                **existing,
                "category_id": category_doc.id,
                "updated_at": utc_now(),
            }

        source_id = source_doc.get("_id")
        if isinstance(source_id, ObjectId):
            await request_immediate_feed_refresh({source_id})

        invalidate_category_counts_cache(user_id)
        return existing, False

    new_subscription = {
        "user_id": user_id,
        "feed_id": source_doc["_id"],
        "category_id": category_doc.id,
        "truncate_on_display": False,
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }

    insert_result = await user_feed_subscriptions_collection.insert_one(new_subscription)
    new_subscription["_id"] = insert_result.inserted_id

    source_id = source_doc.get("_id")
    if isinstance(source_id, ObjectId):
        await request_immediate_feed_refresh({source_id})

    invalidate_category_counts_cache(user_id)
    return new_subscription, True


async def load_user_category(
    user_id: str,
    category_id: str,
) -> FeedCategoryDocument | None:
    """Load a user-owned category document by ID."""

    if feed_categories_collection is None:
        return None

    try:
        category_object_id = ObjectId(category_id)
    except Exception:
        return None

    category_doc = await feed_categories_collection.find_one(
        {"_id": category_object_id, "user_id": user_id}
    )
    if category_doc is None:
        return None

    return FeedCategoryDocument.model_validate(category_doc)


async def get_subscription_source_metadata(
    user_id: str,
    subscription_id: str,
) -> dict[str, Any] | None:
    """Return the existing subscription's feed source URL and title when available."""

    if user_feed_subscriptions_collection is None or feed_sources_collection is None:
        return None

    try:
        subscription_object_id = ObjectId(subscription_id)
    except Exception:
        return None

    existing_subscription = await user_feed_subscriptions_collection.find_one(
        {"_id": subscription_object_id, "user_id": user_id}
    )
    if existing_subscription is None:
        return None

    feed_id = existing_subscription.get("feed_id")
    if not isinstance(feed_id, ObjectId):
        return None

    source_doc = await feed_sources_collection.find_one({"_id": feed_id})
    if source_doc is None:
        return None

    normalized_url = str(source_doc.get("normalized_url", "")).strip()
    if normalized_url == "":
        return None

    source_title = resolve_source_display_title(source_doc)
    return {
        "subscription": dict(existing_subscription),
        "normalized_url": normalized_url,
        "source_title": source_title,
        "feed_id": feed_id,
    }


async def update_subscription_details(
    user_id: str,
    subscription_id: str,
    normalized_url: str,
    source_title: str,
    category_id: str,
    truncate_on_display: bool,
    *,
    refresh_source: bool = True,
) -> dict[str, Any] | None:
    """Update an existing user subscription URL and category.

    When *refresh_source* is False, the feed URL is assumed unchanged and the
    existing source document is reused without requesting an immediate refresh.
    """

    if user_feed_subscriptions_collection is None or feed_sources_collection is None:
        return None

    try:
        subscription_object_id = ObjectId(subscription_id)
    except Exception:
        return None

    category_doc = await load_user_category(user_id, category_id)
    if category_doc is None or category_doc.id is None:
        return None

    existing_subscription = await user_feed_subscriptions_collection.find_one(
        {"_id": subscription_object_id, "user_id": user_id}
    )
    if existing_subscription is None:
        return None

    existing_feed_id = existing_subscription.get("feed_id")
    source_unchanged = (
        not refresh_source
        and isinstance(existing_feed_id, ObjectId)
    )

    if source_unchanged:
        source_doc = await feed_sources_collection.find_one({"_id": existing_feed_id})
        if source_doc is None:
            return None
        if str(source_doc.get("normalized_url", "")).strip() != normalized_url:
            source_doc = await ensure_feed_source(normalized_url, source_title)
            refresh_source = True
    else:
        source_doc = await ensure_feed_source(normalized_url, source_title)

    now = utc_now()
    duplicate_subscription = await user_feed_subscriptions_collection.find_one(
        {
            "user_id": user_id,
            "feed_id": source_doc["_id"],
            "_id": {"$ne": subscription_object_id},
        }
    )

    if duplicate_subscription is not None:
        await user_feed_subscriptions_collection.update_one(
            {"_id": duplicate_subscription["_id"]},
            {
                "$set": {
                    "category_id": category_doc.id,
                    "truncate_on_display": truncate_on_display,
                    "updated_at": now,
                }
            },
        )
        await user_feed_subscriptions_collection.delete_one(
            {"_id": subscription_object_id, "user_id": user_id}
        )

        updated_subscription = await user_feed_subscriptions_collection.find_one(
            {"_id": duplicate_subscription["_id"], "user_id": user_id}
        )
    else:
        await user_feed_subscriptions_collection.update_one(
            {"_id": subscription_object_id, "user_id": user_id},
            {
                "$set": {
                    "feed_id": source_doc["_id"],
                    "category_id": category_doc.id,
                    "truncate_on_display": truncate_on_display,
                    "updated_at": now,
                }
            },
        )
        updated_subscription = await user_feed_subscriptions_collection.find_one(
            {"_id": subscription_object_id, "user_id": user_id}
        )

    source_id = source_doc.get("_id")
    if refresh_source and isinstance(source_id, ObjectId):
        await request_immediate_feed_refresh({source_id})

    if updated_subscription is not None:
        invalidate_category_counts_cache(user_id)
    return dict(updated_subscription) if updated_subscription is not None else None


async def delete_subscription(user_id: str, subscription_id: str) -> bool:
    """Delete a user-owned subscription."""

    if user_feed_subscriptions_collection is None:
        return False

    try:
        subscription_object_id = ObjectId(subscription_id)
    except Exception:
        return False

    result = await user_feed_subscriptions_collection.delete_one(
        {"_id": subscription_object_id, "user_id": user_id}
    )
    if result.deleted_count > 0:
        invalidate_category_counts_cache(user_id)
    return result.deleted_count > 0


async def list_category_documents(user_id: str) -> list[FeedCategoryDocument]:
    """Return all categories for a user sorted by configured order."""

    if feed_categories_collection is None:
        return []

    cursor = feed_categories_collection.find({"user_id": user_id}).sort(
        [("sort_order", ASCENDING), ("name", ASCENDING)]
    )
    return [FeedCategoryDocument.model_validate(doc) async for doc in cursor]


async def list_user_subscription_rows(user_id: str) -> list[dict[str, Any]]:
    """Return subscriptions enriched with category/source details."""

    if user_feed_subscriptions_collection is None:
        return []

    subscriptions = [
        dict(doc)
        async for doc in user_feed_subscriptions_collection.find({"user_id": user_id})
    ]

    if len(subscriptions) == 0:
        return []

    category_ids = {sub["category_id"] for sub in subscriptions}
    feed_ids = {sub["feed_id"] for sub in subscriptions}

    categories_map = await load_categories_map(category_ids)
    sources_map = await load_sources_map(feed_ids)

    rows: list[dict[str, Any]] = []
    for sub in subscriptions:
        category = categories_map.get(sub["category_id"])
        source = sources_map.get(sub["feed_id"])

        if category is None or source is None:
            continue

        rows.append(
            {
                "subscription_id": str(sub["_id"]),
                "feed_id": str(sub["feed_id"]),
                "source_title": resolve_source_display_title(source),
                "source_url": str(source.get("normalized_url", "")),
                "source_image_url": str(source.get("image_url", "")).strip(),
                "category_id": str(category.id),
                "category_name": category.name,
                "category_color_hex": category.color_hex,
                "category_muted": category.muted,
                "truncate_on_display": bool(sub.get("truncate_on_display")),
            }
        )

    rows.sort(key=lambda row: (row["category_name"].lower(), row["source_title"].lower()))
    return rows


async def load_categories_map(category_ids: set[ObjectId]) -> dict[ObjectId, FeedCategoryDocument]:
    """Load category documents keyed by category ObjectId."""

    if feed_categories_collection is None or len(category_ids) == 0:
        return {}

    cursor = feed_categories_collection.find({"_id": {"$in": list(category_ids)}})
    categories = [FeedCategoryDocument.model_validate(doc) async for doc in cursor]
    return {category.id: category for category in categories if category.id is not None}


async def load_sources_map(feed_ids: set[ObjectId]) -> dict[ObjectId, dict[str, Any]]:
    """Load source documents keyed by source ObjectId."""

    if feed_sources_collection is None or len(feed_ids) == 0:
        return {}

    cursor = feed_sources_collection.find({"_id": {"$in": list(feed_ids)}})
    docs = [dict(doc) async for doc in cursor]

    source_map: dict[ObjectId, dict[str, Any]] = {}
    for doc in docs:
        source_id = doc.get("_id")
        if isinstance(source_id, ObjectId):
            source_map[source_id] = doc

    return source_map


def resolve_head_probe_limit(page_size: int) -> int:
    """Return the capped article-window size used for reader head probes."""

    normalized_page_size = max(1, int(page_size))
    return min(max(normalized_page_size * 2, normalized_page_size), HEAD_PROBE_MAX_LIMIT)


def invalidate_category_counts_cache(user_id: str) -> None:
    """Drop cached sidebar category counts for a user."""

    _category_counts_cache.pop(user_id, None)


async def build_categories_with_counts(
    user_id: str,
    categories: list[FeedCategoryDocument],
    subscriptions: list[dict[str, Any]],
    read_state_ids: set[ObjectId],
) -> FeedCategoryListResponse:
    """Build sidebar categories and unread counters from preloaded scope data."""

    if user_feed_subscriptions_collection is None:
        return FeedCategoryListResponse(
            all_unread_count=0,
            recently_read_count=0,
            saved_count=0,
            categories=[],
        )

    feed_to_category = {
        sub["feed_id"]: sub["category_id"] for sub in subscriptions if "feed_id" in sub and "category_id" in sub
    }

    category_summaries: list[FeedCategorySummary] = []
    all_unread_count = 0

    for category in categories:
        category_feed_ids = [
            feed_id
            for feed_id, category_id in feed_to_category.items()
            if category.id is not None and category_id == category.id
        ]
        unread_count = await count_unread_articles_for_feed_ids(category_feed_ids, read_state_ids)

        if not category.muted:
            all_unread_count += unread_count

        if category.id is None:
            continue

        category_summaries.append(
            FeedCategorySummary(
                category_id=str(category.id),
                name=category.name,
                unread_count=unread_count,
                muted=category.muted,
                color_hex=category.color_hex,
                sort_order=category.sort_order,
            )
        )

    recently_read_count = await count_recently_read(user_id, feed_to_category, categories)
    saved_count = await count_saved_articles(user_id, feed_to_category)

    return FeedCategoryListResponse(
        all_unread_count=all_unread_count,
        recently_read_count=recently_read_count,
        saved_count=saved_count,
        categories=category_summaries,
    )


async def get_categories_with_counts(user_id: str) -> FeedCategoryListResponse:
    """Return sidebar categories and unread counters for a user."""

    now = utc_now()
    cached_entry = _category_counts_cache.get(user_id)
    if (
        cached_entry is not None
        and now - cached_entry[0] <= CATEGORY_COUNTS_CACHE_TTL
    ):
        return cached_entry[1]

    categories = await list_category_documents(user_id)
    subscriptions = await list_user_subscription_docs(user_id)
    read_state_ids = await get_read_article_id_set(user_id)
    payload = await build_categories_with_counts(
        user_id,
        categories,
        subscriptions,
        read_state_ids,
    )
    _category_counts_cache[user_id] = (now, payload)
    return payload


async def get_read_article_id_set(user_id: str) -> set[ObjectId]:
    """Return article IDs that are marked as read for the user."""

    if user_article_states_collection is None:
        return set()

    cursor = user_article_states_collection.find(
        {"user_id": user_id, "is_read": True}, {"article_id": 1}
    )
    return {doc["article_id"] async for doc in cursor if "article_id" in doc}


async def get_read_article_visibility_sets(
    user_id: str,
) -> tuple[set[ObjectId], set[ObjectId]]:
    """Return article IDs split into recent-read and expired-read sets."""

    if user_article_states_collection is None:
        return set(), set()

    now = utc_now()
    recent_read_ids: set[ObjectId] = set()
    expired_read_ids: set[ObjectId] = set()

    cursor = user_article_states_collection.find(
        {"user_id": user_id, "is_read": True},
        {"article_id": 1, "read_at": 1},
    )

    async for doc in cursor:
        article_id = doc.get("article_id")
        if not isinstance(article_id, ObjectId):
            continue

        if is_read_within_visibility_window(doc.get("read_at"), reference_time=now):
            recent_read_ids.add(article_id)
        else:
            expired_read_ids.add(article_id)

    return recent_read_ids, expired_read_ids


async def get_saved_article_id_set(
    user_id: str,
) -> set[ObjectId]:
    """Return article IDs that are marked as saved for the user."""

    if user_article_states_collection is None:
        return set()
    cursor = user_article_states_collection.find(
        {"user_id": user_id, "is_saved": True},
        {"article_id": 1},
    )
    return {doc["article_id"] async for doc in cursor if "article_id" in doc}


async def count_saved_articles(
    user_id: str,
    feed_to_category: dict[ObjectId, ObjectId],
) -> int:
    """Count saved articles for feeds the user is subscribed to."""

    if feed_articles_collection is None:
        return 0

    feed_ids = list(feed_to_category.keys())
    if len(feed_ids) == 0:
        return 0

    saved_article_ids = await get_saved_article_id_set(user_id)
    if len(saved_article_ids) == 0:
        return 0

    return await feed_articles_collection.count_documents(
        {
            "_id": {"$in": list(saved_article_ids)},
            "feed_id": {"$in": feed_ids},
            "is_deleted": False,
        }
    )


async def count_unread_articles_for_feed_ids(
    feed_ids: list[ObjectId],
    read_state_ids: set[ObjectId],
) -> int:
    """Count unread articles for a set of feeds."""

    if feed_articles_collection is None or len(feed_ids) == 0:
        return 0

    query: dict[str, Any] = {
        "feed_id": {"$in": feed_ids},
        "is_deleted": False,
    }

    if len(read_state_ids) > 0:
        query["_id"] = {"$nin": list(read_state_ids)}

    return await feed_articles_collection.count_documents(query)


async def count_recently_read(
    user_id: str,
    feed_to_category: dict[ObjectId, ObjectId],
    categories: list[FeedCategoryDocument],
) -> int:
    """Count recently-read articles in the last seven days."""

    if user_article_states_collection is None or feed_articles_collection is None:
        return 0

    muted_category_ids = {
        category.id for category in categories if category.id is not None and category.muted
    }

    threshold = recently_read_cutoff()
    state_cursor = user_article_states_collection.find(
        {
            "user_id": user_id,
            "is_read": True,
            "read_at": {"$gte": threshold},
        },
        {"article_id": 1},
    )
    article_ids = [doc["article_id"] async for doc in state_cursor if "article_id" in doc]

    if len(article_ids) == 0:
        return 0

    article_cursor = feed_articles_collection.find(
        {
            "_id": {"$in": article_ids},
        },
        {"feed_id": 1},
    )

    count = 0
    async for article_doc in article_cursor:
        feed_id = article_doc.get("feed_id")
        if not isinstance(feed_id, ObjectId):
            continue

        category_id = feed_to_category.get(feed_id)
        if category_id in muted_category_ids:
            continue
        count += 1

    return count


async def get_article_list(
    user_id: str,
    category_filter: str,
    status_filter: str,
    feed_filter: str | None = None,
    search_query: str | None = None,
    require_search_query: bool = False,
    offset: int = 0,
    limit: int = 10,
    ids_only: bool = False,
    preloaded_categories: list[FeedCategoryDocument] | None = None,
    preloaded_subscriptions: list[dict[str, Any]] | None = None,
    preloaded_read_state_ids: set[ObjectId] | None = None,
) -> FeedArticleListResponse:
    """Return filtered article cards for the feed reader view."""

    normalized_offset = max(0, int(offset))
    normalized_limit = max(1, int(limit))
    normalized_search_query = normalize_article_search_query(search_query)

    normalized_status: Literal["unread", "read", "all"]
    if status_filter in {"unread", "read", "all"}:
        normalized_status = cast(Literal["unread", "read", "all"], status_filter)
    else:
        normalized_status = "unread"

    if require_search_query and normalized_search_query == "":
        response_status: Literal["unread", "read", "all"]
        if category_filter == "recently-read":
            response_status = "read"
        elif category_filter == "saved":
            response_status = "all"
        else:
            response_status = normalized_status

        return FeedArticleListResponse(
            category=category_filter,
            status=response_status,
            articles=[],
            article_ids=[],
            offset=normalized_offset,
            limit=normalized_limit,
            has_more=False,
            next_offset=normalized_offset,
        )

    use_text_search = False
    if normalized_search_query != "":
        use_text_search = await feed_articles_text_search_available()

    newest_first = normalized_search_query != ""

    categories = (
        preloaded_categories
        if preloaded_categories is not None
        else await list_category_documents(user_id)
    )
    subscriptions = (
        preloaded_subscriptions
        if preloaded_subscriptions is not None
        else await list_user_subscription_docs(user_id)
    )

    selected_feed_id: ObjectId | None = None
    if isinstance(feed_filter, str) and feed_filter.strip() != "":
        try:
            selected_feed_id = ObjectId(feed_filter.strip())
        except Exception:
            selected_feed_id = None

    feed_to_category = {
        sub["feed_id"]: sub["category_id"]
        for sub in subscriptions
        if "feed_id" in sub and "category_id" in sub
    }
    truncated_feed_ids = {
        sub["feed_id"]
        for sub in subscriptions
        if isinstance(sub.get("feed_id"), ObjectId) and bool(sub.get("truncate_on_display"))
    }

    categories_by_id = {
        category.id: category for category in categories if category.id is not None
    }

    if category_filter == "recently-read":
        articles, has_more = await list_recently_read_cards(
            user_id=user_id,
            categories_by_id=categories_by_id,
            feed_to_category=feed_to_category,
            truncated_feed_ids=truncated_feed_ids,
            selected_feed_id=selected_feed_id,
            search_query=normalized_search_query,
            use_text_search=use_text_search,
            offset=normalized_offset,
            limit=normalized_limit,
        )
        return _feed_article_list_response(
            category="recently-read",
            status="read",
            articles=articles,
            article_ids=[article.article_id for article in articles],
            offset=normalized_offset,
            limit=normalized_limit,
            has_more=has_more,
            ids_only=ids_only,
        )

    if category_filter == "saved":
        articles, has_more = await list_saved_cards(
            user_id=user_id,
            categories_by_id=categories_by_id,
            feed_to_category=feed_to_category,
            truncated_feed_ids=truncated_feed_ids,
            selected_feed_id=selected_feed_id,
            search_query=normalized_search_query,
            use_text_search=use_text_search,
            newest_first=newest_first,
            offset=normalized_offset,
            limit=normalized_limit,
        )
        return _feed_article_list_response(
            category="saved",
            status="all",
            articles=articles,
            article_ids=[article.article_id for article in articles],
            offset=normalized_offset,
            limit=normalized_limit,
            has_more=has_more,
            ids_only=ids_only,
        )

    muted_category_ids = {
        category.id for category in categories if category.id is not None and category.muted
    }

    if category_filter == "all":
        allowed_category_ids = [
            category.id
            for category in categories
            if category.id is not None and not category.muted
        ]
    else:
        try:
            selected_category = ObjectId(category_filter)
        except Exception:
            selected_category = None

        if selected_category is None or selected_category in muted_category_ids:
            return _feed_article_list_response(
                category=category_filter,
                status=normalized_status,
                articles=[],
                article_ids=[],
                offset=normalized_offset,
                limit=normalized_limit,
                has_more=False,
                ids_only=ids_only,
            )

        allowed_category_ids = [selected_category]

    allowed_feed_ids = [
        feed_id
        for feed_id, category_id in feed_to_category.items()
        if category_id in allowed_category_ids
    ]

    if isinstance(selected_feed_id, ObjectId):
        allowed_feed_ids = [
            feed_id
            for feed_id in allowed_feed_ids
            if feed_id == selected_feed_id
        ]

    if len(allowed_feed_ids) == 0:
        return _feed_article_list_response(
            category=category_filter,
            status=normalized_status,
            articles=[],
            article_ids=[],
            offset=normalized_offset,
            limit=normalized_limit,
            has_more=False,
            ids_only=ids_only,
        )

    read_state_ids = (
        preloaded_read_state_ids
        if preloaded_read_state_ids is not None
        else await get_read_article_id_set(user_id)
    )
    recent_read_state_ids: set[ObjectId] = set()
    if normalized_status == "read":
        recent_read_state_ids, _ = await get_read_article_visibility_sets(user_id)

    if ids_only:
        article_ids, has_more = await list_article_ids_for_feed_ids(
            allowed_feed_ids=allowed_feed_ids,
            read_state_ids=read_state_ids,
            recent_read_state_ids=recent_read_state_ids,
            search_query=normalized_search_query,
            use_text_search=use_text_search,
            newest_first=newest_first,
            status_filter=normalized_status,
            offset=normalized_offset,
            limit=normalized_limit,
        )
        return _feed_article_list_response(
            category=category_filter,
            status=normalized_status,
            articles=[],
            article_ids=article_ids,
            offset=normalized_offset,
            limit=normalized_limit,
            has_more=has_more,
            ids_only=True,
        )

    cards, has_more = await list_cards_for_feed_ids(
        user_id=user_id,
        allowed_feed_ids=allowed_feed_ids,
        categories_by_id=categories_by_id,
        feed_to_category=feed_to_category,
        truncated_feed_ids=truncated_feed_ids,
        read_state_ids=read_state_ids,
        recent_read_state_ids=recent_read_state_ids,
        search_query=normalized_search_query,
        use_text_search=use_text_search,
        newest_first=newest_first,
        status_filter=normalized_status,
        offset=normalized_offset,
        limit=normalized_limit,
    )

    return _feed_article_list_response(
        category=category_filter,
        status=normalized_status,
        articles=cards,
        article_ids=[card.article_id for card in cards],
        offset=normalized_offset,
        limit=normalized_limit,
        has_more=has_more,
        ids_only=False,
    )


async def list_user_subscription_docs(user_id: str) -> list[dict[str, Any]]:
    """Return raw subscription docs for a user."""

    if user_feed_subscriptions_collection is None:
        return []

    return [
        dict(doc)
        async for doc in user_feed_subscriptions_collection.find({"user_id": user_id})
    ]


async def get_user_read_map(user_id: str) -> dict[ObjectId, datetime | None]:
    """Return article read timestamps keyed by article ID."""

    if user_article_states_collection is None:
        return {}

    cursor = user_article_states_collection.find(
        {"user_id": user_id, "is_read": True},
        {"article_id": 1, "read_at": 1},
    )

    read_map: dict[ObjectId, datetime | None] = {}
    async for doc in cursor:
        article_id = doc.get("article_id")
        if not isinstance(article_id, ObjectId):
            continue
        read_map[article_id] = doc.get("read_at")

    return read_map


async def get_user_saved_map(user_id: str) -> dict[ObjectId, datetime | None]:
    """Return article saved timestamps keyed by article ID."""

    if user_article_states_collection is None:
        return {}

    cursor = user_article_states_collection.find(
        {"user_id": user_id, "is_saved": True},
        {"article_id": 1, "saved_at": 1},
    )

    saved_map: dict[ObjectId, datetime | None] = {}
    async for doc in cursor:
        article_id = doc.get("article_id")
        if not isinstance(article_id, ObjectId):
            continue
        saved_map[article_id] = doc.get("saved_at")

    return saved_map


async def get_user_state_maps_for_article_ids(
    user_id: str,
    article_ids: list[ObjectId],
) -> tuple[dict[ObjectId, datetime | None], dict[ObjectId, datetime | None]]:
    """Return read/saved timestamp maps scoped to explicit article IDs."""

    if user_article_states_collection is None or len(article_ids) == 0:
        return {}, {}

    unique_article_ids = list(dict.fromkeys(article_ids))

    cursor = user_article_states_collection.find(
        {
            "user_id": user_id,
            "article_id": {"$in": unique_article_ids},
        },
        {
            "article_id": 1,
            "is_read": 1,
            "read_at": 1,
            "is_saved": 1,
            "saved_at": 1,
        },
    )

    read_map: dict[ObjectId, datetime | None] = {}
    saved_map: dict[ObjectId, datetime | None] = {}

    async for doc in cursor:
        article_id = doc.get("article_id")
        if not isinstance(article_id, ObjectId):
            continue

        if bool(doc.get("is_read")):
            read_map[article_id] = doc.get("read_at")

        if bool(doc.get("is_saved")):
            saved_map[article_id] = doc.get("saved_at")

    return read_map, saved_map


async def get_article_read_statuses(
    user_id: str,
    article_ids: list[str],
) -> list[FeedArticleStatusItem]:
    """Return read/save-state for explicit article IDs visible to the user."""

    if (
        user_feed_subscriptions_collection is None
        or feed_articles_collection is None
        or user_article_states_collection is None
    ):
        return []

    ordered_unique_ids: list[ObjectId] = []
    seen_ids: set[ObjectId] = set()
    for raw_article_id in article_ids:
        trimmed_article_id = str(raw_article_id or "").strip()
        if trimmed_article_id == "":
            continue

        try:
            parsed_article_id = ObjectId(trimmed_article_id)
        except Exception:
            continue

        if parsed_article_id in seen_ids:
            continue

        seen_ids.add(parsed_article_id)
        ordered_unique_ids.append(parsed_article_id)

    if len(ordered_unique_ids) == 0:
        return []

    subscription_cursor = user_feed_subscriptions_collection.find(
        {"user_id": user_id},
        {"feed_id": 1},
    )
    allowed_feed_ids = [
        doc.get("feed_id")
        async for doc in subscription_cursor
        if isinstance(doc.get("feed_id"), ObjectId)
    ]

    if len(allowed_feed_ids) == 0:
        return []

    article_cursor = feed_articles_collection.find(
        {
            "_id": {"$in": ordered_unique_ids},
            "feed_id": {"$in": allowed_feed_ids},
            "is_deleted": False,
        },
        {"_id": 1},
    )
    visible_article_ids = {
        article_doc.get("_id")
        async for article_doc in article_cursor
        if isinstance(article_doc.get("_id"), ObjectId)
    }

    if len(visible_article_ids) == 0:
        return []

    read_state_cursor = user_article_states_collection.find(
        {
            "user_id": user_id,
            "article_id": {"$in": list(visible_article_ids)},
        },
        {"article_id": 1, "is_read": 1, "is_saved": 1, "read_at": 1, "saved_at": 1},
    )
    state_flags: dict[ObjectId, tuple[bool, bool, datetime | None, datetime | None]] = {}
    async for state_doc in read_state_cursor:
        article_id = state_doc.get("article_id")
        if not isinstance(article_id, ObjectId):
            continue
        is_read = bool(state_doc.get("is_read"))
        read_at = _as_utc_datetime(state_doc.get("read_at"))
        saved_at = _as_utc_datetime(state_doc.get("saved_at"))
        state_flags[article_id] = (
            is_read,
            bool(state_doc.get("is_saved")),
            read_at,
            saved_at,
        )

    return [
        FeedArticleStatusItem(
            article_id=str(article_id),
            is_read=state_flags.get(article_id, (False, False, None, None))[0],
            is_saved=state_flags.get(article_id, (False, False, None, None))[1],
            read_at=state_flags.get(article_id, (False, False, None, None))[2],
            saved_at=state_flags.get(article_id, (False, False, None, None))[3],
        )
        for article_id in ordered_unique_ids
        if article_id in visible_article_ids
    ]


async def list_cards_for_feed_ids(
    user_id: str,
    allowed_feed_ids: list[ObjectId],
    categories_by_id: dict[ObjectId, FeedCategoryDocument],
    feed_to_category: dict[ObjectId, ObjectId],
    truncated_feed_ids: set[ObjectId],
    read_state_ids: set[ObjectId],
    recent_read_state_ids: set[ObjectId],
    search_query: str,
    use_text_search: bool,
    newest_first: bool,
    status_filter: str,
    offset: int,
    limit: int,
) -> tuple[list[FeedArticleCard], bool]:
    """Return article cards for feed IDs with status filtering."""

    if feed_articles_collection is None or len(allowed_feed_ids) == 0:
        return [], False

    base_query = {
        "feed_id": {"$in": allowed_feed_ids},
        "is_deleted": False,
    }

    if status_filter == "read":
        if len(recent_read_state_ids) == 0:
            return [], False
        base_query["_id"] = {"$in": list(recent_read_state_ids)}
    elif status_filter == "unread" and len(read_state_ids) > 0:
        # Fresh unread/category page loads exclude read items immediately.
        # The client intentionally keeps already-rendered cards visible until
        # the user performs a full page refresh.
        base_query["_id"] = {"$nin": list(read_state_ids)}

    search_filter = build_article_search_filter(
        search_query,
        use_text_search=use_text_search,
    )

    # Show oldest-first by default, while keeping search results newest-first.
    sort_direction = DESCENDING if newest_first else ASCENDING

    dated_query = {
        **base_query,
        "published_at": {"$type": "date"},
    }
    undated_query = {
        **base_query,
        "$or": [
            {"published_at": None},
            {"published_at": {"$exists": False}},
        ],
    }

    dated_query = merge_article_search_filter(dated_query, search_filter)
    undated_query = merge_article_search_filter(undated_query, search_filter)

    dated_total = await feed_articles_collection.count_documents(dated_query)
    dated_skip = min(offset, dated_total)
    undated_skip = max(0, offset - dated_total)

    dated_docs = [
        doc
        async for doc in feed_articles_collection.find(dated_query)
        .sort([("published_at", sort_direction), ("_id", sort_direction)])
        .skip(dated_skip)
        .limit(limit + 1)
    ]

    selected_docs: list[Any] = list(dated_docs[:limit])
    has_more = len(dated_docs) > limit

    if not has_more and len(selected_docs) < limit:
        remaining_limit = limit - len(selected_docs)
        undated_docs = [
            doc
            async for doc in feed_articles_collection.find(undated_query)
            .sort("_id", sort_direction)
            .skip(undated_skip)
            .limit(remaining_limit + 1)
        ]

        selected_docs.extend(undated_docs[:remaining_limit])
        has_more = len(undated_docs) > remaining_limit

    if len(selected_docs) == 0:
        return [], has_more

    source_ids: set[ObjectId] = {
        feed_id
        for feed_id in [doc.get("feed_id") for doc in selected_docs]
        if isinstance(feed_id, ObjectId)
    }
    source_map = await load_sources_map(source_ids)

    article_ids: list[ObjectId] = [
        article_id
        for article_id in [doc.get("_id") for doc in selected_docs]
        if isinstance(article_id, ObjectId)
    ]
    read_map, saved_map = await get_user_state_maps_for_article_ids(user_id, article_ids)

    cards: list[FeedArticleCard] = []

    for article_doc in selected_docs:
        article_id = article_doc.get("_id")
        feed_id = article_doc.get("feed_id")

        if not isinstance(article_id, ObjectId) or not isinstance(feed_id, ObjectId):
            continue

        category_id = feed_to_category.get(feed_id)
        if category_id is None:
            continue

        category = categories_by_id.get(category_id)
        if category is None or category.id is None:
            continue

        source_doc = source_map.get(feed_id, {})
        source_title = str(source_doc.get("title", source_doc.get("normalized_url", "Feed")))

        is_read = article_id in read_map
        read_at = read_map.get(article_id)
        is_saved = article_id in saved_map
        saved_at = saved_map.get(article_id)
        summary_html, full_summary_html, is_summary_truncated = build_article_summary_html(
            article_doc,
            truncate_on_display=feed_id in truncated_feed_ids,
        )

        cards.append(
            FeedArticleCard(
                article_id=str(article_id),
                feed_id=str(feed_id),
                title=str(article_doc.get("title", "Untitled")),
                link=normalize_article_navigation_link(article_doc.get("canonical_url") or article_doc.get("link")),
                author=str(article_doc.get("author", "")).strip() or None,
                summary_html=summary_html,
                full_summary_html=full_summary_html,
                is_summary_truncated=is_summary_truncated,
                media_image_url=normalize_article_link(article_doc.get("media_image_url")) or None,
                published_at=article_doc.get("published_at"),
                feed_title=source_title,
                category_id=str(category.id),
                category_name=category.name,
                category_color_hex=category.color_hex,
                is_read=is_read,
                read_at=read_at,
                is_saved=is_saved,
                saved_at=saved_at,
            )
        )

    return cards, has_more


async def list_article_ids_for_feed_ids(
    allowed_feed_ids: list[ObjectId],
    read_state_ids: set[ObjectId],
    recent_read_state_ids: set[ObjectId],
    search_query: str,
    use_text_search: bool,
    newest_first: bool,
    status_filter: str,
    offset: int,
    limit: int,
) -> tuple[list[str], bool]:
    """Return article IDs for feed IDs with status filtering."""

    if feed_articles_collection is None or len(allowed_feed_ids) == 0:
        return [], False

    base_query = {
        "feed_id": {"$in": allowed_feed_ids},
        "is_deleted": False,
    }

    if status_filter == "read":
        if len(recent_read_state_ids) == 0:
            return [], False
        base_query["_id"] = {"$in": list(recent_read_state_ids)}
    elif status_filter == "unread" and len(read_state_ids) > 0:
        base_query["_id"] = {"$nin": list(read_state_ids)}

    search_filter = build_article_search_filter(
        search_query,
        use_text_search=use_text_search,
    )

    sort_direction = DESCENDING if newest_first else ASCENDING

    dated_query = {
        **base_query,
        "published_at": {"$type": "date"},
    }
    undated_query = {
        **base_query,
        "$or": [
            {"published_at": None},
            {"published_at": {"$exists": False}},
        ],
    }

    dated_query = merge_article_search_filter(dated_query, search_filter)
    undated_query = merge_article_search_filter(undated_query, search_filter)

    dated_total = await feed_articles_collection.count_documents(dated_query)
    dated_skip = min(offset, dated_total)
    undated_skip = max(0, offset - dated_total)

    dated_docs = [
        doc
        async for doc in feed_articles_collection.find(dated_query, {"_id": 1})
        .sort([("published_at", sort_direction), ("_id", sort_direction)])
        .skip(dated_skip)
        .limit(limit + 1)
    ]

    selected_docs: list[Any] = list(dated_docs[:limit])
    has_more = len(dated_docs) > limit

    if not has_more and len(selected_docs) < limit:
        remaining_limit = limit - len(selected_docs)
        undated_docs = [
            doc
            async for doc in feed_articles_collection.find(undated_query, {"_id": 1})
            .sort("_id", sort_direction)
            .skip(undated_skip)
            .limit(remaining_limit + 1)
        ]

        selected_docs.extend(undated_docs[:remaining_limit])
        has_more = len(undated_docs) > remaining_limit

    article_ids = [
        str(article_id)
        for article_id in [doc.get("_id") for doc in selected_docs]
        if isinstance(article_id, ObjectId)
    ]

    return article_ids, has_more


def _feed_article_list_response(
    category: str,
    status: Literal["unread", "read", "all"],
    articles: list[FeedArticleCard],
    article_ids: list[str],
    offset: int,
    limit: int,
    has_more: bool,
    ids_only: bool,
) -> FeedArticleListResponse:
    """Build a normalized article-list API payload."""

    resolved_ids = article_ids if article_ids else [article.article_id for article in articles]
    resolved_count = len(resolved_ids)

    return FeedArticleListResponse(
        category=category,
        status=status,
        articles=[] if ids_only else articles,
        article_ids=resolved_ids,
        offset=offset,
        limit=limit,
        has_more=has_more,
        next_offset=offset + resolved_count,
    )


async def list_recently_read_cards(
    user_id: str,
    categories_by_id: dict[ObjectId, FeedCategoryDocument],
    feed_to_category: dict[ObjectId, ObjectId],
    truncated_feed_ids: set[ObjectId],
    selected_feed_id: ObjectId | None,
    search_query: str,
    use_text_search: bool,
    offset: int,
    limit: int,
) -> tuple[list[FeedArticleCard], bool]:
    """Return recently-read cards from the last seven days."""

    if user_article_states_collection is None or feed_articles_collection is None:
        return [], False

    muted_category_ids = {
        category_id
        for category_id, category in categories_by_id.items()
        if category.muted
    }

    eligible_feed_ids = [
        feed_id
        for feed_id, category_id in feed_to_category.items()
        if category_id in categories_by_id and category_id not in muted_category_ids
    ]
    if isinstance(selected_feed_id, ObjectId):
        eligible_feed_ids = [
            feed_id
            for feed_id in eligible_feed_ids
            if feed_id == selected_feed_id
        ]
    if len(eligible_feed_ids) == 0:
        return [], False

    search_filter = build_article_search_filter(
        search_query,
        use_text_search=use_text_search,
    )

    if use_text_search and isinstance(search_filter, dict) and "$text" in search_filter:
        lookup_pipeline: list[dict[str, Any]] = [
            {
                "$match": {
                    "$expr": {"$eq": ["$_id", "$$article_id"]},
                    "is_deleted": False,
                    "feed_id": {"$in": eligible_feed_ids},
                    "$text": search_filter["$text"],
                }
            }
        ]

        additional_and_filters = search_filter.get("$and")
        if isinstance(additional_and_filters, list):
            for component_filter in additional_and_filters:
                if isinstance(component_filter, dict):
                    lookup_pipeline.append({"$match": component_filter})
    else:
        lookup_pipeline = [
            {"$match": {"$expr": {"$eq": ["$_id", "$$article_id"]}}},
            {
                "$match": {
                    "is_deleted": False,
                    "feed_id": {"$in": eligible_feed_ids},
                }
            },
        ]
        if isinstance(search_filter, dict):
            lookup_pipeline.append({"$match": search_filter})

    threshold = recently_read_cutoff()
    pipeline: list[dict[str, Any]] = [
        {
            "$match": {
                "user_id": user_id,
                "is_read": True,
                "read_at": {"$gte": threshold},
            }
        },
        {"$sort": {"read_at": DESCENDING, "_id": DESCENDING}},
        {
            "$lookup": {
                "from": feed_articles_collection.name,
                "let": {"article_id": "$article_id"},
                "pipeline": lookup_pipeline,
                "as": "article_docs",
            }
        },
        {"$unwind": "$article_docs"},
        {"$skip": offset},
        {"$limit": limit + 1},
        {
            "$project": {
                "article": "$article_docs",
                "read_at": 1,
            }
        },
    ]

    state_rows = [doc async for doc in user_article_states_collection.aggregate(pipeline)]
    if len(state_rows) == 0:
        return [], False

    has_more = len(state_rows) > limit
    paged_rows = state_rows[:limit]

    article_ids: list[ObjectId] = []
    source_ids: set[ObjectId] = set()
    for row in paged_rows:
        article_doc = row.get("article")
        if not isinstance(article_doc, dict):
            continue

        article_id = article_doc.get("_id")
        if isinstance(article_id, ObjectId):
            article_ids.append(article_id)

        feed_id = article_doc.get("feed_id")
        if isinstance(feed_id, ObjectId):
            source_ids.add(feed_id)

    source_map = await load_sources_map(source_ids)
    _, saved_map = await get_user_state_maps_for_article_ids(user_id, article_ids)

    cards: list[FeedArticleCard] = []

    for row in paged_rows:
        article_doc = row.get("article")
        if not isinstance(article_doc, dict):
            continue

        article_id = article_doc.get("_id")
        feed_id = article_doc.get("feed_id")
        if not isinstance(article_id, ObjectId) or not isinstance(feed_id, ObjectId):
            continue

        category_id = feed_to_category.get(feed_id)
        if category_id is None or category_id in muted_category_ids:
            continue

        category = categories_by_id.get(category_id)
        if category is None or category.id is None:
            continue

        source_doc = source_map.get(feed_id, {})
        source_title = str(source_doc.get("title", source_doc.get("normalized_url", "Feed")))

        read_at_value = row.get("read_at")
        read_at = read_at_value if isinstance(read_at_value, datetime) else None
        summary_html, full_summary_html, is_summary_truncated = build_article_summary_html(
            article_doc,
            truncate_on_display=feed_id in truncated_feed_ids,
        )

        cards.append(
            FeedArticleCard(
                article_id=str(article_id),
                feed_id=str(feed_id),
                title=str(article_doc.get("title", "Untitled")),
                link=normalize_article_navigation_link(article_doc.get("canonical_url") or article_doc.get("link")),
                author=str(article_doc.get("author", "")).strip() or None,
                summary_html=summary_html,
                full_summary_html=full_summary_html,
                is_summary_truncated=is_summary_truncated,
                media_image_url=normalize_article_link(article_doc.get("media_image_url")) or None,
                published_at=article_doc.get("published_at"),
                feed_title=source_title,
                category_id=str(category.id),
                category_name=category.name,
                category_color_hex=category.color_hex,
                is_read=True,
                read_at=read_at,
                is_saved=article_id in saved_map,
                saved_at=saved_map.get(article_id),
            )
        )

    return cards, has_more


async def list_saved_cards(
    user_id: str,
    categories_by_id: dict[ObjectId, FeedCategoryDocument],
    feed_to_category: dict[ObjectId, ObjectId],
    truncated_feed_ids: set[ObjectId],
    selected_feed_id: ObjectId | None,
    search_query: str,
    use_text_search: bool,
    newest_first: bool,
    offset: int,
    limit: int,
) -> tuple[list[FeedArticleCard], bool]:
    """Return user-saved article cards ordered by article age or search recency."""

    if user_article_states_collection is None or feed_articles_collection is None:
        return [], False

    eligible_feed_ids = [
        feed_id
        for feed_id, category_id in feed_to_category.items()
        if category_id in categories_by_id
    ]
    if isinstance(selected_feed_id, ObjectId):
        eligible_feed_ids = [
            feed_id
            for feed_id in eligible_feed_ids
            if feed_id == selected_feed_id
        ]
    if len(eligible_feed_ids) == 0:
        return [], False

    search_filter = build_article_search_filter(
        search_query,
        use_text_search=use_text_search,
    )

    if use_text_search and isinstance(search_filter, dict) and "$text" in search_filter:
        lookup_pipeline: list[dict[str, Any]] = [
            {
                "$match": {
                    "$expr": {"$eq": ["$_id", "$$article_id"]},
                    "is_deleted": False,
                    "feed_id": {"$in": eligible_feed_ids},
                    "$text": search_filter["$text"],
                }
            }
        ]

        additional_and_filters = search_filter.get("$and")
        if isinstance(additional_and_filters, list):
            for component_filter in additional_and_filters:
                if isinstance(component_filter, dict):
                    lookup_pipeline.append({"$match": component_filter})
    else:
        lookup_pipeline = [
            {"$match": {"$expr": {"$eq": ["$_id", "$$article_id"]}}},
            {
                "$match": {
                    "is_deleted": False,
                    "feed_id": {"$in": eligible_feed_ids},
                }
            },
        ]
        if isinstance(search_filter, dict):
            lookup_pipeline.append({"$match": search_filter})

    article_sort_direction = DESCENDING if newest_first else ASCENDING
    pipeline: list[dict[str, Any]] = [
        {
            "$match": {
                "user_id": user_id,
                "is_saved": True,
            }
        },
        {
            "$lookup": {
                "from": feed_articles_collection.name,
                "let": {"article_id": "$article_id"},
                "pipeline": lookup_pipeline,
                "as": "article_docs",
            }
        },
        {"$unwind": "$article_docs"},
        {
            "$addFields": {
                "article_sort_is_undated": {
                    "$cond": [
                        {"$eq": [{"$type": "$article_docs.published_at"}, "date"]},
                        0,
                        1,
                    ]
                }
            }
        },
        {
            "$sort": {
                "article_sort_is_undated": ASCENDING,
                "article_docs.published_at": article_sort_direction,
                "article_docs._id": article_sort_direction,
            }
        },
        {"$skip": offset},
        {"$limit": limit + 1},
        {
            "$project": {
                "article": "$article_docs",
                "saved_at": 1,
            }
        },
    ]

    state_rows = [doc async for doc in user_article_states_collection.aggregate(pipeline)]
    if len(state_rows) == 0:
        return [], False

    has_more = len(state_rows) > limit
    paged_rows = state_rows[:limit]

    article_ids: list[ObjectId] = []
    source_ids: set[ObjectId] = set()
    for row in paged_rows:
        article_doc = row.get("article")
        if not isinstance(article_doc, dict):
            continue

        article_id = article_doc.get("_id")
        if isinstance(article_id, ObjectId):
            article_ids.append(article_id)

        feed_id = article_doc.get("feed_id")
        if isinstance(feed_id, ObjectId):
            source_ids.add(feed_id)

    source_map = await load_sources_map(source_ids)
    read_map, _ = await get_user_state_maps_for_article_ids(user_id, article_ids)

    cards: list[FeedArticleCard] = []

    for row in paged_rows:
        article_doc = row.get("article")
        if not isinstance(article_doc, dict):
            continue

        article_id = article_doc.get("_id")
        feed_id = article_doc.get("feed_id")
        if not isinstance(article_id, ObjectId) or not isinstance(feed_id, ObjectId):
            continue

        category_id = feed_to_category.get(feed_id)
        if category_id is None:
            continue

        category = categories_by_id.get(category_id)
        if category is None or category.id is None:
            continue

        source_doc = source_map.get(feed_id, {})
        source_title = str(source_doc.get("title", source_doc.get("normalized_url", "Feed")))

        saved_at_value = row.get("saved_at")
        saved_at = saved_at_value if isinstance(saved_at_value, datetime) else None
        summary_html, full_summary_html, is_summary_truncated = build_article_summary_html(
            article_doc,
            truncate_on_display=feed_id in truncated_feed_ids,
        )

        cards.append(
            FeedArticleCard(
                article_id=str(article_id),
                feed_id=str(feed_id),
                title=str(article_doc.get("title", "Untitled")),
                link=normalize_article_navigation_link(article_doc.get("canonical_url") or article_doc.get("link")),
                author=str(article_doc.get("author", "")).strip() or None,
                summary_html=summary_html,
                full_summary_html=full_summary_html,
                is_summary_truncated=is_summary_truncated,
                media_image_url=normalize_article_link(article_doc.get("media_image_url")) or None,
                published_at=article_doc.get("published_at"),
                feed_title=source_title,
                category_id=str(category.id),
                category_name=category.name,
                category_color_hex=category.color_hex,
                is_read=article_id in read_map,
                read_at=read_map.get(article_id),
                is_saved=True,
                saved_at=saved_at,
            )
        )

    return cards, has_more


async def mark_article_read(user_id: str, article_id: str) -> bool:
    """Mark an article as read for a user."""

    if user_article_states_collection is None:
        return False

    try:
        article_object_id = ObjectId(article_id)
    except Exception:
        return False

    now = utc_now()

    await user_article_states_collection.update_one(
        {"user_id": user_id, "article_id": article_object_id},
        {
            "$set": {
                "is_read": True,
                "read_at": now,
                "updated_at": now,
            },
            "$setOnInsert": {
                "created_at": now,
            },
        },
        upsert=True,
    )

    invalidate_category_counts_cache(user_id)
    return True


async def mark_article_opened(user_id: str, article_id: str) -> bool:
    """Mark an article as explicitly opened for a user."""

    if user_article_states_collection is None:
        return False

    try:
        article_object_id = ObjectId(article_id)
    except Exception:
        return False

    now = utc_now()

    await user_article_states_collection.update_one(
        {"user_id": user_id, "article_id": article_object_id},
        {
            "$set": {
                "is_opened": True,
                "updated_at": now,
            },
            "$setOnInsert": {
                "opened_at": now,
                "created_at": now,
            },
        },
        upsert=True,
    )

    await user_article_states_collection.update_one(
        {
            "user_id": user_id,
            "article_id": article_object_id,
            "$or": [
                {"opened_at": {"$exists": False}},
                {"opened_at": None},
            ],
        },
        {
            "$set": {
                "opened_at": now,
                "updated_at": now,
            }
        },
    )

    return True


async def mark_article_unread(user_id: str, article_id: str) -> bool:
    """Mark an article as unread for a user."""

    if user_article_states_collection is None:
        return False

    try:
        article_object_id = ObjectId(article_id)
    except Exception:
        return False

    now = utc_now()

    await user_article_states_collection.update_one(
        {"user_id": user_id, "article_id": article_object_id},
        {
            "$set": {
                "is_read": False,
                "updated_at": now,
            },
            "$setOnInsert": {
                "created_at": now,
            },
        },
        upsert=True,
    )

    invalidate_category_counts_cache(user_id)
    return True


async def mark_article_saved(user_id: str, article_id: str) -> bool:
    """Mark an article as saved for a user."""

    if user_article_states_collection is None:
        return False

    try:
        article_object_id = ObjectId(article_id)
    except Exception:
        return False

    now = utc_now()

    await user_article_states_collection.update_one(
        {"user_id": user_id, "article_id": article_object_id},
        {
            "$set": {
                "is_saved": True,
                "saved_at": now,
                "updated_at": now,
            },
            "$setOnInsert": {
                "is_read": False,
                "created_at": now,
            },
        },
        upsert=True,
    )

    invalidate_category_counts_cache(user_id)
    return True


async def mark_article_unsaved(user_id: str, article_id: str) -> bool:
    """Mark an article as not saved for a user."""

    if user_article_states_collection is None:
        return False

    try:
        article_object_id = ObjectId(article_id)
    except Exception:
        return False

    now = utc_now()

    await user_article_states_collection.update_one(
        {"user_id": user_id, "article_id": article_object_id},
        {
            "$set": {
                "is_saved": False,
                "updated_at": now,
            },
            "$setOnInsert": {
                "is_read": False,
                "created_at": now,
            },
        },
        upsert=True,
    )

    invalidate_category_counts_cache(user_id)
    return True


async def set_category_muted(user_id: str, category_id: str, muted: bool) -> FeedCategoryDocument | None:
    """Update category mute state for a user-owned category."""

    if feed_categories_collection is None:
        return None

    try:
        category_object_id = ObjectId(category_id)
    except Exception:
        return None

    await feed_categories_collection.update_one(
        {
            "_id": category_object_id,
            "user_id": user_id,
        },
        {
            "$set": {
                "muted": muted,
                "updated_at": utc_now(),
            }
        },
    )

    updated = await feed_categories_collection.find_one(
        {"_id": category_object_id, "user_id": user_id}
    )
    if updated is not None:
        invalidate_category_counts_cache(user_id)
    return FeedCategoryDocument.model_validate(updated) if updated is not None else None


async def set_category_color(user_id: str, category_id: str, color_hex: str) -> FeedCategoryDocument | None:
    """Update category color preference for a user-owned category."""

    if feed_categories_collection is None:
        return None

    try:
        category_object_id = ObjectId(category_id)
    except Exception:
        return None

    normalized_color = normalize_color_hex(color_hex)

    await feed_categories_collection.update_one(
        {
            "_id": category_object_id,
            "user_id": user_id,
        },
        {
            "$set": {
                "color_hex": normalized_color,
                "updated_at": utc_now(),
            }
        },
    )

    updated = await feed_categories_collection.find_one(
        {"_id": category_object_id, "user_id": user_id}
    )
    return FeedCategoryDocument.model_validate(updated) if updated is not None else None


async def reorder_category_sort_order(user_id: str, category_ids: list[str]) -> bool:
    """Persist category ordering for a user by updating sort_order values."""

    if feed_categories_collection is None:
        return False

    categories = await list_category_documents(user_id)
    existing_ids_in_order = [category.id for category in categories if category.id is not None]
    if len(existing_ids_in_order) == 0:
        return True

    existing_ids_set = set(existing_ids_in_order)

    parsed_requested_ids: list[ObjectId] = []
    seen_requested: set[ObjectId] = set()
    for raw_category_id in category_ids:
        trimmed = str(raw_category_id or "").strip()
        if trimmed == "":
            continue

        try:
            category_object_id = ObjectId(trimmed)
        except Exception:
            continue

        if category_object_id not in existing_ids_set or category_object_id in seen_requested:
            continue

        seen_requested.add(category_object_id)
        parsed_requested_ids.append(category_object_id)

    # Keep any categories omitted from the payload in their existing relative order.
    reordered_ids = parsed_requested_ids + [
        category_id
        for category_id in existing_ids_in_order
        if category_id not in seen_requested
    ]

    now = utc_now()
    for sort_index, category_id in enumerate(reordered_ids):
        await feed_categories_collection.update_one(
            {
                "_id": category_id,
                "user_id": user_id,
            },
            {
                "$set": {
                    "sort_order": sort_index,
                    "updated_at": now,
                }
            },
        )

    return True


def parse_opml_entries(opml_bytes: bytes) -> tuple[list[tuple[str, str, str]], list[str]]:
    """Parse OPML bytes into tuples of (feed_url, title, category_name)."""

    return feed_utils.parse_opml_entries(opml_bytes)


async def import_opml(
    user_id: str,
    opml_bytes: bytes,
    options: FeedOpmlImportOptions,
) -> FeedOpmlImportResult:
    """Import OPML content into user categories and subscriptions."""

    result = FeedOpmlImportResult()

    entries, parse_errors = parse_opml_entries(opml_bytes)
    result.errors.extend(parse_errors)

    created_category_names: set[str] = set()

    for feed_url, title, category_name in entries:
        category_to_use = category_name.strip() or options.default_category_name.strip() or "Imported"

        try:
            normalized_url = normalize_feed_url(feed_url)
        except ValueError as exc:
            result.errors.append(f"{feed_url}: {exc}")
            continue

        category_doc, category_created = await ensure_category(user_id, category_to_use)
        if category_created:
            created_category_names.add(category_doc.name)

        subscription_doc, created_subscription = await create_or_update_subscription(
            user_id=user_id,
            normalized_url=normalized_url,
            source_title=title,
            category_name=category_doc.name,
            duplicate_policy=options.duplicate_policy,
        )

        if created_subscription:
            result.created_subscriptions += 1
        else:
            if options.duplicate_policy == "skip":
                result.skipped_duplicates += 1
            else:
                result.existing_subscriptions += 1

    result.created_categories = len(created_category_names)
    if (
        result.created_subscriptions > 0
        or result.created_categories > 0
        or result.existing_subscriptions > 0
    ):
        invalidate_category_counts_cache(user_id)
    return result


async def export_opml(user_id: str) -> str:
    """Export user subscriptions and categories as OPML 2.0 XML."""

    categories = await list_category_documents(user_id)
    subscriptions = await list_user_subscription_docs(user_id)

    if len(subscriptions) == 0:
        now = utc_now().strftime("%a, %d %b %Y %H:%M:%S +0000")
        empty_opml = ET.Element("opml", version="2.0")
        head = ET.SubElement(empty_opml, "head")
        ET.SubElement(head, "title").text = "Feed Reader Export"
        ET.SubElement(head, "dateCreated").text = now
        ET.SubElement(empty_opml, "body")
        return ET.tostring(empty_opml, encoding="utf-8", xml_declaration=True).decode("utf-8")

    feed_ids = {sub["feed_id"] for sub in subscriptions if "feed_id" in sub}
    source_map = await load_sources_map(feed_ids)

    grouped: dict[ObjectId, list[dict[str, Any]]] = {}
    for sub in subscriptions:
        category_id = sub.get("category_id")
        if not isinstance(category_id, ObjectId):
            continue
        grouped.setdefault(category_id, []).append(sub)

    root = ET.Element("opml", version="2.0")
    head = ET.SubElement(root, "head")
    ET.SubElement(head, "title").text = "Feed Reader Export"
    ET.SubElement(head, "dateCreated").text = utc_now().strftime("%a, %d %b %Y %H:%M:%S +0000")
    body = ET.SubElement(root, "body")

    for category in sorted(categories, key=lambda item: (item.sort_order, item.name.lower())):
        if category.id is None:
            continue

        category_outline = ET.SubElement(
            body,
            "outline",
            {
                "text": category.name,
                "title": category.name,
                "categoryColor": category.color_hex,
            },
        )

        category_subscriptions = grouped.get(category.id, [])
        entries: list[tuple[str, str]] = []
        for sub in category_subscriptions:
            source_feed_id = sub.get("feed_id")
            if not isinstance(source_feed_id, ObjectId):
                continue

            source = source_map.get(source_feed_id)
            if source is None:
                continue
            title = str(source.get("title", source.get("normalized_url", "Feed")))
            xml_url = str(source.get("normalized_url", ""))
            entries.append((title, xml_url))

        for title, xml_url in sorted(entries, key=lambda item: item[0].lower()):
            ET.SubElement(
                category_outline,
                "outline",
                {
                    "text": title,
                    "title": title,
                    "type": "rss",
                    "xmlUrl": xml_url,
                },
            )

    return ET.tostring(root, encoding="utf-8", xml_declaration=True).decode("utf-8")


def build_sidebar_feed_groups(
    subscription_rows: list[dict[str, Any]],
    visible_feed_ids_by_group: dict[str, set[str]] | None = None,
) -> dict[str, Any]:
    """Build feed groups for expandable sidebar sections."""

    all_feeds: list[dict[str, str]] = []
    saved_feeds: list[dict[str, str]] = []
    recently_read_feeds: list[dict[str, str]] = []
    categories: dict[str, list[dict[str, str]]] = {}

    use_group_filters = isinstance(visible_feed_ids_by_group, dict)
    all_visible = (
        visible_feed_ids_by_group.get("all", set())
        if use_group_filters
        else None
    )
    saved_visible = (
        visible_feed_ids_by_group.get("saved", set())
        if use_group_filters
        else None
    )
    recently_read_visible = (
        visible_feed_ids_by_group.get("recently-read", set())
        if use_group_filters
        else None
    )

    for row in subscription_rows:
        feed_id = str(row.get("feed_id", "")).strip()
        if feed_id == "":
            continue

        title = str(row.get("source_title", "")).strip() or "Feed"
        category_id = str(row.get("category_id", "")).strip()

        item = {
            "feed_id": feed_id,
            "title": title,
            "category_id": category_id,
        }

        if not isinstance(all_visible, set) or feed_id in all_visible:
            all_feeds.append(item)

        if not isinstance(saved_visible, set) or feed_id in saved_visible:
            saved_feeds.append(item)

        if not isinstance(recently_read_visible, set) or feed_id in recently_read_visible:
            recently_read_feeds.append(item)

        if category_id != "":
            category_visible = (
                visible_feed_ids_by_group.get(category_id, set())
                if use_group_filters
                else None
            )
            if not isinstance(category_visible, set) or feed_id in category_visible:
                categories.setdefault(category_id, []).append(item)

    all_feeds.sort(key=lambda item: item["title"].lower())
    saved_feeds.sort(key=lambda item: item["title"].lower())
    recently_read_feeds.sort(key=lambda item: item["title"].lower())
    for category_feed_items in categories.values():
        category_feed_items.sort(key=lambda item: item["title"].lower())

    return {
        "all": all_feeds,
        "saved": saved_feeds,
        "recently-read": recently_read_feeds,
        "categories": categories,
    }


async def get_sidebar_visible_feed_ids_by_group(
    user_id: str,
    subscriptions: list[dict[str, Any]] | None = None,
    read_state_ids: set[ObjectId] | None = None,
) -> dict[str, set[str]]:
    """Return visible feed IDs for each sidebar group, independent of selected category.

    Category/all groups are based on unread availability so expanders align with category
    unread counts. Saved and recently-read groups use their respective state filters.
    """

    if (
        user_feed_subscriptions_collection is None
        or feed_articles_collection is None
        or user_article_states_collection is None
    ):
        return {
            "all": set(),
            "saved": set(),
            "recently-read": set(),
        }

    resolved_subscriptions = (
        subscriptions
        if subscriptions is not None
        else await list_user_subscription_docs(user_id)
    )

    all_feed_ids = [
        sub["feed_id"]
        for sub in resolved_subscriptions
        if isinstance(sub.get("feed_id"), ObjectId)
    ]
    if len(all_feed_ids) == 0:
        return {
            "all": set(),
            "saved": set(),
            "recently-read": set(),
        }

    # Track category membership per feed, including duplicate subscriptions.
    feed_id_to_category_ids: dict[str, set[str]] = {}
    for sub in resolved_subscriptions:
        feed_id = sub.get("feed_id")
        category_id = sub.get("category_id")
        if not isinstance(feed_id, ObjectId) or not isinstance(category_id, ObjectId):
            continue

        feed_id_str = str(feed_id)
        category_id_str = str(category_id)
        feed_id_to_category_ids.setdefault(feed_id_str, set()).add(category_id_str)

    threshold = recently_read_cutoff()

    recently_read_pipeline: list[dict[str, Any]] = [
        {
            "$match": {
                "user_id": user_id,
                "is_read": True,
                "read_at": {"$gte": threshold},
            }
        },
        {
            "$lookup": {
                "from": feed_articles_collection.name,
                "let": {"article_id": "$article_id"},
                "pipeline": [
                    {"$match": {"$expr": {"$eq": ["$_id", "$$article_id"]}}},
                    {
                        "$match": {
                            "is_deleted": False,
                            "feed_id": {"$in": all_feed_ids},
                        }
                    },
                    {"$project": {"feed_id": 1}},
                ],
                "as": "article_docs",
            }
        },
        {"$unwind": "$article_docs"},
        {"$group": {"_id": "$article_docs.feed_id"}},
    ]

    recently_read_feed_ids = {
        str(doc.get("_id"))
        async for doc in user_article_states_collection.aggregate(recently_read_pipeline)
        if isinstance(doc.get("_id"), ObjectId)
    }

    saved_pipeline: list[dict[str, Any]] = [
        {
            "$match": {
                "user_id": user_id,
                "is_saved": True,
            }
        },
        {
            "$lookup": {
                "from": feed_articles_collection.name,
                "let": {"article_id": "$article_id"},
                "pipeline": [
                    {"$match": {"$expr": {"$eq": ["$_id", "$$article_id"]}}},
                    {
                        "$match": {
                            "is_deleted": False,
                            "feed_id": {"$in": all_feed_ids},
                        }
                    },
                    {"$project": {"feed_id": 1}},
                ],
                "as": "article_docs",
            }
        },
        {"$unwind": "$article_docs"},
        {"$group": {"_id": "$article_docs.feed_id"}},
    ]

    saved_feed_ids = {
        str(doc.get("_id"))
        async for doc in user_article_states_collection.aggregate(saved_pipeline)
        if isinstance(doc.get("_id"), ObjectId)
    }

    query: dict[str, Any] = {
        "feed_id": {"$in": all_feed_ids},
        "is_deleted": False,
    }

    resolved_read_state_ids = (
        read_state_ids
        if read_state_ids is not None
        else await get_read_article_id_set(user_id)
    )
    if len(resolved_read_state_ids) > 0:
        query["_id"] = {"$nin": list(resolved_read_state_ids)}

    visible_feed_ids = await feed_articles_collection.distinct("feed_id", query)
    all_visible_feed_ids = {
        str(feed_id)
        for feed_id in visible_feed_ids
        if isinstance(feed_id, ObjectId)
    }

    visible_by_group: dict[str, set[str]] = {
        "all": all_visible_feed_ids,
        "saved": saved_feed_ids,
        "recently-read": recently_read_feed_ids,
    }

    for feed_id_str, category_ids in feed_id_to_category_ids.items():
        if feed_id_str not in all_visible_feed_ids:
            continue

        for category_id in category_ids:
            visible_by_group.setdefault(category_id, set()).add(feed_id_str)

    return visible_by_group


async def get_sidebar_feed_groups_for_reader(user_id: str) -> dict[str, Any]:
    """Return live sidebar feed groups for reader pages."""

    sidebar_meta = await get_sidebar_meta_for_reader(user_id)
    return sidebar_meta.sidebar_feed_groups


async def _subscription_rows_from_docs(
    subscriptions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build sidebar feed-group rows from preloaded subscription docs."""

    if len(subscriptions) == 0:
        return []

    category_ids = {
        sub["category_id"]
        for sub in subscriptions
        if isinstance(sub.get("category_id"), ObjectId)
    }
    feed_ids = {
        sub["feed_id"]
        for sub in subscriptions
        if isinstance(sub.get("feed_id"), ObjectId)
    }

    categories_map = await load_categories_map(category_ids)
    sources_map = await load_sources_map(feed_ids)

    rows: list[dict[str, Any]] = []
    for sub in subscriptions:
        feed_id = sub.get("feed_id")
        category_id = sub.get("category_id")
        if not isinstance(feed_id, ObjectId) or not isinstance(category_id, ObjectId):
            continue

        category = categories_map.get(category_id)
        source = sources_map.get(feed_id)
        if category is None or source is None:
            continue

        rows.append(
            {
                "subscription_id": str(sub.get("_id", "")),
                "feed_id": str(feed_id),
                "source_title": resolve_source_display_title(source),
                "source_url": str(source.get("normalized_url", "")),
                "source_image_url": str(source.get("image_url", "")).strip(),
                "category_id": str(category.id),
                "category_name": category.name,
                "category_color_hex": category.color_hex,
                "category_muted": category.muted,
                "truncate_on_display": bool(sub.get("truncate_on_display")),
            }
        )

    rows.sort(key=lambda row: (row["category_name"].lower(), row["source_title"].lower()))
    return rows


async def get_sidebar_meta_for_reader(user_id: str) -> FeedSidebarMetaResponse:
    """Return merged sidebar counts and expandable feed groups."""

    categories = await list_category_documents(user_id)
    subscriptions = await list_user_subscription_docs(user_id)
    read_state_ids = await get_read_article_id_set(user_id)

    now = utc_now()
    cached_entry = _category_counts_cache.get(user_id)
    if (
        cached_entry is not None
        and now - cached_entry[0] <= CATEGORY_COUNTS_CACHE_TTL
    ):
        categories_payload = cached_entry[1]
    else:
        categories_payload = await build_categories_with_counts(
            user_id,
            categories,
            subscriptions,
            read_state_ids,
        )
        _category_counts_cache[user_id] = (now, categories_payload)

    visible_feed_ids_by_group = await get_sidebar_visible_feed_ids_by_group(
        user_id,
        subscriptions=subscriptions,
        read_state_ids=read_state_ids,
    )
    subscription_rows = await _subscription_rows_from_docs(subscriptions)
    sidebar_feed_groups = build_sidebar_feed_groups(
        subscription_rows,
        visible_feed_ids_by_group=visible_feed_ids_by_group,
    )

    return FeedSidebarMetaResponse(
        all_unread_count=categories_payload.all_unread_count,
        recently_read_count=categories_payload.recently_read_count,
        saved_count=categories_payload.saved_count,
        categories=categories_payload.categories,
        sidebar_feed_groups=sidebar_feed_groups,
    )


async def get_reader_live_sync(
    user_id: str,
    payload: FeedReaderSyncRequest,
) -> FeedReaderSyncResponse:
    """Return consolidated reader live-state in a single backend pass."""

    categories = await list_category_documents(user_id)
    subscriptions = await list_user_subscription_docs(user_id)
    read_state_ids = await get_read_article_id_set(user_id)

    now = utc_now()
    cached_entry = _category_counts_cache.get(user_id)
    if (
        cached_entry is not None
        and now - cached_entry[0] <= CATEGORY_COUNTS_CACHE_TTL
    ):
        categories_payload = cached_entry[1]
    else:
        categories_payload = await build_categories_with_counts(
            user_id,
            categories,
            subscriptions,
            read_state_ids,
        )
        _category_counts_cache[user_id] = (now, categories_payload)

    visible_feed_ids_by_group = await get_sidebar_visible_feed_ids_by_group(
        user_id,
        subscriptions=subscriptions,
        read_state_ids=read_state_ids,
    )
    subscription_rows = await _subscription_rows_from_docs(subscriptions)
    sidebar_feed_groups = build_sidebar_feed_groups(
        subscription_rows,
        visible_feed_ids_by_group=visible_feed_ids_by_group,
    )

    article_list_kwargs = {
        "user_id": user_id,
        "category_filter": payload.category,
        "status_filter": payload.status_filter,
        "feed_filter": payload.feed_id,
        "search_query": payload.search,
        "require_search_query": payload.require_search_query,
        "preloaded_categories": categories,
        "preloaded_subscriptions": subscriptions,
        "preloaded_read_state_ids": read_state_ids,
    }

    head_limit = resolve_head_probe_limit(payload.page_size)
    head_ids_payload = await get_article_list(
        **article_list_kwargs,
        offset=0,
        limit=head_limit,
        ids_only=True,
    )
    head_article_ids = list(head_ids_payload.article_ids)

    head_articles: list[FeedArticleCard] | None = None
    if head_article_ids != payload.current_head_ids:
        head_cards_payload = await get_article_list(
            **article_list_kwargs,
            offset=0,
            limit=head_limit,
            ids_only=False,
        )
        head_articles = list(head_cards_payload.articles)

    tail_articles: list[FeedArticleCard] | None = None
    tail_has_more: bool | None = None
    tail_next_offset: int | None = None
    if payload.at_end:
        tail_offset = max(0, int(payload.tail_offset))
        tail_limit = max(1, int(payload.page_size))
        tail_payload = await get_article_list(
            **article_list_kwargs,
            offset=tail_offset,
            limit=tail_limit,
            ids_only=False,
        )
        if len(tail_payload.articles) > 0:
            tail_articles = list(tail_payload.articles)
            tail_has_more = tail_payload.has_more
            tail_next_offset = tail_payload.next_offset
        else:
            tail_has_more = tail_payload.has_more
            tail_next_offset = tail_payload.next_offset

    statuses = await get_article_read_statuses(user_id, payload.visible_article_ids)

    return FeedReaderSyncResponse(
        all_unread_count=categories_payload.all_unread_count,
        recently_read_count=categories_payload.recently_read_count,
        saved_count=categories_payload.saved_count,
        categories=categories_payload.categories,
        sidebar_feed_groups=sidebar_feed_groups,
        statuses=statuses,
        head_article_ids=head_article_ids,
        head_articles=head_articles,
        head_has_more=head_ids_payload.has_more,
        head_next_offset=head_ids_payload.next_offset,
        tail_articles=tail_articles,
        tail_has_more=tail_has_more,
        tail_next_offset=tail_next_offset,
    )


async def get_feed_reader_context(
    user_id: str,
    category_filter: str,
    status_filter: str,
    feed_filter: str | None = None,
    search_query: str | None = None,
    require_search_query: bool = False,
) -> dict[str, Any]:
    """Build template context payload for the feed reader page."""

    try:
        await opportunistic_consolidate_duplicate_sources()
    except Exception as exc:
        logging.warning(f"Feed source dedupe pass failed: {exc}")

    categories_payload = await get_categories_with_counts(user_id)
    article_payload = await get_article_list(
        user_id,
        category_filter,
        status_filter,
        feed_filter=feed_filter,
        search_query=search_query,
        require_search_query=require_search_query,
        offset=0,
        limit=10,
    )
    normalized_search_query = normalize_article_search_query(search_query)
    return {
        "categories": categories_payload.categories,
        "all_unread_count": categories_payload.all_unread_count,
        "recently_read_count": categories_payload.recently_read_count,
        "saved_count": categories_payload.saved_count,
        "sidebar_feed_groups": await get_sidebar_feed_groups_for_reader(user_id),
        "articles": article_payload.articles,
        "selected_category": category_filter,
        "selected_feed_id": str(feed_filter or "").strip(),
        "selected_search": normalized_search_query,
        "selected_status": article_payload.status,
        "article_has_more": article_payload.has_more,
        "article_next_offset": article_payload.next_offset,
        "article_page_size": article_payload.limit,
    }


async def get_feed_settings_context(user_id: str) -> dict[str, Any]:
    """Build template context payload for the feed settings page."""

    category_payload = await get_categories_with_counts(user_id)
    subscription_rows = await list_user_subscription_rows(user_id)

    return {
        "categories": category_payload.categories,
        "subscriptions": subscription_rows,
        "all_unread_count": category_payload.all_unread_count,
        "recently_read_count": category_payload.recently_read_count,
        "saved_count": category_payload.saved_count,
        "sidebar_feed_groups": await get_sidebar_feed_groups_for_reader(user_id),
    }


async def list_feed_admin_rows() -> list[dict[str, Any]]:
    """Return global feed refresh/status rows for all currently subscribed feeds."""

    if user_feed_subscriptions_collection is None:
        return []

    distinct_feed_ids = await user_feed_subscriptions_collection.distinct("feed_id")
    feed_ids = [feed_id for feed_id in distinct_feed_ids if isinstance(feed_id, ObjectId)]
    if len(feed_ids) == 0:
        return []

    sources_map = await load_sources_map(set(feed_ids))

    article_counts: dict[ObjectId, int] = {}
    latest_article_times: dict[ObjectId, datetime] = {}
    if feed_articles_collection is not None:
        count_cursor = feed_articles_collection.aggregate(
            [
                {
                    "$match": {
                        "feed_id": {"$in": feed_ids},
                        "$or": [
                            {"is_deleted": False},
                            {"is_deleted": {"$exists": False}},
                        ],
                    }
                },
                {
                    "$group": {
                        "_id": "$feed_id",
                        "article_count": {"$sum": 1},
                        "latest_article_at": {
                            "$max": {
                                "$ifNull": ["$published_at", "$fetched_at"]
                            }
                        },
                    }
                },
            ]
        )

        async for count_doc in count_cursor:
            feed_id = count_doc.get("_id")
            if not isinstance(feed_id, ObjectId):
                continue
            article_counts[feed_id] = int(count_doc.get("article_count", 0))

            latest_article_at = _as_utc_datetime(count_doc.get("latest_article_at"))
            if latest_article_at is not None:
                latest_article_times[feed_id] = latest_article_at

    rows: list[dict[str, Any]] = []
    for feed_id in feed_ids:
        source = sources_map.get(feed_id)
        if source is None:
            continue

        feed_name = resolve_source_display_title(source)
        fetch_status = str(source.get("fetch_status", "new")).strip() or "new"

        rows.append(
            {
                "feed_id": str(feed_id),
                "feed_name": feed_name,
                "feed_url": str(source.get("normalized_url", "")).strip(),
                "article_count": int(article_counts.get(feed_id, 0)),
                "latest_article_at_iso": format_datetime_utc_iso(
                    latest_article_times.get(feed_id)
                ),
                "last_refresh_at_iso": format_datetime_utc_iso(
                    source.get("last_fetched_at")
                ),
                "next_refresh_at_iso": format_datetime_utc_iso(
                    source.get("next_refresh_at")
                ),
                "last_refresh_status": fetch_status,
                "last_refresh_error": str(source.get("last_error", "")).strip(),
            }
        )

    rows.sort(key=lambda row: str(row.get("feed_name", "")).lower())
    return rows


async def get_feed_admin_context(user_id: str) -> dict[str, Any]:
    """Build template context payload for the feed admin page."""

    context = await get_feed_settings_context(user_id)
    context["feed_admin_rows"] = await list_feed_admin_rows()
    return context


def _safe_percent(numerator: int, denominator: int) -> float:
    """Return rounded percentage with zero guard."""

    if denominator <= 0:
        return 0.0

    return round((numerator / denominator) * 100.0, 1)


def _build_day_keys(window_days: int, now: datetime) -> list[str]:
    """Return ordered UTC day keys (YYYY-MM-DD) for the lookback window."""

    day_keys: list[str] = []
    start = now - timedelta(days=max(1, window_days) - 1)
    for offset in range(max(1, window_days)):
        day = (start + timedelta(days=offset)).date().isoformat()
        day_keys.append(day)
    return day_keys


async def get_feed_stats(user_id: str, window_days: int = 30) -> FeedStatsResponse:
    """Return aggregate feed-reader stats overall, by category, and by feed."""

    if (
        user_feed_subscriptions_collection is None
        or feed_articles_collection is None
        or user_article_states_collection is None
    ):
        return FeedStatsResponse(window_days=max(1, window_days), overall=FeedStatsOverall())

    normalized_window_days = max(1, int(window_days))
    now = utc_now()
    cutoff = now - timedelta(days=normalized_window_days)
    day_keys = _build_day_keys(normalized_window_days, now)

    subscriptions = await list_user_subscription_docs(user_id)
    feed_to_category = {
        sub["feed_id"]: sub["category_id"]
        for sub in subscriptions
        if isinstance(sub.get("feed_id"), ObjectId) and isinstance(sub.get("category_id"), ObjectId)
    }

    feed_ids = list(feed_to_category.keys())
    if len(feed_ids) == 0:
        return FeedStatsResponse(window_days=normalized_window_days, overall=FeedStatsOverall())

    categories = await list_category_documents(user_id)
    categories_by_id = {
        category.id: category
        for category in categories
        if category.id is not None
    }
    source_map = await load_sources_map(set(feed_ids))

    feed_article_stats: dict[ObjectId, dict[str, Any]] = {}
    article_pipeline: list[dict[str, Any]] = [
        {
            "$match": {
                "feed_id": {"$in": feed_ids},
                "is_deleted": False,
            }
        },
        {
            "$project": {
                "feed_id": 1,
                "event_at": {"$ifNull": ["$published_at", "$fetched_at"]},
            }
        },
        {
            "$group": {
                "_id": "$feed_id",
                "articles_total": {"$sum": 1},
                "articles_recent": {
                    "$sum": {
                        "$cond": [
                            {"$gte": ["$event_at", cutoff]},
                            1,
                            0,
                        ]
                    }
                },
            }
        },
    ]

    async for doc in feed_articles_collection.aggregate(article_pipeline):
        feed_id = doc.get("_id")
        if not isinstance(feed_id, ObjectId):
            continue
        feed_article_stats[feed_id] = {
            "articles_total": int(doc.get("articles_total", 0)),
            "articles_recent": int(doc.get("articles_recent", 0)),
        }

    feed_state_stats: dict[ObjectId, dict[str, Any]] = {}
    state_pipeline: list[dict[str, Any]] = [
        {
            "$match": {
                "user_id": user_id,
                "$or": [
                    {"is_opened": True},
                    {"saved_at": {"$exists": True, "$ne": None}},
                ],
            }
        },
        {
            "$lookup": {
                "from": feed_articles_collection.name,
                "let": {"article_id": "$article_id"},
                "pipeline": [
                    {"$match": {"$expr": {"$eq": ["$_id", "$$article_id"]}}},
                    {
                        "$match": {
                            "feed_id": {"$in": feed_ids},
                            "is_deleted": False,
                        }
                    },
                    {
                        "$project": {
                            "feed_id": 1,
                        }
                    },
                ],
                "as": "article_docs",
            }
        },
        {"$unwind": "$article_docs"},
        {
            "$group": {
                "_id": "$article_docs.feed_id",
                "opened_total": {
                    "$sum": {"$cond": [{"$eq": ["$is_opened", True]}, 1, 0]}
                },
                "opened_recent": {
                    "$sum": {
                        "$cond": [
                            {
                                "$and": [
                                    {"$eq": ["$is_opened", True]},
                                    {"$gte": ["$opened_at", cutoff]},
                                ]
                            },
                            1,
                            0,
                        ]
                    }
                },
                "saved_total": {
                    "$sum": {
                        "$cond": [
                            {"$ne": ["$saved_at", None]},
                            1,
                            0,
                        ]
                    }
                },
                "saved_recent": {
                    "$sum": {
                        "$cond": [
                            {
                                "$and": [
                                    {"$ne": ["$saved_at", None]},
                                    {"$gte": ["$saved_at", cutoff]},
                                ]
                            },
                            1,
                            0,
                        ]
                    }
                },
            }
        },
    ]

    async for doc in user_article_states_collection.aggregate(state_pipeline):
        feed_id = doc.get("_id")
        if not isinstance(feed_id, ObjectId):
            continue

        feed_state_stats[feed_id] = {
            "opened_total": int(doc.get("opened_total", 0)),
            "opened_recent": int(doc.get("opened_recent", 0)),
            "saved_total": int(doc.get("saved_total", 0)),
            "saved_recent": int(doc.get("saved_recent", 0)),
        }

    daily_overall = {
        day: {"published": 0, "opened": 0, "saved": 0}
        for day in day_keys
    }

    publish_daily_pipeline: list[dict[str, Any]] = [
        {
            "$match": {
                "feed_id": {"$in": feed_ids},
                "is_deleted": False,
            }
        },
        {
            "$project": {
                "event_at": {"$ifNull": ["$published_at", "$fetched_at"]},
            }
        },
        {
            "$match": {
                "event_at": {"$gte": cutoff},
            }
        },
        {
            "$project": {
                "day": {
                    "$dateToString": {
                        "format": "%Y-%m-%d",
                        "date": "$event_at",
                        "timezone": "UTC",
                    }
                }
            }
        },
        {
            "$group": {
                "_id": "$day",
                "count": {"$sum": 1},
            }
        },
    ]

    async for doc in feed_articles_collection.aggregate(publish_daily_pipeline):
        day = str(doc.get("_id", "")).strip()
        if day in daily_overall:
            daily_overall[day]["published"] = int(doc.get("count", 0))

    opened_daily_pipeline: list[dict[str, Any]] = [
        {
            "$match": {
                "user_id": user_id,
                "is_opened": True,
                "opened_at": {"$gte": cutoff},
            }
        },
        {
            "$lookup": {
                "from": feed_articles_collection.name,
                "let": {"article_id": "$article_id"},
                "pipeline": [
                    {"$match": {"$expr": {"$eq": ["$_id", "$$article_id"]}}},
                    {
                        "$match": {
                            "feed_id": {"$in": feed_ids},
                            "is_deleted": False,
                        }
                    },
                    {"$project": {"_id": 1}},
                ],
                "as": "article_docs",
            }
        },
        {"$match": {"article_docs.0": {"$exists": True}}},
        {
            "$project": {
                "day": {
                    "$dateToString": {
                        "format": "%Y-%m-%d",
                        "date": "$opened_at",
                        "timezone": "UTC",
                    }
                }
            }
        },
        {
            "$group": {
                "_id": "$day",
                "count": {"$sum": 1},
            }
        },
    ]

    async for doc in user_article_states_collection.aggregate(opened_daily_pipeline):
        day = str(doc.get("_id", "")).strip()
        if day in daily_overall:
            daily_overall[day]["opened"] = int(doc.get("count", 0))

    saved_daily_pipeline: list[dict[str, Any]] = [
        {
            "$match": {
                "user_id": user_id,
                "saved_at": {
                    "$exists": True,
                    "$ne": None,
                    "$gte": cutoff,
                },
            }
        },
        {
            "$lookup": {
                "from": feed_articles_collection.name,
                "let": {"article_id": "$article_id"},
                "pipeline": [
                    {"$match": {"$expr": {"$eq": ["$_id", "$$article_id"]}}},
                    {
                        "$match": {
                            "feed_id": {"$in": feed_ids},
                            "is_deleted": False,
                        }
                    },
                    {"$project": {"_id": 1}},
                ],
                "as": "article_docs",
            }
        },
        {"$match": {"article_docs.0": {"$exists": True}}},
        {
            "$project": {
                "day": {
                    "$dateToString": {
                        "format": "%Y-%m-%d",
                        "date": "$saved_at",
                        "timezone": "UTC",
                    }
                }
            }
        },
        {
            "$group": {
                "_id": "$day",
                "count": {"$sum": 1},
            }
        },
    ]

    async for doc in user_article_states_collection.aggregate(saved_daily_pipeline):
        day = str(doc.get("_id", "")).strip()
        if day in daily_overall:
            daily_overall[day]["saved"] = int(doc.get("count", 0))

    per_feed_rows: list[FeedStatsRow] = []
    category_accumulator: dict[ObjectId, dict[str, Any]] = {}

    for feed_id in feed_ids:
        article_stats = feed_article_stats.get(feed_id, {})
        state_stats = feed_state_stats.get(feed_id, {})

        articles_total = int(article_stats.get("articles_total", 0))
        articles_recent = int(article_stats.get("articles_recent", 0))
        opened_total = int(state_stats.get("opened_total", 0))
        opened_recent = int(state_stats.get("opened_recent", 0))
        saved_total = int(state_stats.get("saved_total", 0))
        saved_recent = int(state_stats.get("saved_recent", 0))

        category_id = feed_to_category.get(feed_id)
        category_doc = categories_by_id.get(category_id) if isinstance(category_id, ObjectId) else None
        source_doc = source_map.get(feed_id, {})

        feed_row = FeedStatsRow(
            scope_id=str(feed_id),
            name=resolve_source_display_title(source_doc) if isinstance(source_doc, dict) else "Feed",
            category_id=str(category_id) if isinstance(category_id, ObjectId) else None,
            category_name=category_doc.name if category_doc is not None else None,
            articles_total=articles_total,
            articles_recent=articles_recent,
            articles_per_day_recent=round(articles_recent / normalized_window_days, 2),
            opened_total=opened_total,
            opened_recent=opened_recent,
            saved_total=saved_total,
            saved_recent=saved_recent,
            open_rate_percent=_safe_percent(opened_total, articles_total),
            save_rate_percent=_safe_percent(saved_total, articles_total),
        )
        per_feed_rows.append(feed_row)

        if not isinstance(category_id, ObjectId):
            continue

        category_stats = category_accumulator.setdefault(
            category_id,
            {
                "articles_total": 0,
                "articles_recent": 0,
                "opened_total": 0,
                "opened_recent": 0,
                "saved_total": 0,
                "saved_recent": 0,
            },
        )
        category_stats["articles_total"] += articles_total
        category_stats["articles_recent"] += articles_recent
        category_stats["opened_total"] += opened_total
        category_stats["opened_recent"] += opened_recent
        category_stats["saved_total"] += saved_total
        category_stats["saved_recent"] += saved_recent

    per_feed_rows.sort(key=lambda row: (row.articles_recent, row.articles_total, row.name.lower()), reverse=True)

    per_category_rows: list[FeedStatsRow] = []
    for category_id, stats in category_accumulator.items():
        category_doc = categories_by_id.get(category_id)
        category_name = category_doc.name if category_doc is not None else "Category"

        articles_total = int(stats.get("articles_total", 0))
        articles_recent = int(stats.get("articles_recent", 0))
        opened_total = int(stats.get("opened_total", 0))
        opened_recent = int(stats.get("opened_recent", 0))
        saved_total = int(stats.get("saved_total", 0))
        saved_recent = int(stats.get("saved_recent", 0))

        per_category_rows.append(
            FeedStatsRow(
                scope_id=str(category_id),
                name=category_name,
                articles_total=articles_total,
                articles_recent=articles_recent,
                articles_per_day_recent=round(articles_recent / normalized_window_days, 2),
                opened_total=opened_total,
                opened_recent=opened_recent,
                saved_total=saved_total,
                saved_recent=saved_recent,
                open_rate_percent=_safe_percent(opened_total, articles_total),
                save_rate_percent=_safe_percent(saved_total, articles_total),
            )
        )

    per_category_rows.sort(key=lambda row: (row.articles_recent, row.articles_total, row.name.lower()), reverse=True)

    overall_articles_total = sum(row.articles_total for row in per_feed_rows)
    overall_articles_recent = sum(row.articles_recent for row in per_feed_rows)
    overall_opened_total = sum(row.opened_total for row in per_feed_rows)
    overall_opened_recent = sum(row.opened_recent for row in per_feed_rows)
    overall_saved_total = sum(row.saved_total for row in per_feed_rows)
    overall_saved_recent = sum(row.saved_recent for row in per_feed_rows)

    daily_points = [
        FeedStatsDailyPoint(
            day=day,
            published_count=daily_overall[day]["published"],
            opened_count=daily_overall[day]["opened"],
            saved_count=daily_overall[day]["saved"],
        )
        for day in day_keys
    ]

    overall = FeedStatsOverall(
        total_feeds=len(per_feed_rows),
        total_categories=len(per_category_rows),
        articles_total=overall_articles_total,
        articles_recent=overall_articles_recent,
        articles_per_day_recent=round(overall_articles_recent / normalized_window_days, 2),
        opened_total=overall_opened_total,
        opened_recent=overall_opened_recent,
        saved_total=overall_saved_total,
        saved_recent=overall_saved_recent,
        open_rate_percent=_safe_percent(overall_opened_total, overall_articles_total),
        save_rate_percent=_safe_percent(overall_saved_total, overall_articles_total),
        daily=daily_points,
    )

    return FeedStatsResponse(
        window_days=normalized_window_days,
        overall=overall,
        per_category=per_category_rows,
        per_feed=per_feed_rows,
    )


async def get_feed_stats_context(user_id: str) -> dict[str, Any]:
    """Build template context payload for the feed stats page."""

    category_payload = await get_categories_with_counts(user_id)
    return {
        "categories": category_payload.categories,
        "all_unread_count": category_payload.all_unread_count,
        "recently_read_count": category_payload.recently_read_count,
        "saved_count": category_payload.saved_count,
        "sidebar_feed_groups": await get_sidebar_feed_groups_for_reader(user_id),
    }


async def log_feed_operation_error(operation_name: str, exc: Exception) -> None:
    """Centralized logging helper for feed operation failures."""

    logging.exception("Feed operation '%s' failed: %s", operation_name, exc)
