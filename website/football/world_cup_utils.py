from __future__ import annotations

import json
import re
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import Match, TableItem, Team

WC_CURRENT_EDITION = "2026"
WC_CREST_UNKNOWN_URL = "/images/football/crests/unknown_team.svg"
WC_CREST_STATIC_DIR = (
    Path(__file__).resolve().parents[1] / "static" / "images" / "football" / "crests" / "wc"
)
WC_FLAG_CACHE_VERSION_PATH = Path(__file__).with_name("wc_flag_cache_version.json")
WC_GROUP_STAGE = "GROUP_STAGE"
WC_GROUP_PLAYOFF = "GROUP_PLAYOFF"
WC_GROUP_ORDER = tuple(chr(code) for code in range(ord("a"), ord("l") + 1))
WC_GROUP_ORDER_4_NUMERIC = ("1", "2", "3", "4")
WC_GROUP_ORDER_6_LETTER = tuple(chr(code) for code in range(ord("a"), ord("f") + 1))
WC_GROUP_ORDER_8_LETTER = tuple(chr(code) for code in range(ord("a"), ord("h") + 1))
WC_1950_GROUP_ORDER = (*WC_GROUP_ORDER_4_NUMERIC, "final")
WC_1982_GROUP_ORDER = ("1", "2", "3", "4", "5", "6", "a", "b", "c", "d")
WC_2022_GROUP_ORDER = WC_GROUP_ORDER_8_LETTER

WC_EDITION_REGISTRY: dict[str, dict[str, object]] = {
    "1930": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_4_NUMERIC},
    "1934": {"has_group_stage": False, "group_order": ()},
    "1938": {"has_group_stage": False, "group_order": ()},
    "1950": {
        "has_group_stage": True,
        "has_knockout_stage": False,
        "group_order": WC_1950_GROUP_ORDER,
        "group_stages": (WC_GROUP_ORDER_4_NUMERIC, ("final",)),
        "group_stage_labels": ("First round", "Final round"),
    },
    "1954": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_4_NUMERIC},
    "1958": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_4_NUMERIC},
    "1962": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_4_NUMERIC},
    "1966": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_4_NUMERIC},
    "1970": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_4_NUMERIC},
    "1974": {
        "has_group_stage": True,
        "group_order": ("1", "2", "3", "4", "a", "b"),
        "group_stages": (("1", "2", "3", "4"), ("a", "b")),
        "group_stage_labels": ("First group stage", "Second group stage"),
    },
    "1978": {
        "has_group_stage": True,
        "group_order": ("1", "2", "3", "4", "a", "b"),
        "group_stages": (("1", "2", "3", "4"), ("a", "b")),
        "group_stage_labels": ("First group stage", "Second group stage"),
    },
    "1982": {
        "has_group_stage": True,
        "group_order": WC_1982_GROUP_ORDER,
        "group_stages": (("1", "2", "3", "4", "5", "6"), ("a", "b", "c", "d")),
        "group_stage_labels": ("First group stage", "Second group stage"),
    },
    "1986": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_6_LETTER},
    "1990": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_6_LETTER},
    "1994": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_6_LETTER},
    "1998": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_8_LETTER},
    "2002": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_8_LETTER},
    "2006": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_8_LETTER},
    "2010": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_8_LETTER},
    "2014": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_8_LETTER},
    "2018": {"has_group_stage": True, "group_order": WC_GROUP_ORDER_8_LETTER},
    "2022": {"has_group_stage": True, "group_order": WC_2022_GROUP_ORDER},
    "2026": {"has_group_stage": True, "group_order": WC_GROUP_ORDER},
}

WC_OPENFOOTBALL_EDITIONS: tuple[str, ...] = tuple(
    sorted(WC_EDITION_REGISTRY.keys(), key=int)
)


def world_cup_edition_query(edition: str) -> str:
    return f"?edition={edition}"


def edition_has_group_stage(edition: str) -> bool:
    entry = WC_EDITION_REGISTRY.get(edition)
    if entry is not None:
        return bool(entry.get("has_group_stage", True))
    return True


def edition_has_knockout_stage(edition: str) -> bool:
    entry = WC_EDITION_REGISTRY.get(edition)
    if entry is not None:
        return bool(entry.get("has_knockout_stage", True))
    return True


def edition_points_per_win(edition: str) -> int:
    """Two points per win through 1990; three points from 1994 onward."""
    return 2 if int(edition) <= 1990 else 3


def compute_group_table_points(won: int, draw: int, edition: str) -> int:
    return won * edition_points_per_win(edition) + draw


def edition_uses_goal_average(edition: str) -> bool:
    year = int(edition)
    return 1958 <= year <= 1966


_GROUP_PLAYOFF_ROUND_RE = re.compile(r"^Group\s+(\d+)\s+Play-off$", re.IGNORECASE)


def group_playoff_slug_from_round(round_name: str) -> str | None:
    base_round = round_name.strip().split(",")[0].strip()
    match = _GROUP_PLAYOFF_ROUND_RE.match(base_round)
    if match is None:
        return None
    return normalise_group_slug(match.group(1))


def _find_legacy_group_playoff_match(
    matches: list["Match"],
    table: list["TableItem"],
) -> "Match | None":
    """Older imports stored group playoffs as LAST_16 without a group field."""
    group_team_ids = {
        row.team.id for row in table if row.team.id is not None
    }
    if len(group_team_ids) == 0:
        return None

    for match in matches:
        if match.stage != "LAST_16":
            continue
        home_id = match.home_team.id
        away_id = match.away_team.id
        if home_id in group_team_ids and away_id in group_team_ids:
            return match
    return None


def find_group_playoff_match(
    matches: list["Match"],
    group_slug: str,
    *,
    table: list["TableItem"] | None = None,
) -> "Match | None":
    slug = normalise_group_slug(group_slug)
    group_enum = group_slug_to_enum(slug)
    playoffs = [
        match
        for match in matches
        if match.stage == WC_GROUP_PLAYOFF and match.group == group_enum
    ]
    if len(playoffs) > 0:
        return playoffs[0]

    if table is not None:
        return _find_legacy_group_playoff_match(matches, table)
    return None


def format_goal_average(goals_for: int, goals_against: int) -> str:
    if goals_against == 0:
        if goals_for == 0:
            return "0.00"
        return "∞"
    return f"{goals_for / goals_against:.2f}"


def _goal_average_sort_components(goals_for: int, goals_against: int) -> tuple[int, float, int]:
    """Ascending sort key so a higher goal average ranks above a lower one."""
    if goals_against == 0:
        return (0, 0.0, -goals_for)
    return (1, -(goals_for / goals_against), -goals_for)


def _sort_rows_by_goal_average(rows: list["TableItem"]) -> list["TableItem"]:
    return sorted(
        rows,
        key=lambda row: _goal_average_sort_components(row.goals_for, row.goals_against)
        + (-row.goals_for, row.team.display_name.casefold()),
    )


def _playoff_total_goals(match: "Match") -> tuple[int, int] | None:
    home_ft = match.score.full_time.home
    away_ft = match.score.full_time.away
    if home_ft is None or away_ft is None:
        return None

    home_total = home_ft
    away_total = away_ft
    extra_time = match.score.extra_time
    if extra_time is not None and extra_time.home is not None and extra_time.away is not None:
        home_total += extra_time.home
        away_total += extra_time.away
    return home_total, away_total


def _playoff_winner_team_id(match: "Match") -> int | None:
    totals = _playoff_total_goals(match)
    if totals is None:
        return None

    home_total, away_total = totals
    if home_total > away_total:
        return match.home_team.id
    if away_total > home_total:
        return match.away_team.id
    return None


def _order_1958_playoff_tie(
    rows: list["TableItem"],
    playoff_match: "Match | None",
) -> list["TableItem"]:
    if playoff_match is None or len(rows) != 2:
        return _sort_rows_by_goal_average(rows)

    team_ids = {row.team.id for row in rows if row.team.id is not None}
    home_id = playoff_match.home_team.id
    away_id = playoff_match.away_team.id
    if home_id not in team_ids or away_id not in team_ids:
        return _sort_rows_by_goal_average(rows)

    winner_id = _playoff_winner_team_id(playoff_match)
    if winner_id is None:
        return _sort_rows_by_goal_average(rows)

    winners = [row for row in rows if row.team.id == winner_id]
    losers = [row for row in rows if row.team.id != winner_id]
    return winners + losers


def _resolve_1958_points_tier(
    rows: list["TableItem"],
    *,
    start_position: int,
    teams_above: int,
    playoff_match: "Match | None",
) -> list["TableItem"]:
    if len(rows) <= 1:
        return rows

    if len(rows) == 2 and teams_above == 1 and start_position == 2:
        return _order_1958_playoff_tie(rows, playoff_match)

    return _sort_rows_by_goal_average(rows)


def _sort_group_table_rows_1958(
    table: list["TableItem"],
    playoff_match: "Match | None",
) -> list["TableItem"]:
    tiers_by_points: dict[int, list["TableItem"]] = {}
    for row in table:
        points = compute_group_table_points(row.won, row.draw, "1958")
        tiers_by_points.setdefault(points, []).append(row)

    ordered_rows: list["TableItem"] = []
    position = 1
    teams_above = 0

    for points in sorted(tiers_by_points.keys(), reverse=True):
        tier_rows = tiers_by_points[points]
        ordered_rows.extend(
            _resolve_1958_points_tier(
                tier_rows,
                start_position=position,
                teams_above=teams_above,
                playoff_match=playoff_match,
            )
        )
        teams_above += len(tier_rows)
        position += len(tier_rows)

    return ordered_rows


def group_table_row_sort_key(
    *,
    won: int,
    draw: int,
    goals_for: int,
    goals_against: int,
    goal_difference: int,
    team_display_name: str,
    edition: str,
) -> tuple[int | float | str, ...]:
    points = compute_group_table_points(won, draw, edition)
    base: tuple[int | float | str, ...] = (-points,)
    if edition_uses_goal_average(edition):
        return base + _goal_average_sort_components(goals_for, goals_against) + (
            team_display_name.casefold(),
        )

    # 1970 onward: goal difference, then goals scored.
    # 1930–1954: playoffs decided ties; interim GD/GF ordering until that is modelled.
    return base + (-goal_difference, -goals_for, team_display_name.casefold())


def sort_group_table_rows(
    table: list["TableItem"],
    edition: str,
    *,
    group_slug: str | None = None,
    edition_matches: list["Match"] | None = None,
) -> list["TableItem"]:
    if edition == "1958":
        playoff_match = (
            find_group_playoff_match(
                edition_matches,
                group_slug,
                table=table,
            )
            if edition_matches is not None and group_slug is not None
            else None
        )
        ordered_rows = _sort_group_table_rows_1958(table, playoff_match)
    else:
        ordered_rows = sorted(
            table,
            key=lambda row: group_table_row_sort_key(
                won=row.won,
                draw=row.draw,
                goals_for=row.goals_for,
                goals_against=row.goals_against,
                goal_difference=row.goal_difference,
                team_display_name=row.team.display_name,
                edition=edition,
            ),
        )

    return [
        row.model_copy(
            update={
                "position": position,
                "points": compute_group_table_points(row.won, row.draw, edition),
            },
        )
        for position, row in enumerate(ordered_rows, start=1)
    ]


def _group_matches_into_date_buckets(matches: list["Match"]) -> list[list["Match"]]:
    sorted_matches = sorted(matches, key=lambda match: match.utc_date)
    date_buckets: list[list["Match"]] = []
    current_date = None
    current_bucket: list["Match"] = []

    for match in sorted_matches:
        match_date = match.utc_date.date()
        if match_date != current_date:
            if current_bucket:
                date_buckets.append(current_bucket)
            current_bucket = [match]
            current_date = match_date
        else:
            current_bucket.append(match)

    if current_bucket:
        date_buckets.append(current_bucket)

    return date_buckets


def group_matchday_buckets(matches: list["Match"]) -> list[tuple[int, list["Match"]]]:
    """Group fixtures into per-group Matchday 1, 2 and 3 buckets."""
    if len(matches) == 0:
        return []

    date_buckets = _group_matches_into_date_buckets(matches)
    buckets: list[tuple[int, list["Match"]]] = []
    matchday = 1
    index = 0

    while index < len(date_buckets):
        bucket = date_buckets[index]
        if (
            len(bucket) == 1
            and index + 1 < len(date_buckets)
            and len(date_buckets[index + 1]) == 1
        ):
            combined = sorted(
                bucket + date_buckets[index + 1],
                key=lambda match: match.utc_date,
            )
            buckets.append((matchday, combined))
            index += 2
        else:
            buckets.append((matchday, bucket))
            index += 1
        matchday += 1

    return buckets


def build_group_matchday_groups(matches: list["Match"]) -> list[dict]:
    return [
        {
            "label": f"Matchday {matchday}",
            "matches": bucket_matches,
        }
        for matchday, bucket_matches in group_matchday_buckets(matches)
    ]


def normalize_group_stage_matchdays(matches: list["Match"]) -> list["Match"]:
    """Rewrite group-stage matchday values to 1, 2 and 3 within each group."""
    group_matches: dict[str, list["Match"]] = {}
    other_matches: list["Match"] = []

    for match in matches:
        if match.stage == WC_GROUP_STAGE and match.group is not None:
            group_matches.setdefault(match.group, []).append(match)
        else:
            other_matches.append(match)

    normalized = list(other_matches)
    for group_matches_list in group_matches.values():
        for matchday, bucket_matches in group_matchday_buckets(group_matches_list):
            for match in bucket_matches:
                normalized.append(match.model_copy(update={"matchday": matchday}))

    normalized.sort(key=lambda match: match.utc_date)
    return normalized


def group_order_for_edition(edition: str) -> tuple[str, ...]:
    entry = WC_EDITION_REGISTRY.get(edition)
    if entry is not None:
        group_order = entry.get("group_order")
        if isinstance(group_order, tuple) and len(group_order) > 0:
            return group_order
    return WC_GROUP_ORDER


def group_stages_for_edition(edition: str) -> tuple[tuple[str, ...], ...]:
    entry = WC_EDITION_REGISTRY.get(edition)
    if entry is not None:
        group_stages = entry.get("group_stages")
        if isinstance(group_stages, tuple) and len(group_stages) > 0:
            return group_stages
    return (group_order_for_edition(edition),)


def final_group_stage_slugs_for_edition(edition: str) -> tuple[str, ...]:
    if edition_has_knockout_stage(edition):
        return ()
    stages = group_stages_for_edition(edition)
    if len(stages) == 0:
        return ()
    return stages[-1]


def is_final_group_stage_group(edition: str, group_slug: str) -> bool:
    slug = normalise_group_slug(group_slug)
    return slug in final_group_stage_slugs_for_edition(edition)


def group_stage_labels_for_edition(edition: str) -> tuple[str, ...]:
    entry = WC_EDITION_REGISTRY.get(edition)
    if entry is not None:
        labels = entry.get("group_stage_labels")
        if isinstance(labels, tuple) and len(labels) > 0:
            return labels
    return ("Group Stage",)


def overview_group_order_for_edition(edition: str) -> tuple[str, ...]:
    """Later group phases first so the overview reads top-down toward the group stage."""
    stages = group_stages_for_edition(edition)
    if len(stages) <= 1:
        return stages[0]
    return tuple(slug for stage in reversed(stages) for slug in stage)


def _labelled_group_stages_for_edition(edition: str) -> tuple[tuple[str, tuple[str, ...]], ...]:
    stages = group_stages_for_edition(edition)
    labels = group_stage_labels_for_edition(edition)
    if len(labels) != len(stages):
        labels = tuple(f"Group stage {index + 1}" for index in range(len(stages)))
    return tuple(zip(labels, stages, strict=True))


def group_index_stages_for_edition(
    edition: str,
) -> tuple[tuple[str, tuple[str, ...]], ...]:
    """Return labelled group stages in tournament order for the groups index."""
    return _labelled_group_stages_for_edition(edition)


def overview_group_stages_for_edition(
    edition: str,
) -> tuple[tuple[str, tuple[str, ...]], ...]:
    """Return labelled group stages in overview order (later phases first)."""
    labelled_stages = _labelled_group_stages_for_edition(edition)
    if len(labelled_stages) <= 1:
        return labelled_stages
    return labelled_stages[::-1]


def group_stage_for_slug(edition: str, group_slug: str) -> tuple[str, ...] | None:
    slug = normalise_group_slug(group_slug)
    for stage_slugs in group_stages_for_edition(edition):
        if slug in stage_slugs:
            return stage_slugs
    return None


def group_stage_overview_anchor(label: str) -> str:
    if label == "Group Stage":
        return "wc-group-stage"
    normalized = re.sub(r"[^a-z0-9]+", "-", label.casefold()).strip("-")
    return f"wc-group-stage-{normalized}"

WC_KNOCKOUT_ROUNDS: tuple[tuple[str, str, str], ...] = (
    ("LAST_32", "round-of-32", "Round of 32"),
    ("LAST_16", "round-of-16", "Round of 16"),
    ("QUARTER_FINALS", "quarter-finals", "Quarter-finals"),
    ("SEMI_FINALS", "semi-finals", "Semi-finals"),
    ("THIRD_PLACE", "third-place", "Third-place play-off"),
    ("FINAL", "final", "Final"),
)
WC_KNOCKOUT_OVERVIEW_ORDER = tuple(reversed(WC_KNOCKOUT_ROUNDS))
WC_KNOCKOUT_ROUND_SLUGS = tuple(round_slug for _, round_slug, _ in WC_KNOCKOUT_ROUNDS)
WC_STAGE_TO_ROUND = {stage: round_slug for stage, round_slug, _ in WC_KNOCKOUT_ROUNDS}
WC_ROUND_TO_STAGE = {round_slug: stage for stage, round_slug, _ in WC_KNOCKOUT_ROUNDS}
WC_STAGE_TO_LABEL = {stage: label for stage, _, label in WC_KNOCKOUT_ROUNDS}
WC_ROUND_TO_LABEL = {round_slug: label for _, round_slug, label in WC_KNOCKOUT_ROUNDS}


def normalise_group_slug(group_slug: str) -> str:
    slug = group_slug.strip().lower()
    if slug.startswith("group_"):
        slug = slug.removeprefix("group_")
    return slug


def group_slug_to_enum(group_slug: str) -> str:
    return f"GROUP_{normalise_group_slug(group_slug).upper()}"


def group_enum_to_slug(group_enum: str) -> str:
    return group_enum.removeprefix("GROUP_").lower()


def group_slug_to_label(group_slug: str) -> str:
    slug = normalise_group_slug(group_slug)
    if slug == "final":
        return "Final round"
    return f"Group {slug.upper()}"


def adjacent_group_slugs(
    group_slug: str,
    edition: str | None = None,
) -> tuple[str, str]:
    slug = normalise_group_slug(group_slug)
    edition_key = edition or WC_CURRENT_EDITION
    stage_slugs = group_stage_for_slug(edition_key, slug)
    if stage_slugs is not None:
        index = stage_slugs.index(slug)
        stage_count = len(stage_slugs)
        return (
            stage_slugs[(index - 1) % stage_count],
            stage_slugs[(index + 1) % stage_count],
        )

    group_order = group_order_for_edition(edition_key)
    index = group_order.index(slug)
    group_count = len(group_order)
    return (
        group_order[(index - 1) % group_count],
        group_order[(index + 1) % group_count],
    )


def standings_label_to_slug(label: str) -> str:
    normalized = label.strip()
    if normalized.casefold() == "final round":
        return "final"
    return normalized.removeprefix("Group ").strip().lower()


def edition_label(edition: str) -> str:
    return f"FIFA World Cup {edition}"


def normalise_round_slug(round_slug: str) -> str:
    return round_slug.strip().lower()


def is_valid_round_slug(round_slug: str) -> bool:
    return normalise_round_slug(round_slug) in WC_ROUND_TO_STAGE


def round_slug_to_stage(round_slug: str) -> str:
    slug = normalise_round_slug(round_slug)
    stage = WC_ROUND_TO_STAGE.get(slug)
    if stage is None:
        raise ValueError(f"Unknown knockout round slug: {round_slug}")
    return stage


def stage_to_round_slug(stage: str) -> str | None:
    return WC_STAGE_TO_ROUND.get(stage)


def round_slug_to_label(round_slug: str) -> str:
    slug = normalise_round_slug(round_slug)
    label = WC_ROUND_TO_LABEL.get(slug)
    if label is None:
        raise ValueError(f"Unknown knockout round slug: {round_slug}")
    return label


def stage_to_label(stage: str) -> str:
    return WC_STAGE_TO_LABEL.get(stage, stage.replace("_", " ").title())


def team_is_confirmed(team: "Team") -> bool:
    if team.id is None:
        return False

    if not isinstance(team.id, int) or team.id <= 0:
        return False

    display_name = team.display_name.strip().casefold()
    if display_name in {"", "tbd"}:
        return False

    return any(
        value is not None and str(value).strip().casefold() not in {"", "tbd"}
        for value in (team.name, team.short_name, team.tla)
    )


def knockout_match_has_confirmed_teams(match: "Match") -> bool:
    return team_is_confirmed(match.home_team) and team_is_confirmed(match.away_team)


def filter_confirmed_knockout_matches(matches: list["Match"]) -> list["Match"]:
    return [match for match in matches if knockout_match_has_confirmed_teams(match)]


def _knockout_fixture_key(match: "Match") -> tuple[str, str]:
    if knockout_match_has_confirmed_teams(match):
        home_id, away_id = match.home_team.id, match.away_team.id
        team_ids = sorted((home_id, away_id))
        return (match.stage, f"teams:{team_ids[0]}:{team_ids[1]}")
    return (match.stage, f"match:{match.id}")


def filter_superseded_knockout_replays(matches: list["Match"]) -> list["Match"]:
    """Drop the original fixture when the same knockout tie was replayed."""
    knockout_matches = [
        match
        for match in matches
        if match.stage not in {WC_GROUP_STAGE, WC_GROUP_PLAYOFF}
    ]
    if len(knockout_matches) <= 1:
        return matches

    fixtures: dict[tuple[str, str], list["Match"]] = {}
    for match in knockout_matches:
        fixtures.setdefault(_knockout_fixture_key(match), []).append(match)

    kept_knockout_ids: set[int] = set()
    for fixture_matches in fixtures.values():
        if len(fixture_matches) == 1:
            kept_knockout_ids.add(fixture_matches[0].id)
            continue
        fixture_matches.sort(key=lambda item: item.utc_date)
        kept_knockout_ids.add(fixture_matches[-1].id)

    return [
        match
        for match in matches
        if match.stage in {WC_GROUP_STAGE, WC_GROUP_PLAYOFF}
        or match.id in kept_knockout_ids
    ]


def _winner_side_from_scores(home: int, away: int) -> str | None:
    if home > away:
        return "home"
    if away > home:
        return "away"
    return None


def knockout_winner_side(match: "Match") -> str | None:
    from .models import MatchStatus

    if match.status not in {MatchStatus.finished, MatchStatus.awarded}:
        return None

    home_score = match.score.full_time.home
    away_score = match.score.full_time.away
    if home_score is None or away_score is None:
        return None

    winner_side = _winner_side_from_scores(home_score, away_score)
    if winner_side is not None:
        return winner_side

    penalties = match.score.penalties
    if penalties is not None and penalties.home is not None and penalties.away is not None:
        return _winner_side_from_scores(penalties.home, penalties.away)

    extra_time = match.score.extra_time
    if extra_time is not None and extra_time.home is not None and extra_time.away is not None:
        return _winner_side_from_scores(extra_time.home, extra_time.away)

    return None


def world_cup_display_score(match: "Match") -> tuple[int | None, int | None]:
    """Return the scoreline to show in match cards."""
    home_ft = match.score.full_time.home
    away_ft = match.score.full_time.away
    if home_ft is None or away_ft is None:
        return home_ft, away_ft

    penalties = match.score.penalties
    if (
        penalties is not None
        and penalties.home is not None
        and penalties.away is not None
        and home_ft == away_ft
    ):
        return home_ft, away_ft

    extra_time = match.score.extra_time
    if (
        extra_time is not None
        and extra_time.home is not None
        and extra_time.away is not None
        and home_ft == away_ft
    ):
        return extra_time.home, extra_time.away

    return home_ft, away_ft


def world_cup_score_annotation(match: "Match") -> str | None:
    score = match.score
    home_score = score.full_time.home
    away_score = score.full_time.away
    if home_score is None or away_score is None or home_score != away_score:
        return None

    penalties = score.penalties
    if (
        penalties is not None
        and penalties.home is not None
        and penalties.away is not None
    ):
        return f"({penalties.home}-{penalties.away} pens)"

    extra_time = score.extra_time
    if (
        extra_time is not None
        and extra_time.home is not None
        and extra_time.away is not None
        and extra_time.home != extra_time.away
    ):
        return "(aet)"

    return None


# FIFA match numbers and feeder labels for the 2026 World Cup knockout bracket.
WC_2026_KNOCKOUT_FIXTURES: dict[str, dict[int, tuple[str, str]]] = {
    "LAST_32": {
        73: ("Runner-up Group A", "Runner-up Group B"),
        74: ("Winner Group E", "3rd Group A/B/C/D/F"),
        75: ("Winner Group F", "Runner-up Group C"),
        76: ("Winner Group C", "Runner-up Group F"),
        77: ("Winner Group I", "3rd Group C/D/F/G/H"),
        78: ("Runner-up Group E", "Runner-up Group I"),
        79: ("Winner Group A", "3rd Group C/E/F/H/I"),
        80: ("Winner Group L", "3rd Group E/H/I/J/K"),
        81: ("Winner Group D", "3rd Group B/E/F/I/J"),
        82: ("Winner Group G", "3rd Group A/E/H/I/J"),
        83: ("Runner-up Group K", "Runner-up Group L"),
        84: ("Winner Group H", "Runner-up Group J"),
        85: ("Winner Group B", "3rd Group E/F/G/I/J"),
        86: ("Winner Group J", "Runner-up Group H"),
        87: ("Winner Group K", "3rd Group D/E/I/J/L"),
        88: ("Runner-up Group D", "Runner-up Group G"),
    },
    "LAST_16": {
        89: ("Winner Match 74", "Winner Match 77"),
        90: ("Winner Match 73", "Winner Match 75"),
        91: ("Winner Match 76", "Winner Match 78"),
        92: ("Winner Match 79", "Winner Match 80"),
        93: ("Winner Match 83", "Winner Match 84"),
        94: ("Winner Match 81", "Winner Match 82"),
        95: ("Winner Match 86", "Winner Match 88"),
        96: ("Winner Match 85", "Winner Match 87"),
    },
    "QUARTER_FINALS": {
        97: ("Winner Match 89", "Winner Match 90"),
        98: ("Winner Match 93", "Winner Match 94"),
        99: ("Winner Match 91", "Winner Match 92"),
        100: ("Winner Match 95", "Winner Match 96"),
    },
    "SEMI_FINALS": {
        101: ("Winner Match 97", "Winner Match 98"),
        102: ("Winner Match 99", "Winner Match 100"),
    },
    "FINAL": {
        104: ("Winner Match 101", "Winner Match 102"),
    },
    "THIRD_PLACE": {
        103: ("Loser Match 101", "Loser Match 102"),
    },
}

WC_2026_KNOCKOUT_BRACKET_ORDER: dict[str, tuple[int, ...]] = {
    "LAST_32": (73, 75, 74, 77, 76, 78, 79, 80, 83, 84, 81, 82, 86, 88, 85, 87),
    "LAST_16": (89, 90, 93, 94, 91, 92, 95, 96),
    "QUARTER_FINALS": (97, 98, 99, 100),
    "SEMI_FINALS": (101, 102),
    "FINAL": (104,),
    "THIRD_PLACE": (103,),
}

_FEEDER_FIFA_CODE_RE = re.compile(r"^([123])([A-L]+)$", re.IGNORECASE)
_FEEDER_WINNER_GROUP_RE = re.compile(
    r"^winner\s+(?:of\s+)?group\s+([a-l])$",
    re.IGNORECASE,
)
_FEEDER_RUNNER_UP_GROUP_RE = re.compile(
    r"^(?:runner[- ]?up|second|2nd)\s+(?:placed\s+)?(?:in\s+)?group\s+([a-l])$",
    re.IGNORECASE,
)
_FEEDER_WINNER_MATCH_RE = re.compile(
    r"^winner\s+(?:of\s+)?match\s+(\d+)$",
    re.IGNORECASE,
)
_FEEDER_LOSER_MATCH_RE = re.compile(
    r"^loser\s+(?:of\s+)?match\s+(\d+)$",
    re.IGNORECASE,
)
_FEEDER_THIRD_GROUP_RE = re.compile(
    r"^3(?:rd)?\s+(?:placed?\s+)?(?:teams?\s+)?(?:group\s+)?([a-l/]+)$",
    re.IGNORECASE,
)


def _format_third_place_groups(groups: str) -> str:
    letters = [letter.upper() for letter in groups if letter.isalpha()]
    if len(letters) == 0:
        return "3rd place"
    return f"3rd Group {'/'.join(letters)}"


def normalise_knockout_feeder_label(text: str) -> str | None:
    candidate = text.strip()
    if candidate.casefold() in {"", "tbd"}:
        return None

    winner_group = _FEEDER_WINNER_GROUP_RE.match(candidate)
    if winner_group is not None:
        return f"Winner Group {winner_group.group(1).upper()}"

    runner_up_group = _FEEDER_RUNNER_UP_GROUP_RE.match(candidate)
    if runner_up_group is not None:
        return f"Runner-up Group {runner_up_group.group(1).upper()}"

    winner_match = _FEEDER_WINNER_MATCH_RE.match(candidate)
    if winner_match is not None:
        return f"Winner Match {winner_match.group(1)}"

    loser_match = _FEEDER_LOSER_MATCH_RE.match(candidate)
    if loser_match is not None:
        return f"Loser Match {loser_match.group(1)}"

    third_group = _FEEDER_THIRD_GROUP_RE.match(candidate)
    if third_group is not None:
        return _format_third_place_groups(third_group.group(1))

    fifa_code = _FEEDER_FIFA_CODE_RE.match(candidate)
    if fifa_code is not None:
        position, groups = fifa_code.group(1), fifa_code.group(2).upper()
        if position == "1":
            return f"Winner Group {groups}"
        if position == "2":
            return f"Runner-up Group {groups}"
        return _format_third_place_groups(groups)

    if candidate.startswith("3rd Group "):
        return candidate

    return None


def bracket_feeder_label_from_team(team: "Team") -> str | None:
    if team_is_confirmed(team):
        return None

    for value in (team.name, team.short_name, team.tla):
        if value is None:
            continue
        label = normalise_knockout_feeder_label(str(value))
        if label is not None:
            return label

    return None


def _feeder_signature(label: str) -> str:
    return label.strip().casefold()


def knockout_winner_team_id(match: "Match") -> int | None:
    side = knockout_winner_side(match)
    if side is None:
        return None

    team = match.home_team if side == "home" else match.away_team
    if not team_is_confirmed(team):
        return None
    return team.id


def knockout_round_team_ids(match: "Match") -> tuple[int | None, int | None]:
    home_id = match.home_team.id if team_is_confirmed(match.home_team) else None
    away_id = match.away_team.id if team_is_confirmed(match.away_team) else None
    return home_id, away_id


def _knockout_stage_has_fixture_order(stage: str, matches: list["Match"]) -> bool:
    if len(matches) <= 1:
        return True
    if stage not in WC_2026_KNOCKOUT_BRACKET_ORDER:
        return False
    return all(
        identify_knockout_fixture_number(stage, match) is not None for match in matches
    )


def _fixture_number_from_winner_match_label(label: str) -> int | None:
    winner_match = _FEEDER_WINNER_MATCH_RE.match(label.strip())
    if winner_match is None:
        return None
    return int(winner_match.group(1))


def chronological_knockout_fixture_map(
    stage: str,
    matches: list["Match"],
) -> dict[int, "Match"]:
    """Assign FIFA fixture numbers by sorting matches within the stage by kick-off time."""
    bracket_order = WC_2026_KNOCKOUT_BRACKET_ORDER.get(stage, ())
    if len(bracket_order) == 0:
        return {}

    chrono_matches = sorted(matches, key=lambda match: match.utc_date)
    mapping: dict[int, Match] = {}
    for index, match in enumerate(chrono_matches):
        if index >= len(bracket_order):
            break
        mapping[bracket_order[index]] = match
    return mapping


def chronological_knockout_fixture_number(
    stage: str,
    match: "Match",
    matches: list["Match"],
) -> int | None:
    for fixture_number, mapped_match in chronological_knockout_fixture_map(
        stage,
        matches,
    ).items():
        if mapped_match.id == match.id:
            return fixture_number
    return None


def bracket_fixture_number_for_match(
    stage: str,
    match: "Match",
    matches: list["Match"],
    *,
    bracket_index: int | None = None,
) -> int | None:
    fixture_number = identify_knockout_fixture_number(stage, match)
    if fixture_number is not None:
        return fixture_number

    fixture_number = chronological_knockout_fixture_number(stage, match, matches)
    if fixture_number is not None:
        return fixture_number

    if bracket_index is not None:
        bracket_order = WC_2026_KNOCKOUT_BRACKET_ORDER.get(stage, ())
        if bracket_index < len(bracket_order):
            return bracket_order[bracket_index]
    return None


def order_stage_by_chronological_fixtures(
    stage: str,
    matches: list["Match"],
) -> list["Match"]:
    fixture_map = chronological_knockout_fixture_map(stage, matches)
    bracket_order = WC_2026_KNOCKOUT_BRACKET_ORDER.get(stage, ())
    if len(bracket_order) == 0:
        return sorted(matches, key=lambda match: match.utc_date)

    ordered = [
        fixture_map[fixture_number]
        for fixture_number in bracket_order
        if fixture_number in fixture_map
    ]
    if len(ordered) == len(matches):
        return ordered
    return sorted(matches, key=lambda match: match.utc_date)


def order_knockout_round_by_fixture_feeders(
    prev_matches: list["Match"],
    next_ordered: list["Match"],
    *,
    prev_stage: str,
    next_stage: str,
) -> list["Match"] | None:
    if len(prev_matches) != 2 * len(next_ordered):
        return None

    prev_fixture_map = chronological_knockout_fixture_map(prev_stage, prev_matches)
    next_bracket_order = WC_2026_KNOCKOUT_BRACKET_ORDER.get(next_stage, ())
    next_fixtures = WC_2026_KNOCKOUT_FIXTURES.get(next_stage, {})
    if len(prev_fixture_map) == 0 or len(next_bracket_order) == 0:
        return None

    result: list["Match | None"] = [None] * len(prev_matches)
    used_ids: set[int] = set()

    for next_idx, _next_match in enumerate(next_ordered):
        next_fixture = (
            next_bracket_order[next_idx]
            if next_idx < len(next_bracket_order)
            else None
        )
        if next_fixture is None:
            return None

        feeder_labels = next_fixtures.get(next_fixture)
        if feeder_labels is None:
            return None

        for slot_offset, feeder_label in enumerate(feeder_labels):
            feeder_fixture = _fixture_number_from_winner_match_label(feeder_label)
            if feeder_fixture is None:
                return None
            feeder_match = prev_fixture_map.get(feeder_fixture)
            if feeder_match is None or feeder_match.id in used_ids:
                return None
            result[2 * next_idx + slot_offset] = feeder_match
            used_ids.add(feeder_match.id)

    ordered: list["Match"] = []
    for match in result:
        if match is None:
            return None
        ordered.append(match)
    return ordered


def _order_knockout_stages_by_results(
    stage_matches: list[tuple[tuple[str, str, str], list["Match"]]],
) -> list[tuple[tuple[str, str, str], list["Match"]]] | None:
    ordered_by_stage: dict[str, list["Match"]] = {}
    last_meta, last_matches = stage_matches[-1]
    ordered_by_stage[last_meta[0]] = sorted(last_matches, key=lambda match: match.utc_date)

    for index in range(len(stage_matches) - 2, -1, -1):
        meta, prev_matches = stage_matches[index]
        stage = meta[0]
        next_stage = stage_matches[index + 1][0][0]
        reordered = order_knockout_round_by_next_round(
            prev_matches,
            ordered_by_stage[next_stage],
            prev_stage=stage,
        )
        if reordered is None:
            return None
        ordered_by_stage[stage] = reordered

    return [(meta, ordered_by_stage[meta[0]]) for meta, _ in stage_matches]


def _order_knockout_stages_by_fixture_feeders(
    stage_matches: list[tuple[tuple[str, str, str], list["Match"]]],
) -> list[tuple[tuple[str, str, str], list["Match"]]]:
    ordered_by_stage: dict[str, list["Match"]] = {}
    last_meta, last_matches = stage_matches[-1]
    ordered_by_stage[last_meta[0]] = sorted(last_matches, key=lambda match: match.utc_date)

    for index in range(len(stage_matches) - 2, -1, -1):
        meta, prev_matches = stage_matches[index]
        stage = meta[0]
        next_stage = stage_matches[index + 1][0][0]
        reordered = order_knockout_round_by_fixture_feeders(
            prev_matches,
            ordered_by_stage[next_stage],
            prev_stage=stage,
            next_stage=next_stage,
        )
        if reordered is None:
            reordered = order_stage_by_chronological_fixtures(stage, prev_matches)
        ordered_by_stage[stage] = reordered

    return [(meta, ordered_by_stage[meta[0]]) for meta, _ in stage_matches]


def _find_bracket_feeder_match(
    prev_matches: list["Match"],
    *,
    team_id: int | None,
    team: "Team",
    prev_stage: str,
    used_ids: set[int],
) -> "Match | None":
    if team_id is not None:
        winner_match = None
        participant_match = None
        for match in prev_matches:
            if match.id in used_ids:
                continue
            if not knockout_match_has_confirmed_teams(match):
                continue
            if team_id not in {match.home_team.id, match.away_team.id}:
                continue
            participant_match = match
            if knockout_winner_team_id(match) == team_id:
                winner_match = match
                break
        if winner_match is not None:
            return winner_match
        if participant_match is not None:
            return participant_match

    label = bracket_feeder_label_from_team(team)
    if label is not None:
        winner_match = _FEEDER_WINNER_MATCH_RE.match(label)
        if winner_match is not None:
            fixture_num = int(winner_match.group(1))
            if fixture_num in WC_2026_KNOCKOUT_FIXTURES.get(prev_stage, {}):
                for match in prev_matches:
                    if match.id in used_ids:
                        continue
                    if identify_knockout_fixture_number(prev_stage, match) == fixture_num:
                        return match
    return None


def order_knockout_round_by_next_round(
    prev_matches: list["Match"],
    next_ordered: list["Match"],
    *,
    prev_stage: str,
) -> list["Match"] | None:
    if len(prev_matches) != 2 * len(next_ordered):
        return None

    result: list["Match | None"] = [None] * len(prev_matches)
    used_ids: set[int] = set()

    for next_idx, next_match in enumerate(next_ordered):
        home_id, away_id = knockout_round_team_ids(next_match)
        slot_teams = (
            (0, home_id, next_match.home_team),
            (1, away_id, next_match.away_team),
        )
        for slot_offset, team_id, team in slot_teams:
            feeder = _find_bracket_feeder_match(
                prev_matches,
                team_id=team_id,
                team=team,
                prev_stage=prev_stage,
                used_ids=used_ids,
            )
            if feeder is None:
                return None
            result[2 * next_idx + slot_offset] = feeder
            used_ids.add(feeder.id)

    ordered: list["Match"] = []
    for match in result:
        if match is None:
            return None
        ordered.append(match)
    return ordered


def order_knockout_stages_for_bracket(
    stage_matches: list[tuple[tuple[str, str, str], list["Match"]]],
) -> list[tuple[tuple[str, str, str], list["Match"]]]:
    if len(stage_matches) == 0:
        return stage_matches

    if all(
        _knockout_stage_has_fixture_order(stage, matches)
        for (stage, _, _), matches in stage_matches
    ):
        return [
            (meta, order_knockout_matches_for_bracket(meta[0], matches))
            for meta, matches in stage_matches
        ]

    result_ordered = _order_knockout_stages_by_results(stage_matches)
    if result_ordered is not None:
        return result_ordered

    return _order_knockout_stages_by_fixture_feeders(stage_matches)


def identify_knockout_fixture_number(stage: str, match: "Match") -> int | None:
    fixtures = WC_2026_KNOCKOUT_FIXTURES.get(stage)
    if fixtures is None:
        return None

    home_label = bracket_feeder_label_from_team(match.home_team)
    away_label = bracket_feeder_label_from_team(match.away_team)
    if home_label is None and away_label is None:
        return None

    home_key = _feeder_signature(home_label) if home_label is not None else None
    away_key = _feeder_signature(away_label) if away_label is not None else None

    for fixture_number, (fixture_home, fixture_away) in fixtures.items():
        fixture_home_key = _feeder_signature(fixture_home)
        fixture_away_key = _feeder_signature(fixture_away)
        if home_key is not None and away_key is not None:
            if home_key == fixture_home_key and away_key == fixture_away_key:
                return fixture_number
            continue

        if home_key is not None and home_key in {fixture_home_key, fixture_away_key}:
            if away_key is None or away_key in {fixture_home_key, fixture_away_key}:
                return fixture_number
        if away_key is not None and away_key in {fixture_home_key, fixture_away_key}:
            if home_key is None or home_key in {fixture_home_key, fixture_away_key}:
                return fixture_number

    return None


def order_knockout_matches_for_bracket(stage: str, matches: list["Match"]) -> list["Match"]:
    bracket_order = WC_2026_KNOCKOUT_BRACKET_ORDER.get(stage)
    if bracket_order is None or len(matches) <= 1:
        return matches

    matches_by_fixture: dict[int, Match] = {}
    unmatched: list[Match] = []
    for match in matches:
        fixture_number = identify_knockout_fixture_number(stage, match)
        if fixture_number is None:
            unmatched.append(match)
            continue
        matches_by_fixture[fixture_number] = match

    ordered = [matches_by_fixture[fixture_number] for fixture_number in bracket_order if fixture_number in matches_by_fixture]
    if len(unmatched) > 0:
        unmatched.sort(key=lambda item: item.utc_date)
        ordered.extend(unmatched)
    return ordered


def bracket_team_label(
    team: "Team",
    *,
    stage: str,
    fixture_number: int | None,
    side: str,
) -> str:
    if team_is_confirmed(team):
        return team.display_name

    parsed_label = bracket_feeder_label_from_team(team)
    if parsed_label is not None:
        return parsed_label

    if fixture_number is not None:
        fixtures = WC_2026_KNOCKOUT_FIXTURES.get(stage, {})
        fixture_labels = fixtures.get(fixture_number)
        if fixture_labels is not None:
            return fixture_labels[0 if side == "home" else 1]

    return "TBD"


def wc_flag_cache_version() -> int:
    try:
        with WC_FLAG_CACHE_VERSION_PATH.open(encoding="utf-8") as handle:
            payload = json.load(handle)
        return int(payload["version"])
    except (FileNotFoundError, json.JSONDecodeError, KeyError, TypeError, ValueError):
        return 1


def bump_wc_flag_cache_version() -> int:
    version = wc_flag_cache_version() + 1
    with WC_FLAG_CACHE_VERSION_PATH.open("w", encoding="utf-8") as handle:
        json.dump({"version": version}, handle, indent=2)
        handle.write("\n")
    return version


def resolve_world_cup_crest_url(team_id: int) -> str:
    cache_suffix = f"?v={wc_flag_cache_version()}"
    if (WC_CREST_STATIC_DIR / f"{team_id}.png").is_file():
        return f"/images/football/crests/wc/{team_id}.png{cache_suffix}"
    if (WC_CREST_STATIC_DIR / f"{team_id}.svg").is_file():
        return f"/images/football/crests/wc/{team_id}.svg{cache_suffix}"
    return WC_CREST_UNKNOWN_URL
