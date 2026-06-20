#!/usr/bin/env python3
"""
Poll football-data.org on the same 4-second cadence as the backend live match worker.

Self-contained — mirrors backend get_request(), FootballApiRateLimiter, session setup,
and live poll URL construction for PL and WC.

Usage (from repo root):
    python scripts/football_live_poll.py

Edit the switches below to compare session reuse vs a fresh request each poll.
"""

from __future__ import annotations

import json
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from urllib3.util.retry import Retry
from requests import Response, Session, status_codes
from requests.adapters import HTTPAdapter
from requests.exceptions import (
    ConnectionError,
    HTTPError,
    RequestException,
    Timeout,
    TooManyRedirects,
)

# --- configuration switches ---------------------------------------------------

USE_SESSION = True  # True = reuse requests.Session (backend default); False = requests.get each poll
COMPETITION = "WC"  # "PL" or "WC"
POLL_INTERVAL_SECONDS = 4
REQUEST_TIMEOUT_SECONDS = 5

# --- constants (match backend) ------------------------------------------------

FOOTBALL_API_MIN_INTERVAL = timedelta(seconds=4)
FOOTBALL_DATA_HOST = "football-data.org"
_RATE_LIMIT_HEADER_PREFIXES = ("x-request", "x-ratelimit", "retry-after")

WC_API_BASE = "https://api.football-data.org/v4/competitions/WC"
WC_EDITION = "2026"
WC_TOURNAMENT_START = datetime(2026, 6, 11, tzinfo=timezone.utc)
WC_TOURNAMENT_END = datetime(2026, 7, 19, 23, 59, 59, tzinfo=timezone.utc)
WC_TOURNAMENT_TZ = ZoneInfo("America/Los_Angeles")

ROOT = Path(__file__).resolve().parent.parent
TOKEN_FILE = ROOT / "backend/src/secrets/football_api_token.txt"


class FootballApiRateLimiter:
    """Same 4-second global spacing as backend/src/utils/network_utils.py."""

    _lock = threading.Lock()
    _last_request_monotonic: float | None = None

    @classmethod
    def acquire(cls, url: str) -> float:
        """Wait if needed; return seconds waited (0 if none)."""
        with cls._lock:
            now = time.monotonic()
            wait_seconds = 0.0
            if cls._last_request_monotonic is not None:
                wait_seconds = (
                    FOOTBALL_API_MIN_INTERVAL.total_seconds()
                    - (now - cls._last_request_monotonic)
                )
                if wait_seconds > 0:
                    time.sleep(wait_seconds)
                else:
                    wait_seconds = 0.0
            cls._last_request_monotonic = time.monotonic()
            return wait_seconds


def football_api_rate_limit_headers(headers) -> dict[str, str]:
    return {
        name: value
        for name, value in headers.items()
        if any(name.lower().startswith(prefix) for prefix in _RATE_LIMIT_HEADER_PREFIXES)
    }


def is_football_data_url(url: str) -> bool:
    return FOOTBALL_DATA_HOST in url


def exception_chain(error: BaseException) -> str:
    parts: list[str] = [f"{type(error).__name__}: {error}"]
    cause = error.__cause__
    while cause is not None:
        parts.append(f"  caused by {type(cause).__name__}: {cause}")
        cause = cause.__cause__
    context = error.__context__
    if context is not None and context is not error.__cause__:
        parts.append(f"  context {type(context).__name__}: {context}")
    return "\n".join(parts)


@dataclass
class PollOutcome:
    ok: bool
    summary: str
    details: str | None = None


def build_live_poll_url(competition: str) -> str:
    if competition == "PL":
        today = datetime.now(timezone.utc).date()
        return (
            "https://api.football-data.org/v4/competitions/PL/matches"
            f"?dateFrom={today}&dateTo={today}"
        )

    if competition == "WC":
        tournament_today = datetime.now(timezone.utc).astimezone(WC_TOURNAMENT_TZ).date()
        day_start = datetime(
            tournament_today.year,
            tournament_today.month,
            tournament_today.day,
            tzinfo=WC_TOURNAMENT_TZ,
        ).astimezone(timezone.utc)
        day_end = (day_start + timedelta(days=1) - timedelta(microseconds=1)).date()
        return (
            f"{WC_API_BASE}/matches"
            f"?dateFrom={day_start.date()}&dateTo={day_end}&season={WC_EDITION}"
        )

    raise ValueError(f"Unsupported competition: {competition!r} (use PL or WC)")


def create_backend_session(api_token: str) -> Session:
    """Match backend/src/football/__init__.py session setup."""
    session = Session()
    # Retry TCP/TLS connect and read failures only — not HTTP status codes (429 etc.).
    retry_policy = Retry(
        total=3,
        connect=2,
        read=2,
        redirect=0,
        status=0,
        backoff_factor=0.5,
        allowed_methods=["GET"],
    )
    adapter = HTTPAdapter(max_retries=retry_policy)
    session.mount("https://", adapter)
    session.headers.update(
        {
            "X-Auth-Token": api_token,
            "X-Api-Version": "v4.1",
        }
    )
    return session


def perform_live_poll(
    url: str,
    *,
    session: Session | None,
    headers: dict[str, str],
) -> PollOutcome:
    """Mirror backend get_request() for a single live poll GET."""
    if is_football_data_url(url):
        rate_wait = FootballApiRateLimiter.acquire(url)
    else:
        rate_wait = 0.0

    started = time.monotonic()
    response: Response | None = None

    try:
        if session is not None:
            response = session.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
        else:
            response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS)
    except Timeout:
        elapsed_ms = (time.monotonic() - started) * 1000
        return PollOutcome(
            ok=False,
            summary=f"TIMEOUT after {elapsed_ms:.0f}ms (limit {REQUEST_TIMEOUT_SECONDS}s)",
            details=(
                f"url={url}\n"
                f"rate_limiter_wait={rate_wait:.2f}s\n"
                f"use_session={session is not None}\n"
                "The backend uses the same 5s timeout; intermittent slow TCP/TLS can hit this."
            ),
        )
    except ConnectionError as error:
        elapsed_ms = (time.monotonic() - started) * 1000
        return PollOutcome(
            ok=False,
            summary=f"CONNECTION ERROR after {elapsed_ms:.0f}ms",
            details=(
                f"url={url}\n"
                f"rate_limiter_wait={rate_wait:.2f}s\n"
                f"use_session={session is not None}\n"
                f"{exception_chain(error)}\n"
                "Typical causes: TCP connect stall, TLS handshake failure, remote disconnect."
            ),
        )
    except HTTPError as error:
        status = error.response.status_code if error.response is not None else "unknown"
        elapsed_ms = (time.monotonic() - started) * 1000
        return PollOutcome(
            ok=False,
            summary=f"HTTP ERROR status={status} after {elapsed_ms:.0f}ms",
            details=f"url={url}\n{exception_chain(error)}",
        )
    except TooManyRedirects:
        elapsed_ms = (time.monotonic() - started) * 1000
        return PollOutcome(
            ok=False,
            summary=f"TOO MANY REDIRECTS after {elapsed_ms:.0f}ms",
            details=f"url={url}",
        )
    except RequestException as error:
        elapsed_ms = (time.monotonic() - started) * 1000
        return PollOutcome(
            ok=False,
            summary=f"REQUEST ERROR after {elapsed_ms:.0f}ms",
            details=f"url={url}\n{exception_chain(error)}",
        )

    elapsed_ms = response.elapsed.total_seconds() * 1000 if response.elapsed else (
        (time.monotonic() - started) * 1000
    )
    rate_headers = football_api_rate_limit_headers(response.headers)
    rate_text = rate_headers or "n/a"

    if response.status_code == status_codes.codes.too_many_requests:
        return PollOutcome(
            ok=False,
            summary=f"RATE LIMITED HTTP 429 after {elapsed_ms:.0f}ms",
            details=(
                f"url={url}\n"
                f"Retry-After={response.headers.get('Retry-After', 'unknown')}\n"
                f"rate_headers={rate_text}\n"
                "Backend discards live poll failures and waits for the next 4s poll."
            ),
        )

    if response.status_code != status_codes.codes.ok:
        body_preview = response.text[:500].replace("\n", " ")
        return PollOutcome(
            ok=False,
            summary=f"HTTP {response.status_code} after {elapsed_ms:.0f}ms",
            details=(
                f"url={url}\n"
                f"rate_headers={rate_text}\n"
                f"body_preview={body_preview!r}"
            ),
        )

    try:
        payload = response.json()
    except json.JSONDecodeError as error:
        body_preview = response.text[:500].replace("\n", " ")
        return PollOutcome(
            ok=False,
            summary=f"INVALID JSON after HTTP 200 ({elapsed_ms:.0f}ms)",
            details=(
                f"url={url}\n"
                f"json_error={error}\n"
                f"body_preview={body_preview!r}"
            ),
        )

    if not isinstance(payload, dict) or "matches" not in payload:
        return PollOutcome(
            ok=False,
            summary=f"UNEXPECTED PAYLOAD after HTTP 200 ({elapsed_ms:.0f}ms)",
            details=(
                f"url={url}\n"
                f"top_level_keys={list(payload.keys()) if isinstance(payload, dict) else type(payload)}"
            ),
        )

    matches = payload["matches"]
    match_count = len(matches) if isinstance(matches, list) else "?"
    in_play = 0
    if isinstance(matches, list):
        in_play = sum(
            1
            for match in matches
            if isinstance(match, dict)
            and match.get("status") in {"IN_PLAY", "PAUSED", "SUSPENDED"}
        )

    return PollOutcome(
        ok=True,
        summary=(
            f"SUCCESS HTTP 200 elapsed={elapsed_ms:.0f}ms "
            f"matches={match_count} in_play={in_play} rate={rate_text}"
        ),
    )


def load_api_token() -> str:
    if not TOKEN_FILE.is_file():
        print(f"Token file not found: {TOKEN_FILE}", file=sys.stderr)
        sys.exit(1)
    token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    if not token:
        print(f"Token file is empty: {TOKEN_FILE}", file=sys.stderr)
        sys.exit(1)
    return token


def main() -> None:
    api_token = load_api_token()
    headers = {
        "X-Auth-Token": api_token,
        "X-Api-Version": "v4.1",
    }
    url = build_live_poll_url(COMPETITION)
    session = create_backend_session(api_token) if USE_SESSION else None

    print(f"Polling every {POLL_INTERVAL_SECONDS}s — press Ctrl+C to stop")
    print(f"competition={COMPETITION} use_session={USE_SESSION}")
    print(f"token_file={TOKEN_FILE}")
    print(f"url={url}")
    print()

    try:
        while True:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            outcome = perform_live_poll(url, session=session, headers=headers)
            if outcome.ok:
                print(f"{ts} {outcome.summary}")
            else:
                print(f"{ts} ERROR {outcome.summary}", file=sys.stderr)
                if outcome.details:
                    print(outcome.details, file=sys.stderr)
                    print(file=sys.stderr)
            time.sleep(POLL_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        if session is not None:
            session.close()


if __name__ == "__main__":
    main()
