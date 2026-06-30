from __future__ import annotations

import logging
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel, Field
from pymongo import ASCENDING

from ..database.database import get_data_by_date
from . import live_wc_standings, mongodb
from .models import LiveTableItem, Match, MatchStatus, Table, TableItem, Team
from .world_cup_utils import (
    WC_CURRENT_EDITION,
    WC_GROUP_STAGE,
    edition_has_group_stage,
    edition_has_knockout_stage,
    edition_hides_goal_difference_column,
    edition_in_group_playoff_era,
    filter_group_playoffs_from_knockout_matches,
    find_group_playoff_match,
    group_playoff_round_label,
    is_final_group_stage_group,
    is_last_group_stage_group,
    is_legacy_group_playoff_match,
    build_group_team_ids_by_slug,
    knockout_qualifier_team_ids_from_group,
    list_group_playoff_matches_for_edition,
    playoff_participant_team_ids,
    sort_group_table_rows,
    project_head_to_head_stats,
    h2h_only_outranks,
    group_order_for_edition,
    group_stages_for_edition,
    group_index_stages_for_edition,
    group_stage_overview_anchor,
    overview_group_stages_for_edition,
    WC_KNOCKOUT_OVERVIEW_ORDER,
    WC_KNOCKOUT_ROUNDS,
    bracket_team_label,
    group_enum_to_slug,
    group_slug_to_enum,
    group_slug_to_label,
    bracket_fixture_number_for_match,
    identify_knockout_fixture_number,
    knockout_winner_side,
    normalise_group_slug,
    filter_confirmed_knockout_matches,
    filter_superseded_knockout_replays,
    order_knockout_stages_for_bracket,
    resolve_2026_knockout_fixture_maps,
    merge_knockout_fixture_maps,
    apply_knockout_feeder_teams,
    resolve_world_cup_crest_url,
    standings_label_to_slug,
    team_is_confirmed,
    WC_CREST_UNKNOWN_URL,
    wc_tournament_day_end_utc,
    wc_tournament_day_start_utc,
    wc_tournament_today,
)

WC_MATCH_COLLECTION_PATTERN = re.compile(r"^wc_matches_(\d{4})$")
BRACKET_CARD_GRID_ROWS = 2
THIRD_PLACE_LABEL_GRID_ROWS = 1
THIRD_PLACE_GAP_GRID_ROWS = 2
WC_STANDINGS_COLLECTION_PATTERN = re.compile(r"^wc_standings_(\d{4})$")
WC_LIVE_STANDINGS_COLLECTION_PATTERN = re.compile(r"^live_wc_standings_(\d{4})$")
WC_LIVE_DAYS_BEFORE_TODAY = 7
WC_LIVE_DAYS_AFTER_TODAY = 6
WC_CURRENT_GROUP_QUALIFICATION_SPOTS = 2
WC_BEST_THIRD_PLACE_SPOTS = 8
WC_CURRENT_EDITION_GROUP_SIZE = 4
WC_WORST_CASE_LOSS_GOALS = 3


@dataclass(frozen=True)
class _ThirdPlaceStats:
    points: int
    goal_difference: int
    goals_for: int
    team_name: str = ""

    def rank_key(self, *, use_goal_metrics: bool = True) -> tuple[int | str, ...]:
        base: tuple[int, ...] = (-self.points,)
        if use_goal_metrics:
            return base + (
                -self.goal_difference,
                -self.goals_for,
                self.team_name.casefold(),
            )
        return base + (self.team_name.casefold(),)


@dataclass
class _ThirdPlaceGroupProfile:
    third_row: TableItem | None
    is_group_complete: bool
    is_third_locked: bool
    final_third_stats: _ThirdPlaceStats | None
    min_third_stats: _ThirdPlaceStats | None
    best_third_stats: _ThirdPlaceStats | None


class WorldCupGroupStandings(BaseModel):
    edition: str
    group_slug: str
    group_label: str
    group_enum: str
    table: list[LiveTableItem]


class WorldCupGroupSummary(BaseModel):
    slug: str
    label: str
    table: list[TableItem] = Field(default_factory=list)
    next_match: Match | None = None


class WorldCupGroupStageSummarySection(BaseModel):
    label: str
    summaries: list[WorldCupGroupSummary] = Field(default_factory=list)


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


class WorldCupOverviewGroupStageSection(BaseModel):
    label: str
    anchor: str
    blocks: list[WorldCupOverviewGroupBlock] = Field(default_factory=list)


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


def _live_standings_collection_name(edition: str) -> str:
    return f"live_wc_standings_{edition}"


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


def _get_live_standings_collection(edition: str):
    return mongodb.get_collection(_live_standings_collection_name(edition))


async def _retrieve_group_standings_from_collection(
    collection, edition: str
) -> list[WorldCupGroupStandings]:
    if collection is None:
        return []

    cursor = collection.find({"edition": edition}).sort("group_slug", ASCENDING)
    return [WorldCupGroupStandings.model_validate(item) async for item in cursor]


def _wc_live_scores_window() -> tuple[datetime, datetime]:
    tournament_today = wc_tournament_today()
    window_start = wc_tournament_day_start_utc(
        tournament_today - timedelta(days=WC_LIVE_DAYS_BEFORE_TODAY)
    )
    window_end = wc_tournament_day_end_utc(
        tournament_today + timedelta(days=WC_LIVE_DAYS_AFTER_TODAY)
    )
    return window_start, window_end


def _wc_today_scores_window() -> tuple[datetime, datetime]:
    return wc_tournament_day_start_utc(), wc_tournament_day_end_utc()


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


async def get_wc_live_group_standings_db(edition: str) -> list[WorldCupGroupStandings]:
    """Read live group standings from MongoDB (mirrors get_table_db for PL)."""
    if edition == WC_CURRENT_EDITION and live_wc_standings is not None:
        collection = live_wc_standings
    else:
        collection = _get_live_standings_collection(edition)

    standings = await _retrieve_group_standings_from_collection(collection, edition)
    if edition == WC_CURRENT_EDITION:
        await apply_live_qualification_labels(edition, standings)

    return standings


async def retrieve_group_standings(
    edition: str, group_slug: str
) -> WorldCupGroupStandings | None:
    slug = normalise_group_slug(group_slug)

    collection = _get_standings_collection(edition)
    if collection is None:
        logging.error("No WC standings collection for edition %s", edition)
        return None

    document = await collection.find_one({"group_slug": slug, "edition": edition})
    if document is None:
        return None

    return WorldCupGroupStandings.model_validate(document)


async def retrieve_all_group_standings(edition: str) -> list[WorldCupGroupStandings]:
    if not edition_has_group_stage(edition):
        return []

    standings = await _retrieve_group_standings_from_collection(
        _get_standings_collection(edition),
        edition,
    )

    if len(standings) > 0:
        return standings

    return await _compute_group_standings_from_matches(edition)


async def retrieve_live_group_standings(edition: str) -> list[WorldCupGroupStandings]:
    return await get_wc_live_group_standings_db(edition)


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

    edition_group_order = group_order_for_edition(edition)
    ordered_slugs = [slug for slug in edition_group_order if slug in discovered_slugs]
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
        TableItem.model_construct(
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


def _group_has_results(table: Sequence[TableItem]) -> bool:
    return any(item.played_games > 0 for item in table)


def normalise_group_table(
    table: Sequence[TableItem], matches: list[Match]
) -> list[TableItem]:
    if len(table) == 0:
        teams = _extract_teams_from_matches(matches)
        if len(teams) == 0:
            return []
        return _build_placeholder_table_items(teams)

    if not _group_has_results(table):
        return _build_placeholder_table_items(_unique_teams([item.team for item in table]))

    return list(table)


def _clear_position_labels(table: Sequence[TableItem]) -> None:
    for table_item in table:
        table_item.position_label = None


def _is_h2h_mini_league_clinched_for_qualification(
    candidate: TableItem,
    table: Sequence[TableItem],
    matches: list[Match],
    *,
    group_slug: str,
    team_count: int,
    edition: str = WC_CURRENT_EDITION,
) -> bool:
    """Clinch via H2H steps 1–3 only while the group still has fixtures left."""
    candidate_id = candidate.team.id
    if candidate_id is None:
        return False

    floor_points = candidate.points
    contenders = [
        row
        for row in table
        if row.team.id is not None
        and row.team.id != candidate_id
        and _team_max_points_in_group(row, team_count) >= floor_points
    ]
    if len(contenders) == 0:
        return True

    for contender in contenders:
        if _team_max_points_in_group(contender, team_count) > floor_points:
            return False

    tier_ids = {candidate_id}
    for contender in contenders:
        if contender.team.id is not None:
            tier_ids.add(contender.team.id)

    candidate_h2h = project_head_to_head_stats(
        candidate_id,
        tier_ids,
        matches,
        group_slug=group_slug,
        edition=edition,
        optimize="min",
    )
    for contender in contenders:
        contender_id = contender.team.id
        if contender_id is None:
            continue
        contender_h2h = project_head_to_head_stats(
            contender_id,
            tier_ids,
            matches,
            group_slug=group_slug,
            edition=edition,
            optimize="max",
        )
        if h2h_only_outranks(
            contender_h2h,
            candidate_h2h,
            challenger_name=contender.team.display_name,
            candidate_name=candidate.team.display_name,
        ):
            return False

    return True


def _is_guaranteed_top_spots_h2h(
    candidate: TableItem,
    table: Sequence[TableItem],
    matches: list[Match],
    *,
    group_slug: str,
    team_count: int,
    qualification_spots: int,
    edition: str = WC_CURRENT_EDITION,
) -> bool:
    if _group_is_complete(table, team_count):
        return False

    return _is_h2h_mini_league_clinched_for_qualification(
        candidate,
        table,
        matches,
        group_slug=group_slug,
        team_count=team_count,
        edition=edition,
    )


def _apply_guaranteed_qualification_labels(
    table: Sequence[TableItem],
    *,
    qualification_spots: int = WC_CURRENT_GROUP_QUALIFICATION_SPOTS,
    group_slug: str | None = None,
    group_matches: list[Match] | None = None,
    edition: str = WC_CURRENT_EDITION,
) -> list[TableItem]:
    if len(table) == 0 or len(table) <= qualification_spots:
        _clear_position_labels(table)
        return list(table)

    team_count = len(table)
    total_matches_per_team = max(team_count - 1, 0)
    max_points_by_team_id: dict[int, int] = {}
    adjusted_points_by_team_id: dict[int, int] = {}

    for table_item in table:
        team_id = table_item.team.id
        if team_id is None:
            continue
        remaining_matches = max(total_matches_per_team - table_item.played_games, 0)
        max_points_by_team_id[team_id] = table_item.points + (remaining_matches * 3)
        adjusted_points_by_team_id[team_id] = table_item.points
        table_item.position_label = None

    if _group_is_complete(table, team_count, group_matches=group_matches):
        for table_item in table[:qualification_spots]:
            table_item.position_label = "Q"
        if group_matches is not None:
            in_progress_team_ids = _teams_in_progress_from_matches(group_matches)
            for table_item in table[:qualification_spots]:
                if table_item.team.id in in_progress_team_ids:
                    table_item.position_label = None
        return list(table)

    cutoff_row = table[qualification_spots]
    cutoff_team_id = cutoff_row.team.id
    if cutoff_team_id is None:
        return list(table)

    cutoff_max_points = max_points_by_team_id[cutoff_team_id]

    for table_item in table[:qualification_spots]:
        team_id = table_item.team.id
        if team_id is None:
            continue
        if adjusted_points_by_team_id[team_id] > cutoff_max_points:
            table_item.position_label = "Q"

    for index in range(min(qualification_spots, len(table))):
        table_item = table[index]
        if table_item.position_label == "Q":
            continue
        if _is_locked_in_group_position(table, index, team_count):
            table_item.position_label = "Q"

    if group_matches is not None and group_slug is not None:
        for table_item in table[:qualification_spots]:
            if table_item.position_label == "Q":
                continue
            if _is_guaranteed_top_spots_h2h(
                table_item,
                table,
                group_matches,
                group_slug=group_slug,
                team_count=team_count,
                qualification_spots=qualification_spots,
                edition=edition,
            ):
                table_item.position_label = "Q"

    if group_matches is not None:
        in_progress_team_ids = _teams_in_progress_from_matches(group_matches)
        for table_item in table[:qualification_spots]:
            if table_item.team.id in in_progress_team_ids:
                table_item.position_label = None

    return list(table)


def _team_remaining_group_matches(table_item: TableItem, team_count: int) -> int:
    return max(team_count - 1 - table_item.played_games, 0)


def _team_max_points_in_group(table_item: TableItem, team_count: int) -> int:
    remaining_matches = _team_remaining_group_matches(table_item, team_count)
    return table_item.points + (remaining_matches * 3)


def _team_max_goal_projection(table_item: TableItem, remaining_matches: int) -> tuple[int, int]:
    return (
        table_item.goal_difference + (WC_WORST_CASE_LOSS_GOALS * remaining_matches),
        table_item.goals_for + (WC_WORST_CASE_LOSS_GOALS * remaining_matches),
    )


def _team_min_goal_projection(table_item: TableItem, remaining_matches: int) -> tuple[int, int]:
    return (
        table_item.goal_difference - (WC_WORST_CASE_LOSS_GOALS * remaining_matches),
        table_item.goals_for,
    )


def _group_is_complete(
    table: Sequence[TableItem],
    team_count: int,
    *,
    group_matches: list[Match] | None = None,
) -> bool:
    if group_matches is not None and len(group_matches) > 0:
        return _group_matches_are_complete(group_matches)

    if team_count == 0:
        return False
    required_matches = team_count - 1
    return all(item.played_games >= required_matches for item in table)


def _is_locked_in_group_position(
    table: Sequence[TableItem],
    position_index: int,
    team_count: int,
) -> bool:
    if len(table) <= position_index + 1:
        return False

    leader = table[position_index]
    chaser = table[position_index + 1]
    if leader.team.id is None or chaser.team.id is None:
        return False

    return leader.points > _team_max_points_in_group(chaser, team_count)


def _third_place_stats_from_row(table_item: TableItem) -> _ThirdPlaceStats:
    return _ThirdPlaceStats(
        points=table_item.points,
        goal_difference=table_item.goal_difference,
        goals_for=table_item.goals_for,
        team_name=table_item.team.display_name,
    )


def _third_place_stats_are_better(
    left: _ThirdPlaceStats,
    right: _ThirdPlaceStats,
    *,
    use_goal_metrics: bool,
) -> bool:
    if left.points > right.points:
        return True
    if left.points < right.points:
        return False
    if not use_goal_metrics:
        return False
    if left.goal_difference > right.goal_difference:
        return True
    if left.goal_difference < right.goal_difference:
        return False
    if left.goals_for > right.goals_for:
        return True
    if left.goals_for < right.goals_for:
        return False
    return left.team_name.casefold() < right.team_name.casefold()


def _max_third_place_stats(
    stats: Sequence[_ThirdPlaceStats],
    *,
    use_goal_metrics: bool,
) -> _ThirdPlaceStats | None:
    if len(stats) == 0:
        return None

    return min(stats, key=lambda item: item.rank_key(use_goal_metrics=use_goal_metrics))


def _best_possible_third_place_stats(
    table: Sequence[TableItem],
    team_count: int,
    *,
    group_matches: list[Match] | None = None,
) -> _ThirdPlaceStats | None:
    if len(table) < 3:
        return None

    if _group_is_complete(table, team_count, group_matches=group_matches):
        return _third_place_stats_from_row(table[2])

    candidate_stats: list[_ThirdPlaceStats] = []
    for row in table[1:team_count]:
        remaining_matches = _team_remaining_group_matches(row, team_count)
        max_goal_difference, max_goals_for = _team_max_goal_projection(row, remaining_matches)
        candidate_stats.append(
            _ThirdPlaceStats(
                points=_team_max_points_in_group(row, team_count),
                goal_difference=max_goal_difference,
                goals_for=max_goals_for,
                team_name=row.team.display_name,
            )
        )

    return _max_third_place_stats(candidate_stats, use_goal_metrics=True)


def _all_group_stages_complete(
    group_tables: Mapping[str, Sequence[TableItem]],
    *,
    group_matches_by_slug: Mapping[str, list[Match]] | None = None,
    edition: str = WC_CURRENT_EDITION,
) -> bool:
    expected_slugs = group_order_for_edition(edition)
    if len(group_tables) < len(expected_slugs):
        return False

    for slug in expected_slugs:
        table = group_tables.get(slug)
        if table is None or not _group_has_results(table):
            return False
        group_matches = (
            group_matches_by_slug.get(slug) if group_matches_by_slug is not None else None
        )
        if not _group_is_complete(
            table,
            len(table),
            group_matches=group_matches,
        ):
            return False
    return True


def _build_third_place_group_profile(
    table: Sequence[TableItem],
    *,
    group_matches: list[Match] | None = None,
) -> _ThirdPlaceGroupProfile:
    team_count = len(table)
    if team_count < WC_CURRENT_EDITION_GROUP_SIZE:
        return _ThirdPlaceGroupProfile(
            third_row=None,
            is_group_complete=False,
            is_third_locked=False,
            final_third_stats=None,
            min_third_stats=None,
            best_third_stats=None,
        )

    third_row = table[2]
    is_group_complete = _group_is_complete(
        table,
        team_count,
        group_matches=group_matches,
    )
    is_third_locked = _is_locked_in_group_position(table, 2, team_count)
    best_third_stats = _best_possible_third_place_stats(
        table,
        team_count,
        group_matches=group_matches,
    )
    final_third_stats = (
        _third_place_stats_from_row(third_row) if is_group_complete else None
    )

    min_third_stats: _ThirdPlaceStats | None = None
    if is_third_locked and not is_group_complete:
        remaining_matches = _team_remaining_group_matches(third_row, team_count)
        min_goal_difference, min_goals_for = _team_min_goal_projection(
            third_row,
            remaining_matches,
        )
        min_third_stats = _ThirdPlaceStats(
            points=third_row.points,
            goal_difference=min_goal_difference,
            goals_for=min_goals_for,
            team_name=third_row.team.display_name,
        )

    return _ThirdPlaceGroupProfile(
        third_row=third_row,
        is_group_complete=is_group_complete,
        is_third_locked=is_third_locked,
        final_third_stats=final_third_stats,
        min_third_stats=min_third_stats,
        best_third_stats=best_third_stats,
    )


def _competitor_threatens_third_place_spot(
    competitor: _ThirdPlaceStats,
    candidate: _ThirdPlaceStats,
    *,
    use_goal_metrics: bool,
) -> bool:
    if not use_goal_metrics:
        return competitor.points >= candidate.points
    return competitor.rank_key(use_goal_metrics=True) <= candidate.rank_key(
        use_goal_metrics=True
    )


def _is_guaranteed_best_third_placed(
    candidate_stats: _ThirdPlaceStats,
    competitor_stats: Sequence[_ThirdPlaceStats],
    *,
    use_goal_metrics: bool,
) -> bool:
    threatening_count = sum(
        1
        for stats in competitor_stats
        if _competitor_threatens_third_place_spot(
            stats,
            candidate_stats,
            use_goal_metrics=use_goal_metrics,
        )
    )
    return threatening_count < WC_BEST_THIRD_PLACE_SPOTS


def _apply_current_edition_qualification_labels(
    group_tables: Mapping[str, Sequence[TableItem]],
    *,
    group_matches_by_slug: Mapping[str, list[Match]] | None = None,
) -> None:
    profiles: dict[str, _ThirdPlaceGroupProfile] = {}

    for slug, table in group_tables.items():
        if not _group_has_results(table):
            _clear_position_labels(table)
            continue

        if len(table) >= WC_CURRENT_GROUP_QUALIFICATION_SPOTS + 1:
            _apply_guaranteed_qualification_labels(
                table,
                qualification_spots=WC_CURRENT_GROUP_QUALIFICATION_SPOTS,
                group_slug=slug,
                group_matches=(
                    group_matches_by_slug.get(slug)
                    if group_matches_by_slug is not None
                    else None
                ),
            )
        profiles[slug] = _build_third_place_group_profile(
            table,
            group_matches=(
                group_matches_by_slug.get(slug)
                if group_matches_by_slug is not None
                else None
            ),
        )

    use_goal_metrics = _all_group_stages_complete(
        group_tables,
        group_matches_by_slug=group_matches_by_slug,
    )

    for slug, profile in profiles.items():
        if profile.third_row is None or profile.best_third_stats is None:
            continue

        group_matches = (
            group_matches_by_slug.get(slug) if group_matches_by_slug is not None else None
        )
        if group_matches is not None:
            in_progress_team_ids = _teams_in_progress_from_matches(group_matches)
            if profile.third_row.team.id in in_progress_team_ids:
                continue

        if profile.is_group_complete:
            candidate_stats = profile.final_third_stats
        elif profile.is_third_locked:
            candidate_stats = profile.min_third_stats
        else:
            continue

        if candidate_stats is None:
            continue

        competitor_stats = [
            other_profile.best_third_stats
            for other_slug, other_profile in profiles.items()
            if other_slug != slug and other_profile.best_third_stats is not None
        ]
        if _is_guaranteed_best_third_placed(
            candidate_stats,
            competitor_stats,
            use_goal_metrics=use_goal_metrics,
        ):
            profile.third_row.position_label = "Q"


def _merge_position_labels_from_official(
    live_table: Sequence[LiveTableItem],
    official_table: Sequence[TableItem],
) -> None:
    labels_by_team_id = {
        row.team.id: row.position_label
        for row in official_table
        if row.team.id is not None
    }
    for row in live_table:
        team_id = row.team.id
        row.position_label = labels_by_team_id.get(team_id) if team_id is not None else None


async def _fetch_official_group_tables_for_qualification(
    edition: str,
) -> tuple[dict[str, list[TableItem]], dict[str, list[Match]]]:
    """Official wc_standings snapshot only — never the live overlay collection."""
    collection = _get_standings_collection(edition)

    standings = await _retrieve_group_standings_from_collection(collection, edition)
    if len(standings) == 0:
        standings = await _compute_group_standings_from_matches(edition)

    group_tables: dict[str, list[TableItem]] = {}
    group_matches: dict[str, list[Match]] = {}
    for group in standings:
        matches = await retrieve_group_matches(edition, group.group_slug)
        group_matches[group.group_slug] = matches
        prepared = normalise_group_table(group.table, matches)
        if _group_has_results(prepared):
            prepared = sort_group_table_rows(
                prepared,
                edition,
                group_slug=group.group_slug,
                edition_matches=matches,
            )
        group_tables[group.group_slug] = prepared

    return group_tables, group_matches


async def _fetch_all_sorted_group_tables_for_qualification(
    edition: str,
) -> tuple[dict[str, list[TableItem]], dict[str, list[Match]]]:
    return await _fetch_official_group_tables_for_qualification(edition)


def qualified_team_ids_for_next_round(
    edition: str,
    group_slug: str,
    all_matches: list[Match],
) -> set[int]:
    slug = normalise_group_slug(group_slug)
    stages = group_stages_for_edition(edition)
    stage_index = next(
        (index for index, stage_slugs in enumerate(stages) if slug in stage_slugs),
        None,
    )
    if stage_index is None:
        return set()

    team_ids: set[int] = set()
    knockout_stages = {stage for stage, _, _ in WC_KNOCKOUT_ROUNDS}

    if stage_index < len(stages) - 1:
        next_group_slugs = {
            group_slug_value
            for subsequent_stage in stages[stage_index + 1 :]
            for group_slug_value in subsequent_stage
        }
        for match in all_matches:
            if match.stage != WC_GROUP_STAGE or match.group is None:
                continue
            match_group_slug = group_enum_to_slug(match.group)
            if match_group_slug not in next_group_slugs:
                continue
            for team in (match.home_team, match.away_team):
                if team.id is not None:
                    team_ids.add(team.id)
        return team_ids

    if not edition_has_knockout_stage(edition):
        return set()

    group_team_ids_by_slug = build_group_team_ids_by_slug(all_matches)
    for match in all_matches:
        if match.stage not in knockout_stages:
            continue
        if is_legacy_group_playoff_match(match, group_team_ids_by_slug):
            continue
        for team in (match.home_team, match.away_team):
            if team.id is not None:
                team_ids.add(team.id)

    return team_ids


def _apply_historic_qualification_labels(
    table: list[TableItem],
    qualified_team_ids: set[int],
    *,
    playoff_participant_ids: set[int] | None = None,
) -> list[TableItem]:
    _clear_position_labels(table)
    playoff_ids = playoff_participant_ids or set()

    for table_item in table:
        team_id = table_item.team.id
        if team_id is None:
            continue
        if team_id in playoff_ids:
            table_item.position_label = "P"
        elif team_id in qualified_team_ids:
            table_item.position_label = "Q"
    return table


_TERMINAL_MATCH_STATUSES = {
    MatchStatus.finished,
    MatchStatus.cancelled,
    MatchStatus.awarded,
}

_IN_PROGRESS_MATCH_STATUSES = {
    MatchStatus.in_play,
    MatchStatus.paused,
}


def _teams_in_progress_from_matches(matches: list[Match]) -> set[int]:
    team_ids: set[int] = set()
    for match in matches:
        if match.stage != WC_GROUP_STAGE:
            continue
        if match.status not in _IN_PROGRESS_MATCH_STATUSES:
            continue
        for team in (match.home_team, match.away_team):
            if team.id is not None:
                team_ids.add(team.id)
    return team_ids


def _group_matches_are_complete(matches: list[Match]) -> bool:
    group_matches = [
        match for match in matches if match.stage == WC_GROUP_STAGE
    ]
    if len(group_matches) == 0:
        return False
    return all(match.status in _TERMINAL_MATCH_STATUSES for match in group_matches)


def _apply_final_group_champion_label(
    table: list[TableItem],
    matches: list[Match],
) -> list[TableItem]:
    if not _group_matches_are_complete(matches) or len(table) == 0:
        return table

    leader = table[0]
    if leader.position == 1:
        leader.position_label = "C"
    return table


async def prepare_group_table_for_display(
    edition: str,
    group_slug: str,
    table: Sequence[TableItem],
    matches: list[Match],
    *,
    all_edition_matches: list[Match] | None = None,
) -> list[TableItem]:
    prepared = normalise_group_table(table, matches)
    if not _group_has_results(prepared):
        _clear_position_labels(prepared)
        return prepared

    edition_matches = all_edition_matches
    if edition_matches is None and (
        edition == "1958"
        or edition_hides_goal_difference_column(edition)
        or edition_in_group_playoff_era(edition)
    ):
        edition_matches = await retrieve_all_edition_matches(edition)

    prepared = sort_group_table_rows(
        prepared,
        edition,
        group_slug=group_slug,
        edition_matches=matches if edition == WC_CURRENT_EDITION else edition_matches,
    )

    if edition == WC_CURRENT_EDITION:
        all_group_tables, group_matches = (
            await _fetch_all_sorted_group_tables_for_qualification(edition)
        )
        all_group_tables[group_slug] = prepared
        group_matches[group_slug] = matches
        _apply_current_edition_qualification_labels(
            all_group_tables,
            group_matches_by_slug=group_matches,
        )
        return prepared

    if edition_matches is None:
        edition_matches = await retrieve_all_edition_matches(edition)

    playoff_match = find_group_playoff_match(
        edition_matches,
        group_slug,
        table=prepared,
    )
    playoff_participant_ids = playoff_participant_team_ids(playoff_match)

    if (
        edition_in_group_playoff_era(edition)
        and edition_has_knockout_stage(edition)
        and is_last_group_stage_group(edition, group_slug)
    ):
        qualified_team_ids = knockout_qualifier_team_ids_from_group(
            prepared,
            playoff_match,
        )
    else:
        qualified_team_ids = qualified_team_ids_for_next_round(
            edition,
            group_slug,
            edition_matches,
        )

    prepared = _apply_historic_qualification_labels(
        prepared,
        qualified_team_ids,
        playoff_participant_ids=playoff_participant_ids,
    )

    if is_final_group_stage_group(edition, group_slug):
        _apply_final_group_champion_label(prepared, matches)

    return prepared


def _sort_live_group_table_rows(
    table: list[LiveTableItem],
    edition: str,
    *,
    group_slug: str,
    edition_matches: list[Match] | None = None,
) -> list[LiveTableItem]:
    sorted_rows = sort_group_table_rows(
        list(table),
        edition,
        group_slug=group_slug,
        edition_matches=edition_matches,
    )
    rows_by_team_id = {
        row.team.id: row for row in table if row.team.id is not None
    }
    reordered: list[LiveTableItem] = []
    for sorted_row in sorted_rows:
        team_id = sorted_row.team.id
        if team_id is None:
            continue
        live_row = rows_by_team_id.get(team_id)
        if live_row is None:
            continue
        live_row.position = sorted_row.position
        live_row.points = sorted_row.points
        reordered.append(live_row)

    return reordered


async def apply_live_qualification_labels(
    edition: str,
    groups: list[WorldCupGroupStandings],
) -> None:
    if edition != WC_CURRENT_EDITION:
        return

    official_tables, group_matches_by_slug = (
        await _fetch_official_group_tables_for_qualification(edition)
    )
    _apply_current_edition_qualification_labels(
        official_tables,
        group_matches_by_slug=group_matches_by_slug,
    )

    for group in groups:
        if not _group_has_results(group.table):
            _clear_position_labels(group.table)
            continue

        matches = group_matches_by_slug.get(group.group_slug)
        if matches is None:
            matches = await retrieve_group_matches(edition, group.group_slug)
        reordered = _sort_live_group_table_rows(
            group.table,
            edition,
            group_slug=group.group_slug,
            edition_matches=matches,
        )
        _merge_position_labels_from_official(
            reordered,
            official_tables.get(group.group_slug, []),
        )
        group.table.clear()
        group.table.extend(reordered)


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


async def retrieve_knockout_matches(
    edition: str,
    stage: str,
    *,
    supersede_replays: bool = True,
) -> list[Match]:
    collection = _get_matches_collection(edition)
    if collection is None:
        logging.error("No WC match collection for edition %s", edition)
        return []

    cursor = collection.find({"stage": stage}).sort("utc_date", ASCENDING)
    matches = [Match.model_validate(item) async for item in cursor]
    if stage == "LAST_16":
        all_matches = await retrieve_all_edition_matches(edition)
        matches = filter_group_playoffs_from_knockout_matches(
            edition,
            matches,
            all_matches,
        )
    if supersede_replays:
        matches = filter_superseded_knockout_replays(matches)
    return matches


async def retrieve_group_playoff_matches(edition: str) -> list[Match]:
    all_matches = await retrieve_all_edition_matches(edition)
    return [
        match
        for _, match in list_group_playoff_matches_for_edition(edition, all_matches)
    ]


async def edition_has_group_playoff_matches(edition: str) -> bool:
    return len(await retrieve_group_playoff_matches(edition)) > 0


class WorldCupGroupPlayoffSection(BaseModel):
    slug: str
    label: str
    group_slug: str
    group_label: str
    matches: list[Match] = Field(default_factory=list)


async def build_overview_group_playoff_sections(
    edition: str,
) -> list[WorldCupGroupPlayoffSection]:
    all_matches = await retrieve_all_edition_matches(edition)
    sections: list[WorldCupGroupPlayoffSection] = []

    for group_slug, match in list_group_playoff_matches_for_edition(
        edition,
        all_matches,
    ):
        sections.append(
            WorldCupGroupPlayoffSection(
                slug=group_slug,
                label=group_playoff_round_label(group_slug),
                group_slug=group_slug,
                group_label=group_slug_to_label(group_slug),
                matches=[match],
            )
        )

    return sections


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
            await retrieve_knockout_matches(edition, stage, supersede_replays=False)
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


async def _build_overview_group_block(
    edition: str,
    group: WorldCupGroupStandings,
    *,
    all_edition_matches: list[Match] | None = None,
) -> WorldCupOverviewGroupBlock:
    matches = await retrieve_group_matches(edition, group.group_slug)
    table = await prepare_group_table_for_display(
        edition,
        group.group_slug,
        group.table,
        matches,
        all_edition_matches=all_edition_matches,
    )
    return WorldCupOverviewGroupBlock(
        slug=group.group_slug,
        label=group.group_label,
        table=table,
        matches=matches,
    )


async def build_overview_group_stage_sections(
    edition: str,
) -> list[WorldCupOverviewGroupStageSection]:
    if not edition_has_group_stage(edition):
        return []

    standings = await retrieve_all_group_standings(edition)
    standings_by_slug = {group.group_slug: group for group in standings}
    all_edition_matches = (
        None
        if edition == WC_CURRENT_EDITION
        else await retrieve_all_edition_matches(edition)
    )
    sections: list[WorldCupOverviewGroupStageSection] = []

    for stage_label, stage_slugs in overview_group_stages_for_edition(edition):
        blocks: list[WorldCupOverviewGroupBlock] = []
        for slug in stage_slugs:
            group = standings_by_slug.get(slug)
            if group is None:
                continue
            blocks.append(
                await _build_overview_group_block(
                    edition,
                    group,
                    all_edition_matches=all_edition_matches,
                )
            )

        if len(blocks) == 0:
            continue

        sections.append(
            WorldCupOverviewGroupStageSection(
                label=stage_label,
                anchor=group_stage_overview_anchor(stage_label),
                blocks=blocks,
            )
        )

    return sections


async def _build_group_summary(
    edition: str,
    group: WorldCupGroupStandings,
    *,
    all_edition_matches: list[Match] | None = None,
) -> WorldCupGroupSummary:
    matches = await retrieve_group_matches(edition, group.group_slug)
    table = await prepare_group_table_for_display(
        edition,
        group.group_slug,
        group.table,
        matches,
        all_edition_matches=all_edition_matches,
    )
    return WorldCupGroupSummary(
        slug=group.group_slug,
        label=group.group_label,
        table=table,
        next_match=_select_next_match(matches),
    )


async def list_group_summaries(edition: str) -> list[WorldCupGroupSummary]:
    if not edition_has_group_stage(edition):
        return []

    standings = await retrieve_all_group_standings(edition)
    summaries: list[WorldCupGroupSummary] = []

    for group in standings:
        summaries.append(await _build_group_summary(edition, group))

    return summaries


async def list_group_stage_summary_sections(
    edition: str,
) -> list[WorldCupGroupStageSummarySection]:
    if not edition_has_group_stage(edition):
        return []

    standings = await retrieve_all_group_standings(edition)
    all_edition_matches = (
        None
        if edition == WC_CURRENT_EDITION
        else await retrieve_all_edition_matches(edition)
    )
    summaries_by_slug = {
        group.group_slug: await _build_group_summary(
            edition,
            group,
            all_edition_matches=all_edition_matches,
        )
        for group in standings
    }
    sections: list[WorldCupGroupStageSummarySection] = []

    for stage_label, stage_slugs in group_index_stages_for_edition(edition):
        stage_summaries = [
            summaries_by_slug[slug] for slug in stage_slugs if slug in summaries_by_slug
        ]
        if len(stage_summaries) == 0:
            continue

        sections.append(
            WorldCupGroupStageSummarySection(
                label=stage_label,
                summaries=stage_summaries,
            )
        )

    return sections


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
                table=[
                    LiveTableItem.model_validate(row.model_dump())
                    for row in standing.table
                ],
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

    fixture_maps: dict[str, dict[int, Match]] | None = None
    if edition == WC_CURRENT_EDITION:
        group_tables, _ = await _fetch_all_sorted_group_tables_for_qualification(
            edition
        )
        fixture_maps = resolve_2026_knockout_fixture_maps(
            stage_matches,
            group_tables,
        )

    stage_matches = order_knockout_stages_for_bracket(
        stage_matches,
        fixture_maps=fixture_maps,
    )

    third_place_matches = await retrieve_knockout_matches(edition, "THIRD_PLACE")
    matches_by_fixture = merge_knockout_fixture_maps(
        stage_matches,
        fixture_maps=fixture_maps,
        extra_matches=[("THIRD_PLACE", third_place_matches)]
        if len(third_place_matches) > 0
        else None,
    )

    first_round_count = len(stage_matches[0][1])
    grid_rows = max(BRACKET_CARD_GRID_ROWS, _bracket_grid_row_count(first_round_count))
    rounds: list[BracketRoundColumn] = []

    for round_index, ((stage, round_slug, label), matches) in enumerate(stage_matches):
        ordered_matches = matches
        slots: list[BracketSlot] = []
        for match_index, match in enumerate(ordered_matches):
            row_start, row_span = _bracket_grid_position(match_index, round_index)
            fixture_number = bracket_fixture_number_for_match(
                stage,
                match,
                ordered_matches,
                bracket_index=match_index,
                fixture_map=fixture_maps.get(stage) if fixture_maps else None,
            )
            slots.append(
                _bracket_slot_from_match(
                    apply_knockout_feeder_teams(match, matches_by_fixture),
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
            apply_knockout_feeder_teams(third_place_match, matches_by_fixture),
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
