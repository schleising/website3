from ..database.database import Database

# Get an instance of the Database class
mongodb = Database()

# Set the database in use
mongodb.set_database('web_database')

# Set the collection in use
user_collection = mongodb.get_collection('user_collection')

# Store short-lived WebAuthn ceremony challenges.
webauthn_challenge_collection = mongodb.get_collection('webauthn_challenges')
