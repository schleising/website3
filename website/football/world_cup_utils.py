from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import Match, Team

WC_CURRENT_EDITION = "2026"
WC_CREST_UNKNOWN_URL = "/images/football/crests/unknown_team.svg"
WC_CREST_STATIC_DIR = (
    Path(__file__).resolve().parents[1] / "static" / "images" / "football" / "crests" / "wc"
)
WC_GROUP_STAGE = "GROUP_STAGE"
WC_GROUP_ORDER = tuple(chr(code) for code in range(ord("a"), ord("l") + 1))
WC_2022_GROUP_ORDER = tuple(chr(code) for code in range(ord("a"), ord("h") + 1))

WC_EDITION_REGISTRY: dict[str, dict[str, object]] = {
    "1934": {"has_group_stage": False, "group_order": ()},
    "1938": {"has_group_stage": False, "group_order": ()},
    "2022": {"has_group_stage": True, "group_order": WC_2022_GROUP_ORDER},
    "2026": {"has_group_stage": True, "group_order": WC_GROUP_ORDER},
}


def world_cup_edition_query(edition: str) -> str:
    return f"?edition={edition}"


def edition_has_group_stage(edition: str) -> bool:
    entry = WC_EDITION_REGISTRY.get(edition)
    if entry is not None:
        return bool(entry.get("has_group_stage", True))
    return True


def group_order_for_edition(edition: str) -> tuple[str, ...]:
    entry = WC_EDITION_REGISTRY.get(edition)
    if entry is not None:
        group_order = entry.get("group_order")
        if isinstance(group_order, tuple) and len(group_order) > 0:
            return group_order
    return WC_GROUP_ORDER

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
    return f"Group {normalise_group_slug(group_slug).upper()}"


def adjacent_group_slugs(
    group_slug: str,
    edition: str | None = None,
) -> tuple[str, str]:
    slug = normalise_group_slug(group_slug)
    group_order = group_order_for_edition(edition or WC_CURRENT_EDITION)
    index = group_order.index(slug)
    group_count = len(group_order)
    return (
        group_order[(index - 1) % group_count],
        group_order[(index + 1) % group_count],
    )


def standings_label_to_slug(label: str) -> str:
    return label.removeprefix("Group ").strip().lower()


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


def _knockout_fixture_key(match: "Match") -> tuple[str, frozenset[int | None]]:
    return (match.stage, frozenset((match.home_team.id, match.away_team.id)))


def filter_superseded_knockout_replays(matches: list["Match"]) -> list["Match"]:
    """Drop the original fixture when the same knockout tie was replayed."""
    knockout_matches = [match for match in matches if match.stage != WC_GROUP_STAGE]
    if len(knockout_matches) <= 1:
        return matches

    fixtures: dict[tuple[str, frozenset[int | None]], list["Match"]] = {}
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
        if match.stage == WC_GROUP_STAGE or match.id in kept_knockout_ids
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


@lru_cache(maxsize=128)
def resolve_world_cup_crest_url(team_id: int) -> str:
    if (WC_CREST_STATIC_DIR / f"{team_id}.png").is_file():
        return f"/images/football/crests/wc/{team_id}.png"
    if (WC_CREST_STATIC_DIR / f"{team_id}.svg").is_file():
        return f"/images/football/crests/wc/{team_id}.svg"
    return WC_CREST_UNKNOWN_URL
