from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from .models import (
    Match,
    MatchStatus,
)


def kickoff_utc_iso(value: datetime) -> str:
    """Return an ISO-8601 UTC timestamp with an explicit Z suffix for HTML/JS."""
    if value.tzinfo is None:
        utc_value = value.replace(tzinfo=timezone.utc)
    else:
        utc_value = value.astimezone(timezone.utc)

    return utc_value.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def match_status_pill_class(
    status: MatchStatus | str | None,
    duration: str | None = None,
) -> str:
    """Return the CSS modifier class for a coloured match-status pill."""
    if isinstance(status, MatchStatus):
        status_value = status.value
    else:
        status_value = str(status or "").strip().upper().replace(" ", "_")

    duration_value = str(duration or "").strip().upper()

    if status_value == MatchStatus.in_play.value:
        if duration_value == "PENALTY_SHOOTOUT":
            return "match-status--penalties"
        return "match-status--live"
    if status_value == MatchStatus.paused.value:
        return "match-status--paused"
    if status_value == MatchStatus.finished.value:
        return "match-status--finished"
    if status_value == MatchStatus.suspended.value:
        return "match-status--suspended"
    if status_value == MatchStatus.postponed.value:
        return "match-status--postponed"
    if status_value == MatchStatus.cancelled.value:
        return "match-status--cancelled"
    if status_value in {
        MatchStatus.scheduled.value,
        MatchStatus.timed.value,
        MatchStatus.awarded.value,
    }:
        return "match-status--scheduled"

    return "match-status--scheduled"


def update_match_timezone(matches: list[Match]) -> list[Match]:
    """Populate local_date in Europe/London for server-side day grouping only."""
    local_tz = ZoneInfo("Europe/London")

    for match in matches:
        utc_date = match.utc_date
        if utc_date.tzinfo is None:
            utc_date = utc_date.replace(tzinfo=timezone.utc)
        match.local_date = utc_date.astimezone(local_tz)

    return matches
