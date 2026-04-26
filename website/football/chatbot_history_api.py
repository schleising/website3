from __future__ import annotations

from datetime import UTC, datetime
from time import perf_counter
import re

import bcrypt
from fastapi import APIRouter, Depends, Header, HTTPException, status

from . import football_api_keys
from .chatbot_history_models import (
    FootballHistoryGroupBy,
    FootballHistoryRequestEnvelope,
    FootballHistoryResponseEnvelope,
    FootballHistoryResponseMetadata,
    FootballHistoryResponseModel,
    FootballHistoryStatus,
)
from .football_db import (
    get_available_season_keys,
    get_competition_name_for_season,
    get_table_db_for_season,
    retreive_matches,
)
from .football_utils import update_match_timezone
from .models import LiveTableItem, Match, Team


football_history_api_router = APIRouter()

API_KEY_PATTERN = re.compile(r"^fha_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{24,})$")
SEASON_LABEL_PATTERN = re.compile(r"^(\d{4})/(\d{2})$")


def _normalise_value(value: str) -> str:
    return " ".join(value.lower().strip().split())


def _parse_season_label_to_key(label: str) -> str:
    matched = SEASON_LABEL_PATTERN.fullmatch(label.strip())

    if matched is None:
        raise ValueError(f"Invalid season label: {label}")

    season_start_year = int(matched.group(1))
    season_end_short = int(matched.group(2))
    season_end_year = (season_start_year // 100) * 100 + season_end_short

    if season_end_year < season_start_year:
        season_end_year += 100

    return f"{season_start_year}_{season_end_year}"


def _season_label_from_key(season_key: str) -> str:
    season_start, season_end = season_key.split("_", maxsplit=1)
    return f"{season_start}/{season_end[-2:]}"


def _season_bounds_utc(season_key: str) -> tuple[datetime, datetime]:
    season_start, season_end = season_key.split("_", maxsplit=1)
    start_year = int(season_start)
    end_year = int(season_end)

    return (
        datetime(start_year, 8, 1, tzinfo=UTC),
        datetime(end_year, 8, 1, tzinfo=UTC),
    )


def _team_aliases(team: Team) -> set[str]:
    return {
        _normalise_value(team.name),
        _normalise_value(str(team.short_name)),
        _normalise_value(team.tla),
    }


def _team_matches_any(team: Team, team_filters: set[str]) -> bool:
    if len(team_filters) == 0:
        return True

    aliases = _team_aliases(team)
    return any(alias in team_filters for alias in aliases)


def _team_matches_name(team: Team, team_name: str) -> bool:
    target = _normalise_value(team_name)
    return target in _team_aliases(team)


def _match_is_draw(match: Match) -> bool:
    winner = str(match.score.winner or "")
    return winner.upper() == "DRAW"


def _home_team_won(match: Match) -> bool:
    winner = str(match.score.winner or "")
    return winner.upper() == "HOME_TEAM"


def _away_team_won(match: Match) -> bool:
    winner = str(match.score.winner or "")
    return winner.upper() == "AWAY_TEAM"


def _winner_label(match: Match) -> str:
    if _home_team_won(match):
        return str(match.home_team.short_name)
    if _away_team_won(match):
        return str(match.away_team.short_name)
    if _match_is_draw(match):
        return "Draw"

    return "Unknown"


def _match_passes_team_filter(match: Match, team_filters: set[str], venue: str) -> bool:
    if len(team_filters) == 0:
        return True

    home_matches = _team_matches_any(match.home_team, team_filters)
    away_matches = _team_matches_any(match.away_team, team_filters)

    if venue == "home":
        return home_matches
    if venue == "away":
        return away_matches

    return home_matches or away_matches


def _match_to_result_row(match: Match, season_key: str) -> dict[str, object]:
    home_goals = match.score.full_time.home
    away_goals = match.score.full_time.away

    return {
        "season": _season_label_from_key(season_key),
        "season_key": season_key,
        "competition": get_competition_name_for_season(season_key),
        "utc_date": match.utc_date.isoformat(),
        "status": str(match.status),
        "matchday": match.matchday,
        "home_team": str(match.home_team.short_name),
        "away_team": str(match.away_team.short_name),
        "home_goals": home_goals,
        "away_goals": away_goals,
        "winner": _winner_label(match),
    }


def _normalise_metrics_fields(data: list[dict[str, object]], group_fields: list[str], metrics: list[str]) -> list[dict[str, object]]:
    normalised_rows: list[dict[str, object]] = []

    for row in data:
        output: dict[str, object] = {}

        for field in group_fields:
            if field in row:
                output[field] = row[field]

        for metric in metrics:
            if metric in row:
                output[metric] = row[metric]

        if "league_titles" in row and "team" in group_fields:
            output["league_titles"] = row["league_titles"]

        normalised_rows.append(output)

    return normalised_rows


def _sort_key(value: object) -> tuple[int, float | str]:
    if value is None:
        return (2, "")

    if isinstance(value, (int, float)):
        return (0, float(value))

    return (1, str(value).lower())


def _to_int(value: object) -> int:
    if isinstance(value, bool):
        return int(value)

    if isinstance(value, int):
        return value

    if isinstance(value, float):
        return int(value)

    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return 0

    return 0


def _apply_sort_and_limit(
    rows: list[dict[str, object]],
    sort_field: str | None,
    sort_order: str,
    limit: int | None,
) -> list[dict[str, object]]:
    output = rows.copy()

    if sort_field is not None and sort_field != "":
        output.sort(
            key=lambda item: _sort_key(item.get(sort_field)),
            reverse=(sort_order == "desc"),
        )

    if limit is not None:
        output = output[:limit]

    return output


async def _resolve_requested_seasons(
    season_start: str | None,
    season_end: str | None,
    competitions: list[str],
) -> list[str]:
    available_seasons = await get_available_season_keys()

    if len(available_seasons) == 0:
        return []

    if season_start is None and season_end is None:
        selected_seasons = available_seasons.copy()
    else:
        start_key = _parse_season_label_to_key(season_start or season_end or "")
        end_key = _parse_season_label_to_key(season_end or season_start or "")

        start_year = int(start_key.split("_", maxsplit=1)[0])
        end_year = int(end_key.split("_", maxsplit=1)[0])

        lower_year = min(start_year, end_year)
        upper_year = max(start_year, end_year)

        selected_seasons = [
            season_key
            for season_key in available_seasons
            if lower_year <= int(season_key.split("_", maxsplit=1)[0]) <= upper_year
        ]

    competition_filters = {_normalise_value(item) for item in competitions}

    if len(competition_filters) == 0:
        return selected_seasons

    return [
        season_key
        for season_key in selected_seasons
        if _normalise_value(get_competition_name_for_season(season_key)) in competition_filters
    ]


async def _fetch_matches_by_season(season_keys: list[str]) -> dict[str, list[Match]]:
    matches_by_season: dict[str, list[Match]] = {}

    for season_key in season_keys:
        date_from, date_to = _season_bounds_utc(season_key)
        season_matches = await retreive_matches(date_from, date_to, season_key)
        update_match_timezone(season_matches)

        matches_by_season[season_key] = season_matches

    return matches_by_season


async def _build_match_results_data(
    payload: FootballHistoryRequestEnvelope,
    season_keys: list[str],
) -> list[dict[str, object]]:
    team_filters = {_normalise_value(team) for team in payload.request.filters.teams}
    venue = payload.request.filters.venue.value

    data: list[dict[str, object]] = []
    matches_by_season = await _fetch_matches_by_season(season_keys)

    for season_key, season_matches in matches_by_season.items():
        for match in season_matches:
            if not _match_passes_team_filter(match, team_filters, venue):
                continue

            data.append(_match_to_result_row(match, season_key))

    if payload.request.sort_by is None:
        data = _apply_sort_and_limit(
            rows=data,
            sort_field="utc_date",
            sort_order="desc",
            limit=payload.request.limit,
        )
    else:
        data = _apply_sort_and_limit(
            rows=data,
            sort_field=payload.request.sort_by.field,
            sort_order=payload.request.sort_by.order.value,
            limit=payload.request.limit,
        )

    return data


async def _build_league_table_data(
    payload: FootballHistoryRequestEnvelope,
    season_keys: list[str],
) -> list[dict[str, object]]:
    team_filters = {_normalise_value(team) for team in payload.request.filters.teams}

    rows: list[dict[str, object]] = []

    for season_key in season_keys:
        season_table = await get_table_db_for_season(season_key)
        competition = get_competition_name_for_season(season_key)
        season_label = _season_label_from_key(season_key)
        season_start_year = int(season_key.split("_", maxsplit=1)[0])

        for item in season_table:
            if len(team_filters) > 0 and not _team_matches_any(item.team, team_filters):
                continue

            rows.append(
                {
                    "season": season_label,
                    "season_key": season_key,
                    "competition": competition,
                    "season_start_year": season_start_year,
                    "team": str(item.team.short_name),
                    "position": item.position,
                    "matches_played": item.played_games,
                    "wins": item.won,
                    "draws": item.draw,
                    "losses": item.lost,
                    "goals_for": item.goals_for,
                    "goals_against": item.goals_against,
                    "goal_difference": item.goal_difference,
                    "points": item.points,
                }
            )

    if payload.request.sort_by is None:
        rows.sort(
            key=lambda row: (
                -_to_int(row.get("season_start_year")),
                _to_int(row.get("position")),
            )
        )

        if payload.request.limit is not None:
            rows = rows[: payload.request.limit]

        return rows

    return _apply_sort_and_limit(
        rows=rows,
        sort_field=payload.request.sort_by.field,
        sort_order=payload.request.sort_by.order.value,
        limit=payload.request.limit,
    )


def _update_aggregate_bucket(
    bucket: dict[str, object],
    table_item: LiveTableItem,
) -> None:
    bucket["matches_played"] = _to_int(bucket.get("matches_played")) + table_item.played_games
    bucket["wins"] = _to_int(bucket.get("wins")) + table_item.won
    bucket["draws"] = _to_int(bucket.get("draws")) + table_item.draw
    bucket["losses"] = _to_int(bucket.get("losses")) + table_item.lost
    bucket["goals_for"] = _to_int(bucket.get("goals_for")) + table_item.goals_for
    bucket["goals_against"] = _to_int(bucket.get("goals_against")) + table_item.goals_against
    bucket["points"] = _to_int(bucket.get("points")) + table_item.points
    bucket["goal_difference"] = _to_int(bucket.get("goals_for")) - _to_int(bucket.get("goals_against"))


async def _build_aggregate_stats_data(
    payload: FootballHistoryRequestEnvelope,
    season_keys: list[str],
) -> tuple[list[dict[str, object]], str | None]:
    group_by_values = payload.request.group_by or [FootballHistoryGroupBy.team]

    if FootballHistoryGroupBy.manager in group_by_values:
        raise ValueError("Grouping by manager is not currently supported for this dataset.")

    group_fields = [group.value for group in group_by_values]
    if payload.request.metrics is None:
        metric_fields = [
            "goals_for",
            "goals_against",
            "goal_difference",
            "wins",
            "draws",
            "losses",
            "points",
            "matches_played",
        ]
    else:
        metric_fields = [metric.value for metric in payload.request.metrics]
    team_filters = {_normalise_value(team) for team in payload.request.filters.teams}

    grouped_rows: dict[tuple[str, ...], dict[str, object]] = {}

    for season_key in season_keys:
        season_label = _season_label_from_key(season_key)
        competition = get_competition_name_for_season(season_key)
        season_table = await get_table_db_for_season(season_key)

        for item in season_table:
            if len(team_filters) > 0 and not _team_matches_any(item.team, team_filters):
                continue

            group_values: dict[str, str] = {}

            for group_field in group_fields:
                if group_field == "team":
                    group_values["team"] = str(item.team.short_name)
                elif group_field == "season":
                    group_values["season"] = season_label
                elif group_field == "competition":
                    group_values["competition"] = competition

            group_key = tuple(group_values.get(field, "") for field in group_fields)
            bucket = grouped_rows.setdefault(
                group_key,
                {
                    **group_values,
                    "matches_played": 0,
                    "wins": 0,
                    "draws": 0,
                    "losses": 0,
                    "goals_for": 0,
                    "goals_against": 0,
                    "goal_difference": 0,
                    "points": 0,
                    "league_titles": 0,
                },
            )

            _update_aggregate_bucket(bucket, item)

            if item.position == 1 and "team" in group_fields:
                bucket["league_titles"] = _to_int(bucket.get("league_titles")) + 1

    data = _normalise_metrics_fields(
        data=list(grouped_rows.values()),
        group_fields=group_fields,
        metrics=metric_fields,
    )

    if payload.request.sort_by is None:
        default_sort_field = metric_fields[0] if len(metric_fields) > 0 else group_fields[0]
        data = _apply_sort_and_limit(
            rows=data,
            sort_field=default_sort_field,
            sort_order="desc",
            limit=payload.request.limit,
        )
    else:
        data = _apply_sort_and_limit(
            rows=data,
            sort_field=payload.request.sort_by.field,
            sort_order=payload.request.sort_by.order.value,
            limit=payload.request.limit,
        )

    disclaimer = (
        "Points values are summed from stored historical tables. "
        "Older competitions may reflect era-specific points systems."
    )

    return data, disclaimer


async def _build_head_to_head_data(
    payload: FootballHistoryRequestEnvelope,
    season_keys: list[str],
) -> list[dict[str, object]]:
    teams = payload.request.filters.teams

    if len(teams) < 2:
        raise ValueError("Head-to-head queries require at least two team names in filters.teams.")

    team_a_name = teams[0]
    team_b_name = teams[1]

    rows: list[dict[str, object]] = []

    matches_by_season = await _fetch_matches_by_season(season_keys)

    team_a_wins = 0
    team_b_wins = 0
    draws = 0
    team_a_goals = 0
    team_b_goals = 0

    for season_key, season_matches in matches_by_season.items():
        for match in season_matches:
            home_is_a = _team_matches_name(match.home_team, team_a_name)
            away_is_a = _team_matches_name(match.away_team, team_a_name)
            home_is_b = _team_matches_name(match.home_team, team_b_name)
            away_is_b = _team_matches_name(match.away_team, team_b_name)

            if not ((home_is_a and away_is_b) or (home_is_b and away_is_a)):
                continue

            home_goals = int(match.score.full_time.home or 0)
            away_goals = int(match.score.full_time.away or 0)

            if home_is_a:
                team_a_goals += home_goals
                team_b_goals += away_goals
            else:
                team_a_goals += away_goals
                team_b_goals += home_goals

            if _match_is_draw(match):
                draws += 1
            elif (home_is_a and _home_team_won(match)) or (away_is_a and _away_team_won(match)):
                team_a_wins += 1
            else:
                team_b_wins += 1

            rows.append(_match_to_result_row(match, season_key))

    if len(rows) == 0:
        return []

    summary_row = {
        "record_type": "summary",
        "team_a": team_a_name,
        "team_b": team_b_name,
        "matches_played": len(rows),
        "wins": team_a_wins,
        "draws": draws,
        "losses": team_b_wins,
        "goals_for": team_a_goals,
        "goals_against": team_b_goals,
        "goal_difference": team_a_goals - team_b_goals,
        "points": (team_a_wins * 3) + draws,
    }

    if payload.request.group_by is None:
        sorted_matches = _apply_sort_and_limit(
            rows=rows,
            sort_field=(payload.request.sort_by.field if payload.request.sort_by else "utc_date"),
            sort_order=(payload.request.sort_by.order.value if payload.request.sort_by else "desc"),
            limit=payload.request.limit,
        )

        return [summary_row, *sorted_matches]

    group_fields = [group.value for group in payload.request.group_by]

    if FootballHistoryGroupBy.manager.value in group_fields:
        raise ValueError("Grouping by manager is not currently supported for this dataset.")

    if "team" in group_fields:
        raise ValueError("Head-to-head grouping by team is not supported. Use season or competition.")

    aggregated: dict[tuple[str, ...], dict[str, object]] = {}

    for row in rows:
        group_values: dict[str, str] = {}

        for group_field in group_fields:
            value = str(row.get(group_field, ""))
            group_values[group_field] = value

        group_key = tuple(group_values[field] for field in group_fields)
        bucket = aggregated.setdefault(
            group_key,
            {
                **group_values,
                "team_a": team_a_name,
                "team_b": team_b_name,
                "matches_played": 0,
                "wins": 0,
                "draws": 0,
                "losses": 0,
                "goals_for": 0,
                "goals_against": 0,
                "goal_difference": 0,
                "points": 0,
            },
        )

        bucket["matches_played"] = _to_int(bucket.get("matches_played")) + 1

        home_team_name = str(row.get("home_team", ""))
        away_team_name = str(row.get("away_team", ""))
        home_goals = _to_int(row.get("home_goals"))
        away_goals = _to_int(row.get("away_goals"))

        team_a_was_home = _normalise_value(home_team_name) == _normalise_value(team_a_name)
        team_a_match_goals = home_goals if team_a_was_home else away_goals
        team_a_match_conceded = away_goals if team_a_was_home else home_goals

        bucket["goals_for"] = _to_int(bucket.get("goals_for")) + team_a_match_goals
        bucket["goals_against"] = _to_int(bucket.get("goals_against")) + team_a_match_conceded
        bucket["goal_difference"] = _to_int(bucket.get("goals_for")) - _to_int(bucket.get("goals_against"))

        winner = str(row.get("winner", ""))
        if _normalise_value(winner) == _normalise_value(team_a_name):
            bucket["wins"] = _to_int(bucket.get("wins")) + 1
            bucket["points"] = _to_int(bucket.get("points")) + 3
        elif winner == "Draw":
            bucket["draws"] = _to_int(bucket.get("draws")) + 1
            bucket["points"] = _to_int(bucket.get("points")) + 1
        else:
            bucket["losses"] = _to_int(bucket.get("losses")) + 1

    if payload.request.metrics is None:
        metric_fields = [
            "goals_for",
            "goals_against",
            "goal_difference",
            "wins",
            "draws",
            "losses",
            "points",
            "matches_played",
        ]
    else:
        metric_fields = [metric.value for metric in payload.request.metrics]

    grouped_data = _normalise_metrics_fields(
        data=list(aggregated.values()),
        group_fields=[*group_fields, "team_a", "team_b"],
        metrics=metric_fields,
    )

    grouped_data = _apply_sort_and_limit(
        rows=grouped_data,
        sort_field=(payload.request.sort_by.field if payload.request.sort_by else metric_fields[0]),
        sort_order=(payload.request.sort_by.order.value if payload.request.sort_by else "desc"),
        limit=payload.request.limit,
    )

    return [summary_row, *grouped_data]


async def _require_football_history_api_key(
    authorization: str | None = Header(default=None),
) -> None:
    if football_api_keys is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Football API key store is unavailable.",
        )

    if authorization is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header.",
        )

    scheme, _, credentials = authorization.partition(" ")

    if scheme.lower() != "bearer" or credentials.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must use Bearer token.",
        )

    token = credentials.strip()
    matched = API_KEY_PATTERN.fullmatch(token)

    if matched is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key format.",
        )

    key_id = matched.group(1)
    raw_secret = matched.group(2)

    key_doc = await football_api_keys.find_one({"key_id": key_id, "is_active": True})

    if key_doc is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown API key.",
        )

    stored_hash = str(key_doc.get("key_hash", ""))

    if stored_hash == "":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key is not valid.",
        )

    if not bcrypt.checkpw(raw_secret.encode("utf-8"), stored_hash.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key is not valid.",
        )

    await football_api_keys.update_one(
        {"_id": key_doc["_id"]},
        {
            "$set": {"last_used_at": datetime.now(tz=UTC)},
            "$inc": {"use_count": 1},
        },
    )


@football_history_api_router.post("/query", response_model=FootballHistoryResponseEnvelope)
@football_history_api_router.post("/query/", response_model=FootballHistoryResponseEnvelope)
async def query_football_history(
    payload: FootballHistoryRequestEnvelope,
    _: None = Depends(_require_football_history_api_key),
) -> FootballHistoryResponseEnvelope:
    start_time = perf_counter()

    try:
        season_keys = await _resolve_requested_seasons(
            season_start=payload.request.filters.season_start,
            season_end=payload.request.filters.season_end,
            competitions=payload.request.filters.competitions,
        )

        if len(season_keys) == 0:
            elapsed_ms = int((perf_counter() - start_time) * 1000)
            return FootballHistoryResponseEnvelope(
                response=FootballHistoryResponseModel(
                    status=FootballHistoryStatus.no_data,
                    data=[],
                    metadata=FootballHistoryResponseMetadata(
                        total_records=0,
                        query_execution_time_ms=elapsed_ms,
                    ),
                )
            )

        data_disclaimer: str | None = None

        match payload.request.action.value:
            case "get_match_results":
                data = await _build_match_results_data(payload, season_keys)
            case "get_head_to_head":
                data = await _build_head_to_head_data(payload, season_keys)
            case "get_league_table":
                data = await _build_league_table_data(payload, season_keys)
            case "get_aggregate_stats":
                data, data_disclaimer = await _build_aggregate_stats_data(payload, season_keys)
            case _:
                raise ValueError("Unsupported action.")

        elapsed_ms = int((perf_counter() - start_time) * 1000)

        if len(data) == 0:
            return FootballHistoryResponseEnvelope(
                response=FootballHistoryResponseModel(
                    status=FootballHistoryStatus.no_data,
                    data=[],
                    metadata=FootballHistoryResponseMetadata(
                        total_records=0,
                        query_execution_time_ms=elapsed_ms,
                        data_disclaimer=data_disclaimer,
                    ),
                )
            )

        return FootballHistoryResponseEnvelope(
            response=FootballHistoryResponseModel(
                status=FootballHistoryStatus.success,
                data=data,
                metadata=FootballHistoryResponseMetadata(
                    total_records=len(data),
                    query_execution_time_ms=elapsed_ms,
                    data_disclaimer=data_disclaimer,
                ),
            )
        )
    except ValueError as ex:
        elapsed_ms = int((perf_counter() - start_time) * 1000)
        return FootballHistoryResponseEnvelope(
            response=FootballHistoryResponseModel(
                status=FootballHistoryStatus.error,
                data=[],
                metadata=FootballHistoryResponseMetadata(
                    total_records=0,
                    query_execution_time_ms=elapsed_ms,
                ),
                error_message=str(ex),
            )
        )
