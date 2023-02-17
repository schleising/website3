from datetime import datetime
from typing import Callable
import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pydantic import BaseModel

# Type alias to avoid Pylance errors
AIOMDB = AsyncIOMotorDatabase

class Database:
    def __init__(self) -> None:
        """Creates a Database instance, creates a connection to the Mongo DB
        """
        with open('/app/database/db_server.txt', 'r', encoding='utf8') as serverFile:
            serverName = serverFile.read().strip()

            self.client = AsyncIOMotorClient(serverName, 27017)

            self.current_db: AIOMDB | None = None

    def set_database(self, db_name: str) -> AIOMDB:
        """Set the database within the Mongo instance

        Args:
            db_name (str): The name of the database to use

        Returns:
            The database in use
        """
        self.current_db = self.client[db_name]
        return self.current_db

    def get_collection(self, collection_name: str, db_name: str | None = None) -> AIOMDB | None:
        """Gets a collection object given the name of the collection and, optionally, the name of the database

        Args:
            collection_name (str): The name of the collection
            db_name (str | None, optional): Optional database name. Defaults to None.

        Returns:
            The collection or None if it does not exist
        """
        if db_name is not None:
            self.current_db = db_name
            return self.client.db_name[collection_name]
        elif self.current_db is not None:
            return self.current_db[collection_name]
        else:
            return None

async def get_data_by_date(collection: AIOMDB, field: str, date_from: datetime, date_to: datetime, output_type: Callable) -> list:
    items: list[BaseModel] = []

    from_db_cursor = collection.find({ field: {'$gte': date_from, '$lt': date_to} })

    from_db = await from_db_cursor.to_list(None)

    for item in from_db:
        items.append(output_type(**item))

    logging.info(f'Got {len(items)} matches')

    return items
