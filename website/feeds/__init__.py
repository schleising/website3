from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorCollection

from ..database.database import Database

# Create a dedicated database connection for feed-reader data.
mongodb = Database()
mongodb.set_database("feeds_database")

feed_sources_collection: AsyncIOMotorCollection | None = mongodb.get_collection(
    "feed_sources"
)
feed_articles_collection: AsyncIOMotorCollection | None = mongodb.get_collection(
    "feed_articles"
)
user_feed_subscriptions_collection: AsyncIOMotorCollection | None = mongodb.get_collection(
    "user_feed_subscriptions"
)
feed_categories_collection: AsyncIOMotorCollection | None = mongodb.get_collection(
    "feed_categories"
)
user_article_states_collection: AsyncIOMotorCollection | None = mongodb.get_collection(
    "user_article_states"
)

__all__ = [
    "mongodb",
    "feed_sources_collection",
    "feed_articles_collection",
    "user_feed_subscriptions_collection",
    "feed_categories_collection",
    "user_article_states_collection",
]
