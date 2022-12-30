from ..database.database import Database

# Get an instance of the Database class
mongodb = Database()

# Set the database in use
mongodb.set_database('web_database')

# Set the collection in use
irca_collection = mongodb.get_collection('irca_collection')
