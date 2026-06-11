from ..database.database import Database

# Get an instance of the Database class
mongodb = Database()

# Set the database in use
mongodb.set_database('web_database')

# Set the collection in use
pl_matches = mongodb.get_collection('pl_matches_2025_2026')

# Set the collection in use
pl_table = mongodb.get_collection('live_pl_table')

# World Cup live standings for the current edition (mirrors live_pl_table)
live_wc_standings = mongodb.get_collection('live_wc_standings_2026')

# Set the collection for push subscriptions
football_push = mongodb.get_collection('football_push_subscriptions')

# Set the collection for team primary colours
team_primary_colours = mongodb.get_collection('pl_team_primary_colours')

# Set the collection for football history chatbot API keys
football_api_keys = mongodb.get_collection('football_chatbot_api_keys')
