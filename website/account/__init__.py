from ..database.database import Database

# Get an instance of the Database class
mongodb = Database()

# Set the database in use
mongodb.set_database('web_database')

# Set the collection in use
user_collection = mongodb.get_collection('user_collection')

# Store short-lived WebAuthn ceremony challenges.
webauthn_challenge_collection = mongodb.get_collection('webauthn_challenges')

# Store short-lived one-time email link tokens for signup and recovery.
email_link_token_collection = mongodb.get_collection('email_link_tokens')
