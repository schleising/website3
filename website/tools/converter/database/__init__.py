from ....database.database import Database

# Get an instance of the Database class
mongodb = Database()

# Set the database in use
mongodb.set_database('media')

# Set the media collection
media_collection = mongodb.get_collection('media_collection', tz_aware=True)

# Set the push notification collection
push_collection = mongodb.get_collection('push_subscriptions')
