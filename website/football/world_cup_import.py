from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from pydantic import BaseModel, Field
from pymongo.operations import UpdateOne

from .models import (
    Area,
    Competition,
    FullTime,
    HalfTime,
    Match,
    MatchStatus,
    Odds,
    Score,
    Season,
    TableItem,
    Team,
)
from .world_cup_utils import (
    WC_GROUP_STAGE,
    edition_has_group_stage,
    group_enum_to_slug,
    group_order_for_edition,
    group_slug_to_enum,
    group_slug_to_label,
    standings_label_to_slug,
)

OPENFOOTBALL_BASE_URL = (
    "https://raw.githubusercontent.com/openfootball/worldcup.json/master"
)
WC_AREA = Area(id=2267, name="World", code="INT", flag=None)
WC_COMPETITION = Competition(
    id=2000,
    name="FIFA World Cup",
    code="WC",
    type="CUP",
    emblem="",
)
_TEAM_REGISTRY_PATH = Path(__file__).with_name("wc_team_registry.json")
_MATCHDAY_RE = re.compile(r"^Matchday\s+(\d+)$", re.IGNORECASE)


class WorldCupGroupStandingsDocument(BaseModel):
    edition: str
    group_slug: str
    group_label: str
    group_enum: str
    table: list[TableItem] = Field(default_factory=list)


def _load_team_registry() -> dict[str, dict[str, object]]:
    with _TEAM_REGISTRY_PATH.open(encoding="utf-8") as registry_file:
        return json.load(registry_file)


def _team_from_name(name: str, registry: dict[str, dict[str, object]]) -> Team:
    entry = registry.get(name.strip())
    if entry is None:
        logging.warning("No team registry entry for %s", name)
        return Team(name=name, short_name=name, tla=None, id=None, crest=None)

    team_id = entry.get("id")
    return Team(
        id=int(team_id) if team_id is not None else None,
        name=name,
        short_name=str(entry.get("short_name", name)),
        tla=str(entry["tla"]) if entry.get("tla") is not None else None,
        crest=None,
    )


def _parse_openfootball_datetime(date_value: str, time_value: str | None) -> datetime:
    if time_value:
        local = datetime.strptime(
            f"{date_value} {time_value}",
            "%Y-%m-%d %H:%M",
        )
        return local.replace(tzinfo=UTC)
    return datetime.strptime(date_value, "%Y-%m-%d").replace(
        hour=12,
        minute=0,
        tzinfo=UTC,
    )


def _score_winner(home: int | None, away: int | None) -> str | None:
    if home is None or away is None:
        return None
    if home > away:
        return "HOME_TEAM"
    if away > home:
        return "AWAY_TEAM"
    return "DRAW"


def _parse_score(score_payload: dict[str, Any] | None) -> Score:
    if score_payload is None:
        return Score(
            winner=None,
            duration="REGULAR",
            full_time=FullTime(home=None, away=None),
            half_time=HalfTime(home=None, away=None),
        )

    full_time = score_payload.get("ft")
    half_time = score_payload.get("ht")
    home_ft = full_time[0] if isinstance(full_time, list) and len(full_time) == 2 else None
    away_ft = full_time[1] if isinstance(full_time, list) and len(full_time) == 2 else None
    home_ht = half_time[0] if isinstance(half_time, list) and len(half_time) == 2 else None
    away_ht = half_time[1] if isinstance(half_time, list) and len(half_time) == 2 else None

    return Score(
        winner=_score_winner(home_ft, away_ft),
        duration="REGULAR",
        full_time=FullTime(home=home_ft, away=away_ft),
        half_time=HalfTime(home=home_ht, away=away_ht),
    )


def _map_openfootball_round(round_name: str) -> tuple[str, int | None, str | None]:
    matchday_match = _MATCHDAY_RE.match(round_name.strip())
    if matchday_match is not None:
        return WC_GROUP_STAGE, int(matchday_match.group(1)), None

    mapping = {
        "Preliminary round": ("LAST_16", None),
        "Round of 16": ("LAST_16", None),
        "Round of 32": ("LAST_32", None),
        "Quarter-finals": ("QUARTER_FINALS", None),
        "Quarter-finals, Replays": ("QUARTER_FINALS", None),
        "Semi-finals": ("SEMI_FINALS", None),
        "Third-place match": ("THIRD_PLACE", None),
        "Match for third place": ("THIRD_PLACE", None),
        "3rd place playoff": ("THIRD_PLACE", None),
        "Final": ("FINAL", None),
    }
    mapped = mapping.get(round_name.strip())
    if mapped is None:
        raise ValueError(f"Unsupported openfootball round: {round_name}")
    stage, group = mapped
    return stage, None, group


def _season_for_edition(edition: str) -> Season:
    year = int(edition)
    return Season(
        id=year,
        start_date=f"{year}-01-01",
        end_date=f"{year}-12-31",
        current_matchday=0,
        winner=None,
    )


def fetch_openfootball_matches(edition: str) -> list[dict[str, Any]]:
    url = f"{OPENFOOTBALL_BASE_URL}/{edition}/worldcup.json"
    with urlopen(url, timeout=60) as response:
        payload = json.load(response)

    if isinstance(payload, list):
        return payload
    return payload.get("matches", [])


def openfootball_matches_to_models(edition: str) -> list[Match]:
    registry = _load_team_registry()
    raw_matches = fetch_openfootball_matches(edition)
    season = _season_for_edition(edition)
    now = datetime.now(tz=UTC)
    matches: list[Match] = []

    for index, raw_match in enumerate(raw_matches, start=1):
        round_name = str(raw_match.get("round", "")).strip()
        stage, matchday, _ = _map_openfootball_round(round_name)

        group_enum: str | None = None
        if stage == WC_GROUP_STAGE:
            group_label = raw_match.get("group")
            if group_label is None:
                raise ValueError(f"Group-stage match missing group: {raw_match}")
            group_enum = group_slug_to_enum(standings_label_to_slug(str(group_label)))

        home_name = str(raw_match.get("team1", "")).strip()
        away_name = str(raw_match.get("team2", "")).strip()
        score = _parse_score(raw_match.get("score"))
        has_result = (
            score.full_time.home is not None and score.full_time.away is not None
        )

        matches.append(
            Match(
                area=WC_AREA,
                competition=WC_COMPETITION,
                season=season,
                id=int(edition) * 1000 + index,
                utc_date=_parse_openfootball_datetime(
                    str(raw_match["date"]),
                    raw_match.get("time"),
                ),
                status=MatchStatus.finished if has_result else MatchStatus.scheduled,
                matchday=matchday,
                stage=stage,
                group=group_enum,
                last_updated=now,
                home_team=_team_from_name(home_name, registry),
                away_team=_team_from_name(away_name, registry),
                score=score,
                odds=Odds(msg=""),
                referees=[],
            )
        )

    return matches


class _GroupStats(BaseModel):
    team: Team
    played: int = 0
    won: int = 0
    draw: int = 0
    lost: int = 0
    goals_for: int = 0
    goals_against: int = 0

    @property
    def points(self) -> int:
        return self.won * 3 + self.draw

    @property
    def goal_difference(self) -> int:
        return self.goals_for - self.goals_against


def _apply_group_result(
    stats: dict[int, _GroupStats],
    team: Team,
    goals_for: int,
    goals_against: int,
) -> None:
    if team.id is None:
        return

    row = stats.setdefault(team.id, _GroupStats(team=team))
    row.played += 1
    row.goals_for += goals_for
    row.goals_against += goals_against

    if goals_for > goals_against:
        row.won += 1
    elif goals_for < goals_against:
        row.lost += 1
    else:
        row.draw += 1


def compute_group_standings(matches: list[Match], edition: str) -> list[WorldCupGroupStandingsDocument]:
    if not edition_has_group_stage(edition):
        return []

    standings_by_slug: dict[str, dict[int, _GroupStats]] = {}

    for match in matches:
        if match.stage != WC_GROUP_STAGE or match.group is None:
            continue

        home_score = match.score.full_time.home
        away_score = match.score.full_time.away
        if home_score is None or away_score is None:
            continue

        slug = group_enum_to_slug(match.group)
        group_stats = standings_by_slug.setdefault(slug, {})
        _apply_group_result(group_stats, match.home_team, home_score, away_score)
        _apply_group_result(group_stats, match.away_team, away_score, home_score)

    documents: list[WorldCupGroupStandingsDocument] = []
    for slug in group_order_for_edition(edition):
        group_stats = standings_by_slug.get(slug)
        if group_stats is None:
            continue

        ordered_rows = sorted(
            group_stats.values(),
            key=lambda row: (
                -row.points,
                -row.goal_difference,
                -row.goals_for,
                row.team.display_name.casefold(),
            ),
        )
        table = [
            TableItem(
                position=position,
                team=row.team,
                played_games=row.played,
                won=row.won,
                draw=row.draw,
                lost=row.lost,
                points=row.points,
                goals_for=row.goals_for,
                goals_against=row.goals_against,
                goal_difference=row.goal_difference,
            )
            for position, row in enumerate(ordered_rows, start=1)
        ]
        documents.append(
            WorldCupGroupStandingsDocument(
                edition=edition,
                group_slug=slug,
                group_label=group_slug_to_label(slug),
                group_enum=group_slug_to_enum(slug),
                table=table,
            )
        )

    return documents


def write_edition_to_mongo(
    edition: str,
    *,
    matches_collection,
    standings_collection,
    drop_existing: bool = False,
) -> tuple[int, int]:
    matches = openfootball_matches_to_models(edition)

    if drop_existing:
        matches_collection.drop()
        if standings_collection is not None:
            standings_collection.drop()

    match_operations = [
        UpdateOne({"id": match.id}, {"$set": match.model_dump()}, upsert=True)
        for match in matches
    ]
    if len(match_operations) > 0:
        matches_collection.bulk_write(match_operations)

    standings_count = 0
    if edition_has_group_stage(edition) and standings_collection is not None:
        standings_documents = compute_group_standings(matches, edition)
        standings_operations = [
            UpdateOne(
                {"edition": document.edition, "group_slug": document.group_slug},
                {"$set": document.model_dump()},
                upsert=True,
            )
            for document in standings_documents
        ]
        if len(standings_operations) > 0:
            standings_collection.bulk_write(standings_operations)
            standings_count = len(standings_operations)

    return len(matches), standings_count
