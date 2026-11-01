from ...database.database import Database

# Get an instance of the Database class
mongodb = Database()

# Set the database to the event database
mongodb.set_database("web_database")

# Set the sensor data collection
sensor_data_collection = mongodb.get_collection("sensor_data")

# Nest thermostat changes. One row when the combination changes. The poller
# still writes heating_samples; this page does not read that collection.
heating_changes_collection = mongodb.get_collection("heating_changes")
