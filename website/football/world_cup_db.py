from __future__ import annotations

import logging
import re
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field
from pymongo import ASCENDING

from ..database.database import get_data_by_date
from . import mongodb
from .models import Match, MatchStatus, Table, TableItem, Team
from .world_cup_utils import (
    WC_CURRENT_EDITION,
    WC_GROUP_ORDER,
    WC_GROUP_STAGE,
    WC_KNOCKOUT_OVERVIEW_ORDER,
    WC_KNOCKOUT_ROUNDS,
    WC_2026_KNOCKOUT_BRACKET_ORDER,
    bracket_team_label,
    group_enum_to_slug,
    group_slug_to_enum,
    group_slug_to_label,
    identify_knockout_fixture_number,
    knockout_winner_side,
    normalise_group_slug,
    filter_confirmed_knockout_matches,
    order_knockout_matches_for_bracket,
    resolve_world_cup_crest_url,
    standings_label_to_slug,
    team_is_confirmed,
    WC_CREST_UNKNOWN_URL,
)

WC_MATCH_COLLECTION_PATTERN = re.compile(r"^wc_matches_(\d{4})$")
BRACKET_CARD_GRID_ROWS = 2
THIRD_PLACE_LABEL_GRID_ROWS = 1
THIRD_PLACE_GAP_GRID_ROWS = 2
WC_STANDINGS_COLLECTION_PATTERN = re.compile(r"^wc_standings_(\d{4})$")
WC_LIVE_DAYS_BEFORE_TODAY = 7
WC_LIVE_DAYS_AFTER_TODAY = 6
LONDON_TZ = ZoneInfo("Europe/London")


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


class WorldCupKnockoutRound(BaseModel):
    slug: str
    stage: str
    label: str
    matches: list[Match] = Field(default_factory=list)


class WorldCupOverviewGroupBlock(BaseModel):
    slug: str
    label: str
    table: list[TableItem] = Field(default_factory=list)
    matches: list[Match] = Field(default_factory=list)


class BracketSlot(BaseModel):
    match: Match
    home_label: str = "TBD"
    away_label: str = "TBD"
    home_crest: str = WC_CREST_UNKNOWN_URL
    away_crest: str = WC_CREST_UNKNOWN_URL
    grid_row_start: int = 1
    grid_row_span: int = 1


class BracketConnector(BaseModel):
    grid_row_start: int = 1
    grid_row_span: int = 1
    top_fraction: float = 0.25
    bottom_fraction: float = 0.75
    exit_fraction: float = 0.5
    exit_grid_row_start: int = 1
    exit_grid_row_span: int = 1


class BracketRoundColumn(BaseModel):
    slug: str
    label: str
    round_url: str
    slots: list[BracketSlot] = Field(default_factory=list)
    connectors: list[BracketConnector] = Field(default_factory=list)


class KnockoutBracketDiagram(BaseModel):
    grid_rows: int = 1
    rounds: list[BracketRoundColumn] = Field(default_factory=list)
    third_place: BracketSlot | None = None


WC_BRACKET_ROUND_STAGES: tuple[tuple[str, str, str], ...] = (
    ("LAST_32", "round-of-32", "Round of 32"),
    ("LAST_16", "round-of-16", "Round of 16"),
    ("QUARTER_FINALS", "quarter-finals", "Quarter-finals"),
    ("SEMI_FINALS", "semi-finals", "Semi-finals"),
    ("FINAL", "final", "Final"),
)


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


def _wc_live_scores_window() -> tuple[datetime, datetime]:
    today_start = datetime.now(tz=LONDON_TZ).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    window_start = today_start - timedelta(days=WC_LIVE_DAYS_BEFORE_TODAY)
    window_end = (today_start + timedelta(days=WC_LIVE_DAYS_AFTER_TODAY)).replace(
        hour=23, minute=59, second=59, microsecond=0
    )
    return window_start, window_end


def _wc_today_scores_window() -> tuple[datetime, datetime]:
    today_start = datetime.now(tz=LONDON_TZ).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    today_end = today_start.replace(hour=23, minute=59, second=59, microsecond=0)
    return today_start, today_end


async def retrieve_matches_in_window(
    edition: str, date_from: datetime, date_to: datetime
) -> list[Match]:
    collection = _get_matches_collection(edition)
    if collection is None:
        logging.error("No WC match collection for edition %s", edition)
        return []

    return await get_data_by_date(collection, "utc_date", date_from, date_to, Match)


async def retrieve_live_score_matches(
    edition: str, *, current_day_only: bool = False
) -> list[Match]:
    if current_day_only:
        start_date, end_date = _wc_today_scores_window()
    else:
        start_date, end_date = _wc_live_scores_window()

    return await retrieve_matches_in_window(edition, start_date, end_date)


async def retrieve_all_edition_matches(edition: str) -> list[Match]:
    collection = _get_matches_collection(edition)
    if collection is None:
        logging.error("No WC match collection for edition %s", edition)
        return []

    cursor = collection.find({}).sort("utc_date", ASCENDING)
    return [Match.model_validate(item) async for item in cursor]


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


async def retrieve_distinct_knockout_stages(edition: str) -> set[str]:
    collection = _get_matches_collection(edition)
    if collection is None:
        return set()

    knockout_stages = [stage for stage, _, _ in WC_KNOCKOUT_ROUNDS]
    cursor = collection.find({"stage": {"$in": knockout_stages}}, {"stage": 1})
    stages: set[str] = set()
    async for item in cursor:
        stage_value = item.get("stage")
        if isinstance(stage_value, str):
            stages.add(stage_value)

    return stages


async def retrieve_team_matches(edition: str, team_id: int) -> tuple[str, list[Match]]:
    collection = _get_matches_collection(edition)
    if collection is None:
        logging.error("No WC match collection for edition %s", edition)
        return ("", [])

    cursor = collection.find(
        {
            "$or": [
                {"home_team.id": team_id},
                {"away_team.id": team_id},
            ]
        }
    ).sort("utc_date", ASCENDING)
    matches = [Match.model_validate(item) async for item in cursor]
    if len(matches) == 0:
        return ("", [])

    team_name = ""
    for match in matches:
        if match.home_team.id == team_id:
            team_name = match.home_team.display_name
            break
        if match.away_team.id == team_id:
            team_name = match.away_team.display_name
            break

    return (team_name, matches)


async def retrieve_knockout_matches(edition: str, stage: str) -> list[Match]:
    collection = _get_matches_collection(edition)
    if collection is None:
        logging.error("No WC match collection for edition %s", edition)
        return []

    cursor = collection.find({"stage": stage}).sort("utc_date", ASCENDING)
    return [Match.model_validate(item) async for item in cursor]


async def list_available_knockout_rounds(edition: str) -> list[WorldCupKnockoutRound]:
    present_stages = await retrieve_distinct_knockout_stages(edition)
    rounds: list[WorldCupKnockoutRound] = []

    for stage, round_slug, label in WC_KNOCKOUT_ROUNDS:
        if stage not in present_stages:
            continue

        matches = filter_confirmed_knockout_matches(
            await retrieve_knockout_matches(edition, stage)
        )
        if len(matches) == 0:
            continue

        rounds.append(
            WorldCupKnockoutRound(
                slug=round_slug,
                stage=stage,
                label=label,
                matches=matches,
            )
        )

    return rounds


async def build_overview_knockout_sections(edition: str) -> list[WorldCupKnockoutRound]:
    sections: list[WorldCupKnockoutRound] = []

    for stage, round_slug, label in WC_KNOCKOUT_OVERVIEW_ORDER:
        matches = filter_confirmed_knockout_matches(
            await retrieve_knockout_matches(edition, stage)
        )
        if len(matches) == 0:
            continue

        sections.append(
            WorldCupKnockoutRound(
                slug=round_slug,
                stage=stage,
                label=label,
                matches=matches,
            )
        )

    return sections


async def build_overview_group_blocks(edition: str) -> list[WorldCupOverviewGroupBlock]:
    standings = await retrieve_all_group_standings(edition)
    blocks: list[WorldCupOverviewGroupBlock] = []

    for group in standings:
        matches = await retrieve_group_matches(edition, group.group_slug)
        blocks.append(
            WorldCupOverviewGroupBlock(
                slug=group.group_slug,
                label=group.group_label,
                table=normalise_group_table(group.table, matches),
                matches=matches,
            )
        )

    return blocks


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


def _bracket_slot_from_match(
    match: Match,
    *,
    stage: str,
    fixture_number: int | None,
    grid_row_start: int,
    grid_row_span: int,
) -> BracketSlot:
    return BracketSlot(
        match=match,
        home_label=bracket_team_label(
            match.home_team,
            stage=stage,
            fixture_number=fixture_number,
            side="home",
        ),
        away_label=bracket_team_label(
            match.away_team,
            stage=stage,
            fixture_number=fixture_number,
            side="away",
        ),
        home_crest=match.home_team.world_cup_local_crest,
        away_crest=match.away_team.world_cup_local_crest,
        grid_row_start=grid_row_start,
        grid_row_span=grid_row_span,
    )


def _bracket_grid_position(match_index: int, round_index: int) -> tuple[int, int]:
    """Place each card on a fine grid; round-of-32 slots stack back-to-back."""
    card_rows = BRACKET_CARD_GRID_ROWS
    if round_index == 0:
        return 1 + match_index * card_rows, card_rows

    top_start, top_span = _bracket_grid_position(2 * match_index, round_index - 1)
    bottom_start, bottom_span = _bracket_grid_position(
        2 * match_index + 1,
        round_index - 1,
    )
    top_center = _bracket_row_center(top_start, top_span)
    bottom_center = _bracket_row_center(bottom_start, bottom_span)
    card_center = (top_center + bottom_center) / 2
    card_start = int(card_center - (card_rows - 1) / 2)
    return card_start, card_rows


def _bracket_grid_row_count(first_round_match_count: int) -> int:
    return first_round_match_count * BRACKET_CARD_GRID_ROWS


def _third_place_grid_position(final_round_index: int) -> tuple[int, int]:
    final_row_start, final_row_span = _bracket_grid_position(0, final_round_index)
    third_place_span = THIRD_PLACE_LABEL_GRID_ROWS + BRACKET_CARD_GRID_ROWS
    row_start = final_row_start + final_row_span + THIRD_PLACE_GAP_GRID_ROWS
    return row_start, third_place_span


def _bracket_row_center(row_start: int, row_span: int) -> float:
    return row_start + (row_span - 1) / 2


def _bracket_connector_metrics(
    child_match_index: int,
    round_index: int,
) -> tuple[int, int, float, float, float, int, int]:
    top_row_start, top_row_span = _bracket_grid_position(child_match_index, round_index)
    bottom_row_start, bottom_row_span = _bracket_grid_position(
        child_match_index + 1,
        round_index,
    )
    row_start = top_row_start
    row_span = bottom_row_start + bottom_row_span - top_row_start

    top_center = _bracket_row_center(top_row_start, top_row_span)
    bottom_center = _bracket_row_center(bottom_row_start, bottom_row_span)
    parent_index = child_match_index // 2
    parent_row_start, parent_row_span = _bracket_grid_position(
        parent_index,
        round_index + 1,
    )
    exit_center = _bracket_row_center(parent_row_start, parent_row_span)

    def centre_fraction(center: float) -> float:
        return (center - row_start + 0.5) / row_span

    return (
        row_start,
        row_span,
        centre_fraction(top_center),
        centre_fraction(bottom_center),
        centre_fraction(exit_center),
        parent_row_start,
        parent_row_span,
    )


def _bracket_connectors_for_round(
    match_count: int,
    round_index: int,
) -> list[BracketConnector]:
    connectors: list[BracketConnector] = []
    for child_match_index in range(0, match_count, 2):
        (
            row_start,
            row_span,
            top_fraction,
            bottom_fraction,
            exit_fraction,
            exit_grid_row_start,
            exit_grid_row_span,
        ) = _bracket_connector_metrics(child_match_index, round_index)
        connectors.append(
            BracketConnector(
                grid_row_start=row_start,
                grid_row_span=row_span,
                top_fraction=top_fraction,
                bottom_fraction=bottom_fraction,
                exit_fraction=exit_fraction,
                exit_grid_row_start=exit_grid_row_start,
                exit_grid_row_span=exit_grid_row_span,
            )
        )
    return connectors


async def build_knockout_bracket_diagram(
    edition: str,
    *,
    football_root: str = "/football/",
) -> KnockoutBracketDiagram | None:
    stage_matches: list[tuple[tuple[str, str, str], list[Match]]] = []

    for stage_meta in WC_BRACKET_ROUND_STAGES:
        stage, round_slug, label = stage_meta
        matches = await retrieve_knockout_matches(edition, stage)
        if len(matches) == 0:
            continue
        stage_matches.append((stage_meta, matches))

    if len(stage_matches) == 0:
        return None

    first_round_count = len(stage_matches[0][1])
    grid_rows = max(BRACKET_CARD_GRID_ROWS, _bracket_grid_row_count(first_round_count))
    rounds: list[BracketRoundColumn] = []

    for round_index, ((stage, round_slug, label), matches) in enumerate(stage_matches):
        ordered_matches = order_knockout_matches_for_bracket(stage, matches)
        slots: list[BracketSlot] = []
        bracket_order = WC_2026_KNOCKOUT_BRACKET_ORDER.get(stage, ())
        for match_index, match in enumerate(ordered_matches):
            row_start, row_span = _bracket_grid_position(match_index, round_index)
            fixture_number = identify_knockout_fixture_number(stage, match)
            if fixture_number is None and match_index < len(bracket_order):
                fixture_number = bracket_order[match_index]
            slots.append(
                _bracket_slot_from_match(
                    match,
                    stage=stage,
                    fixture_number=fixture_number,
                    grid_row_start=row_start,
                    grid_row_span=row_span,
                )
            )

        rounds.append(
            BracketRoundColumn(
                slug=round_slug,
                label=label,
                round_url=f"{football_root}world-cup/knockout/{round_slug}/?edition={edition}",
                slots=slots,
                connectors=_bracket_connectors_for_round(len(slots), round_index),
            )
        )

    third_place_slot: BracketSlot | None = None
    third_place_matches = await retrieve_knockout_matches(edition, "THIRD_PLACE")
    if len(third_place_matches) > 0:
        third_place_match = third_place_matches[0]
        third_place_fixture = identify_knockout_fixture_number(
            "THIRD_PLACE",
            third_place_match,
        )
        if third_place_fixture is None:
            third_place_fixture = 103
        final_round_index = len(rounds) - 1
        third_place_row_start, third_place_span = _third_place_grid_position(
            final_round_index
        )
        grid_rows = max(
            grid_rows,
            third_place_row_start + third_place_span - 1,
        )
        third_place_slot = _bracket_slot_from_match(
            third_place_match,
            stage="THIRD_PLACE",
            fixture_number=third_place_fixture,
            grid_row_start=third_place_row_start,
            grid_row_span=third_place_span,
        )

    return KnockoutBracketDiagram(
        grid_rows=grid_rows,
        rounds=rounds,
        third_place=third_place_slot,
    )


async def retrieve_distinct_teams(edition: str) -> list[Team]:
    collection = _get_matches_collection(edition)
    if collection is None:
        return []

    teams_by_id: dict[int, Team] = {}
    cursor = collection.find({}, {"home_team": 1, "away_team": 1})

    async for document in cursor:
        for field_name in ("home_team", "away_team"):
            team_data = document.get(field_name)
            if not isinstance(team_data, dict):
                continue

            team_id = team_data.get("id")
            if not isinstance(team_id, int) or team_id <= 0:
                continue

            teams_by_id[team_id] = Team.model_validate(team_data)

    return sorted(teams_by_id.values(), key=lambda team: team.display_name.casefold())
