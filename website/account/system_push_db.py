from __future__ import annotations

import logging
from datetime import UTC, datetime

from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

from . import system_push_subscriptions
from .system_push_models import PushSubscription, SystemPushSubscriptionDocument

SUBSCRIPTION_DOCUMENT_SORT = [("updated_at", DESCENDING), ("created_at", DESCENDING)]


def _subscription_query(subscription: PushSubscription) -> dict:
    return {"subscription.endpoint": subscription.endpoint}


def _normalise_subscription_client_id(client_id: str | None) -> str | None:
    if not isinstance(client_id, str):
        return None

    candidate = client_id.strip()
    return candidate if candidate != "" else None


def _subscription_client_query(username: str | None, client_id: str | None) -> dict | None:
    if not isinstance(username, str):
        return None

    normalised_username = username.strip()
    normalised_client_id = _normalise_subscription_client_id(client_id)

    if (
        normalised_username == ""
        or normalised_username == "Anonymous User"
        or normalised_client_id is None
    ):
        return None

    return {"username": normalised_username, "client_id": normalised_client_id}


async def ensure_system_push_subscription_indexes() -> None:
    if system_push_subscriptions is None:
        logging.error("No DB connection for system push subscriptions")
        return

    await system_push_subscriptions.create_index(
        [("subscription.endpoint", ASCENDING)],
        name="system_push_subscription_endpoint",
        unique=True,
    )
    await system_push_subscriptions.create_index(
        [("topics", ASCENDING)],
        name="system_push_topics",
    )
    await system_push_subscriptions.create_index(
        [("username", ASCENDING), ("client_id", ASCENDING)],
        name="system_push_username_client_id",
        sparse=True,
    )


async def upsert_system_push_subscription(
    subscription_doc: SystemPushSubscriptionDocument,
) -> bool:
    if system_push_subscriptions is None:
        logging.error("No DB connection for system push subscriptions")
        return False

    now = datetime.now(tz=UTC)
    topics = sorted(set(subscription_doc.topics))
    client_query = _subscription_client_query(
        subscription_doc.username,
        subscription_doc.client_id,
    )
    update_filter: dict = _subscription_query(subscription_doc.subscription)

    if client_query is not None:
        existing = await system_push_subscriptions.find_one(
            {"$or": [client_query, _subscription_query(subscription_doc.subscription)]},
            sort=SUBSCRIPTION_DOCUMENT_SORT,
        )

        if existing is not None:
            update_filter = {"_id": existing["_id"]}
        else:
            update_filter = client_query

    try:
        await system_push_subscriptions.update_one(
            update_filter,
            {
                "$set": {
                    "subscription": subscription_doc.subscription.model_dump(
                        by_alias=True, exclude_none=True
                    ),
                    "topics": topics,
                    "username": subscription_doc.username,
                    "client_id": subscription_doc.client_id,
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "created_at": now,
                },
            },
            upsert=True,
        )
    except DuplicateKeyError as ex:
        logging.error("Error upserting system push subscription: %s", ex)
        return False

    if client_query is not None:
        current_subscription = await system_push_subscriptions.find_one(
            client_query,
            sort=SUBSCRIPTION_DOCUMENT_SORT,
        )

        if current_subscription is not None:
            await system_push_subscriptions.delete_many(
                {
                    "$and": [
                        {"_id": {"$ne": current_subscription["_id"]}},
                        {
                            "$or": [
                                client_query,
                                _subscription_query(subscription_doc.subscription),
                            ]
                        },
                    ]
                }
            )

    return True


async def get_system_push_subscription(
    subscription: PushSubscription | None,
    *,
    username: str | None = None,
    client_id: str | None = None,
) -> SystemPushSubscriptionDocument | None:
    if system_push_subscriptions is None:
        logging.error("No DB connection for system push subscriptions")
        return None

    if subscription is not None:
        existing = await system_push_subscriptions.find_one(
            _subscription_query(subscription),
            sort=SUBSCRIPTION_DOCUMENT_SORT,
        )

        if existing is not None:
            return SystemPushSubscriptionDocument.model_validate(existing)

    client_query = _subscription_client_query(username, client_id)
    if client_query is None:
        return None

    existing = await system_push_subscriptions.find_one(
        client_query,
        sort=SUBSCRIPTION_DOCUMENT_SORT,
    )

    if existing is None:
        return None

    return SystemPushSubscriptionDocument.model_validate(existing)


async def get_system_push_subscription_for_username_client(
    username: str,
    client_id: str | None,
) -> SystemPushSubscriptionDocument | None:
    if system_push_subscriptions is None:
        logging.error("No DB connection for system push subscriptions")
        return None

    client_query = _subscription_client_query(username, client_id)
    if client_query is None:
        return None

    existing = await system_push_subscriptions.find_one(
        client_query,
        sort=SUBSCRIPTION_DOCUMENT_SORT,
    )

    if existing is None:
        return None

    return SystemPushSubscriptionDocument.model_validate(existing)


async def delete_system_push_subscription(
    subscription: PushSubscription | None,
    *,
    username: str | None = None,
    client_id: str | None = None,
) -> bool:
    if system_push_subscriptions is None:
        logging.error("No DB connection for system push subscriptions")
        return False

    delete_filters: list[dict] = []

    if subscription is not None:
        delete_filters.append(_subscription_query(subscription))

    client_query = _subscription_client_query(username, client_id)
    if client_query is not None:
        delete_filters.append(client_query)

    if len(delete_filters) == 0:
        logging.error("No subscription identity provided for system push delete")
        return False

    delete_query = (
        delete_filters[0] if len(delete_filters) == 1 else {"$or": delete_filters}
    )
    result = await system_push_subscriptions.delete_many(delete_query)

    if result.deleted_count == 0:
        logging.error("No system push subscription found to delete")
        return False

    return True
