from datetime import UTC, datetime
import logging
import re

from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError
from motor.motor_asyncio import AsyncIOMotorCollection

from ..database.database import get_data_by_date

from . import pl_matches, pl_table, football_push, team_primary_colours, mongodb
from .models import (
    FormItem,
    Match,
    LiveTableItem,
    Team,
    PushSubscription,
    PushSubscriptionDocument,
)


SEASON_KEY_PATTERN = re.compile(r"^\d{4}_\d{4}$")
SEASON_MATCH_COLLECTION_PATTERN = re.compile(r"^pl_matches_(\d{4}_\d{4})$")
SEASON_TABLE_COLLECTION_PATTERN = re.compile(r"^pl_table_(\d{4}_\d{4})$")
FORM_RESULT_CLASS = {
    "W": "form-win",
    "D": "form-draw",
    "L": "form-loss",
}
FIRST_PREMIER_LEAGUE_SEASON_START_YEAR = 1992
_PUSH_SUBSCRIPTION_INDEXES_READY = False


def _season_matches_collection_name(season_key: str) -> str:
    return f"pl_matches_{season_key}"


def _season_table_collection_name(season_key: str) -> str:
    return f"pl_table_{season_key}"


def _season_sort_value(season_key: str) -> int:
    return int(season_key.split("_")[0])


def _season_year_label(season_key: str) -> str:
    season_start, season_end = season_key.split("_", maxsplit=1)
    if season_start[:2] != season_end[:2]:
        return f"{season_start}-{season_end}"

    return f"{season_start}-{season_end[-2:]}"


def get_competition_name_for_season(season_key: str) -> str:
    season_start, _ = season_key.split("_", maxsplit=1)
    season_start_year = int(season_start)
    if season_start_year < FIRST_PREMIER_LEAGUE_SEASON_START_YEAR:
        return "Division 1"

    return "Premier League"


def get_season_label(season_key: str) -> str:
    return f"{get_competition_name_for_season(season_key)} {_season_year_label(season_key)}"


def get_season_short_label(season_key: str) -> str:
    return _season_year_label(season_key)


def _build_form_list(form_value: str | None) -> list[FormItem]:
    if form_value is None:
        return []

    compact_form = str(form_value).upper().replace(",", "").replace(" ", "")
    parsed_results = [result for result in compact_form if result in FORM_RESULT_CLASS]

    return [
        FormItem(character=result, css_class=FORM_RESULT_CLASS[result])
        for result in parsed_results
    ]


def _normalise_table_form_items(table_list: list[LiveTableItem]) -> None:
    for table_item in table_list:
        if len(table_item.form_list) > 0:
            continue

        table_item.form_list = _build_form_list(table_item.form)


def infer_current_season_key(available_season_keys: list[str]) -> str:
    now = datetime.now(tz=UTC)
    season_start_year = now.year if now.month >= 8 else now.year - 1
    guessed_current = f"{season_start_year}_{season_start_year + 1}"

    if guessed_current in available_season_keys:
        return guessed_current

    if len(available_season_keys) > 0:
        return max(available_season_keys, key=_season_sort_value)

    return guessed_current


async def get_available_season_keys() -> list[str]:
    if mongodb.current_db is None:
        if pl_matches is None:
            return []

        matched = SEASON_MATCH_COLLECTION_PATTERN.match(pl_matches.name)
        return [matched.group(1)] if matched else []

    collection_names = await mongodb.current_db.list_collection_names()
    season_keys: list[str] = []

    for collection_name in collection_names:
        matched = SEASON_MATCH_COLLECTION_PATTERN.match(collection_name)
        if matched is not None:
            season_keys.append(matched.group(1))

    return sorted(set(season_keys), key=_season_sort_value, reverse=True)


def _get_match_collection_for_season(
    season_key: str | None = None,
) -> AsyncIOMotorCollection | None:
    if season_key is not None and SEASON_KEY_PATTERN.match(season_key) is not None:
        return mongodb.get_collection(_season_matches_collection_name(season_key))

    return pl_matches


def _get_table_collection_for_season(
    season_key: str | None = None,
) -> AsyncIOMotorCollection | None:
    if season_key is not None and SEASON_KEY_PATTERN.match(season_key) is not None:
        return mongodb.get_collection(_season_table_collection_name(season_key))

    return pl_table


async def _get_match_collections(include_all_seasons: bool = False) -> list[AsyncIOMotorCollection]:
    if not include_all_seasons:
        return [pl_matches] if pl_matches is not None else []

    collections: list[AsyncIOMotorCollection] = []

    for season_key in await get_available_season_keys():
        collection = mongodb.get_collection(_season_matches_collection_name(season_key))
        if collection is not None:
            collections.append(collection)

    if len(collections) == 0 and pl_matches is not None:
        collections.append(pl_matches)

    return collections


async def retreive_matches(
    date_from: datetime, date_to: datetime, season_key: str | None = None
) -> list[Match]:
    matches = []

    logging.debug(f"Getting Matches from {date_from} to {date_to} for season {season_key}")

    collection = _get_match_collection_for_season(season_key)

    if collection is not None:
        matches = await get_data_by_date(
            collection, "utc_date", date_from, date_to, Match
        )
    else:
        logging.error("No DB connection")

    return matches


async def retreive_team_matches(
    team_id: int, season_key: str | None = None
) -> tuple[str, list[Match]]:
    team_name = "Unknown"

    collection = _get_match_collection_for_season(season_key)

    if collection is not None:
        from_db_cursor = collection.find(
            {"$or": [{"home_team.id": team_id}, {"away_team.id": team_id}]}
        ).sort("utc_date", ASCENDING)

        matches = [Match.model_validate(item) async for item in from_db_cursor]

        if len(matches) > 0:
            sample = matches[0]
            if sample.home_team.id == team_id:
                team_name = str(sample.home_team.short_name)
            elif sample.away_team.id == team_id:
                team_name = str(sample.away_team.short_name)
    else:
        matches: list[Match] = []

    # Fallback to table lookup when no match data was found.
    table_collection = _get_table_collection_for_season(season_key)
    if team_name == "Unknown" and table_collection is not None:
        # Get the team dict from the table db
        team_dict_db = await table_collection.find_one({"team.id": team_id})

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


async def retreive_team_primary_colours(team_ids: list[int]) -> dict[int, str]:
    colours_by_team_id: dict[int, str] = {}

    if len(team_ids) == 0:
        return colours_by_team_id

    if team_primary_colours is None:
        logging.error("No DB connection")
        return colours_by_team_id

    cursor = team_primary_colours.find(
        {
            "team_id": {"$in": team_ids},
            "primary_colour": {"$type": "string"},
        },
        {"_id": 0, "team_id": 1, "primary_colour": 1},
    )

    async for item in cursor:
        team_id_raw = item.get("team_id")
        colour_raw = str(item.get("primary_colour", "")).strip()

        if team_id_raw is None:
            continue

        if re.fullmatch(r"#[0-9A-Fa-f]{6}", colour_raw) is None:
            continue

        colours_by_team_id[int(team_id_raw)] = colour_raw.upper()

    return colours_by_team_id


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

    table_collection = _get_table_collection_for_season(None)

    if table_collection is not None:
        table_cursor = table_collection.find({}).sort("position", ASCENDING)

        table_list = [
            LiveTableItem.model_validate(table_item) async for table_item in table_cursor
        ]

    _normalise_table_form_items(table_list)

    return table_list


async def get_table_db_for_season(season_key: str | None = None) -> list[LiveTableItem]:
    table_list: list[LiveTableItem] = []

    table_collection = _get_table_collection_for_season(season_key)

    if table_collection is not None:
        table_cursor = table_collection.find({}).sort("position", ASCENDING)

        table_list = [
            LiveTableItem.model_validate(table_item) async for table_item in table_cursor
        ]

    # Fallback to live table only for current season if seasonal table is empty.
    if len(table_list) == 0 and pl_table is not None and season_key is not None:
        available_season_keys = await get_available_season_keys()
        current_season_key = infer_current_season_key(available_season_keys)

        if season_key == current_season_key:
            table_cursor = pl_table.find({}).sort("position", ASCENDING)

            table_list = [
                LiveTableItem.model_validate(table_item) async for table_item in table_cursor
            ]

    _normalise_table_form_items(table_list)

    return table_list


async def _ensure_push_subscription_indexes() -> None:
    global _PUSH_SUBSCRIPTION_INDEXES_READY

    if _PUSH_SUBSCRIPTION_INDEXES_READY:
        return

    if football_push is None:
        return

    await football_push.create_index("subscription.endpoint", unique=True)
    await football_push.create_index("team_ids")
    _PUSH_SUBSCRIPTION_INDEXES_READY = True


def _subscription_query(subscription: PushSubscription) -> dict:
    return {"subscription.endpoint": subscription.endpoint}


async def upsert_push_subscription(subscription_doc: PushSubscriptionDocument) -> bool:
    if football_push is None:
        logging.error("No DB connection")
        return False

    await _ensure_push_subscription_indexes()

    now = datetime.now(tz=UTC)
    team_ids = sorted(set(subscription_doc.team_ids))

    try:
        await football_push.update_one(
            _subscription_query(subscription_doc.subscription),
            {
                "$set": {
                    "subscription": subscription_doc.subscription.model_dump(
                        by_alias=True, exclude_none=True
                    ),
                    "team_ids": team_ids,
                    "username": subscription_doc.username,
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "created_at": now,
                },
            },
            upsert=True,
        )
    except DuplicateKeyError as ex:
        logging.error(f"Error upserting subscription: {ex}")
        return False

    return True


async def get_push_subscription(
    subscription: PushSubscription,
) -> PushSubscriptionDocument | None:
    if football_push is None:
        logging.error("No DB connection")
        return None

    await _ensure_push_subscription_indexes()
    existing = await football_push.find_one(_subscription_query(subscription))

    if existing is None:
        return None

    return PushSubscriptionDocument.model_validate(existing)


async def delete_push_subscription(subscription: PushSubscription) -> bool:
    if football_push is None:
        logging.error("No DB connection")
        return False

    await _ensure_push_subscription_indexes()
    result = await football_push.delete_one(_subscription_query(subscription))

    if result.deleted_count == 0:
        logging.error("No subscription found to delete")
        return False

    return True


async def get_push_subscriptions_for_team_ids(
    team_ids: list[int],
) -> list[PushSubscriptionDocument]:
    if football_push is None:
        logging.error("No DB connection")
        return []

    await _ensure_push_subscription_indexes()
    unique_team_ids = sorted(set(team_ids))

    if len(unique_team_ids) == 0:
        return []

    cursor = football_push.find({"team_ids": {"$in": unique_team_ids}})
    return [
        PushSubscriptionDocument.model_validate(item)
        async for item in cursor
    ]
