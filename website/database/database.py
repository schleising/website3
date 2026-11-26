from datetime import datetime
from typing import TypeVar
import logging

from motor.motor_asyncio import (
    AsyncIOMotorClient,
    AsyncIOMotorDatabase,
    AsyncIOMotorCollection,
)
from pydantic import BaseModel
from pymongo import ASCENDING
from bson.codec_options import CodecOptions

T = TypeVar("T", bound=BaseModel)

_shared_client: AsyncIOMotorClient[dict[str, object]] | None = None
_shared_client_server: str | None = None


def shared_motor_client(server_name: str) -> AsyncIOMotorClient[dict[str, object]]:
    """Return the process-wide Motor client, opening it on first use."""

    global _shared_client, _shared_client_server

    client = _shared_client
    if client is None or _shared_client_server != server_name:
        client = AsyncIOMotorClient(server_name, 27017)
        _shared_client = client
        _shared_client_server = server_name

    return client


class Database:
    def __init__(self) -> None:
        """Creates a Database instance on the shared Mongo connection."""
        with open("/app/database/db_server.txt", "r", encoding="utf8") as serverFile:
            server_name = serverFile.read().strip()

        self.client = shared_motor_client(server_name)
        self.current_db: AsyncIOMotorDatabase | None = None

    def set_database(self, db_name: str) -> AsyncIOMotorDatabase:
        """Set the database within the Mongo instance

        Args:
            db_name (str): The name of the database to use

        Returns:
            The database in use
        """
        self.current_db = self.client[db_name]

        return self.current_db

    def get_database(self, db_name: str) -> AsyncIOMotorDatabase:
        """Return a database handle without changing ``current_db``."""
        return self.client[db_name]

    def get_collection(
        self, collection_name: str, db_name: str | None = None, tz_aware: bool = False
    ) -> AsyncIOMotorCollection | None:
        """Gets a collection object given the name of the collection and, optionally, the name of the database

        Args:
            collection_name (str): The name of the collection
            db_name (str | None, optional): Optional database name. Defaults to None.
                When provided, ``current_db`` is left unchanged.

        Returns:
            The collection or None if it does not exist
        """
        if db_name is not None:
            database = self.client[db_name]
        elif self.current_db is not None:
            database = self.current_db
        else:
            return None

        if tz_aware:
            return database.get_collection(
                collection_name, codec_options=CodecOptions(tz_aware=True)
            )
        return database.get_collection(collection_name)


async def get_data_by_date(
    collection: AsyncIOMotorCollection,
    date_field: str,
    date_from: datetime,
    date_to: datetime,
    output_type: type[T],
) -> list[T]:
    from_db_cursor = collection.find(
        {date_field: {"$gte": date_from, "$lt": date_to}}
    ).sort(date_field, ASCENDING)

    items = [output_type.model_validate(item) async for item in from_db_cursor]

    logging.debug(f"Got {len(items)} matches")

    return items
