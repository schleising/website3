from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class FootballHistoryAction(str, Enum):
    get_aggregate_stats = "get_aggregate_stats"
    get_head_to_head = "get_head_to_head"
    get_league_table = "get_league_table"
    get_match_results = "get_match_results"


class FootballHistoryVenue(str, Enum):
    home = "home"
    away = "away"
    both = "both"


class FootballHistoryMetric(str, Enum):
    goals_for = "goals_for"
    goals_against = "goals_against"
    goal_difference = "goal_difference"
    wins = "wins"
    draws = "draws"
    losses = "losses"
    points = "points"
    matches_played = "matches_played"


class FootballHistoryGroupBy(str, Enum):
    team = "team"
    season = "season"
    competition = "competition"
    manager = "manager"


class FootballHistorySortOrder(str, Enum):
    asc = "asc"
    desc = "desc"


class FootballHistorySortBy(BaseModel):
    field: str
    order: FootballHistorySortOrder = FootballHistorySortOrder.desc


class FootballHistoryFilters(BaseModel):
    teams: list[str] = Field(default_factory=list)
    competitions: list[str] = Field(default_factory=list)
    season_start: str | None = Field(default=None, pattern=r"^\d{4}/\d{2}$")
    season_end: str | None = Field(default=None, pattern=r"^\d{4}/\d{2}$")
    venue: FootballHistoryVenue = FootballHistoryVenue.both


class FootballHistoryRequestModel(BaseModel):
    action: FootballHistoryAction
    filters: FootballHistoryFilters
    metrics: list[FootballHistoryMetric] | None = None
    group_by: list[FootballHistoryGroupBy] | None = None
    limit: int | None = Field(default=None, ge=1)
    sort_by: FootballHistorySortBy | None = None


class FootballHistoryRequestEnvelope(BaseModel):
    request: FootballHistoryRequestModel


class FootballHistoryStatus(str, Enum):
    success = "success"
    error = "error"
    no_data = "no_data"


class FootballHistoryResponseMetadata(BaseModel):
    total_records: int | None = None
    query_execution_time_ms: int | None = None
    data_disclaimer: str | None = None


class FootballHistoryResponseModel(BaseModel):
    status: FootballHistoryStatus
    data: list[dict[str, Any]] = Field(default_factory=list)
    metadata: FootballHistoryResponseMetadata | None = None
    error_message: str | None = None


class FootballHistoryResponseEnvelope(BaseModel):
    response: FootballHistoryResponseModel
