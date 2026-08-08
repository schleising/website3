from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from ..utils.system_notifications_access import require_system_notifications_access
from .csrf import validate_csrf
from .system_push_db import (
    delete_system_push_subscription,
    get_system_push_subscription,
    get_system_push_subscription_for_username_client,
    upsert_system_push_subscription,
)
from .system_push_models import (
    SYSTEM_NOTIFICATION_TOPIC_IDS,
    SYSTEM_NOTIFICATION_TOPICS,
    SystemPushSubscriptionDocument,
    SystemSubscriptionDeleteRequest,
    SystemSubscriptionOperationResponse,
    SystemSubscriptionPreferencesResponse,
    SystemSubscriptionUpdateRequest,
)
from .user_model import User

TEMPLATES = Jinja2Templates("/app/templates")
notifications_router = APIRouter()
logger = logging.getLogger(__name__)


def _request_username(request: Request) -> str:
    user = getattr(request.state, "user", None)
    username = getattr(user, "username", None)

    if isinstance(username, str) and username.strip() != "":
        return username

    return "Anonymous User"


def _require_tools_username(request: Request) -> str:
    require_system_notifications_access(request)
    username = _request_username(request)
    if username == "Anonymous User":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not Found",
        )
    return username


def _assert_subscription_owner(
    existing_subscription: SystemPushSubscriptionDocument | None,
    username: str,
) -> None:
    if existing_subscription is None:
        return

    owner = existing_subscription.username.strip()
    if owner == "" or owner == "Anonymous User":
        return

    if owner != username:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This subscription is managed by a different account.",
        )


def _validated_topics(topics: list[str]) -> list[str]:
    normalised = sorted({topic.strip() for topic in topics if topic.strip() != ""})
    unknown = [topic for topic in normalised if topic not in SYSTEM_NOTIFICATION_TOPIC_IDS]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown notification topics: {', '.join(unknown)}",
        )
    if len(normalised) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least one notification topic.",
        )
    return normalised


@notifications_router.get("/notifications", response_class=HTMLResponse)
@notifications_router.get("/notifications/", response_class=HTMLResponse)
async def system_notifications_page(request: Request):
    require_system_notifications_access(request)

    request_user = getattr(request.state, "user", None)
    username = request_user.username if isinstance(request_user, User) else ""

    return TEMPLATES.TemplateResponse(
        request,
        "account/notifications.html",
        {
            "request": request,
            "username": username,
            "topics": SYSTEM_NOTIFICATION_TOPICS,
        },
    )


@notifications_router.get("/notifications/catalog")
@notifications_router.get("/notifications/catalog/")
async def system_notifications_catalog(request: Request):
    require_system_notifications_access(request)
    return [topic.model_dump() for topic in SYSTEM_NOTIFICATION_TOPICS]


@notifications_router.get(
    "/notifications/subscriptions/current",
    response_model=SystemSubscriptionPreferencesResponse,
)
@notifications_router.get(
    "/notifications/subscriptions/current/",
    response_model=SystemSubscriptionPreferencesResponse,
)
async def current_system_subscription_preferences(
    request: Request,
    client_id: str | None = None,
):
    username = _require_tools_username(request)
    subscription_doc = await get_system_push_subscription_for_username_client(
        username,
        client_id,
    )

    if subscription_doc is None:
        return SystemSubscriptionPreferencesResponse(is_subscribed=False, topics=[])

    return SystemSubscriptionPreferencesResponse(
        is_subscribed=True,
        topics=sorted(set(subscription_doc.topics)),
    )


@notifications_router.put(
    "/notifications/subscriptions",
    response_model=SystemSubscriptionOperationResponse,
)
@notifications_router.put(
    "/notifications/subscriptions/",
    response_model=SystemSubscriptionOperationResponse,
)
async def update_system_subscription(
    request: Request,
    payload: SystemSubscriptionUpdateRequest,
    _: None = Depends(validate_csrf),
):
    username = _require_tools_username(request)
    topics = _validated_topics(payload.topics)

    existing_subscription = await get_system_push_subscription(
        payload.subscription,
        username=username,
        client_id=payload.client_id,
    )
    _assert_subscription_owner(existing_subscription, username)

    subscription_doc = SystemPushSubscriptionDocument(
        subscription=payload.subscription,
        topics=topics,
        username=username,
        client_id=payload.client_id,
    )
    ok = await upsert_system_push_subscription(subscription_doc)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save notification subscription.",
        )

    logger.info(
        "Saved system push subscription for user=%s topics=%s",
        username,
        topics,
    )
    return SystemSubscriptionOperationResponse(
        status="ok",
        message="Notification preferences saved.",
        topics=topics,
    )


@notifications_router.delete(
    "/notifications/subscriptions",
    response_model=SystemSubscriptionOperationResponse,
)
@notifications_router.delete(
    "/notifications/subscriptions/",
    response_model=SystemSubscriptionOperationResponse,
)
async def delete_system_subscription(
    request: Request,
    payload: SystemSubscriptionDeleteRequest,
    _: None = Depends(validate_csrf),
):
    username = _require_tools_username(request)

    existing_subscription = await get_system_push_subscription(
        payload.subscription,
        username=username,
        client_id=payload.client_id,
    )
    _assert_subscription_owner(existing_subscription, username)

    ok = await delete_system_push_subscription(
        payload.subscription,
        username=username,
        client_id=payload.client_id,
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No notification subscription found to remove.",
        )

    logger.info("Deleted system push subscription for user=%s", username)
    return SystemSubscriptionOperationResponse(
        status="ok",
        message="Notification subscription removed.",
        topics=[],
    )
