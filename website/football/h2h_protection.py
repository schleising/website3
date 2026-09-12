from collections import deque
from hmac import compare_digest
from ipaddress import ip_address
from time import monotonic

from fastapi import Request
from fastapi.responses import HTMLResponse

_CSRF_COOKIE_NAME = "csrf_token"
_CSRF_HEADER_NAME = "x-csrf-token"


H2H_RATE_LIMIT_WINDOW_SECONDS = 60.0
H2H_RATE_LIMIT_MAX_REQUESTS = 15
H2H_ROBOTS_HEADERS = {
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "no-store",
}

_BOT_UA_MARKERS = (
    "bot",
    "crawler",
    "spider",
    "scraper",
    "scrapy",
    "curl/",
    "wget/",
    "python-requests",
    "python-urllib",
    "httpx/",
    "aiohttp",
    "go-http-client",
    "libwww",
    "okhttp",
    "headlesschrome",
    "phantomjs",
    "selenium",
    "puppeteer",
    "playwright",
    "bytespider",
    "gptbot",
    "claudebot",
    "anthropic",
    "ccbot",
    "ahrefs",
    "semrush",
    "dotbot",
    "petalbot",
    "yandex",
    "baiduspider",
    "facebookexternalhit",
    "linkedinbot",
    "slackbot",
    "discordbot",
)

_h2h_hits_by_ip: dict[str, deque[float]] = {}


def reset_h2h_rate_limit_state() -> None:
    _h2h_hits_by_ip.clear()


def is_parameterized_h2h_request(team_a: int | None, team_b: int | None) -> bool:
    return team_a is not None or team_b is not None


def _is_private_or_local_ip(host: str) -> bool:
    candidate = host.strip()
    if candidate in {"", "unknown", "localhost"}:
        return True

    try:
        parsed = ip_address(candidate)
    except ValueError:
        return False

    return parsed.is_private or parsed.is_loopback


def h2h_client_ip(request: Request) -> str:
    """Prefer the proxy-provided client IP when the peer is Docker/nginx."""

    peer_host = ""
    if request.client is not None:
        peer_host = request.client.host.strip()

    forwarded_ip = request.headers.get("x-real-ip", "").strip()
    if forwarded_ip == "":
        xff = request.headers.get("x-forwarded-for", "")
        forwarded_ip = xff.split(",", maxsplit=1)[0].strip()

    if forwarded_ip != "" and _is_private_or_local_ip(peer_host):
        return forwarded_ip

    if peer_host != "":
        return peer_host

    return "unknown"


def request_looks_like_scraper(request: Request) -> bool:
    user_agent = request.headers.get("user-agent", "").strip()
    if user_agent == "":
        return True

    ua_lower = user_agent.lower()
    if any(marker in ua_lower for marker in _BOT_UA_MARKERS):
        return True

    sec_fetch_dest = request.headers.get("sec-fetch-dest", "").strip()
    sec_fetch_mode = request.headers.get("sec-fetch-mode", "").strip()
    accept_language = request.headers.get("accept-language", "").strip()
    if sec_fetch_dest == "" and sec_fetch_mode == "" and accept_language == "":
        return True

    return False


def is_same_origin_fetch(request: Request) -> bool:
    """True for browser fetch()/XHR from this origin, not a top-level navigation."""

    fetch_site = request.headers.get("sec-fetch-site", "").strip().lower()
    fetch_dest = request.headers.get("sec-fetch-dest", "").strip().lower()
    return fetch_site == "same-origin" and fetch_dest in {"", "empty"}


def has_valid_h2h_csrf(request: Request) -> bool:
    cookie_token = request.cookies.get(_CSRF_COOKIE_NAME, "").strip()
    header_token = request.headers.get(_CSRF_HEADER_NAME, "").strip()
    if cookie_token == "" or header_token == "":
        return False

    return compare_digest(cookie_token, header_token)


def allows_expensive_h2h_lookup(request: Request) -> bool:
    """Only same-origin JS fetches with a CSRF pair may run the all-season query."""

    if request_looks_like_scraper(request):
        return False

    return is_same_origin_fetch(request) and has_valid_h2h_csrf(request)


def _prune_h2h_hits(now_ts: float, attempts: deque[float]) -> None:
    cutoff = now_ts - H2H_RATE_LIMIT_WINDOW_SECONDS
    while len(attempts) > 0 and attempts[0] < cutoff:
        attempts.popleft()


def consume_h2h_rate_limit(request: Request) -> bool:
    """Record a parameterized H2H hit. Return True when the IP is over the limit."""

    now_ts = monotonic()
    ip = h2h_client_ip(request)
    attempts = _h2h_hits_by_ip.setdefault(ip, deque())
    _prune_h2h_hits(now_ts, attempts)

    if len(attempts) >= H2H_RATE_LIMIT_MAX_REQUESTS:
        return True

    attempts.append(now_ts)
    return False


def h2h_rejected_response(status_code: int, detail: str, retry_after: int | None = None) -> HTMLResponse:
    headers = dict(H2H_ROBOTS_HEADERS)
    if retry_after is not None:
        headers["Retry-After"] = str(retry_after)

    return HTMLResponse(content=detail, status_code=status_code, headers=headers)
