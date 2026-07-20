"""MongoDB database names and current PL season for football data.

Premier League and World Cup match/table collections live in dedicated databases.
Cross-cutting football app data (push subscriptions, chatbot API keys) stays in
``web_database`` with the rest of the site.

Roll the live Premier League season by changing ``CURRENT_PL_SEASON`` (and the
matching standings clamp in the backend worker). Collection names are derived
from that key.
"""

from __future__ import annotations

PL_DATABASE = "pl_database"
WC_DATABASE = "wc_database"
WEB_DATABASE = "web_database"

# Live Premier League season (worker + website defaults + bet). Next rollover: edit this.
CURRENT_PL_SEASON = "2026_2027"

LIVE_PL_TABLE_COLLECTION = "live_pl_table"


def pl_matches_collection_name(season_key: str = CURRENT_PL_SEASON) -> str:
    return f"pl_matches_{season_key}"


def pl_table_collection_name(season_key: str = CURRENT_PL_SEASON) -> str:
    return f"pl_table_{season_key}"
