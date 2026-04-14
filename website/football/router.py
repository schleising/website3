from calendar import monthrange, month_name
from datetime import datetime
import json
import logging
from zoneinfo import ZoneInfo

from fastapi import (
    APIRouter,
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
    retreive_matches,
    retreive_team_matches,
    retreive_all_teams,
    retreive_head_to_head_matches_by_id,
    get_table_db,
    add_push_subscription,
    delete_push_subscription,
)

from .football_utils import update_match_timezone, create_bet_standings

from .models import (
    FootballBetList,
    MatchList,
    LiveTableItem,
    SimplifiedMatch,
    SimplifiedTableRow,
    SimplifiedFootballData,
)

TEMPLATES = Jinja2Templates("/app/templates")

football_router = APIRouter(prefix="/football")


@football_router.get("/", response_class=HTMLResponse)
async def get_live_matches(request: Request):
    logging.debug(f"/football/: {request}")
    matches = await retreive_matches(
        datetime.today().replace(hour=0, minute=0, second=0, microsecond=0),
        datetime.today().replace(hour=23, minute=59, second=59, microsecond=0),
    )
    matches = update_match_timezone(matches)
    return TEMPLATES.TemplateResponse(
        request,
        "football/match_template.html",
        {
            "request": request,
            "matches": matches,
            "title": "Today",
            "live_matches": True,
        },
    )


@football_router.get("/matches/{month}", response_class=HTMLResponse)
@football_router.get("/matches/{month}/", response_class=HTMLResponse)
async def get_months_matches(request: Request, month: int = Path(ge=1, le=12)):
    if month > 5:
        year = 2025
    else:
        year = 2026

    _, last_day_of_month = monthrange(year, month)

    start_date = datetime(year, month, 1, 0, 0, 0)
    end_date = datetime(year, month, last_day_of_month, 23, 59, 59)

    matches = await retreive_matches(start_date, end_date)
    matches = update_match_timezone(matches)

    return TEMPLATES.TemplateResponse(
        request,
        "football/match_template.html",
        {
            "request": request,
            "matches": matches,
            "title": month_name[month],
            "live_matches": False,
        },
    )


@football_router.get("/matches/team/{team_id}", response_class=HTMLResponse)
@football_router.get("/matches/team/{team_id}/", response_class=HTMLResponse)
async def get_teams_matches(request: Request, team_id: int):
    team_name, matches = await retreive_team_matches(team_id)
    matches = update_match_timezone(matches)

    return TEMPLATES.TemplateResponse(
        request,
        "football/match_template.html",
        {
            "request": request,
            "matches": matches,
            "title": team_name,
            "live_matches": False,
        },
    )


@football_router.get("/head-to-head", response_class=HTMLResponse)
@football_router.get("/head-to-head/", response_class=HTMLResponse)
async def get_head_to_head_matches(
    request: Request,
    team_a: int | None = Query(default=None),
    team_b: int | None = Query(default=None),
):
    teams = await retreive_all_teams()
    teams_by_id = {team.id: team for team in teams}

    selected_team_a = teams_by_id.get(team_a) if team_a is not None else None
    selected_team_b = teams_by_id.get(team_b) if team_b is not None else None

    matches = []
    summary = None
    validation_message: str | None = None

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
            "summary": summary,
            "validation_message": validation_message,
        },
    )


@football_router.get("/table", response_class=HTMLResponse)
@football_router.get("/table/", response_class=HTMLResponse)
async def get_table(request: Request):
    table_list: list[LiveTableItem] = await get_table_db()

    return TEMPLATES.TemplateResponse(
        request,
        "football/table_template.html",
        {"request": request, "title": "Premier League Table", "table_list": table_list},
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
    # Get todays matches from the database
    matches = await retreive_matches(
        datetime.today().replace(hour=0, minute=0, second=0, microsecond=0),
        datetime.today().replace(hour=23, minute=59, second=59, microsecond=0),
    )

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
        while True:
            # Wait for a message from the client
            recv = await websocket.receive_text()

            # Load the json
            msg = json.loads(recv)

            if msg["messageType"] == "get_scores":
                logging.debug("Football Websocket")
                matches = await retreive_matches(
                    datetime.today().replace(hour=0, minute=0, second=0, microsecond=0),
                    datetime.today().replace(
                        hour=23, minute=59, second=59, microsecond=0
                    ),
                )
                logging.debug("Got matches")

                match_list = MatchList(matches=matches)

                await websocket.send_text(match_list.model_dump_json())

    except WebSocketDisconnect:
        logging.info("Football Socket Closed")


# Endpoint to subscribe to push notifications
@football_router.post("/subscribe", status_code=201)
@football_router.post("/subscribe/", status_code=201)
async def subscribe(request: Request, response: Response):
    data = await request.json()
    logging.debug(data)

    # Insert the subscription into the database
    ok = await add_push_subscription(data)

    # Check if the subscription was added
    if not ok:
        response.status_code = status.HTTP_400_BAD_REQUEST
        return {"status": "error", "message": "Subscription already exists"}

    # Send a 201 response
    return {"status": "success"}


# Endpoint to unsubscribe from push notifications
@football_router.delete("/unsubscribe", status_code=204)
@football_router.delete("/unsubscribe/", status_code=204)
async def unsubscribe(request: Request):
    data = await request.json()
    logging.debug(data)

    # Remove the subscription from the database
    ok = await delete_push_subscription(data)

    # Check if the subscription was deleted
    if not ok:
        return {"status": "error", "message": "Subscription not found"}

    # Send a 204 response
    return {"status": "success"}
