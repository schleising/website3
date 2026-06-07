from __future__ import annotations

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


def knockout_winner_side(match: "Match") -> str | None:
    from .models import MatchStatus

    if match.status not in {MatchStatus.finished, MatchStatus.awarded}:
        return None

    home_score = match.score.full_time.home
    away_score = match.score.full_time.away
    if home_score is None or away_score is None:
        return None
    if home_score > away_score:
        return "home"
    if away_score > home_score:
        return "away"
    return None


@lru_cache(maxsize=128)
def resolve_world_cup_crest_url(team_id: int) -> str:
    if (WC_CREST_STATIC_DIR / f"{team_id}.png").is_file():
        return f"/images/football/crests/wc/{team_id}.png"
    if (WC_CREST_STATIC_DIR / f"{team_id}.svg").is_file():
        return f"/images/football/crests/wc/{team_id}.svg"
    return WC_CREST_UNKNOWN_URL
