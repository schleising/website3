from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase, AsyncIOMotorCollection

class Database:
    def __init__(self) -> None:
        """Creates a Database instance, creates a connection to the Mongo DB
        """
        with open('/app/database/db_server.txt', 'r', encoding='utf8') as serverFile:
            serverName = serverFile.read()

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

    def get_collection(self, collection_name: str, db_name: str | None = None) -> AsyncIOMotorCollection | None:
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