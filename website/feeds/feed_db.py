from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast
import xml.etree.ElementTree as ET

import aiohttp
from bson import ObjectId
from pymongo import ASCENDING, DESCENDING

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
)


def utc_now() -> datetime:
    """Return the current UTC timestamp with timezone information."""

    return datetime.now(UTC)


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

    return normalized


async def validate_feed_url(feed_url: str) -> tuple[str, str]:
    """Validate a feed URL by fetching and parsing minimal XML metadata.

    Returns:
        Tuple of normalized URL and best-effort source title.
    """

    normalized_url = normalize_feed_url(feed_url)

    timeout = aiohttp.ClientTimeout(12)
    headers = {
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9,*/*;q=0.8"
    }

    try:
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
            async with session.get(normalized_url) as response:
                if response.status >= 400:
                    raise ValueError(f"Feed URL returned HTTP {response.status}.")

                payload = await response.read()
    except aiohttp.ClientError as exc:
        raise ValueError(f"Unable to fetch feed URL: {exc}") from exc

    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise ValueError("Feed URL did not return valid XML.") from exc

    title = extract_feed_title(root)
    if title == "":
        title = normalized_url

    return normalized_url, title


def extract_feed_title(root: ET.Element) -> str:
    """Extract feed title from RSS or Atom root element."""

    tag = root.tag.lower()

    if tag.endswith("rss"):
        channel = root.find("channel")
        if channel is not None:
            title = channel.findtext("title", default="")
            return title.strip()

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

    existing_doc = await feed_sources_collection.find_one({"normalized_url": normalized_url})
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
    result = await feed_sources_collection.insert_one(new_source)
    new_source["_id"] = result.inserted_id
    return new_source


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

        return existing, False

    new_subscription = {
        "user_id": user_id,
        "feed_id": source_doc["_id"],
        "category_id": category_doc.id,
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }

    insert_result = await user_feed_subscriptions_collection.insert_one(new_subscription)
    new_subscription["_id"] = insert_result.inserted_id

    source_id = source_doc.get("_id")
    if isinstance(source_id, ObjectId):
        await request_immediate_feed_refresh({source_id})

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


async def update_subscription_details(
    user_id: str,
    subscription_id: str,
    normalized_url: str,
    source_title: str,
    category_id: str,
) -> dict[str, Any] | None:
    """Update an existing user subscription URL and category."""

    if user_feed_subscriptions_collection is None:
        return None

    try:
        subscription_object_id = ObjectId(subscription_id)
    except Exception:
        return None

    category_doc = await load_user_category(user_id, category_id)
    if category_doc is None or category_doc.id is None:
        return None

    source_doc = await ensure_feed_source(normalized_url, source_title)

    existing_subscription = await user_feed_subscriptions_collection.find_one(
        {"_id": subscription_object_id, "user_id": user_id}
    )
    if existing_subscription is None:
        return None

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
                    "updated_at": now,
                }
            },
        )
        updated_subscription = await user_feed_subscriptions_collection.find_one(
            {"_id": subscription_object_id, "user_id": user_id}
        )

    source_id = source_doc.get("_id")
    if isinstance(source_id, ObjectId):
        await request_immediate_feed_refresh({source_id})

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
                "source_title": str(source.get("title", source.get("normalized_url", "Feed"))),
                "source_url": str(source.get("normalized_url", "")),
                "source_image_url": str(source.get("image_url", "")).strip(),
                "category_id": str(category.id),
                "category_name": category.name,
                "category_color_hex": category.color_hex,
                "category_muted": category.muted,
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


async def get_categories_with_counts(user_id: str) -> FeedCategoryListResponse:
    """Return sidebar categories and unread counters for a user."""

    categories = await list_category_documents(user_id)

    if user_feed_subscriptions_collection is None:
        return FeedCategoryListResponse(
            all_unread_count=0,
            recently_read_count=0,
            saved_count=0,
            categories=[],
        )

    subscriptions = [
        dict(doc)
        async for doc in user_feed_subscriptions_collection.find({"user_id": user_id})
    ]
    feed_to_category = {
        sub["feed_id"]: sub["category_id"] for sub in subscriptions if "feed_id" in sub and "category_id" in sub
    }

    read_state_ids = await get_read_article_id_set(user_id)

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


async def get_read_article_id_set(user_id: str) -> set[ObjectId]:
    """Return article IDs that are marked as read for the user."""

    if user_article_states_collection is None:
        return set()

    cursor = user_article_states_collection.find(
        {"user_id": user_id, "is_read": True}, {"article_id": 1}
    )
    return {doc["article_id"] async for doc in cursor if "article_id" in doc}


async def get_saved_article_id_set(user_id: str) -> set[ObjectId]:
    """Return article IDs that are marked as saved for the user."""

    if user_article_states_collection is None:
        return set()

    cursor = user_article_states_collection.find(
        {"user_id": user_id, "is_saved": True}, {"article_id": 1}
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
    """Count recently-read articles in the last seven days, excluding muted categories."""

    if user_article_states_collection is None or feed_articles_collection is None:
        return 0

    muted_category_ids = {
        category.id for category in categories if category.id is not None and category.muted
    }

    threshold = utc_now() - timedelta(days=7)
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
    offset: int = 0,
    limit: int = 10,
) -> FeedArticleListResponse:
    """Return filtered article cards for the feed reader view."""

    normalized_offset = max(0, int(offset))
    normalized_limit = max(1, int(limit))

    normalized_status: Literal["unread", "read", "all"]
    if status_filter in {"unread", "read", "all"}:
        normalized_status = cast(Literal["unread", "read", "all"], status_filter)
    else:
        normalized_status = "unread"

    categories = await list_category_documents(user_id)
    subscriptions = await list_user_subscription_docs(user_id)

    feed_to_category = {
        sub["feed_id"]: sub["category_id"]
        for sub in subscriptions
        if "feed_id" in sub and "category_id" in sub
    }

    categories_by_id = {
        category.id: category for category in categories if category.id is not None
    }

    if category_filter == "recently-read":
        articles, has_more = await list_recently_read_cards(
            user_id=user_id,
            categories_by_id=categories_by_id,
            feed_to_category=feed_to_category,
            offset=normalized_offset,
            limit=normalized_limit,
        )
        return FeedArticleListResponse(
            category="recently-read",
            status="read",
            articles=articles,
            offset=normalized_offset,
            limit=normalized_limit,
            has_more=has_more,
            next_offset=normalized_offset + len(articles),
        )

    if category_filter == "saved":
        articles, has_more = await list_saved_cards(
            user_id=user_id,
            categories_by_id=categories_by_id,
            feed_to_category=feed_to_category,
            offset=normalized_offset,
            limit=normalized_limit,
        )
        return FeedArticleListResponse(
            category="saved",
            status="all",
            articles=articles,
            offset=normalized_offset,
            limit=normalized_limit,
            has_more=has_more,
            next_offset=normalized_offset + len(articles),
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
            return FeedArticleListResponse(
                category=category_filter,
                status=normalized_status,
                articles=[],
                offset=normalized_offset,
                limit=normalized_limit,
                has_more=False,
                next_offset=normalized_offset,
            )

        allowed_category_ids = [selected_category]

    allowed_feed_ids = [
        feed_id
        for feed_id, category_id in feed_to_category.items()
        if category_id in allowed_category_ids
    ]

    if len(allowed_feed_ids) == 0:
        return FeedArticleListResponse(
            category=category_filter,
            status=normalized_status,
            articles=[],
            offset=normalized_offset,
            limit=normalized_limit,
            has_more=False,
            next_offset=normalized_offset,
        )

    read_map = await get_user_read_map(user_id)
    saved_map = await get_user_saved_map(user_id)
    cards, has_more = await list_cards_for_feed_ids(
        allowed_feed_ids=allowed_feed_ids,
        categories_by_id=categories_by_id,
        feed_to_category=feed_to_category,
        read_map=read_map,
        saved_map=saved_map,
        status_filter=normalized_status,
        offset=normalized_offset,
        limit=normalized_limit,
    )

    return FeedArticleListResponse(
        category=category_filter,
        status=normalized_status,
        articles=cards,
        offset=normalized_offset,
        limit=normalized_limit,
        has_more=has_more,
        next_offset=normalized_offset + len(cards),
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
        {"article_id": 1, "is_read": 1, "is_saved": 1},
    )
    state_flags: dict[ObjectId, tuple[bool, bool]] = {}
    async for state_doc in read_state_cursor:
        article_id = state_doc.get("article_id")
        if not isinstance(article_id, ObjectId):
            continue
        state_flags[article_id] = (
            bool(state_doc.get("is_read")),
            bool(state_doc.get("is_saved")),
        )

    return [
        FeedArticleStatusItem(
            article_id=str(article_id),
            is_read=state_flags.get(article_id, (False, False))[0],
            is_saved=state_flags.get(article_id, (False, False))[1],
        )
        for article_id in ordered_unique_ids
        if article_id in visible_article_ids
    ]


async def list_cards_for_feed_ids(
    allowed_feed_ids: list[ObjectId],
    categories_by_id: dict[ObjectId, FeedCategoryDocument],
    feed_to_category: dict[ObjectId, ObjectId],
    read_map: dict[ObjectId, datetime | None],
    saved_map: dict[ObjectId, datetime | None],
    status_filter: str,
    offset: int,
    limit: int,
) -> tuple[list[FeedArticleCard], bool]:
    """Return article cards for feed IDs with status filtering."""

    if feed_articles_collection is None:
        return [], False

    source_map = await load_sources_map(set(allowed_feed_ids))

    base_query = {
        "feed_id": {"$in": allowed_feed_ids},
        "is_deleted": False,
    }

    # Match frontend ordering: publication date ascending, with undated articles
    # treated as "infinite" and therefore placed at the end.
    dated_cursor = feed_articles_collection.find(
        {
            **base_query,
            "published_at": {"$type": "date"},
        }
    ).sort([
        ("published_at", ASCENDING),
        ("_id", ASCENDING),
    ])

    undated_cursor = feed_articles_collection.find(
        {
            **base_query,
            "$or": [
                {"published_at": None},
                {"published_at": {"$exists": False}},
            ],
        }
    ).sort("_id", ASCENDING)

    cards: list[FeedArticleCard] = []
    seen_matching = 0
    has_more = False

    for cursor in (dated_cursor, undated_cursor):
        async for article_doc in cursor:
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

            read_at = read_map.get(article_id)
            is_read = article_id in read_map
            saved_at = saved_map.get(article_id)
            is_saved = article_id in saved_map

            if status_filter == "read" and not is_read:
                continue
            if status_filter == "unread" and is_read:
                continue

            if seen_matching < offset:
                seen_matching += 1
                continue

            if len(cards) >= limit:
                has_more = True
                break

            source_doc = source_map.get(feed_id, {})
            source_title = str(source_doc.get("title", source_doc.get("normalized_url", "Feed")))

            cards.append(
                FeedArticleCard(
                    article_id=str(article_id),
                    title=str(article_doc.get("title", "Untitled")),
                    link=normalize_article_link(article_doc.get("link")),
                    author=str(article_doc.get("author", "")).strip() or None,
                    summary_html=sanitize_html(str(article_doc.get("summary_html", "")))
                    if article_doc.get("summary_html")
                    else None,
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

            seen_matching += 1

        if has_more:
            break

    return cards, has_more


async def list_recently_read_cards(
    user_id: str,
    categories_by_id: dict[ObjectId, FeedCategoryDocument],
    feed_to_category: dict[ObjectId, ObjectId],
    offset: int,
    limit: int,
) -> tuple[list[FeedArticleCard], bool]:
    """Return recently-read article cards from the last seven days."""

    if user_article_states_collection is None or feed_articles_collection is None:
        return [], False

    muted_category_ids = {
        category_id
        for category_id, category in categories_by_id.items()
        if category.muted
    }

    threshold = utc_now() - timedelta(days=7)
    state_cursor = user_article_states_collection.find(
        {
            "user_id": user_id,
            "is_read": True,
            "read_at": {"$gte": threshold},
        },
        {"article_id": 1, "read_at": 1},
    ).sort("read_at", DESCENDING)

    state_rows = [doc async for doc in state_cursor]
    if len(state_rows) == 0:
        return [], False

    read_map: dict[ObjectId, datetime | None] = {}
    article_ids: list[ObjectId] = []

    for row in state_rows:
        article_id = row.get("article_id")
        if not isinstance(article_id, ObjectId):
            continue
        article_ids.append(article_id)
        read_map[article_id] = row.get("read_at")

    if len(article_ids) == 0:
        return [], False

    article_cursor = feed_articles_collection.find(
        {
            "_id": {"$in": article_ids},
        }
    )
    article_map = {doc["_id"]: doc async for doc in article_cursor if "_id" in doc}

    source_ids: set[ObjectId] = {
        feed_id
        for doc in article_map.values()
        for feed_id in [doc.get("feed_id")]
        if isinstance(feed_id, ObjectId)
    }
    source_map = await load_sources_map(source_ids)
    saved_map = await get_user_saved_map(user_id)

    ordered_cards: list[FeedArticleCard] = []

    for article_id in article_ids:
        article_doc = article_map.get(article_id)
        if article_doc is None:
            continue

        feed_id = article_doc.get("feed_id")
        if not isinstance(feed_id, ObjectId):
            continue

        category_id = feed_to_category.get(feed_id)
        if category_id is None:
            continue

        if category_id in muted_category_ids:
            continue

        category = categories_by_id.get(category_id)
        if category is None or category.id is None:
            continue

        source_doc = source_map.get(feed_id, {})
        source_title = str(source_doc.get("title", source_doc.get("normalized_url", "Feed")))

        ordered_cards.append(
            FeedArticleCard(
                article_id=str(article_id),
                title=str(article_doc.get("title", "Untitled")),
                link=normalize_article_link(article_doc.get("link")),
                author=str(article_doc.get("author", "")).strip() or None,
                summary_html=sanitize_html(str(article_doc.get("summary_html", "")))
                if article_doc.get("summary_html")
                else None,
                media_image_url=normalize_article_link(article_doc.get("media_image_url")) or None,
                published_at=article_doc.get("published_at"),
                feed_title=source_title,
                category_id=str(category.id),
                category_name=category.name,
                category_color_hex=category.color_hex,
                is_read=True,
                read_at=read_map.get(article_id),
                is_saved=article_id in saved_map,
                saved_at=saved_map.get(article_id),
            )
        )

    ordered_cards.sort(
        key=lambda card: card.read_at or datetime.fromtimestamp(0, tz=UTC), reverse=True
    )

    paged_cards = ordered_cards[offset:offset + limit]
    has_more = (offset + len(paged_cards)) < len(ordered_cards)
    return paged_cards, has_more


async def list_saved_cards(
    user_id: str,
    categories_by_id: dict[ObjectId, FeedCategoryDocument],
    feed_to_category: dict[ObjectId, ObjectId],
    offset: int,
    limit: int,
) -> tuple[list[FeedArticleCard], bool]:
    """Return user-saved article cards, newest-saved first."""

    if user_article_states_collection is None or feed_articles_collection is None:
        return [], False

    state_cursor = user_article_states_collection.find(
        {
            "user_id": user_id,
            "is_saved": True,
        },
        {"article_id": 1, "saved_at": 1},
    ).sort("saved_at", DESCENDING)

    state_rows = [doc async for doc in state_cursor]
    if len(state_rows) == 0:
        return [], False

    read_map = await get_user_read_map(user_id)

    ordered_article_ids: list[ObjectId] = []
    saved_map: dict[ObjectId, datetime | None] = {}
    for row in state_rows:
        article_id = row.get("article_id")
        if not isinstance(article_id, ObjectId):
            continue
        ordered_article_ids.append(article_id)
        saved_map[article_id] = row.get("saved_at")

    if len(ordered_article_ids) == 0:
        return [], False

    article_cursor = feed_articles_collection.find(
        {
            "_id": {"$in": ordered_article_ids},
            "is_deleted": False,
        }
    )
    article_map = {doc["_id"]: doc async for doc in article_cursor if "_id" in doc}

    source_ids: set[ObjectId] = {
        feed_id
        for doc in article_map.values()
        for feed_id in [doc.get("feed_id")]
        if isinstance(feed_id, ObjectId)
    }
    source_map = await load_sources_map(source_ids)

    ordered_cards: list[FeedArticleCard] = []

    for article_id in ordered_article_ids:
        article_doc = article_map.get(article_id)
        if article_doc is None:
            continue

        feed_id = article_doc.get("feed_id")
        if not isinstance(feed_id, ObjectId):
            continue

        category_id = feed_to_category.get(feed_id)
        if category_id is None:
            continue

        category = categories_by_id.get(category_id)
        if category is None or category.id is None:
            continue

        source_doc = source_map.get(feed_id, {})
        source_title = str(source_doc.get("title", source_doc.get("normalized_url", "Feed")))

        ordered_cards.append(
            FeedArticleCard(
                article_id=str(article_id),
                title=str(article_doc.get("title", "Untitled")),
                link=normalize_article_link(article_doc.get("link")),
                author=str(article_doc.get("author", "")).strip() or None,
                summary_html=sanitize_html(str(article_doc.get("summary_html", "")))
                if article_doc.get("summary_html")
                else None,
                media_image_url=normalize_article_link(article_doc.get("media_image_url")) or None,
                published_at=article_doc.get("published_at"),
                feed_title=source_title,
                category_id=str(category.id),
                category_name=category.name,
                category_color_hex=category.color_hex,
                is_read=article_id in read_map,
                read_at=read_map.get(article_id),
                is_saved=True,
                saved_at=saved_map.get(article_id),
            )
        )

    paged_cards = ordered_cards[offset:offset + limit]
    has_more = (offset + len(paged_cards)) < len(ordered_cards)
    return paged_cards, has_more


async def mark_article_read(user_id: str, article_id: str) -> bool:
    """Mark an article as read for a user."""

    if user_article_states_collection is None:
        return False

    try:
        article_object_id = ObjectId(article_id)
    except Exception:
        return False

    now = utc_now()
    existing_state = await user_article_states_collection.find_one(
        {"user_id": user_id, "article_id": article_object_id},
        {"is_read": 1, "read_at": 1},
    )

    existing_read_at = existing_state.get("read_at") if isinstance(existing_state, dict) else None
    preserve_existing_read_at = (
        isinstance(existing_state, dict)
        and bool(existing_state.get("is_read"))
        and isinstance(existing_read_at, datetime)
    )
    read_at_value = existing_read_at if preserve_existing_read_at else now

    await user_article_states_collection.update_one(
        {"user_id": user_id, "article_id": article_object_id},
        {
            "$set": {
                "is_read": True,
                "read_at": read_at_value,
                "updated_at": now,
            },
            "$setOnInsert": {
                "created_at": now,
            },
        },
        upsert=True,
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
            "$unset": {
                "read_at": "",
            },
            "$setOnInsert": {
                "created_at": now,
            },
        },
        upsert=True,
    )

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
            "$unset": {
                "saved_at": "",
            },
            "$setOnInsert": {
                "is_read": False,
                "created_at": now,
            },
        },
        upsert=True,
    )

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

    category_map = {category.id: category for category in categories if category.id is not None}
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


async def get_feed_reader_context(user_id: str, category_filter: str, status_filter: str) -> dict[str, Any]:
    """Build template context payload for the feed reader page."""

    categories_payload = await get_categories_with_counts(user_id)
    article_payload = await get_article_list(
        user_id,
        category_filter,
        status_filter,
        offset=0,
        limit=10,
    )

    return {
        "categories": categories_payload.categories,
        "all_unread_count": categories_payload.all_unread_count,
        "recently_read_count": categories_payload.recently_read_count,
        "saved_count": categories_payload.saved_count,
        "articles": article_payload.articles,
        "selected_category": category_filter,
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
                    }
                },
            ]
        )

        async for count_doc in count_cursor:
            feed_id = count_doc.get("_id")
            if not isinstance(feed_id, ObjectId):
                continue
            article_counts[feed_id] = int(count_doc.get("article_count", 0))

    rows: list[dict[str, Any]] = []
    for feed_id in feed_ids:
        source = sources_map.get(feed_id)
        if source is None:
            continue

        feed_name = str(
            source.get("title", source.get("normalized_url", "Feed"))
        ).strip() or "Feed"
        fetch_status = str(source.get("fetch_status", "new")).strip() or "new"

        rows.append(
            {
                "feed_id": str(feed_id),
                "feed_name": feed_name,
                "article_count": int(article_counts.get(feed_id, 0)),
                "last_refresh_at_iso": format_datetime_utc_iso(
                    source.get("last_fetched_at")
                ),
                "next_refresh_at_iso": format_datetime_utc_iso(
                    source.get("next_refresh_at")
                ),
                "last_refresh_status": fetch_status,
            }
        )

    rows.sort(key=lambda row: str(row.get("feed_name", "")).lower())
    return rows


async def get_feed_admin_context(user_id: str) -> dict[str, Any]:
    """Build template context payload for the feed admin page."""

    context = await get_feed_settings_context(user_id)
    context["feed_admin_rows"] = await list_feed_admin_rows()
    return context


async def log_feed_operation_error(operation_name: str, exc: Exception) -> None:
    """Centralized logging helper for feed operation failures."""

    logging.exception("Feed operation '%s' failed: %s", operation_name, exc)
