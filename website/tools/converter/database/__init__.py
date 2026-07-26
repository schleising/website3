from ....database.database import Database

# Get an instance of the Database class
mongodb = Database()

# Set the database in use
mongodb.set_database('media')

# Set the media collection
media_collection = mongodb.get_collection('media_collection', tz_aware=True)

# Cover art cache (posters for Converter Films/TV)
cover_art_cache_collection = mongodb.get_collection('cover_art_cache')

# Set the push notification collection
push_collection = mongodb.get_collection('push_subscriptions')