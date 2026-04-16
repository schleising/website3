from calendar import monthrange, month_name
from datetime import date, datetime, timedelta
import json
import logging
from zoneinfo import ZoneInfo

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    Path,
    Response,
    status,
)
from fastapi.responses import HTMLResponse
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

SEASON_MONTH_ORDER = [8, 9, 10, 11, 12, 1, 2, 3, 4, 5]
LIVE_DAYS_BEFORE_TODAY = 7
LIVE_DAYS_AFTER_TODAY = 6
LONDON_TZ = ZoneInfo("Europe/London")


def _season_year_bounds(season_key: str) -> tuple[int, int]:
    season_start, season_end = season_key.split("_", maxsplit=1)
    return int(season_start), int(season_end)


def _year_for_season_month(month: int, season_key: str) -> int:
    season_start, season_end = _season_year_bounds(season_key)
    return season_start if month >= 8 else season_end


def _build_month_nav_links(selected_season_key: str) -> list[dict[str, str]]:
    season_label = get_season_short_label(selected_season_key)

    return [
        {
            "label": f"{month_name[month]} {season_label}",
            "url": f"/football/matches/{month}/?season={selected_season_key}",
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
        "season_switch_path": "/football/table/",
        "current_season_url": f"/football/table/?season={current_season_key}",
        "live_scores_url": "/football/",
        "table_url": f"/football/table/?season={selected_season_key}",
        "all_matches_url": f"/football/matches/all/?season={selected_season_key}",
        "month_nav_links": _build_month_nav_links(selected_season_key),
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

    season_context = await _build_football_season_context(request, None)
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
                home_team_score=match.score.full_time.home,
                away_team=str(match.away_team.short_name),
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
async def get_subscription_preferences(payload: SubscriptionLookupRequest):
    subscription_doc = await get_push_subscription(payload.subscription)

    if subscription_doc is None:
        return SubscriptionPreferencesResponse(is_subscribed=False)

    return SubscriptionPreferencesResponse(
        is_subscribed=True,
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
async def remove_subscription_preferences(request: Request, payload: SubscriptionLookupRequest):
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
async def subscribe(request: Request, payload: SubscriptionLookupRequest):
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
async def unsubscribe(request: Request, payload: SubscriptionLookupRequest):
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
