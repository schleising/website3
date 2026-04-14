from datetime import UTC, datetime
import logging
import re

from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError
from motor.motor_asyncio import AsyncIOMotorCollection

from ..database.database import get_data_by_date

from . import pl_matches, pl_table, football_push, mongodb
from .models import Match, LiveTableItem, Team


SEASON_MATCH_COLLECTION_PATTERN = re.compile(r"^pl_matches_\d{4}_\d{4}$")


async def _get_match_collections(include_all_seasons: bool = False) -> list[AsyncIOMotorCollection]:
    if not include_all_seasons:
        return [pl_matches] if pl_matches is not None else []

    collections: list[AsyncIOMotorCollection] = []

    if mongodb.current_db is None:
        return [pl_matches] if pl_matches is not None else []

    collection_names = await mongodb.current_db.list_collection_names()

    for collection_name in sorted(collection_names):
        if SEASON_MATCH_COLLECTION_PATTERN.match(collection_name) is None:
            continue

        collection = mongodb.get_collection(collection_name)
        if collection is not None:
            collections.append(collection)

    if len(collections) == 0 and pl_matches is not None:
        collections.append(pl_matches)

    return collections


async def retreive_matches(date_from: datetime, date_to: datetime) -> list[Match]:
    matches = []

    logging.debug(f"Getting Matches from {date_from} to {date_to}")

    if pl_matches is not None:
        matches = await get_data_by_date(
            pl_matches, "utc_date", date_from, date_to, Match
        )
    else:
        logging.error("No DB connection")

    return matches


async def retreive_team_matches(team_id: int) -> tuple[str, list[Match]]:
    team_name = "Unknown"

    if pl_matches is not None:
        from_db_cursor = pl_matches.find(
            {"$or": [{"home_team.id": team_id}, {"away_team.id": team_id}]}
        ).sort("utc_date", ASCENDING)

        matches = [Match.model_validate(item) async for item in from_db_cursor]
    else:
        matches: list[Match] = []

    # Get the team name from the table db
    if pl_table is not None:
        # Get the team dict from the table db
        team_dict_db = await pl_table.find_one({"team.id": team_id})

        logging.debug(f"Team Dict: {team_dict_db}")

        if team_dict_db is not None:
            item = LiveTableItem.model_validate(team_dict_db)
            team_name = item.team.short_name

    return (team_name, matches)


async def retreive_head_to_head_matches(
    team_a_short_name: str, team_b_short_name: str
) -> list[Match]:
    matches: list[Match] = []

    # Get the matches between the two teams from the database
    if pl_matches is not None:
        from_db_cursor = pl_matches.find(
            {
                "$or": [
                    {
                        "home_team.short_name": team_a_short_name,
                        "away_team.short_name": team_b_short_name,
                    },
                    {
                        "home_team.short_name": team_b_short_name,
                        "away_team.short_name": team_a_short_name,
                    },
                ]
            }
        ).sort("utc_date", ASCENDING)

        matches = [Match.model_validate(item) async for item in from_db_cursor]
    else:
        logging.error("No DB connection")

    return matches


async def retreive_head_to_head_matches_by_id(
    team_a_id: int, team_b_id: int
) -> list[Match]:
    matches: list[Match] = []

    match_collections = await _get_match_collections(include_all_seasons=True)

    if len(match_collections) == 0:
        logging.error("No DB connection")
        return matches

    query = {
        "$or": [
            {
                "home_team.id": team_a_id,
                "away_team.id": team_b_id,
            },
            {
                "home_team.id": team_b_id,
                "away_team.id": team_a_id,
            },
        ]
    }

    for collection in match_collections:
        from_db_cursor = collection.find(query).sort("utc_date", DESCENDING)
        collection_matches = [Match.model_validate(item) async for item in from_db_cursor]
        matches.extend(collection_matches)

    matches.sort(key=lambda match: match.utc_date, reverse=True)

    return matches


async def retreive_all_teams() -> list[Team]:
    teams_by_id: dict[int, Team] = {}

    match_collections = await _get_match_collections(include_all_seasons=True)

    if len(match_collections) == 0:
        logging.error("No DB connection")
        return []

    for collection in match_collections:
        from_db_cursor = collection.find({}, {"home_team": 1, "away_team": 1, "_id": 0})

        async for item in from_db_cursor:
            for field_name in ["home_team", "away_team"]:
                team_dict = item.get(field_name)

                if isinstance(team_dict, dict):
                    team = Team.model_validate(team_dict)
                    teams_by_id[team.id] = team

    return sorted(teams_by_id.values(), key=lambda team: str(team.short_name).lower())


async def retreive_latest_team_match(team: str) -> Match | None:
    match: Match | None = None

    if pl_matches is not None:
        # Get the match for this team with the most recent start time before now
        from_db = await pl_matches.find_one(
            {
                "$or": [{"home_team.short_name": team}, {"away_team.short_name": team}],
                "utc_date": {"$lte": datetime.now(tz=UTC)},
            },
            sort=[("utc_date", DESCENDING)],
        )

        if from_db:
            match = Match.model_validate(from_db)
            logging.debug(f"Latest match for team {team}: {match}")

    else:
        logging.error("No DB connection")

    return match


async def get_table_db() -> list[LiveTableItem]:
    table_list: list[LiveTableItem] = []

    if pl_table is not None:
        table_cursor = pl_table.find({}).sort("position", ASCENDING)

        table_list = [LiveTableItem.model_validate(table_item) async for table_item in table_cursor]

    return table_list


async def add_push_subscription(data: dict) -> bool:
    if football_push is not None:
        try:
            await football_push.insert_one(data)
        except DuplicateKeyError as ex:
            logging.error(f"Error inserting subscription: {ex}")
            return False
    else:
        logging.error("No DB connection")
        return False

    return True


async def delete_push_subscription(data: dict) -> bool:
    if football_push is not None:
        result = await football_push.delete_one(data)
        if result.deleted_count == 0:
            logging.error("No subscription found to delete")
            return False
    else:
        logging.error("No DB connection")
        return False

    return True
