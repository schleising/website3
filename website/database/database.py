from datetime import datetime
from typing import Callable, TypeVar
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

class Database:
    def __init__(self) -> None:
        """Creates a Database instance, creates a connection to the Mongo DB"""
        with open("/app/database/db_server.txt", "r", encoding="utf8") as serverFile:
            serverName = serverFile.read().strip()

            self.client = AsyncIOMotorClient(serverName, 27017)

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

    def get_collection(
        self, collection_name: str, db_name: str | None = None, tz_aware: bool = False
    ) -> AsyncIOMotorCollection | None:
        """Gets a collection object given the name of the collection and, optionally, the name of the database

        Args:
            collection_name (str): The name of the collection
            db_name (str | None, optional): Optional database name. Defaults to None.

        Returns:
            The collection or None if it does not exist
        """
        if db_name is not None:
            self.current_db = self.client[db_name]
            if tz_aware:
                return (
                    self.current_db.get_collection(
                        collection_name, codec_options=CodecOptions(tz_aware=True)
                    )
                    if self.current_db is not None
                    else None
                )
            else:
                return (
                    self.current_db.get_collection(collection_name)
                    if self.current_db is not None
                    else None
                )
        elif self.current_db is not None:
            if tz_aware:
                return self.current_db.get_collection(
                    collection_name, codec_options=CodecOptions(tz_aware=True)
                )
            else:
                return self.current_db.get_collection(collection_name)
        else:
            return None


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
