#!/usr/bin/env python3
"""
Probe football-data.org X-Unfold-* headers one at a time for a single tournament day.

Fetches WC matches for yesterday (America/Los_Angeles by default), once per header
variant, with 4 s spacing between requests. Writes each response to its own JSON file.

Usage (from repo root):
    python scripts/football_unfold_headers_probe.py
    python scripts/football_unfold_headers_probe.py --date 2026-06-20
    python scripts/football_unfold_headers_probe.py --output /tmp/unfold-probe
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from collections.abc import Mapping
from typing import Any
from zoneinfo import ZoneInfo

import requests
from requests.adapters import HTTPAdapter

ROOT = Path(__file__).resolve().parent.parent
TOKEN_FILE = ROOT / "backend/src/secrets/football_api_token.txt"
DEFAULT_OUTPUT_DIR = ROOT / "scripts" / "output" / "football_unfold_probe"

WC_MATCHES_URL = "https://api.football-data.org/v4/competitions/WC/matches"
WC_EDITION = "2026"
WC_TOURNAMENT_TZ = ZoneInfo("America/Los_Angeles")

REQUEST_TIMEOUT_SECONDS = 30
MIN_REQUEST_GAP_SECONDS = 4

UNFOLD_HEADERS = (
    "X-Unfold-Lineups",
    "X-Unfold-Bookings",
    "X-Unfold-Subs",
    "X-Unfold-Goals",
)

RATE_LIMIT_HEADER_PREFIXES = ("x-request", "x-ratelimit", "retry-after")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch one day of WC matches with each X-Unfold-* header set individually "
            "and save responses to separate JSON files."
        )
    )
    parser.add_argument(
        "--date",
        help="Tournament calendar day in America/Los_Angeles (YYYY-MM-DD). "
        "Default: yesterday US Pacific.",
    )
    parser.add_argument(
        "--season",
        default=WC_EDITION,
        help=f"World Cup season year (default: {WC_EDITION}).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory root (default: {DEFAULT_OUTPUT_DIR}).",
    )
    return parser.parse_args()


def yesterday_us_pacific() -> date:
    return (datetime.now(WC_TOURNAMENT_TZ) - timedelta(days=1)).date()


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


def wc_api_dates(match_day: date) -> tuple[date, date]:
    day_start = datetime(
        match_day.year,
        match_day.month,
        match_day.day,
        tzinfo=WC_TOURNAMENT_TZ,
    ).astimezone(timezone.utc)
    day_end = (day_start + timedelta(days=1) - timedelta(microseconds=1)).date()
    return day_start.date(), day_end


def build_matches_url(match_day: date, season: str) -> str:
    date_from, date_to = wc_api_dates(match_day)
    return (
        f"{WC_MATCHES_URL}?dateFrom={date_from}&dateTo={date_to}&season={season}"
    )


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


def rate_limit_response_headers(headers: Mapping[str, str]) -> dict[str, str]:
    return {
        name: value
        for name, value in headers.items()
        if any(name.lower().startswith(prefix) for prefix in RATE_LIMIT_HEADER_PREFIXES)
    }


def probe_variants() -> list[tuple[str, dict[str, str]]]:
    variants: list[tuple[str, dict[str, str]]] = [("baseline", {})]
    for header_name in UNFOLD_HEADERS:
        variants.append((header_name, {header_name: "true"}))
    return variants


def output_filename(slug: str) -> str:
    return f"{slug}.json"


def fetch_variant(
    session: requests.Session,
    url: str,
    extra_headers: dict[str, str],
) -> dict[str, Any]:
    request_headers = dict(session.headers)
    request_headers.update(extra_headers)

    try:
        response = session.get(url, headers=extra_headers, timeout=REQUEST_TIMEOUT_SECONDS)
    except requests.RequestException as error:
        return {
            "ok": False,
            "error": str(error),
            "request_headers": {key: request_headers[key] for key in sorted(request_headers)},
        }

    body: Any
    try:
        body = response.json()
    except json.JSONDecodeError:
        body = response.text

    match_count = None
    if isinstance(body, dict) and isinstance(body.get("matches"), list):
        match_count = len(body["matches"])

    return {
        "ok": response.ok,
        "status_code": response.status_code,
        "match_count": match_count,
        "response_headers": rate_limit_response_headers(response.headers),
        "request_headers": {key: request_headers[key] for key in sorted(request_headers)},
        "body": body,
    }


def write_result(
    output_dir: Path,
    slug: str,
    *,
    tournament_day: date,
    season: str,
    url: str,
    unfold_headers: dict[str, str],
    result: dict[str, Any],
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / output_filename(slug)
    payload = {
        "probe": {
            "slug": slug,
            "tournament_day": tournament_day.isoformat(),
            "tournament_timezone": str(WC_TOURNAMENT_TZ),
            "season": season,
            "url": url,
            "unfold_headers": unfold_headers or None,
        },
        "result": result,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def main() -> None:
    args = parse_args()
    tournament_day = parse_iso_date(args.date) if args.date else yesterday_us_pacific()
    api_token = load_api_token()
    url = build_matches_url(tournament_day, args.season)
    output_dir = args.output / tournament_day.isoformat()

    session = create_session(api_token)
    written: list[dict[str, Any]] = []

    print(f"Tournament day (US Pacific): {tournament_day.isoformat()}")
    print(f"GET {url}")
    print(f"Output directory: {output_dir}")
    print()

    try:
        variants = probe_variants()
        for index, (slug, unfold_headers) in enumerate(variants):
            if index > 0:
                time.sleep(MIN_REQUEST_GAP_SECONDS)

            print(f"[{index + 1}/{len(variants)}] {slug} ...", end=" ", flush=True)
            result = fetch_variant(session, url, unfold_headers)
            path = write_result(
                output_dir,
                slug,
                tournament_day=tournament_day,
                season=args.season,
                url=url,
                unfold_headers=unfold_headers,
                result=result,
            )

            if result.get("ok"):
                print(
                    f"HTTP {result['status_code']} — "
                    f"{result.get('match_count', '?')} matches → {path.name}"
                )
            else:
                print(f"FAILED → {path.name}")
                if "error" in result:
                    print(f"  {result['error']}", file=sys.stderr)
                elif "status_code" in result:
                    print(f"  HTTP {result['status_code']}", file=sys.stderr)

            try:
                file_ref = str(path.relative_to(ROOT))
            except ValueError:
                file_ref = str(path)

            written.append(
                {
                    "slug": slug,
                    "file": file_ref,
                    "ok": result.get("ok", False),
                    "status_code": result.get("status_code"),
                    "match_count": result.get("match_count"),
                    "unfold_headers": unfold_headers or None,
                }
            )
    finally:
        session.close()

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "tournament_day": tournament_day.isoformat(),
                "tournament_timezone": str(WC_TOURNAMENT_TZ),
                "url": url,
                "files": written,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    try:
        manifest_ref = str(manifest_path.relative_to(ROOT))
    except ValueError:
        manifest_ref = str(manifest_path)

    print()
    print(f"Wrote {len(written)} response files and {manifest_ref}")


if __name__ == "__main__":
    main()
