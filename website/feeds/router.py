from __future__ import annotations

from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import HTMLResponse, Response, RedirectResponse
from fastapi.templating import Jinja2Templates

from ..account.csrf import validate_csrf
from .feed_db import (
    create_or_update_subscription,
    delete_subscription,
    export_opml,
    get_article_list,
    get_article_read_statuses,
    get_categories_with_counts,
    get_feed_reader_context,
    get_feed_settings_context,
    import_opml,
    mark_article_read,
    mark_article_saved,
    mark_article_unread,
    mark_article_unsaved,
    normalize_color_hex,
    reorder_category_sort_order,
    set_category_color,
    set_category_muted,
    update_subscription_details,
    validate_feed_url,
)
from .models import (
    FeedArticleListResponse,
    FeedArticleStatusRequest,
    FeedArticleStatusResponse,
    FeedCategoryColorUpdateRequest,
    FeedCategoryListResponse,
    FeedCategoryOperationResponse,
    FeedCategoryReorderRequest,
    FeedOpmlImportOptions,
    FeedOpmlImportResult,
    FeedSubscriptionCreateRequest,
    FeedSubscriptionCreateResponse,
    FeedSubscriptionDeleteResponse,
    FeedSubscriptionUpdateRequest,
    FeedSubscriptionUpdateResponse,
)

TEMPLATES = Jinja2Templates("/app/templates")

feeds_router = APIRouter(prefix="/feeds")


def _request_username(request: Request) -> str | None:
    """Extract authenticated username from request state."""

    user = getattr(request.state, "user", None)
    if user is None:
        return None

    username = getattr(user, "username", None)
    if not isinstance(username, str) or username.strip() == "":
        return None

    return username


def _login_redirect_response(path: str) -> RedirectResponse:
    """Build a login redirect response with return path."""

    return RedirectResponse(
        f"/account/login/?next={quote(path, safe='/?=&')}",
        status_code=status.HTTP_303_SEE_OTHER,
    )


def _require_logged_in_user(request: Request) -> str:
    """Return username for authenticated user or raise HTTP 401."""

    username = _request_username(request)
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Login is required to access feeds.",
        )

    return username


@feeds_router.get("/", response_class=HTMLResponse)
@feeds_router.get("", response_class=HTMLResponse)
async def feed_reader_page(
    request: Request,
    category: str = "all",
    status_filter: Literal["unread", "read", "all"] = "unread",
):
    """Render the main feed reader page."""

    username = _request_username(request)
    if username is None:
        return _login_redirect_response("/feeds/")

    context = await get_feed_reader_context(username, category, status_filter)

    return TEMPLATES.TemplateResponse(
        request,
        "feeds/reader.html",
        {
            "request": request,
            "title": "Feeds",
            **context,
        },
    )


@feeds_router.get("/settings", response_class=HTMLResponse)
@feeds_router.get("/settings/", response_class=HTMLResponse)
async def feed_settings_page(request: Request):
    """Render the feed settings page."""

    username = _request_username(request)
    if username is None:
        return _login_redirect_response("/feeds/settings/")

    context = await get_feed_settings_context(username)

    return TEMPLATES.TemplateResponse(
        request,
        "feeds/settings.html",
        {
            "request": request,
            "title": "Feed Settings",
            **context,
        },
    )


@feeds_router.get(
    "/api/categories",
    response_model=FeedCategoryListResponse,
)
@feeds_router.get(
    "/api/categories/",
    response_model=FeedCategoryListResponse,
)
async def get_categories(request: Request) -> FeedCategoryListResponse:
    """Return sidebar category counts for the authenticated user."""

    username = _require_logged_in_user(request)
    return await get_categories_with_counts(username)


@feeds_router.get(
    "/api/articles",
    response_model=FeedArticleListResponse,
)
@feeds_router.get(
    "/api/articles/",
    response_model=FeedArticleListResponse,
)
async def get_articles(
    request: Request,
    category: str = "all",
    status_filter: Literal["unread", "read", "all"] = "unread",
    offset: int = 0,
    limit: int = 10,
) -> FeedArticleListResponse:
    """Return feed article cards filtered by category and status."""

    username = _require_logged_in_user(request)
    return await get_article_list(
        username,
        category,
        status_filter,
        offset=max(0, int(offset)),
        limit=max(1, min(100, int(limit))),
    )


@feeds_router.post(
    "/api/articles/statuses",
    response_model=FeedArticleStatusResponse,
)
@feeds_router.post(
    "/api/articles/statuses/",
    response_model=FeedArticleStatusResponse,
)
async def get_article_statuses(
    request: Request,
    payload: FeedArticleStatusRequest,
) -> FeedArticleStatusResponse:
    """Return read/save-state for explicit article IDs visible to the authenticated user."""

    username = _require_logged_in_user(request)
    statuses = await get_article_read_statuses(username, payload.article_ids)
    return FeedArticleStatusResponse(statuses=statuses)


@feeds_router.post(
    "/api/subscriptions",
    response_model=FeedSubscriptionCreateResponse,
)
@feeds_router.post(
    "/api/subscriptions/",
    response_model=FeedSubscriptionCreateResponse,
)
async def create_subscription(
    request: Request,
    payload: FeedSubscriptionCreateRequest,
    _: None = Depends(validate_csrf),
) -> FeedSubscriptionCreateResponse:
    """Create a feed subscription for the authenticated user."""

    username = _require_logged_in_user(request)

    if payload.category_name.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category name is required.",
        )

    normalized_url, source_title = await validate_feed_url(payload.feed_url)
    subscription_doc, created_subscription = await create_or_update_subscription(
        user_id=username,
        normalized_url=normalized_url,
        source_title=source_title,
        category_name=payload.category_name,
        duplicate_policy="skip",
    )

    return FeedSubscriptionCreateResponse(
        subscription_id=str(subscription_doc["_id"]),
        feed_id=str(subscription_doc["feed_id"]),
        category_id=str(subscription_doc["category_id"]),
        normalized_url=normalized_url,
        source_title=source_title,
        created_subscription=created_subscription,
    )


@feeds_router.post(
    "/api/subscriptions/{subscription_id}",
    response_model=FeedSubscriptionUpdateResponse,
)
@feeds_router.post(
    "/api/subscriptions/{subscription_id}/",
    response_model=FeedSubscriptionUpdateResponse,
)
async def update_subscription(
    request: Request,
    subscription_id: str,
    payload: FeedSubscriptionUpdateRequest,
    _: None = Depends(validate_csrf),
) -> FeedSubscriptionUpdateResponse:
    """Update subscription URL and category for the authenticated user."""

    username = _require_logged_in_user(request)

    if payload.category_id.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category is required.",
        )

    normalized_url, source_title = await validate_feed_url(payload.feed_url)
    updated_doc = await update_subscription_details(
        user_id=username,
        subscription_id=subscription_id,
        normalized_url=normalized_url,
        source_title=source_title,
        category_id=payload.category_id,
    )

    if updated_doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subscription or category not found.",
        )

    return FeedSubscriptionUpdateResponse(
        subscription_id=str(updated_doc["_id"]),
        feed_id=str(updated_doc["feed_id"]),
        category_id=str(updated_doc["category_id"]),
        normalized_url=normalized_url,
        source_title=source_title,
    )


@feeds_router.delete(
    "/api/subscriptions/{subscription_id}",
    response_model=FeedSubscriptionDeleteResponse,
)
@feeds_router.delete(
    "/api/subscriptions/{subscription_id}/",
    response_model=FeedSubscriptionDeleteResponse,
)
async def delete_subscription_route(
    request: Request,
    subscription_id: str,
    _: None = Depends(validate_csrf),
) -> FeedSubscriptionDeleteResponse:
    """Delete a subscription for the authenticated user."""

    username = _require_logged_in_user(request)
    deleted = await delete_subscription(username, subscription_id)

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subscription not found.",
        )

    return FeedSubscriptionDeleteResponse(subscription_id=subscription_id, deleted=True)


@feeds_router.post("/api/articles/{article_id}/read")
@feeds_router.post("/api/articles/{article_id}/read/")
async def mark_article_as_read(
    request: Request,
    article_id: str,
    _: None = Depends(validate_csrf),
) -> dict[str, str | bool]:
    """Mark an article as read for the authenticated user."""

    username = _require_logged_in_user(request)
    success = await mark_article_read(username, article_id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid article ID.",
        )

    return {"article_id": article_id, "is_read": True}


@feeds_router.post("/api/articles/{article_id}/unread")
@feeds_router.post("/api/articles/{article_id}/unread/")
async def mark_article_as_unread(
    request: Request,
    article_id: str,
    _: None = Depends(validate_csrf),
) -> dict[str, str | bool]:
    """Mark an article as unread for the authenticated user."""

    username = _require_logged_in_user(request)
    success = await mark_article_unread(username, article_id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid article ID.",
        )

    return {"article_id": article_id, "is_read": False}


@feeds_router.post("/api/articles/{article_id}/save")
@feeds_router.post("/api/articles/{article_id}/save/")
async def mark_article_as_saved(
    request: Request,
    article_id: str,
    _: None = Depends(validate_csrf),
) -> dict[str, str | bool]:
    """Mark an article as saved for the authenticated user."""

    username = _require_logged_in_user(request)
    success = await mark_article_saved(username, article_id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid article ID.",
        )

    return {"article_id": article_id, "is_saved": True}


@feeds_router.post("/api/articles/{article_id}/unsave")
@feeds_router.post("/api/articles/{article_id}/unsave/")
async def mark_article_as_unsaved(
    request: Request,
    article_id: str,
    _: None = Depends(validate_csrf),
) -> dict[str, str | bool]:
    """Mark an article as unsaved for the authenticated user."""

    username = _require_logged_in_user(request)
    success = await mark_article_unsaved(username, article_id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid article ID.",
        )

    return {"article_id": article_id, "is_saved": False}


@feeds_router.post(
    "/api/categories/{category_id}/mute",
    response_model=FeedCategoryOperationResponse,
)
@feeds_router.post(
    "/api/categories/{category_id}/mute/",
    response_model=FeedCategoryOperationResponse,
)
async def mute_category(
    request: Request,
    category_id: str,
    _: None = Depends(validate_csrf),
) -> FeedCategoryOperationResponse:
    """Mute a category for the authenticated user."""

    username = _require_logged_in_user(request)
    updated = await set_category_muted(username, category_id, True)

    if updated is None or updated.id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found.",
        )

    return FeedCategoryOperationResponse(
        category_id=str(updated.id),
        muted=updated.muted,
        color_hex=updated.color_hex,
    )


@feeds_router.post(
    "/api/categories/{category_id}/unmute",
    response_model=FeedCategoryOperationResponse,
)
@feeds_router.post(
    "/api/categories/{category_id}/unmute/",
    response_model=FeedCategoryOperationResponse,
)
async def unmute_category(
    request: Request,
    category_id: str,
    _: None = Depends(validate_csrf),
) -> FeedCategoryOperationResponse:
    """Unmute a category for the authenticated user."""

    username = _require_logged_in_user(request)
    updated = await set_category_muted(username, category_id, False)

    if updated is None or updated.id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found.",
        )

    return FeedCategoryOperationResponse(
        category_id=str(updated.id),
        muted=updated.muted,
        color_hex=updated.color_hex,
    )


@feeds_router.post(
    "/api/categories/{category_id}/color",
    response_model=FeedCategoryOperationResponse,
)
@feeds_router.post(
    "/api/categories/{category_id}/color/",
    response_model=FeedCategoryOperationResponse,
)
async def update_category_color(
    request: Request,
    category_id: str,
    payload: FeedCategoryColorUpdateRequest,
    _: None = Depends(validate_csrf),
) -> FeedCategoryOperationResponse:
    """Update category color for the authenticated user."""

    username = _require_logged_in_user(request)

    try:
        normalize_color_hex(payload.color_hex)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    updated = await set_category_color(username, category_id, payload.color_hex)
    if updated is None or updated.id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found.",
        )

    return FeedCategoryOperationResponse(
        category_id=str(updated.id),
        muted=updated.muted,
        color_hex=updated.color_hex,
    )


@feeds_router.post(
    "/api/categories/reorder",
    response_model=FeedCategoryListResponse,
)
@feeds_router.post(
    "/api/categories/reorder/",
    response_model=FeedCategoryListResponse,
)
async def reorder_categories(
    request: Request,
    payload: FeedCategoryReorderRequest,
    _: None = Depends(validate_csrf),
) -> FeedCategoryListResponse:
    """Persist category ordering for the authenticated user."""

    username = _require_logged_in_user(request)
    await reorder_category_sort_order(username, payload.category_ids)
    return await get_categories_with_counts(username)


@feeds_router.post(
    "/api/opml/import",
    response_model=FeedOpmlImportResult,
)
@feeds_router.post(
    "/api/opml/import/",
    response_model=FeedOpmlImportResult,
)
async def import_opml_data(
    request: Request,
    opml_file: UploadFile = File(...),
    duplicate_policy: Literal["skip", "refresh"] = Form("skip"),
    default_category_name: str = Form("Imported"),
    _: None = Depends(validate_csrf),
) -> FeedOpmlImportResult:
    """Import OPML subscriptions for the authenticated user."""

    username = _require_logged_in_user(request)

    file_bytes = await opml_file.read()
    if len(file_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded OPML file is empty.",
        )

    options = FeedOpmlImportOptions(
        duplicate_policy=duplicate_policy,
        default_category_name=default_category_name,
    )

    try:
        return await import_opml(username, file_bytes, options)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@feeds_router.get("/api/opml/export")
@feeds_router.get("/api/opml/export/")
async def export_opml_data(request: Request) -> Response:
    """Export OPML subscriptions for the authenticated user."""

    username = _require_logged_in_user(request)
    opml_xml = await export_opml(username)

    return Response(
        content=opml_xml,
        media_type="application/xml",
        headers={
            "Content-Disposition": "attachment; filename=feeds-export.opml",
        },
    )
