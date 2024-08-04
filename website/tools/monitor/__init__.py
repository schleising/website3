from ...database.database import Database

# Get an instance of the Database class
mongodb = Database()

# Set the database to the event database
mongodb.set_database("web_database")

# Set the event log collection
sensor_data_collection = mongodb.get_collection("sensor_data")
