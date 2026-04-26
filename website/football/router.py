import asyncio
from calendar import monthrange, month_name
from datetime import UTC, date, datetime, timedelta
import json
import logging
from pathlib import Path as FilePath
from urllib.parse import quote
from ..account.csrf import validate_csrf
from zoneinfo import ZoneInfo

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    Path,
    Response,
    status,
)
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.templating import Jinja2Templates

from .football_db import (
    get_available_season_keys,
    get_competition_name_for_season,
    get_season_label,
    get_season_short_label,
    infer_current_season_key,
    retreive_matches,
    retreive_team_matches,
    retreive_all_teams,
    retreive_head_to_head_matches_by_id,
    retreive_team_primary_colours,
    get_table_db,
    get_table_db_for_season,
    get_push_subscription,
    upsert_push_subscription,
    delete_push_subscription,
)

from .football_utils import update_match_timezone, create_bet_standings
from .chatbot_history_api import (
    football_history_api_router,
    query_football_history,
    _require_football_history_api_key,
)
from .chatbot_history_models import (
    FootballHistoryAction,
    FootballHistoryFilters,
    FootballHistoryGroupBy,
    FootballHistoryMetric,
    FootballHistoryRequestEnvelope,
    FootballHistoryRequestModel,
    FootballHistoryResponseEnvelope,
    FootballHistoryResponseMetadata,
    FootballHistorySortBy,
    FootballHistorySortOrder,
    FootballHistoryStatus,
    FootballHistoryVenue,
)

from .models import (
    FootballBetList,
    MatchList,
    LiveTableList,
    LiveTableItem,
    SimplifiedMatch,
    SimplifiedTableRow,
    SimplifiedFootballData,
    Team,
    PushSubscriptionDocument,
    SubscriptionLookupRequest,
    SubscriptionPreferencesUpdateRequest,
    SubscriptionPreferencesResponse,
    SubscriptionOperationResponse,
)

TEMPLATES = Jinja2Templates("/app/templates")

football_router = APIRouter(prefix="/football")
football_router.include_router(football_history_api_router, prefix="/api/history")

WEBSITE_ROOT = FilePath("/app")
FOOTBALL_MANIFEST_PATH = WEBSITE_ROOT / "static" / "manifests" / "football" / "football.webmanifest"
FOOTBALL_SERVICE_WORKER_PATH = WEBSITE_ROOT / "static" / "football" / "sw.js"
FOOTBALL_WEB_APP_HOST = "football.schleising.net"
FOOTBALL_STATS_DEFAULT_SEASON_SPAN = 8
FOOTBALL_HISTORY_API_KEY_PATHS = (
    WEBSITE_ROOT / "secrets" / "football-api-key.txt",
    FilePath(__file__).resolve().parent.parent / "secrets" / "football-api-key.txt",
)

SEASON_MONTH_ORDER = [8, 9, 10, 11, 12, 1, 2, 3, 4, 5]
LIVE_DAYS_BEFORE_TODAY = 7
LIVE_DAYS_AFTER_TODAY = 6
LONDON_TZ = ZoneInfo("Europe/London")
_football_history_api_key_cache: str | None = None


def _season_year_bounds(season_key: str) -> tuple[int, int]:
    season_start, season_end = season_key.split("_", maxsplit=1)
    return int(season_start), int(season_end)


def _year_for_season_month(month: int, season_key: str) -> int:
    season_start, season_end = _season_year_bounds(season_key)
    return season_start if month >= 8 else season_end


def _request_host(request: Request) -> str:
    forwarded_host = request.headers.get("x-forwarded-host", "")
    host_header = forwarded_host if forwarded_host.strip() != "" else request.headers.get("host", "")

    if host_header.strip() == "":
        return ""

    first_host = host_header.split(",", maxsplit=1)[0].strip()
    return first_host.split(":", maxsplit=1)[0].lower()


def _is_football_web_app_request(request: Request) -> bool:
    header_value = request.headers.get("x-is-web-app", "").strip().lower()
    if header_value == "true":
        return True

    return _request_host(request) == FOOTBALL_WEB_APP_HOST


def _request_scheme(request: Request) -> str:
    forwarded_scheme = request.headers.get("x-forwarded-proto", "").split(",", maxsplit=1)[0].strip()
    if forwarded_scheme != "":
        return forwarded_scheme

    scheme = request.url.scheme
    return scheme if scheme != "" else "https"


def _to_public_football_path(path: str) -> str:
    if path == "/football" or path == "/football/":
        return "/"

    if path.startswith("/football/"):
        public_path = path[len("/football") :]
        return public_path if public_path.startswith("/") else f"/{public_path}"

    return path


def _request_public_path_with_query(request: Request) -> str:
    path = request.url.path
    if _is_football_web_app_request(request):
        path = _to_public_football_path(path)

    query = request.url.query
    return f"{path}?{query}" if query else path


def _build_football_mode_context(request: Request) -> dict[str, str | bool]:
    is_web_app = _is_football_web_app_request(request)
    football_base_path = "" if is_web_app else "/football"
    football_root_path = "/" if is_web_app else "/football/"

    return {
        "is_web_app": is_web_app,
        "render_left_sidebar": not is_web_app,
        "football_base_path": football_base_path,
        "football_root_path": football_root_path,
    }


def _build_football_auth_links(request: Request) -> dict[str, str]:
    if _is_football_web_app_request(request):
        scheme = _request_scheme(request)
        host = _request_host(request)
        if host == "":
            host = FOOTBALL_WEB_APP_HOST

        next_url = f"{scheme}://{host}{_request_public_path_with_query(request)}"
        encoded_next_url = quote(next_url, safe=":/?=&%#")
        return {
            "login_url": f"https://www.schleising.net/account/login/?next={encoded_next_url}",
            "signup_url": "https://www.schleising.net/account/create/",
        }

    local_next = _request_public_path_with_query(request)
    encoded_local_next = quote(local_next, safe="/?=&")
    return {
        "login_url": f"/account/login/?next={encoded_local_next}",
        "signup_url": "/account/create/",
    }


def _build_month_nav_links(selected_season_key: str, football_root_path: str) -> list[dict[str, str]]:
    season_label = get_season_short_label(selected_season_key)

    return [
        {
            "label": f"{month_name[month]} {season_label}",
            "url": f"{football_root_path}matches/{month}/?season={selected_season_key}",
        }
        for month in SEASON_MONTH_ORDER
    ]


def _ordinal_day(day_of_month: int) -> str:
    if 10 <= day_of_month % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(day_of_month % 10, "th")

    return f"{day_of_month}{suffix}"


def _format_match_day_label(day_value: datetime, today_value: datetime) -> str:
    day_delta = (day_value.date() - today_value.date()).days

    if day_delta == -1:
        return "Yesterday"
    if day_delta == 0:
        return "Today"
    if day_delta == 1:
        return "Tomorrow"

    return f"{day_value.strftime('%A')}, {_ordinal_day(day_value.day)} {day_value.strftime('%B')}"


def _build_live_day_groups(matches: list, today_value: datetime) -> list[dict]:
    grouped_matches: dict[date, list] = {}

    for match in matches:
        match_datetime = match.local_date if match.local_date is not None else match.utc_date
        match_day = match_datetime.date()
        grouped_matches.setdefault(match_day, []).append(match)

    live_day_groups: list[dict] = []

    for day_offset in range(-LIVE_DAYS_BEFORE_TODAY, LIVE_DAYS_AFTER_TODAY + 1):
        day_datetime = today_value + timedelta(days=day_offset)
        day_key = day_datetime.date()
        live_day_groups.append(
            {
                "label": _format_match_day_label(day_datetime, today_value),
                "matches": grouped_matches.get(day_key, []),
                "is_current_period": day_offset == 0,
            }
        )

    return live_day_groups


def _build_match_day_groups(matches: list, today_value: datetime) -> list[dict]:
    grouped_matches: dict[date, list] = {}

    for match in matches:
        match_datetime = match.local_date if match.local_date is not None else match.utc_date
        match_day = match_datetime.date()
        grouped_matches.setdefault(match_day, []).append(match)

    day_groups: list[dict] = []

    for day_key in sorted(grouped_matches):
        day_datetime = datetime.combine(day_key, datetime.min.time())
        anchor_id = f"day-{day_key.isoformat()}"
        day_groups.append(
            {
                "label": _format_match_day_label(day_datetime, today_value),
                "matches": grouped_matches[day_key],
                "is_current_period": day_key == today_value.date(),
                "day_key": day_key,
                "anchor_id": anchor_id,
            }
        )

    return day_groups


def _build_team_month_groups(matches: list) -> list[dict]:
    grouped_matches: dict[tuple[int, int], list] = {}
    today_value = datetime.now(tz=LONDON_TZ)
    current_month_key = (today_value.year, today_value.month)

    for match in matches:
        match_datetime = match.local_date if match.local_date is not None else match.utc_date
        month_key = (match_datetime.year, match_datetime.month)
        grouped_matches.setdefault(month_key, []).append(match)

    month_groups: list[dict] = []

    for year_value, month_value in sorted(grouped_matches):
        month_label = datetime(year_value, month_value, 1).strftime("%B %Y")
        month_key = (year_value, month_value)
        anchor_id = f"month-{year_value}-{month_value:02d}"
        month_groups.append(
            {
                "label": month_label,
                "matches": grouped_matches[(year_value, month_value)],
                "is_current_period": month_key == current_month_key,
                "anchor_id": anchor_id,
                "month_key": month_key,
            }
        )

    return month_groups


def _build_team_matches_current_anchor(month_groups: list[dict], today_value: datetime) -> str | None:
    if len(month_groups) == 0:
        return None

    current_month_key = (today_value.year, today_value.month)

    for month_group in month_groups:
        month_key = month_group.get("month_key")
        anchor_id = month_group.get("anchor_id")

        if isinstance(month_key, tuple) and month_key >= current_month_key and isinstance(anchor_id, str):
            return anchor_id

    last_anchor = month_groups[-1].get("anchor_id")
    return last_anchor if isinstance(last_anchor, str) else None


def _live_scores_window() -> tuple[datetime, datetime]:
    today_start = datetime.now(tz=LONDON_TZ).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    window_start = today_start - timedelta(days=LIVE_DAYS_BEFORE_TODAY)
    window_end = (today_start + timedelta(days=LIVE_DAYS_AFTER_TODAY)).replace(
        hour=23, minute=59, second=59, microsecond=0
    )

    return window_start, window_end


def _today_scores_window() -> tuple[datetime, datetime]:
    today_start = datetime.now(tz=LONDON_TZ).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    today_end = today_start.replace(hour=23, minute=59, second=59, microsecond=0)
    return today_start, today_end


def _season_matches_window(season_key: str) -> tuple[datetime, datetime]:
    season_start_year, season_end_year = _season_year_bounds(season_key)
    return (
        datetime(season_start_year, 7, 1, 0, 0, 0),
        datetime(season_end_year, 6, 30, 23, 59, 59),
    )


def _season_sort_year(season_key: str) -> int:
    season_start, _ = season_key.split("_", maxsplit=1)
    return int(season_start)


def _season_label_for_history_api(season_key: str) -> str:
    season_start, season_end = season_key.split("_", maxsplit=1)
    return f"{season_start}/{season_end[-2:]}"


def _normalise_stats_season_range(
    available_season_keys: list[str],
    requested_start_key: str | None,
    requested_end_key: str | None,
    default_end_key: str,
) -> tuple[str, str]:
    if len(available_season_keys) == 0:
        return default_end_key, default_end_key

    sorted_keys = sorted(set(available_season_keys), key=_season_sort_year)
    if default_end_key in sorted_keys:
        resolved_end_key = default_end_key
    else:
        resolved_end_key = sorted_keys[-1]

    if requested_end_key in sorted_keys:
        resolved_end_key = requested_end_key

    resolved_end_index = sorted_keys.index(resolved_end_key)
    default_start_index = max(
        0,
        resolved_end_index - (FOOTBALL_STATS_DEFAULT_SEASON_SPAN - 1),
    )

    resolved_start_key = sorted_keys[default_start_index]
    if requested_start_key in sorted_keys:
        resolved_start_key = requested_start_key

    return resolved_start_key, resolved_end_key


def _load_football_history_api_key() -> str:
    global _football_history_api_key_cache

    if _football_history_api_key_cache is not None:
        return _football_history_api_key_cache

    for key_path in FOOTBALL_HISTORY_API_KEY_PATHS:
        if not key_path.is_file():
            continue

        api_key = key_path.read_text(encoding="utf-8").strip()
        if api_key == "":
            continue

        _football_history_api_key_cache = api_key
        return api_key

    raise RuntimeError("Football history API key is not configured on the server.")


def _extract_history_data(
    envelope: FootballHistoryResponseEnvelope,
    dataset_label: str,
    errors: list[str],
) -> tuple[list[dict[str, object]], FootballHistoryResponseMetadata | None]:
    response_model = envelope.response
    response_metadata = response_model.metadata

    if response_model.status == FootballHistoryStatus.error:
        detail = response_model.error_message or "History API query failed."
        errors.append(f"{dataset_label}: {detail}")
        return [], response_metadata

    return response_model.data, response_metadata


def _format_history_match_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    formatted_rows: list[dict[str, object]] = []

    for row in rows:
        formatted_row = dict(row)
        utc_date = formatted_row.get("utc_date")
        formatted_kickoff = "-"

        if isinstance(utc_date, str) and utc_date.strip() != "":
            try:
                parsed_datetime = datetime.fromisoformat(utc_date.replace("Z", "+00:00"))
                if parsed_datetime.tzinfo is None:
                    parsed_datetime = parsed_datetime.replace(tzinfo=UTC)

                formatted_kickoff = parsed_datetime.astimezone(LONDON_TZ).strftime(
                    "%a %d %b %Y %H:%M %Z"
                )
            except ValueError:
                formatted_kickoff = utc_date

        home_goals = formatted_row.get("home_goals")
        away_goals = formatted_row.get("away_goals")
        if home_goals is None or away_goals is None:
            scoreline = "-"
        else:
            scoreline = f"{home_goals}-{away_goals}"

        formatted_row["kickoff_local"] = formatted_kickoff
        formatted_row["scoreline"] = scoreline
        formatted_rows.append(formatted_row)

    return formatted_rows


def _parse_optional_query_int(raw_value: str | None) -> tuple[int | None, bool]:
    if raw_value is None:
        return None, False

    candidate = raw_value.strip()
    if candidate == "":
        return None, False

    try:
        return int(candidate), False
    except ValueError:
        return None, True


async def _query_history_api_internal(
    payload: FootballHistoryRequestEnvelope,
) -> FootballHistoryResponseEnvelope:
    return await query_football_history(payload, None)


def _build_all_matches_jump_targets(day_groups: list[dict], today_value: datetime) -> tuple[str | None, list[dict[str, str]]]:
    if len(day_groups) == 0:
        return (None, [])

    current_anchor: str | None = None

    for day_group in day_groups:
        day_key = day_group.get("day_key")
        if isinstance(day_key, date) and day_key >= today_value.date():
            current_anchor = day_group.get("anchor_id")
            break

    if current_anchor is None:
        current_anchor = day_groups[-1].get("anchor_id")

    month_targets: list[dict[str, str]] = []
    seen_month_keys: set[tuple[int, int]] = set()

    for day_group in day_groups:
        day_key = day_group.get("day_key")
        anchor_id = day_group.get("anchor_id")

        if not isinstance(day_key, date) or not isinstance(anchor_id, str):
            continue

        month_key = (day_key.year, day_key.month)
        if month_key in seen_month_keys:
            continue

        seen_month_keys.add(month_key)
        month_targets.append(
            {
                "label": day_key.strftime("%B %Y"),
                "anchor": anchor_id,
            }
        )

    return (current_anchor, month_targets)


def _has_today_matches(matches: list) -> bool:
    today_date = datetime.now(tz=LONDON_TZ).date()

    for match in matches:
        match_datetime = match.local_date if match.local_date is not None else match.utc_date
        if match_datetime.date() == today_date:
            return True

    return False


async def _build_football_season_context(
    request: Request,
    requested_season_key: str | None,
    show_selector: bool = True,
) -> dict:
    mode_context = _build_football_mode_context(request)
    football_root_path = str(mode_context["football_root_path"])
    table_root_url = f"{football_root_path}table/"

    available_season_keys = await get_available_season_keys()
    current_season_key = infer_current_season_key(available_season_keys)

    if len(available_season_keys) == 0:
        available_season_keys = [current_season_key]

    selected_season_key = (
        requested_season_key
        if requested_season_key in available_season_keys
        else current_season_key
    )

    return {
        "show_season_selector": show_selector,
        "available_seasons": [
            {
                "key": season_key,
                "label": get_season_label(season_key),
                "selected": season_key == selected_season_key,
                "is_current": season_key == current_season_key,
            }
            for season_key in available_season_keys
        ],
        "selected_season_key": selected_season_key,
        "selected_season_label": get_season_label(selected_season_key),
        "selected_season_short_label": get_season_short_label(selected_season_key),
        "selected_competition_name": get_competition_name_for_season(selected_season_key),
        "current_season_key": current_season_key,
        "current_season_label": get_season_label(current_season_key),
        "current_season_short_label": get_season_short_label(current_season_key),
        "current_competition_name": get_competition_name_for_season(current_season_key),
        "is_current_season": selected_season_key == current_season_key,
        "season_switch_path": table_root_url,
        "current_season_url": f"{table_root_url}?season={current_season_key}",
        "live_scores_url": football_root_path,
        "table_url": f"{table_root_url}?season={selected_season_key}",
        "all_matches_url": f"{football_root_path}matches/all/?season={selected_season_key}",
        "stats_url": f"{football_root_path}stats/",
        "head_to_head_url": f"{football_root_path}head-to-head/",
        "subscriptions_url": f"{football_root_path}subscriptions/",
        "month_nav_links": _build_month_nav_links(selected_season_key, football_root_path),
        **mode_context,
    }


async def _get_current_season_key() -> str:
    available_season_keys = await get_available_season_keys()
    return infer_current_season_key(available_season_keys)


async def _get_current_season_teams(current_season_key: str) -> list[Team]:
    current_table = await get_table_db_for_season(current_season_key)
    team_by_id: dict[int, Team] = {}

    for table_item in current_table:
        team_by_id[table_item.team.id] = table_item.team

    return sorted(team_by_id.values(), key=lambda team: team.short_name.lower())


def _request_username(request: Request) -> str:
    user = getattr(request.state, "user", None)
    username = getattr(user, "username", None)

    if isinstance(username, str) and username.strip() != "":
        return username

    return "Anonymous User"


def _require_logged_in_username(request: Request) -> str:
    username = _request_username(request)
    if username == "Anonymous User":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Login required to manage notifications.",
        )
    return username


def _assert_subscription_owner(
    existing_subscription: PushSubscriptionDocument | None,
    username: str,
) -> None:
    if existing_subscription is None:
        return

    owner = existing_subscription.username.strip()
    if owner == "" or owner == "Anonymous User":
        return

    if owner != username:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This subscription is managed by a different account.",
        )


@football_router.get("/", response_class=HTMLResponse)
async def get_live_matches(
    request: Request,
):
    logging.debug(f"/football/: {request}")

    season_context = await _build_football_season_context(
        request,
        None,
        show_selector=False,
    )
    selected_season_key = season_context["selected_season_key"]

    start_date, end_date = _live_scores_window()
    page_title = "Latest Matches"
    live_matches = True

    matches = await retreive_matches(start_date, end_date, selected_season_key)
    matches = update_match_timezone(matches)
    enable_live_updates = True
    live_today_anchor = start_date + timedelta(days=LIVE_DAYS_BEFORE_TODAY)
    today_anchor = datetime.now(tz=LONDON_TZ).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    day_groups = (
        _build_live_day_groups(matches, live_today_anchor)
        if live_matches
        else _build_match_day_groups(matches, today_anchor)
    )

    return TEMPLATES.TemplateResponse(
        request,
        "football/match_template.html",
        {
            "request": request,
            "matches": matches,
            "day_groups": day_groups,
            "title": page_title,
            "live_matches": live_matches,
            "enable_live_updates": enable_live_updates,
            **season_context,
        },
    )


@football_router.get("/matches/all", response_class=HTMLResponse)
@football_router.get("/matches/all/", response_class=HTMLResponse)
async def get_all_season_matches(
    request: Request,
    season: str | None = Query(default=None),
):
    season_context = await _build_football_season_context(request, season)
    selected_season_key = season_context["selected_season_key"]

    start_date, end_date = _season_matches_window(selected_season_key)
    matches = await retreive_matches(start_date, end_date, selected_season_key)
    matches = update_match_timezone(matches)

    today_anchor = datetime.now(tz=LONDON_TZ).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    day_groups = _build_match_day_groups(matches, today_anchor)
    current_day_anchor, jump_targets = _build_all_matches_jump_targets(day_groups, today_anchor)

    return TEMPLATES.TemplateResponse(
        request,
        "football/match_template.html",
        {
            "request": request,
            "matches": matches,
            "day_groups": day_groups,
            "title": "All Matches",
            "live_matches": False,
            "all_matches_view": True,
            "enable_live_updates": bool(season_context["is_current_season"]),
            "current_day_anchor": current_day_anchor,
            "jump_targets": jump_targets,
            **season_context,
        },
    )


@football_router.get("/matches/{month}", response_class=HTMLResponse)
@football_router.get("/matches/{month}/", response_class=HTMLResponse)
async def get_months_matches(
    request: Request,
    month: int = Path(ge=1, le=12),
    season: str | None = Query(default=None),
):
    season_context = await _build_football_season_context(request, season)
    selected_season_key = season_context["selected_season_key"]

    year = _year_for_season_month(month, selected_season_key)

    _, last_day_of_month = monthrange(year, month)

    start_date = datetime(year, month, 1, 0, 0, 0)
    end_date = datetime(year, month, last_day_of_month, 23, 59, 59)

    matches = await retreive_matches(start_date, end_date, selected_season_key)
    matches = update_match_timezone(matches)
    enable_live_updates = bool(season_context["is_current_season"])
    today_anchor = datetime.now(tz=LONDON_TZ).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    day_groups = _build_match_day_groups(matches, today_anchor)

    return TEMPLATES.TemplateResponse(
        request,
        "football/match_template.html",
        {
            "request": request,
            "matches": matches,
            "day_groups": day_groups,
            "title": month_name[month],
            "live_matches": False,
            "enable_live_updates": enable_live_updates,
            **season_context,
        },
    )


@football_router.get("/matches/team/{team_id}", response_class=HTMLResponse)
@football_router.get("/matches/team/{team_id}/", response_class=HTMLResponse)
async def get_teams_matches(
    request: Request,
    team_id: int,
    season: str | None = Query(default=None),
):
    season_context = await _build_football_season_context(request, season)
    selected_season_key = season_context["selected_season_key"]

    team_name, matches = await retreive_team_matches(team_id, selected_season_key)
    matches = update_match_timezone(matches)
    enable_live_updates = bool(season_context["is_current_season"])
    day_groups = _build_team_month_groups(matches)
    today_anchor = datetime.now(tz=LONDON_TZ).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    jump_targets = [
        {"label": day_group["label"], "anchor": day_group["anchor_id"]}
        for day_group in day_groups
        if isinstance(day_group.get("label"), str)
        and isinstance(day_group.get("anchor_id"), str)
    ]
    current_day_anchor = (
        _build_team_matches_current_anchor(day_groups, today_anchor)
        if season_context["is_current_season"]
        else None
    )

    return TEMPLATES.TemplateResponse(
        request,
        "football/match_template.html",
        {
            "request": request,
            "matches": matches,
            "day_groups": day_groups,
            "title": team_name,
            "live_matches": False,
            "enable_live_updates": enable_live_updates,
            "team_matches_view": True,
            "jump_targets": jump_targets,
            "current_day_anchor": current_day_anchor,
            **season_context,
        },
    )


@football_router.get("/subscriptions", response_class=HTMLResponse)
@football_router.get("/subscriptions/", response_class=HTMLResponse)
async def get_subscriptions_page(request: Request):
    season_context = await _build_football_season_context(
        request, None, show_selector=False
    )
    auth_links = _build_football_auth_links(request)
    current_season_key = season_context["current_season_key"]
    teams = await _get_current_season_teams(current_season_key)

    return TEMPLATES.TemplateResponse(
        request,
        "football/subscriptions_template.html",
        {
            "request": request,
            "title": "Notifications",
            "live_matches": False,
            "enable_live_updates": False,
            "matches": [],
            "teams": teams,
            "can_manage_subscriptions": _request_username(request) != "Anonymous User",
            **auth_links,
            **season_context,
        },
    )


@football_router.get("/head-to-head", response_class=HTMLResponse)
@football_router.get("/head-to-head/", response_class=HTMLResponse)
async def get_head_to_head_matches(
    request: Request,
    team_a: int | None = Query(default=None),
    team_b: int | None = Query(default=None),
    season: str | None = Query(default=None),
):
    season_context = await _build_football_season_context(
        request, season, show_selector=False
    )

    teams = await retreive_all_teams()
    teams_by_id = {team.id: team for team in teams}

    selected_team_a = teams_by_id.get(team_a) if team_a is not None else None
    selected_team_b = teams_by_id.get(team_b) if team_b is not None else None

    matches = []
    summary = None
    validation_message: str | None = None
    team_primary_colours: dict[int, str] = {}

    if selected_team_a is not None and selected_team_b is not None:
        team_primary_colours = await retreive_team_primary_colours(
            [selected_team_a.id, selected_team_b.id]
        )

    if team_a is not None or team_b is not None:
        if selected_team_a is None or selected_team_b is None:
            validation_message = "Please select two valid teams."
        elif selected_team_a.id == selected_team_b.id:
            validation_message = "Please choose two different teams."
        else:
            matches = await retreive_head_to_head_matches_by_id(
                selected_team_a.id, selected_team_b.id
            )
            matches = update_match_timezone(matches)

            played_matches = [
                match
                for match in matches
                if match.score.full_time.home is not None
                and match.score.full_time.away is not None
            ]

            team_a_wins = 0
            team_b_wins = 0
            draws = 0
            team_a_goals = 0
            team_b_goals = 0

            for match in played_matches:
                home_score = match.score.full_time.home
                away_score = match.score.full_time.away

                if home_score is None or away_score is None:
                    continue

                if match.home_team.id == selected_team_a.id:
                    team_a_goals += home_score
                    team_b_goals += away_score
                else:
                    team_a_goals += away_score
                    team_b_goals += home_score

                if home_score == away_score:
                    draws += 1
                elif home_score > away_score:
                    if match.home_team.id == selected_team_a.id:
                        team_a_wins += 1
                    else:
                        team_b_wins += 1
                else:
                    if match.away_team.id == selected_team_a.id:
                        team_a_wins += 1
                    else:
                        team_b_wins += 1

            summary = {
                "meetings": len(matches),
                "played": len(played_matches),
                "team_a_wins": team_a_wins,
                "team_b_wins": team_b_wins,
                "draws": draws,
                "team_a_goals": team_a_goals,
                "team_b_goals": team_b_goals,
            }

            if len(matches) == 0:
                validation_message = "No matches found between the selected teams."

    return TEMPLATES.TemplateResponse(
        request,
        "football/head_to_head_template.html",
        {
            "request": request,
            "title": "Head to Head",
            "live_matches": False,
            "matches": matches,
            "teams": teams,
            "selected_team_a": selected_team_a,
            "selected_team_b": selected_team_b,
            "team_a_primary_colour": (
                team_primary_colours.get(selected_team_a.id)
                if selected_team_a is not None
                else None
            ),
            "team_b_primary_colour": (
                team_primary_colours.get(selected_team_b.id)
                if selected_team_b is not None
                else None
            ),
            "summary": summary,
            "validation_message": validation_message,
            **season_context,
        },
    )


@football_router.get("/stats", response_class=HTMLResponse)
@football_router.get("/stats/", response_class=HTMLResponse)
async def get_stats_page(
    request: Request,
    season_start: str | None = Query(default=None),
    season_end: str | None = Query(default=None),
    competition: str | None = Query(default=None),
    venue: str = Query(default=FootballHistoryVenue.both.value),
    team: str | None = Query(default=None),
    team_a: str | None = Query(default=None),
    team_b: str | None = Query(default=None),
):
    season_context = await _build_football_season_context(
        request,
        season_end,
        show_selector=False,
    )

    available_seasons = season_context.get("available_seasons", [])
    available_season_keys = [
        str(season_option.get("key", ""))
        for season_option in available_seasons
        if str(season_option.get("key", "")) != ""
    ]

    selected_start_key, selected_end_key = _normalise_stats_season_range(
        available_season_keys=available_season_keys,
        requested_start_key=season_start,
        requested_end_key=season_end,
        default_end_key=str(season_context["selected_season_key"]),
    )

    selected_start_history_label = _season_label_for_history_api(selected_start_key)
    selected_end_history_label = _season_label_for_history_api(selected_end_key)

    selected_team_id, team_parse_error = _parse_optional_query_int(team)
    selected_team_a_id, team_a_parse_error = _parse_optional_query_int(team_a)
    selected_team_b_id, team_b_parse_error = _parse_optional_query_int(team_b)

    teams = await retreive_all_teams()
    teams_by_id = {team_option.id: team_option for team_option in teams}

    selected_team = (
        teams_by_id.get(selected_team_id) if selected_team_id is not None else None
    )
    selected_team_a = (
        teams_by_id.get(selected_team_a_id) if selected_team_a_id is not None else None
    )
    selected_team_b = (
        teams_by_id.get(selected_team_b_id) if selected_team_b_id is not None else None
    )

    available_competitions = sorted(
        {
            get_competition_name_for_season(season_key)
            for season_key in available_season_keys
        }
    )
    selected_competition = (
        competition.strip()
        if isinstance(competition, str) and competition.strip() in available_competitions
        else None
    )

    try:
        selected_venue = FootballHistoryVenue(venue)
    except ValueError:
        selected_venue = FootballHistoryVenue.both

    query_errors: list[str] = []
    aggregate_rows: list[dict[str, object]] = []
    table_rows: list[dict[str, object]] = []
    recent_result_rows: list[dict[str, object]] = []
    h2h_summary: dict[str, object] | None = None
    h2h_result_rows: list[dict[str, object]] = []
    aggregate_query_ms: int | None = None
    table_query_ms: int | None = None
    recent_results_query_ms: int | None = None
    h2h_query_ms: int | None = None
    aggregate_disclaimer: str | None = None

    if team_parse_error:
        query_errors.append("Selected team filter is invalid.")
    elif selected_team_id is not None and selected_team is None:
        query_errors.append("Selected team filter is invalid.")
    if team_a_parse_error:
        query_errors.append("Head to head Team A is invalid.")
    elif selected_team_a_id is not None and selected_team_a is None:
        query_errors.append("Head to head Team A is invalid.")
    if team_b_parse_error:
        query_errors.append("Head to head Team B is invalid.")
    elif selected_team_b_id is not None and selected_team_b is None:
        query_errors.append("Head to head Team B is invalid.")
    if (
        selected_team_a is not None
        and selected_team_b is not None
        and selected_team_a.id == selected_team_b.id
    ):
        query_errors.append("Head to head teams must be different.")

    team_filters = [str(selected_team.short_name)] if selected_team is not None else []
    competition_filters = [selected_competition] if selected_competition is not None else []

    if len(query_errors) == 0:
        try:
            history_api_key = _load_football_history_api_key()
        except RuntimeError as exc:
            query_errors.append(str(exc))
        else:
            try:
                await _require_football_history_api_key(
                    authorization=f"Bearer {history_api_key}"
                )
            except HTTPException as exc:
                query_errors.append(f"History API authentication failed: {exc.detail}")

        if len(query_errors) == 0:

            aggregate_payload = FootballHistoryRequestEnvelope(
                request=FootballHistoryRequestModel(
                    action=FootballHistoryAction.get_aggregate_stats,
                    filters=FootballHistoryFilters(
                        teams=team_filters,
                        competitions=competition_filters,
                        season_start=selected_start_history_label,
                        season_end=selected_end_history_label,
                        venue=selected_venue,
                    ),
                    metrics=[
                        FootballHistoryMetric.matches_played,
                        FootballHistoryMetric.wins,
                        FootballHistoryMetric.draws,
                        FootballHistoryMetric.losses,
                        FootballHistoryMetric.goals_for,
                        FootballHistoryMetric.goals_against,
                        FootballHistoryMetric.goal_difference,
                        FootballHistoryMetric.points,
                    ],
                    group_by=[FootballHistoryGroupBy.team],
                    sort_by=FootballHistorySortBy(
                        field="points",
                        order=FootballHistorySortOrder.desc,
                    ),
                    limit=20,
                )
            )

            table_payload = FootballHistoryRequestEnvelope(
                request=FootballHistoryRequestModel(
                    action=FootballHistoryAction.get_league_table,
                    filters=FootballHistoryFilters(
                        teams=team_filters,
                        competitions=competition_filters,
                        season_start=selected_end_history_label,
                        season_end=selected_end_history_label,
                        venue=selected_venue,
                    ),
                    sort_by=FootballHistorySortBy(
                        field="position",
                        order=FootballHistorySortOrder.asc,
                    ),
                    limit=20,
                )
            )

            recent_results_payload = FootballHistoryRequestEnvelope(
                request=FootballHistoryRequestModel(
                    action=FootballHistoryAction.get_match_results,
                    filters=FootballHistoryFilters(
                        teams=team_filters,
                        competitions=competition_filters,
                        season_start=selected_start_history_label,
                        season_end=selected_end_history_label,
                        venue=selected_venue,
                    ),
                    sort_by=FootballHistorySortBy(
                        field="utc_date",
                        order=FootballHistorySortOrder.desc,
                    ),
                    limit=20,
                )
            )

            query_jobs: list[tuple[str, FootballHistoryRequestEnvelope]] = [
                ("Aggregate stats", aggregate_payload),
                ("League table", table_payload),
                ("Recent results", recent_results_payload),
            ]

            should_query_h2h = (
                selected_team_a is not None
                and selected_team_b is not None
                and selected_team_a.id != selected_team_b.id
            )

            if should_query_h2h and selected_team_a is not None and selected_team_b is not None:
                h2h_payload = FootballHistoryRequestEnvelope(
                    request=FootballHistoryRequestModel(
                        action=FootballHistoryAction.get_head_to_head,
                        filters=FootballHistoryFilters(
                            teams=[
                                str(selected_team_a.short_name),
                                str(selected_team_b.short_name),
                            ],
                            competitions=competition_filters,
                            season_start=selected_start_history_label,
                            season_end=selected_end_history_label,
                            venue=selected_venue,
                        ),
                        sort_by=FootballHistorySortBy(
                            field="utc_date",
                            order=FootballHistorySortOrder.desc,
                        ),
                        limit=14,
                    )
                )
                query_jobs.append(("Head to head", h2h_payload))

            query_results = await asyncio.gather(
                *[
                    _query_history_api_internal(payload)
                    for _, payload in query_jobs
                ],
                return_exceptions=True,
            )

            envelopes: dict[str, FootballHistoryResponseEnvelope] = {}

            for (dataset_label, _), query_result in zip(query_jobs, query_results):
                if isinstance(query_result, BaseException):
                    query_errors.append(f"{dataset_label}: {query_result}")
                    continue

                if not isinstance(query_result, FootballHistoryResponseEnvelope):
                    query_errors.append(
                        f"{dataset_label}: History API returned an unexpected response."
                    )
                    continue

                envelopes[dataset_label] = query_result

            aggregate_envelope = envelopes.get("Aggregate stats")
            if aggregate_envelope is not None:
                aggregate_rows, aggregate_metadata = _extract_history_data(
                    aggregate_envelope,
                    "Aggregate stats",
                    query_errors,
                )
                if aggregate_metadata is not None:
                    aggregate_query_ms = aggregate_metadata.query_execution_time_ms
                    aggregate_disclaimer = aggregate_metadata.data_disclaimer

            table_envelope = envelopes.get("League table")
            if table_envelope is not None:
                table_rows, table_metadata = _extract_history_data(
                    table_envelope,
                    "League table",
                    query_errors,
                )
                if table_metadata is not None:
                    table_query_ms = table_metadata.query_execution_time_ms

            recent_results_envelope = envelopes.get("Recent results")
            if recent_results_envelope is not None:
                recent_result_rows, recent_results_metadata = _extract_history_data(
                    recent_results_envelope,
                    "Recent results",
                    query_errors,
                )
                if recent_results_metadata is not None:
                    recent_results_query_ms = recent_results_metadata.query_execution_time_ms
                recent_result_rows = _format_history_match_rows(recent_result_rows)

            h2h_envelope = envelopes.get("Head to head")
            if h2h_envelope is not None:
                h2h_rows, h2h_metadata = _extract_history_data(
                    h2h_envelope,
                    "Head to head",
                    query_errors,
                )
                if h2h_metadata is not None:
                    h2h_query_ms = h2h_metadata.query_execution_time_ms

                if (
                    len(h2h_rows) > 0
                    and isinstance(h2h_rows[0], dict)
                    and h2h_rows[0].get("record_type") == "summary"
                ):
                    h2h_summary = h2h_rows[0]
                    h2h_result_rows = _format_history_match_rows(h2h_rows[1:])
                else:
                    h2h_result_rows = _format_history_match_rows(h2h_rows)

    return TEMPLATES.TemplateResponse(
        request,
        "football/stats_template.html",
        {
            "request": request,
            "title": "Stats",
            "teams": teams,
            "selected_team_filter": selected_team,
            "selected_team_a": selected_team_a,
            "selected_team_b": selected_team_b,
            "selected_start_key": selected_start_key,
            "selected_end_key": selected_end_key,
            "selected_start_label": get_season_short_label(selected_start_key),
            "selected_end_label": get_season_short_label(selected_end_key),
            "selected_competition": selected_competition,
            "available_competitions": available_competitions,
            "selected_venue": selected_venue.value,
            "aggregate_rows": aggregate_rows,
            "table_rows": table_rows,
            "recent_result_rows": recent_result_rows,
            "h2h_summary": h2h_summary,
            "h2h_result_rows": h2h_result_rows,
            "aggregate_query_ms": aggregate_query_ms,
            "table_query_ms": table_query_ms,
            "recent_results_query_ms": recent_results_query_ms,
            "h2h_query_ms": h2h_query_ms,
            "aggregate_disclaimer": aggregate_disclaimer,
            "query_errors": query_errors,
            **season_context,
        },
    )


@football_router.get("/table", response_class=HTMLResponse)
@football_router.get("/table/", response_class=HTMLResponse)
async def get_table(
    request: Request,
    season: str | None = Query(default=None),
):
    season_context = await _build_football_season_context(request, season)
    selected_season_key = season_context["selected_season_key"]

    table_list: list[LiveTableItem] = await get_table_db_for_season(selected_season_key)

    return TEMPLATES.TemplateResponse(
        request,
        "football/table_template.html",
        {
            "request": request,
            "title": "League Table",
            "table_list": table_list,
            **season_context,
        },
    )


@football_router.get("/manifest.webmanifest")
async def get_football_manifest(request: Request):
    if not _is_football_web_app_request(request):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    return FileResponse(
        path=FOOTBALL_MANIFEST_PATH,
        media_type="application/manifest+json",
    )


@football_router.get("/sw.js")
async def get_football_service_worker(request: Request):
    if not _is_football_web_app_request(request):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    return FileResponse(
        path=FOOTBALL_SERVICE_WORKER_PATH,
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@football_router.get("/bet", response_class=HTMLResponse)
@football_router.get("/bet/", response_class=HTMLResponse)
async def get_bet_page(request: Request):
    return TEMPLATES.TemplateResponse(
        request, "football/bet_template.html", {"request": request}
    )


@football_router.get("/bet/data", response_model=FootballBetList)
@football_router.get("/bet/data/", response_model=FootballBetList)
async def get_bet_data(request: Request):
    return await create_bet_standings()


@football_router.get("/api", response_model=SimplifiedFootballData)
@football_router.get("/api/", response_model=SimplifiedFootballData)
async def get_simplified_matches(request: Request) -> SimplifiedFootballData:
    # Get live-window matches from the database.
    start_date, end_date = _live_scores_window()
    matches = await retreive_matches(start_date, end_date)

    # Create a list of simplified matches
    simplified_football_data: SimplifiedFootballData = SimplifiedFootballData(
        matches=[], table=[]
    )

    # Convert the matches to the simplified version
    for match in matches:
        simplified_football_data.matches.append(
            SimplifiedMatch(
                status=str(match.status),
                start_time_iso=match.utc_date.astimezone(
                    tz=ZoneInfo("Europe/London")
                ).isoformat(),
                home_team=str(match.home_team.short_name),
                home_team_crest=str(match.home_team.local_crest),
                home_team_score=match.score.full_time.home,
                away_team=str(match.away_team.short_name),
                away_team_crest=str(match.away_team.local_crest),
                away_team_score=match.score.full_time.away,
            )
        )

    table_list = await get_table_db()

    for table_item in table_list:
        simplified_football_data.table.append(
            SimplifiedTableRow(
                position=table_item.position,
                team=table_item.team.short_name,
                played=table_item.played_games,
                won=table_item.won,
                drawn=table_item.draw,
                lost=table_item.lost,
                goals_for=table_item.goals_for,
                goals_against=table_item.goals_against,
                goal_difference=table_item.goal_difference,
                points=table_item.points,
            )
        )

    # Return the simplified football data
    return simplified_football_data


@football_router.websocket("/ws/")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    logging.info("Football Websocket Opened")

    try:
        selected_season_key = websocket.query_params.get("season")

        while True:
            # Wait for a message from the client
            recv = await websocket.receive_text()

            # Load the json
            msg = json.loads(recv)

            if msg["messageType"] == "get_scores":
                logging.debug("Football Websocket")
                if bool(msg.get("currentDayOnly", False)):
                    start_date, end_date = _today_scores_window()
                else:
                    start_date, end_date = _live_scores_window()

                matches = await retreive_matches(
                    start_date, end_date, selected_season_key
                )
                logging.debug("Got matches")

                match_list = MatchList(matches=matches)

                await websocket.send_text(match_list.model_dump_json())

    except WebSocketDisconnect:
        logging.info("Football Socket Closed")


@football_router.websocket("/ws/table/")
async def websocket_table_endpoint(websocket: WebSocket):
    await websocket.accept()

    logging.info("Football Table Websocket Opened")

    try:
        while True:
            recv = await websocket.receive_text()
            msg = json.loads(recv)

            if msg.get("messageType") == "get_table":
                table_list = await get_table_db()
                payload = LiveTableList(table_list=table_list)
                await websocket.send_text(payload.model_dump_json())

    except WebSocketDisconnect:
        logging.info("Football Table Socket Closed")


@football_router.post(
    "/subscription/preferences",
    response_model=SubscriptionPreferencesResponse,
)
@football_router.post(
    "/subscription/preferences/",
    response_model=SubscriptionPreferencesResponse,
)
async def get_subscription_preferences(request: Request, payload: SubscriptionLookupRequest):
    subscription_doc = await get_push_subscription(payload.subscription)
    username = _request_username(request)
    is_logged_in = username != "Anonymous User"

    if subscription_doc is None:
        return SubscriptionPreferencesResponse(
            is_subscribed=False,
            can_manage_subscription=is_logged_in,
            ownership_status="none",
        )

    if not is_logged_in:
        return SubscriptionPreferencesResponse(
            is_subscribed=True,
            can_manage_subscription=False,
            ownership_status="logged_out",
            team_ids=sorted(set(subscription_doc.team_ids)),
        )

    if subscription_doc.username == username:
        return SubscriptionPreferencesResponse(
            is_subscribed=True,
            can_manage_subscription=True,
            ownership_status="current_user",
            team_ids=sorted(set(subscription_doc.team_ids)),
        )

    return SubscriptionPreferencesResponse(
        is_subscribed=True,
        can_manage_subscription=False,
        ownership_status="different_user",
        team_ids=sorted(set(subscription_doc.team_ids)),
    )


@football_router.put(
    "/subscription/preferences",
    response_model=SubscriptionPreferencesResponse,
)
@football_router.put(
    "/subscription/preferences/",
    response_model=SubscriptionPreferencesResponse,
)
async def update_subscription_preferences(
    request: Request,
    payload: SubscriptionPreferencesUpdateRequest,
    _: None = Depends(validate_csrf),
):
    current_season_key = await _get_current_season_key()
    current_teams = await _get_current_season_teams(current_season_key)
    valid_team_ids = {team.id for team in current_teams}
    selected_team_ids = sorted(
        {team_id for team_id in payload.team_ids if team_id in valid_team_ids}
    )

    if len(selected_team_ids) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least one valid current-season team.",
        )

    username = _require_logged_in_username(request)
    existing_subscription = await get_push_subscription(payload.subscription)
    _assert_subscription_owner(existing_subscription, username)

    subscription_doc = PushSubscriptionDocument(
        subscription=payload.subscription,
        team_ids=selected_team_ids,
        username=username,
    )
    ok = await upsert_push_subscription(subscription_doc)

    if not ok:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to save subscription preferences.",
        )

    return SubscriptionPreferencesResponse(
        is_subscribed=True,
        team_ids=selected_team_ids,
    )


@football_router.api_route(
    "/subscription/preferences",
    methods=["DELETE"],
    response_model=SubscriptionOperationResponse,
)
@football_router.api_route(
    "/subscription/preferences/",
    methods=["DELETE"],
    response_model=SubscriptionOperationResponse,
)
async def remove_subscription_preferences(
    request: Request,
    payload: SubscriptionLookupRequest,
    _: None = Depends(validate_csrf),
):
    username = _require_logged_in_username(request)
    existing_subscription = await get_push_subscription(payload.subscription)
    _assert_subscription_owner(existing_subscription, username)

    ok = await delete_push_subscription(payload.subscription)

    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subscription not found.",
        )

    return SubscriptionOperationResponse(
        status="success",
        message="Subscription deleted.",
    )


# Legacy endpoint: subscribe request with all current-season teams.
@football_router.post("/subscribe", response_model=SubscriptionOperationResponse)
@football_router.post("/subscribe/", response_model=SubscriptionOperationResponse)
async def subscribe(
    request: Request,
    payload: SubscriptionLookupRequest,
    _: None = Depends(validate_csrf),
):
    current_season_key = await _get_current_season_key()
    current_teams = await _get_current_season_teams(current_season_key)
    selected_team_ids = sorted({team.id for team in current_teams})
    username = _require_logged_in_username(request)

    existing_subscription = await get_push_subscription(payload.subscription)
    _assert_subscription_owner(existing_subscription, username)

    subscription_doc = PushSubscriptionDocument(
        subscription=payload.subscription,
        team_ids=selected_team_ids,
        username=username,
    )
    ok = await upsert_push_subscription(subscription_doc)

    if not ok:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to save subscription.",
        )

    return SubscriptionOperationResponse(
        status="success",
        message="Subscribed to all current-season teams.",
    )


# Legacy endpoint: unsubscribe request.
@football_router.api_route(
    "/unsubscribe",
    methods=["DELETE"],
    response_model=SubscriptionOperationResponse,
)
@football_router.api_route(
    "/unsubscribe/",
    methods=["DELETE"],
    response_model=SubscriptionOperationResponse,
)
async def unsubscribe(
    request: Request,
    payload: SubscriptionLookupRequest,
    _: None = Depends(validate_csrf),
):
    username = _require_logged_in_username(request)
    existing_subscription = await get_push_subscription(payload.subscription)
    _assert_subscription_owner(existing_subscription, username)

    ok = await delete_push_subscription(payload.subscription)

    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subscription not found.",
        )

    return SubscriptionOperationResponse(
        status="success",
        message="Unsubscribed.",
    )
