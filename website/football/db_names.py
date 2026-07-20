"""MongoDB database names for football data.

Premier League and World Cup match/table collections live in dedicated databases.
Cross-cutting football app data (push subscriptions, chatbot API keys) stays in
``web_database`` with the rest of the site.
"""

from __future__ import annotations

PL_DATABASE = "pl_database"
WC_DATABASE = "wc_database"
WEB_DATABASE = "web_database"
