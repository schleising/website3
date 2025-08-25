from datetime import UTC, datetime
import logging

from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

from ..database.database import get_data_by_date

from . import pl_matches, pl_table, football_push
from .models import Match, LiveTableItem


async def retreive_matches(date_from: datetime, date_to: datetime) -> list[Match]:
    matches: list[Match] = []

    logging.debug(f"Getting Matches from {date_from} to {date_to}")

    if pl_matches is not None:
        matches: list[Match] = await get_data_by_date(
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

        matches = [Match(**item) async for item in from_db_cursor]
    else:
        matches: list[Match] = []

    # Get the team name from the table db
    if pl_table is not None:
        # Get the team dict from the table db
        team_dict_db = await pl_table.find_one({"team.id": team_id})

        logging.debug(f"Team Dict: {team_dict_db}")

        if team_dict_db is not None:
            item = LiveTableItem(**team_dict_db)
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

        matches = [Match(**item) async for item in from_db_cursor]
    else:
        logging.error("No DB connection")

    return matches


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
            logging.info(f"Latest match for team {team}: {match}")

    else:
        logging.error("No DB connection")

    return match


async def get_table_db() -> list[LiveTableItem]:
    table_list: list[LiveTableItem] = []

    if pl_table is not None:
        table_cursor = pl_table.find({}).sort("position", ASCENDING)

        table_list = [LiveTableItem(**table_item) async for table_item in table_cursor]

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
