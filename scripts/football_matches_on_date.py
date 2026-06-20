#!/usr/bin/env python3
"""
Fetch and print all football-data.org matches on a given date.

Usage (from repo root):
    python scripts/football_matches_on_date.py 2026-06-20
    python scripts/football_matches_on_date.py 2026-06-20 --competition WC
    python scripts/football_matches_on_date.py 2026-06-20 --competition PL
    python scripts/football_matches_on_date.py 2026-06-20 --competition both
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from requests.adapters import HTTPAdapter

ROOT = Path(__file__).resolve().parent.parent
TOKEN_FILE = ROOT / "backend/src/secrets/football_api_token.txt"
REQUEST_TIMEOUT_SECONDS = 30

PL_MATCHES_URL = "https://api.football-data.org/v4/competitions/PL/matches"
WC_MATCHES_URL = "https://api.football-data.org/v4/competitions/WC/matches"
WC_EDITION = "2026"
WC_TOURNAMENT_TZ = ZoneInfo("America/Los_Angeles")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Show all Premier League or World Cup matches on a given date."
    )
    parser.add_argument(
        "date",
        help="Calendar date to query (YYYY-MM-DD). WC uses the tournament timezone (America/Los_Angeles); PL uses UTC.",
    )
    parser.add_argument(
        "--competition",
        choices=("PL", "WC", "both"),
        default="WC",
        help="Competition to query (default: WC).",
    )
    parser.add_argument(
        "--season",
        default=WC_EDITION,
        help=f"World Cup season year (default: {WC_EDITION}). Ignored for PL.",
    )
    return parser.parse_args()


def parse_iso_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"Invalid date {value!r}; use YYYY-MM-DD") from error


def load_api_token() -> str:
    if not TOKEN_FILE.is_file():
        print(f"Token file not found: {TOKEN_FILE}", file=sys.stderr)
        sys.exit(1)
    token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    if not token:
        print(f"Token file is empty: {TOKEN_FILE}", file=sys.stderr)
        sys.exit(1)
    return token


def create_session(api_token: str) -> requests.Session:
    session = requests.Session()
    adapter = HTTPAdapter(max_retries=0)
    session.mount("https://", adapter)
    session.headers.update(
        {
            "X-Auth-Token": api_token,
            "X-Api-Version": "v4.1",
        }
    )
    return session


def pl_api_dates(match_day: date) -> tuple[date, date]:
    return match_day, match_day


def wc_api_dates(match_day: date) -> tuple[date, date]:
    day_start = datetime(
        match_day.year,
        match_day.month,
        match_day.day,
        tzinfo=WC_TOURNAMENT_TZ,
    ).astimezone(timezone.utc)
    day_end = (day_start + timedelta(days=1) - timedelta(microseconds=1)).date()
    return day_start.date(), day_end


def build_url(competition: str, match_day: date, season: str) -> str:
    if competition == "PL":
        date_from, date_to = pl_api_dates(match_day)
        return f"{PL_MATCHES_URL}?dateFrom={date_from}&dateTo={date_to}"
    date_from, date_to = wc_api_dates(match_day)
    return (
        f"{WC_MATCHES_URL}?dateFrom={date_from}&dateTo={date_to}&season={season}"
    )


def fetch_matches(
    session: requests.Session,
    competition: str,
    match_day: date,
    season: str,
) -> list[dict]:
    url = build_url(competition, match_day, season)
    try:
        response = session.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
    except requests.RequestException as error:
        print(f"Request failed: GET {url}\n{error}", file=sys.stderr)
        sys.exit(1)

    if response.status_code != requests.codes.ok:
        print(
            f"Request failed: GET {url}\nHTTP {response.status_code}\n{response.text[:500]}",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        payload = response.json()
    except json.JSONDecodeError as error:
        print(f"Invalid JSON from {url}: {error}", file=sys.stderr)
        sys.exit(1)

    matches = payload.get("matches")
    if not isinstance(matches, list):
        print(f"Unexpected response shape from {url}", file=sys.stderr)
        sys.exit(1)

    return matches


def team_label(team: dict) -> str:
    return (
        team.get("shortName")
        or team.get("name")
        or team.get("tla")
        or "?"
    )


def format_score(match: dict) -> str:
    score = match.get("score") or {}
    full_time = score.get("fullTime") or {}
    home = full_time.get("home")
    away = full_time.get("away")
    if home is None or away is None:
        half_time = score.get("halfTime") or {}
        home = half_time.get("home")
        away = half_time.get("away")
    if home is None or away is None:
        return "-"
    return f"{home}-{away}"


def format_kickoff(match: dict) -> str:
    utc_date = match.get("utcDate")
    if not utc_date:
        return "??:??"
    kickoff = datetime.fromisoformat(utc_date.replace("Z", "+00:00"))
    return kickoff.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")


def format_status(match: dict) -> str:
    status = match.get("status") or "?"
    minute = match.get("minute")
    if minute is not None and status in {"IN_PLAY", "PAUSED", "SUSPENDED"}:
        injury = match.get("injuryTime")
        if injury:
            return f"{status} {minute}+{injury}'"
        return f"{status} {minute}'"
    return status


def format_stage(match: dict) -> str:
    parts: list[str] = []
    stage = match.get("stage")
    group = match.get("group")
    matchday = match.get("matchday")
    if stage:
        parts.append(stage)
    if group:
        parts.append(group)
    if matchday is not None:
        parts.append(f"MD{matchday}")
    return ", ".join(parts) if parts else "-"


def print_matches(competition: str, match_day: date, matches: list[dict]) -> None:
    print(f"{match_day.isoformat()} {competition} — {len(matches)} match(es)")
    if not matches:
        print()
        return

    sorted_matches = sorted(
        matches,
        key=lambda match: match.get("utcDate") or "",
    )

    print()
    print(
        f"{'Kickoff (UTC)':<17}  {'Home':<22} {'Score':^5}  {'Away':<22} {'Status':<12} Stage"
    )
    print("-" * 95)

    for match in sorted_matches:
        home = team_label(match.get("homeTeam") or {})
        away = team_label(match.get("awayTeam") or {})
        print(
            f"{format_kickoff(match):<17}  "
            f"{home:<22} {format_score(match):^5}  "
            f"{away:<22} {format_status(match):<12} {format_stage(match)}"
        )
    print()


def main() -> None:
    args = parse_args()
    match_day = parse_iso_date(args.date)
    api_token = load_api_token()
    session = create_session(api_token)

    competitions: list[str]
    if args.competition == "both":
        competitions = ["PL", "WC"]
    else:
        competitions = [args.competition]

    try:
        for index, competition in enumerate(competitions):
            matches = fetch_matches(session, competition, match_day, args.season)
            print_matches(competition, match_day, matches)
            if index + 1 < len(competitions):
                print()
    finally:
        session.close()


if __name__ == "__main__":
    main()
