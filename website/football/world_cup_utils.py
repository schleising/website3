from __future__ import annotations

from functools import lru_cache
from pathlib import Path

WC_CURRENT_EDITION = "2026"
WC_CREST_UNKNOWN_URL = "/images/football/crests/unknown_team.svg"
WC_CREST_STATIC_DIR = (
    Path(__file__).resolve().parents[1] / "static" / "images" / "football" / "crests" / "wc"
)
WC_GROUP_STAGE = "GROUP_STAGE"
WC_GROUP_ORDER = tuple(chr(code) for code in range(ord("a"), ord("l") + 1))


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


@lru_cache(maxsize=128)
def resolve_world_cup_crest_url(team_id: int) -> str:
    if (WC_CREST_STATIC_DIR / f"{team_id}.png").is_file():
        return f"/images/football/crests/wc/{team_id}.png"
    if (WC_CREST_STATIC_DIR / f"{team_id}.svg").is_file():
        return f"/images/football/crests/wc/{team_id}.svg"
    return WC_CREST_UNKNOWN_URL
