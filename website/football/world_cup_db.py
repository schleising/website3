from __future__ import annotations

import logging
import re
from datetime import UTC, datetime

from pydantic import BaseModel, Field
from pymongo import ASCENDING

from . import mongodb
from .models import Match, MatchStatus, Table, TableItem, Team
from .world_cup_utils import (
    WC_CURRENT_EDITION,
    WC_GROUP_ORDER,
    WC_GROUP_STAGE,
    group_enum_to_slug,
    group_slug_to_enum,
    group_slug_to_label,
    normalise_group_slug,
    standings_label_to_slug,
)

WC_MATCH_COLLECTION_PATTERN = re.compile(r"^wc_matches_(\d{4})$")
WC_STANDINGS_COLLECTION_PATTERN = re.compile(r"^wc_standings_(\d{4})$")


class WorldCupGroupStandings(BaseModel):
    edition: str
    group_slug: str
    group_label: str
    group_enum: str
    table: list[TableItem]


class WorldCupGroupSummary(BaseModel):
    slug: str
    label: str
    table: list[TableItem] = Field(default_factory=list)
    next_match: Match | None = None


def _matches_collection_name(edition: str) -> str:
    return f"wc_matches_{edition}"


def _standings_collection_name(edition: str) -> str:
    return f"wc_standings_{edition}"


async def _list_collection_names() -> list[str]:
    if mongodb.current_db is None:
        return []

    return await mongodb.current_db.list_collection_names()


async def get_available_wc_editions() -> list[str]:
    editions: list[str] = []

    for collection_name in await _list_collection_names():
        matched = WC_MATCH_COLLECTION_PATTERN.match(collection_name)
        if matched is not None:
            editions.append(matched.group(1))

    return sorted(editions, reverse=True)


async def world_cup_nav_available() -> bool:
    return len(await get_available_wc_editions()) > 0


async def infer_current_wc_edition() -> str:
    editions = await get_available_wc_editions()
    if WC_CURRENT_EDITION in editions:
        return WC_CURRENT_EDITION
    if len(editions) > 0:
        return editions[0]
    return WC_CURRENT_EDITION


def _get_matches_collection(edition: str):
    return mongodb.get_collection(_matches_collection_name(edition))


def _get_standings_collection(edition: str):
    return mongodb.get_collection(_standings_collection_name(edition))


async def retrieve_group_matches(edition: str, group_slug: str) -> list[Match]:
    collection = _get_matches_collection(edition)
    if collection is None:
        logging.error("No WC match collection for edition %s", edition)
        return []

    group_enum = group_slug_to_enum(group_slug)
    cursor = collection.find(
        {"stage": WC_GROUP_STAGE, "group": group_enum}
    ).sort([("matchday", ASCENDING), ("utc_date", ASCENDING)])

    return [Match.model_validate(item) async for item in cursor]


async def retrieve_group_standings(edition: str, group_slug: str) -> WorldCupGroupStandings | None:
    collection = _get_standings_collection(edition)
    if collection is None:
        logging.error("No WC standings collection for edition %s", edition)
        return None

    slug = normalise_group_slug(group_slug)
    document = await collection.find_one({"group_slug": slug, "edition": edition})
    if document is None:
        return None

    return WorldCupGroupStandings.model_validate(document)


async def retrieve_all_group_standings(edition: str) -> list[WorldCupGroupStandings]:
    collection = _get_standings_collection(edition)
    if collection is None:
        return []

    cursor = collection.find({"edition": edition}).sort("group_slug", ASCENDING)
    standings = [WorldCupGroupStandings.model_validate(item) async for item in cursor]

    if len(standings) > 0:
        return standings

    return await _compute_group_standings_from_matches(edition)


async def _compute_group_standings_from_matches(edition: str) -> list[WorldCupGroupStandings]:
    collection = _get_matches_collection(edition)
    if collection is None:
        return []

    discovered_slugs: set[str] = set()
    cursor = collection.find({"stage": WC_GROUP_STAGE, "group": {"$ne": None}})
    async for item in cursor:
        group_value = item.get("group")
        if isinstance(group_value, str):
            discovered_slugs.add(group_enum_to_slug(group_value))

    ordered_slugs = [slug for slug in WC_GROUP_ORDER if slug in discovered_slugs]
    ordered_slugs.extend(sorted(discovered_slugs - set(ordered_slugs)))

    return [
        WorldCupGroupStandings(
            edition=edition,
            group_slug=slug,
            group_label=group_slug_to_label(slug),
            group_enum=group_slug_to_enum(slug),
            table=[],
        )
        for slug in ordered_slugs
    ]


def _unique_teams(teams: list[Team]) -> list[Team]:
    teams_by_id: dict[int, Team] = {}

    for team in teams:
        if team.id is not None:
            teams_by_id[team.id] = team

    return list(teams_by_id.values())


def _extract_teams_from_matches(matches: list[Match]) -> list[Team]:
    teams: list[Team] = []

    for match in matches:
        teams.extend((match.home_team, match.away_team))

    return _unique_teams(teams)


def _build_placeholder_table_items(teams: list[Team]) -> list[TableItem]:
    ordered_teams = sorted(teams, key=lambda team: team.display_name.casefold())

    return [
        TableItem(
            position=index,
            team=team,
            played_games=0,
            won=0,
            draw=0,
            lost=0,
            points=0,
            goals_for=0,
            goals_against=0,
            goal_difference=0,
        )
        for index, team in enumerate(ordered_teams, start=1)
    ]


def _group_has_results(table: list[TableItem]) -> bool:
    return any(item.played_games > 0 for item in table)


def normalise_group_table(table: list[TableItem], matches: list[Match]) -> list[TableItem]:
    if len(table) == 0:
        teams = _extract_teams_from_matches(matches)
        if len(teams) == 0:
            return []
        return _build_placeholder_table_items(teams)

    if not _group_has_results(table):
        return _build_placeholder_table_items(_unique_teams([item.team for item in table]))

    return table


async def list_group_summaries(edition: str) -> list[WorldCupGroupSummary]:
    standings = await retrieve_all_group_standings(edition)
    summaries: list[WorldCupGroupSummary] = []

    for group in standings:
        matches = await retrieve_group_matches(edition, group.group_slug)
        next_match = _select_next_match(matches)
        summaries.append(
            WorldCupGroupSummary(
                slug=group.group_slug,
                label=group.group_label,
                table=normalise_group_table(group.table, matches),
                next_match=next_match,
            )
        )

    return summaries


def _as_utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _select_next_match(matches: list[Match]) -> Match | None:
    now = datetime.now(UTC)
    terminal_statuses = {
        MatchStatus.finished,
        MatchStatus.cancelled,
        MatchStatus.awarded,
    }
    upcoming = [
        match
        for match in matches
        if match.status not in terminal_statuses
        and _as_utc_datetime(match.utc_date) >= now
    ]
    if len(upcoming) > 0:
        return upcoming[0]

    if all(match.status in terminal_statuses for match in matches):
        return None

    return matches[0] if len(matches) > 0 else None


def standings_from_api_table(table: Table) -> list[WorldCupGroupStandings]:
    groups: list[WorldCupGroupStandings] = []

    for standing in table.standings:
        if standing.group is None:
            continue

        slug = standings_label_to_slug(standing.group)
        groups.append(
            WorldCupGroupStandings(
                edition=str(table.filters.season),
                group_slug=slug,
                group_label=standing.group,
                group_enum=group_slug_to_enum(slug),
                table=standing.table,
            )
        )

    groups.sort(key=lambda item: item.group_slug)
    return groups
