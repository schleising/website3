from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field

from ..database.models import ObjectIdPydanticAnnotation

PyObjectId = Annotated[ObjectId, ObjectIdPydanticAnnotation]


class FeedSourceDocument(BaseModel):
    """Represents a globally deduplicated RSS/Atom source document."""

    model_config = ConfigDict(populate_by_name=True)

    id: PyObjectId | None = Field(default=None, alias="_id")
    normalized_url: str
    title: str = ""
    image_url: str | None = None
    etag: str | None = None
    last_modified: str | None = None
    last_fetched_at: datetime | None = None
    next_refresh_at: datetime | None = None
    refresh_interval_seconds: int | None = None
    fetch_status: str = "new"
    last_error: str | None = None
    next_retry_at: datetime | None = None
    force_refresh_requested_at: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FeedArticleDocument(BaseModel):
    """Represents a fetched article for a feed source."""

    model_config = ConfigDict(populate_by_name=True)

    id: PyObjectId | None = Field(default=None, alias="_id")
    feed_id: PyObjectId
    dedupe_key: str
    title: str
    link: str
    author: str | None = None
    summary_html: str | None = None
    media_image_url: str | None = None
    published_at: datetime | None = None
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    is_deleted: bool = False
    deleted_at: datetime | None = None


class FeedCategoryDocument(BaseModel):
    """Represents a user-owned feed category preference."""

    model_config = ConfigDict(populate_by_name=True)

    id: PyObjectId | None = Field(default=None, alias="_id")
    user_id: str
    name: str
    muted: bool = False
    color_hex: str
    sort_order: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class UserFeedSubscriptionDocument(BaseModel):
    """Represents a user subscription to a deduplicated feed source."""

    model_config = ConfigDict(populate_by_name=True)

    id: PyObjectId | None = Field(default=None, alias="_id")
    user_id: str
    feed_id: PyObjectId
    category_id: PyObjectId
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class UserArticleStateDocument(BaseModel):
    """Stores user read/save state for an article."""

    model_config = ConfigDict(populate_by_name=True)

    id: PyObjectId | None = Field(default=None, alias="_id")
    user_id: str
    article_id: PyObjectId
    is_read: bool = False
    read_at: datetime | None = None
    is_saved: bool = False
    saved_at: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FeedCategorySummary(BaseModel):
    """Category summary returned to the feed-reader sidebar."""

    category_id: str
    name: str
    unread_count: int
    muted: bool
    color_hex: str
    sort_order: int


class FeedCategoryListResponse(BaseModel):
    """Category sidebar payload including aggregate counts."""

    all_unread_count: int
    recently_read_count: int
    saved_count: int
    categories: list[FeedCategorySummary]


class FeedArticleCard(BaseModel):
    """Article card payload used by feed-reader UI rendering."""

    article_id: str
    title: str
    link: str
    author: str | None = None
    summary_html: str | None = None
    media_image_url: str | None = None
    published_at: datetime | None = None
    feed_title: str
    category_id: str
    category_name: str
    category_color_hex: str
    is_read: bool = False
    read_at: datetime | None = None
    is_saved: bool = False
    saved_at: datetime | None = None


class FeedArticleListResponse(BaseModel):
    """Feed article list payload for API consumers."""

    category: str
    status: Literal["unread", "read", "all"]
    articles: list[FeedArticleCard]
    offset: int = 0
    limit: int = 0
    has_more: bool = False
    next_offset: int = 0


class FeedArticleStatusRequest(BaseModel):
    """Request payload for batch article read-status lookups."""

    article_ids: list[str] = Field(default_factory=list)


class FeedArticleStatusItem(BaseModel):
    """Single article read-status entry."""

    article_id: str
    is_read: bool
    is_saved: bool


class FeedArticleStatusResponse(BaseModel):
    """Batch article read-status lookup response payload."""

    statuses: list[FeedArticleStatusItem] = Field(default_factory=list)


class FeedSubscriptionCreateRequest(BaseModel):
    """Subscription creation request payload."""

    feed_url: str
    category_name: str


class FeedSubscriptionCreateResponse(BaseModel):
    """Subscription creation response payload."""

    subscription_id: str
    feed_id: str
    category_id: str
    normalized_url: str
    source_title: str
    source_image_url: str | None = None
    created_subscription: bool


class FeedSubscriptionUpdateRequest(BaseModel):
    """Subscription update payload for URL/category changes."""

    feed_url: str
    category_id: str


class FeedSubscriptionUpdateResponse(BaseModel):
    """Subscription update response payload."""

    subscription_id: str
    feed_id: str
    category_id: str
    normalized_url: str
    source_title: str
    source_image_url: str | None = None


class FeedSubscriptionDeleteResponse(BaseModel):
    """Subscription deletion response payload."""

    subscription_id: str
    deleted: bool


class FeedCategoryOperationResponse(BaseModel):
    """Generic response for category preference updates."""

    category_id: str
    muted: bool
    color_hex: str


class FeedCategoryColorUpdateRequest(BaseModel):
    """Request payload for category color preference updates."""

    color_hex: str


class FeedCategoryReorderRequest(BaseModel):
    """Request payload for persisted category ordering."""

    category_ids: list[str] = Field(default_factory=list)


class FeedOpmlImportOptions(BaseModel):
    """Optional import behavior controls for OPML ingestion."""

    duplicate_policy: Literal["skip", "refresh"] = "skip"
    default_category_name: str = "Imported"


class FeedOpmlImportResult(BaseModel):
    """Summary payload for OPML import actions."""

    created_subscriptions: int = 0
    existing_subscriptions: int = 0
    created_categories: int = 0
    skipped_duplicates: int = 0
    errors: list[str] = Field(default_factory=list)


class FeedSettingsViewModel(BaseModel):
    """Settings page model with user subscriptions and categories."""

    categories: list[FeedCategorySummary]
    subscriptions: list[dict[str, str]]
