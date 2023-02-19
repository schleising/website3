from ..database.database import Database

# Get an instance of the Database class
mongodb = Database()

# Set the database in use
mongodb.set_database('web_database')

# Set the collection in use
pl_matches = mongodb.get_collection('pl_matches')

# Set the collection in use
pl_table = mongodb.get_collection('live_pl_table')
