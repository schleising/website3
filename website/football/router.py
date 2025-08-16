from calendar import monthrange, month_name
from datetime import datetime
import json
import logging
from zoneinfo import ZoneInfo

from fastapi import (
    APIRouter,
    Request,
    WebSocket,
    WebSocketDisconnect,
    Path,
    Response,
    status,
)
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError

from ..database.database import get_data_by_date

from .models import (
    FootballBetData,
    FootballBetList,
    Match,
    MatchList,
    LiveTableItem,
    MatchStatus,
    SimplifiedMatch,
    SimplifiedTableRow,
    SimplifiedFootballData,
    TableItem,
)
from . import pl_matches, pl_table, football_push

TEMPLATES = Jinja2Templates("/app/templates")

football_router = APIRouter(prefix="/football")


def update_match_timezone(matches: list[Match], request: Request) -> list[Match]:
    local_tz = ZoneInfo("Europe/London")

    for match in matches:
        match.local_date = match.utc_date.astimezone(local_tz)

    return matches


@football_router.get("/", response_class=HTMLResponse)
async def get_live_matches(request: Request):
    logging.debug(f"/football/: {request}")
    matches = await retreive_matches(
        datetime.today().replace(hour=0, minute=0, second=0, microsecond=0),
        datetime.today().replace(hour=23, minute=59, second=59, microsecond=0),
    )
    matches = update_match_timezone(matches, request)
    return TEMPLATES.TemplateResponse(
        "football/match_template.html",
        {
            "request": request,
            "matches": matches,
            "title": "Today",
            "live_matches": True,
        },
    )


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
    matches = update_match_timezone(matches, request)

    return TEMPLATES.TemplateResponse(
        "football/match_template.html",
        {
            "request": request,
            "matches": matches,
            "title": month_name[month],
            "live_matches": False,
        },
    )


@football_router.get("/matches/team/{team_id}/", response_class=HTMLResponse)
async def get_teams_matches(request: Request, team_id: int):
    team_name, matches = await retreive_team_matches(team_id)
    matches = update_match_timezone(matches, request)

    return TEMPLATES.TemplateResponse(
        "football/match_template.html",
        {
            "request": request,
            "matches": matches,
            "title": team_name,
            "live_matches": False,
        },
    )


@football_router.get("/table/", response_class=HTMLResponse)
async def get_table(request: Request):
    table_list: list[LiveTableItem] = []

    if pl_table is not None:
        table_cursor = pl_table.find({}).sort("position", ASCENDING)

        table_list = [LiveTableItem(**table_item) async for table_item in table_cursor]

    return TEMPLATES.TemplateResponse(
        "football/table_template.html",
        {"request": request, "title": "Premier League Table", "table_list": table_list},
    )


async def retreive_matches(date_from: datetime, date_to: datetime) -> list[Match]:
    matches: list[Match] = []

    logging.debug(f"Getting Matches from {date_from} to {date_to}")

    if pl_matches is not None:
        matches: list[Match] = await get_data_by_date(
            pl_matches, "utc_date", date_from, date_to, Match
        )
    else:
        logging.error("No DB connection")

    return matches


async def retreive_team_matches(team_id: int) -> tuple[str, list[Match]]:
    team_name = "Unknown"

    if pl_matches is not None:
        from_db_cursor = pl_matches.find(
            {"$or": [{"home_team.id": team_id}, {"away_team.id": team_id}]}
        ).sort("utc_date", ASCENDING)

        matches = [Match(**item) async for item in from_db_cursor]
    else:
        matches: list[Match] = []

    # Get the team name from the table db
    if pl_table is not None:
        # Get the team dict from the table db
        team_dict_db = await pl_table.find_one({"team.id": team_id})

        logging.debug(f"Team Dict: {team_dict_db}")

        if team_dict_db is not None:
            item = LiveTableItem(**team_dict_db)
            team_name = item.team.short_name

    return (team_name, matches)


async def retreive_head_to_head_matches(
    team_a_short_name: str, team_b_short_name: str
) -> list[Match]:
    matches: list[Match] = []

    # Get the matches between the two teams from the database
    if pl_matches is not None:
        from_db_cursor = pl_matches.find(
            {
                "$or": [
                    {
                        "home_team.short_name": team_a_short_name,
                        "away_team.short_name": team_b_short_name,
                    },
                    {
                        "home_team.short_name": team_b_short_name,
                        "away_team.short_name": team_a_short_name,
                    },
                ]
            }
        ).sort("utc_date", ASCENDING)

        matches = [Match(**item) async for item in from_db_cursor]
    else:
        logging.error("No DB connection")

    return matches


@football_router.get("/bet/", response_class=HTMLResponse)
async def get_bet_page(request: Request):
    return TEMPLATES.TemplateResponse(
        "football/bet_template.html", {"request": request}
    )


@football_router.get("/bet/data/", response_model=FootballBetList)
async def get_bet_data(request: Request):
    # Get the bet data for the current user
    bet_data = FootballBetList(bets=[])

    # Get the number of points and games remaining for Liverpool, Chelsea and Tottenham
    liverpool_points = 0
    chelsea_points = 0
    tottenham_points = 0

    liverpool_remaining = 0
    chelsea_remaining = 0
    tottenham_remaining = 0

    if pl_table is None:
        return bet_data

    table_cursor = pl_table.find({})

    async for table_item in table_cursor:
        team_details = TableItem.model_validate(table_item)
        if team_details.team.short_name == "Liverpool":
            liverpool_points = team_details.points
            liverpool_remaining = 38 - team_details.played_games
        elif team_details.team.short_name == "Chelsea":
            chelsea_points = team_details.points
            chelsea_remaining = 38 - team_details.played_games
        elif team_details.team.short_name == "Tottenham":
            tottenham_points = team_details.points
            tottenham_remaining = 38 - team_details.played_games

    # Get the matches between Liverpool, Chelsea and Tottenham
    liverpool_chelsea = await retreive_head_to_head_matches("Liverpool", "Chelsea")
    liverpool_tottenham = await retreive_head_to_head_matches("Liverpool", "Tottenham")
    chelsea_tottenham = await retreive_head_to_head_matches("Chelsea", "Tottenham")

    # Filter out matches that have already finished and count them
    liverpool_chelsea = len(
        [match for match in liverpool_chelsea if match.status not in [MatchStatus.in_play, MatchStatus.paused, MatchStatus.finished]]
    )
    liverpool_tottenham = len(
        [match for match in liverpool_tottenham if match.status not in [MatchStatus.in_play, MatchStatus.paused, MatchStatus.finished]]
    )
    chelsea_tottenham = len(
        [match for match in chelsea_tottenham if match.status not in [MatchStatus.in_play, MatchStatus.paused, MatchStatus.finished]]
    )

    # Calculate the best case for each team
    liverpool_best_case = (
        (liverpool_points + (liverpool_remaining * 3))
        - chelsea_points
        - (chelsea_tottenham * 1)
        + (liverpool_points + (liverpool_remaining * 3))
        - tottenham_points
        - (chelsea_tottenham * 1)
    ) * 5

    chelsea_best_case = (
        (chelsea_points + (chelsea_remaining * 3))
        - liverpool_points
        - (liverpool_tottenham * 1)
        + (chelsea_points + (chelsea_remaining * 3))
        - tottenham_points
        - (liverpool_tottenham * 1)
    ) * 5

    tottenham_best_case = (
        (tottenham_points + (tottenham_remaining * 3))
        - liverpool_points
        - (chelsea_tottenham * 1)
        + (tottenham_points + (tottenham_remaining * 3))
        - chelsea_points
        - (chelsea_tottenham * 1)
    ) * 5

    # Calculate the worst case for each team
    liverpool_worst_case = (
        - (chelsea_points - liverpool_points)
        - (tottenham_points - liverpool_points)
        - ((chelsea_remaining - chelsea_tottenham) * 3)
        - ((tottenham_remaining - chelsea_tottenham) * 3)
        - chelsea_tottenham * 3
    ) * 5

    chelsea_worst_case = (
        - (liverpool_points - chelsea_points)
        - (tottenham_points - chelsea_points)
        - ((liverpool_remaining - liverpool_tottenham) * 3)
        - ((tottenham_remaining - liverpool_tottenham) * 3)
        - liverpool_tottenham * 3
    ) * 5

    tottenham_worst_case = (
        - (liverpool_points - tottenham_points)
        - (chelsea_points - tottenham_points)
        - ((liverpool_remaining - liverpool_chelsea) * 3)
        - ((chelsea_remaining - liverpool_chelsea) * 3)
        - liverpool_chelsea * 3
    ) * 5

    # Create a bet data object for each user
    liverpool_bet_data = FootballBetData(
        team_name="liverpool",
        name="Steve",
        points=liverpool_points,
        owea="From Tim" if (liverpool_points - chelsea_points) > 0 else "To Tim",
        amounta=(liverpool_points - chelsea_points) * 5,
        oweb=(
            "From Thommo" if (liverpool_points - tottenham_points) > 0 else "To Thommo"
        ),
        amountb=(liverpool_points - tottenham_points) * 5,
        best_case=liverpool_best_case,
        worst_case=liverpool_worst_case,
        balance="Steve's Balance",
        balance_amount=(
            (liverpool_points - chelsea_points) + (liverpool_points - tottenham_points)
        )
        * 5,
    )

    chelsea_bet_data = FootballBetData(
        team_name="chelsea",
        name="Tim",
        points=chelsea_points,
        owea="From Steve" if (chelsea_points - liverpool_points) > 0 else "To Steve",
        amounta=(chelsea_points - liverpool_points) * 5,
        oweb="From Thommo" if (chelsea_points - tottenham_points) > 0 else "To Thommo",
        amountb=(chelsea_points - tottenham_points) * 5,
        best_case=chelsea_best_case,
        worst_case=chelsea_worst_case,
        balance="Tim's Balance",
        balance_amount=(
            (chelsea_points - liverpool_points) + (chelsea_points - tottenham_points)
        )
        * 5,
    )

    tottenham_bet_data = FootballBetData(
        team_name="tottenham",
        name="Thommo",
        points=tottenham_points,
        owea="From Steve" if (tottenham_points - liverpool_points) > 0 else "To Steve",
        amounta=(tottenham_points - liverpool_points) * 5,
        oweb="From Tim" if (tottenham_points - chelsea_points) > 0 else "To Tim",
        amountb=(tottenham_points - chelsea_points) * 5,
        best_case=tottenham_best_case,
        worst_case=tottenham_worst_case,
        balance="Thommo's Balance",
        balance_amount=(
            (tottenham_points - liverpool_points) + (tottenham_points - chelsea_points)
        )
        * 5,
    )

    # Add the bet data to the list
    bet_data.bets.extend([liverpool_bet_data, chelsea_bet_data, tottenham_bet_data])

    # Sort the bet data by the points field
    bet_data.bets.sort(key=lambda x: x.points, reverse=True)

    return bet_data


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

    table_list: list[LiveTableItem] = []

    if pl_table is not None:
        table_cursor = pl_table.find({}).sort("position", ASCENDING)

        table_list = [LiveTableItem(**table_item) async for table_item in table_cursor]

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
@football_router.post("/subscribe/", status_code=201)
async def subscribe(request: Request, response: Response):
    data = await request.json()
    logging.debug(data)

    # Insert the subscription into the database
    if football_push is not None:
        try:
            result = await football_push.insert_one(data)
        except DuplicateKeyError as ex:
            logging.error(f"Error inserting subscription: {ex}")
            response.status_code = status.HTTP_400_BAD_REQUEST
            return {"status": "error", "message": "Subscription already exists"}

    logging.debug(result)

    # Send a 201 response
    return {"status": "success"}


# Endpoint to unsubscribe from push notifications
@football_router.delete("/unsubscribe/", status_code=204)
async def unsubscribe(request: Request):
    data = await request.json()
    logging.debug(data)

    # Remove the subscription from the database
    if football_push is not None:
        result = await football_push.delete_one(data)

    logging.debug(result)

    # Send a 204 response
    return {"status": "success"}
