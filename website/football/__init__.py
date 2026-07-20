from ..database.database import Database
from .db_names import (
    LIVE_PL_TABLE_COLLECTION,
    PL_DATABASE,
    WC_DATABASE,
    WEB_DATABASE,
    pl_matches_collection_name,
)

# Get an instance of the Database class
mongodb = Database()

# Premier League collections (live season from CURRENT_PL_SEASON)
pl_matches = mongodb.get_collection(
    pl_matches_collection_name(), db_name=PL_DATABASE
)
pl_table = mongodb.get_collection(LIVE_PL_TABLE_COLLECTION, db_name=PL_DATABASE)
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
