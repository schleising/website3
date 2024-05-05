from ...database.database import Database

# Get an instance of the Database class
mongodb = Database()

# Set the database to the event database
mongodb.set_database('event_database')

# Set the event collection
event_collection = mongodb.get_collection('event_collection')

# Set the event log collection
event_log_collection = mongodb.get_collection('event_log_collection')
