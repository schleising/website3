from ..database.database import Database
from .db_names import PL_DATABASE, WC_DATABASE, WEB_DATABASE

# Get an instance of the Database class
mongodb = Database()

# Premier League collections
pl_matches = mongodb.get_collection("pl_matches_2025_2026", db_name=PL_DATABASE)
pl_table = mongodb.get_collection("live_pl_table", db_name=PL_DATABASE)
team_primary_colours = mongodb.get_collection(
    "pl_team_primary_colours", db_name=PL_DATABASE
)

# World Cup live standings for the latest edition (mirrors live_pl_table)
live_wc_standings = mongodb.get_collection(
    "live_wc_standings_2026", db_name=WC_DATABASE
)

# Cross-cutting football app data remains on web_database
football_push = mongodb.get_collection(
    "football_push_subscriptions", db_name=WEB_DATABASE
)
football_api_keys = mongodb.get_collection(
    "football_chatbot_api_keys", db_name=WEB_DATABASE
)
