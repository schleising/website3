from calendar import monthrange, month_name
from datetime import datetime
import json
import logging
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect, Path
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pymongo import ASCENDING

from ..database.database import get_data_by_date

from ..account.user_model import User
from ..account.admin import ws_get_current_active_user

from .models import Match, MatchList, TableItem, SimplifiedMatch, SimplifiedMatchList
from . import pl_matches, pl_table

TEMPLATES = Jinja2Templates('/app/templates')

football_router = APIRouter(prefix='/football')

def update_match_timezone(matches: list[Match], request: Request) -> list[Match]:
    local_tz = ZoneInfo('Europe/London')

    for match in matches:
        match.local_date = match.utc_date.astimezone(local_tz)

    return matches

@football_router.get('/', response_class=HTMLResponse)
async def get_live_matches(request: Request):
    matches = await retreive_matches(datetime.today().replace(hour=0, minute=0, second=0, microsecond=0), datetime.today().replace(hour=23, minute=59, second=59, microsecond=0))
    matches = update_match_timezone(matches, request)
    return TEMPLATES.TemplateResponse('football/match_template.html', {'request': request, 
                                                                       'matches': matches, 
                                                                       'title': 'Today', 
                                                                       'live_matches': True})

@football_router.get('/matches/{month}', response_class=HTMLResponse)
async def get_months_matches( request: Request, month: int = Path(ge=1, le=12)):
    if month > 5:
        year = 2023
    else:
        year = 2024

    _, last_day_of_month = monthrange(year, month)

    start_date = datetime(year, month, 1, 0, 0, 0)
    end_date = datetime(year, month, last_day_of_month, 23, 59, 59)

    matches = await retreive_matches(start_date, end_date)
    matches = update_match_timezone(matches, request)

    return TEMPLATES.TemplateResponse('football/match_template.html', {'request': request, 
                                                                       'matches': matches, 
                                                                       'title': month_name[month], 
                                                                       'live_matches': False})

@football_router.get('/matches/team/{team_id}', response_class=HTMLResponse)
async def get_teams_matches( request: Request, team_id: int):
    team_name, matches = await retreive_team_matches(team_id)
    matches = update_match_timezone(matches, request)

    return TEMPLATES.TemplateResponse('football/match_template.html', {'request': request, 
                                                                       'matches': matches, 
                                                                       'title': team_name, 
                                                                       'live_matches': False})

@football_router.get('/table/', response_class=HTMLResponse)
async def get_table(request: Request):
    table_list: list[TableItem] = []

    if pl_table is not None:
        table_cursor = pl_table.find({}).sort('position', ASCENDING)

        table_list = [TableItem(**table_item) async for table_item in table_cursor]

    return TEMPLATES.TemplateResponse('football/table_template.html', {'request': request, 'title': 'Premier League Table', 'table_list': table_list})

async def retreive_matches(date_from: datetime, date_to: datetime) -> list[Match]:
    matches: list[Match] = []

    logging.info(f'Getting Matches from {date_from} to {date_to}')

    if pl_matches is not None:
        matches: list[Match] = await get_data_by_date(pl_matches, 'utc_date', date_from, date_to, Match)
    else:
        logging.info('No DB connection')

    return matches

async def retreive_team_matches(team_id: int) -> tuple[str, list[Match]]:
    team_name = 'Unknown'

    if pl_matches is not None:
        from_db_cursor = pl_matches.find({ '$or': [{ 'home_team.id': team_id }, {'away_team.id': team_id}]}).sort('utc_date', ASCENDING)

        matches = [Match(**item) async for item in from_db_cursor]
    else:
        matches: list[Match] = []

    # Get the team name from the table db
    if pl_table is not None:
        team_dict: dict[str, Any] | None = await pl_table.find_one({'team.id': team_id})
        logging.debug(f'Team Dict: {team_dict}')

        if team_dict is not None:
            item = TableItem(**team_dict)
            team_name = item.team.short_name

    return (team_name, matches)

@football_router.get('/api/', response_model=SimplifiedMatchList)
async def get_simplified_matches(request: Request) -> SimplifiedMatchList:
    # Get todays matches from the database
    matches = await retreive_matches(datetime.today().replace(hour=0, minute=0, second=0, microsecond=0), datetime.today().replace(hour=23, minute=59, second=59, microsecond=0))

    # Create a list of simplified matches
    simplified_matches: SimplifiedMatchList = SimplifiedMatchList(matches = [])

    # Convert the matches to the simplified version
    for match in matches:
        simplified_matches.matches.append(
            SimplifiedMatch(
                status = str(match.status),
                start_time_iso = match.utc_date.astimezone(tz=ZoneInfo('Europe/London')).isoformat(),
                home_team = match.home_team.short_name,
                home_team_score = match.score.full_time.home,
                away_team = match.away_team.short_name,
                away_team_score = match.score.full_time.away
            )
        )

    # Return the simplified matches
    return simplified_matches

@football_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, user: User | None = Depends(ws_get_current_active_user)):
    await websocket.accept()

    logging.info('Football Websocket Opened')

    try:
        while True:
            # Wait for a message from the client
            recv = await websocket.receive_text()

            # Load the json
            msg = json.loads(recv)

            if msg['messageType'] == 'get_scores':
                logging.info('Football Websocket')
                matches = await retreive_matches(datetime.today().replace(hour=0, minute=0, second=0, microsecond=0), datetime.today().replace(hour=23, minute=59, second=59, microsecond=0))
                logging.info('Got matches')

                match_list = MatchList(matches = matches)

                await websocket.send_text(match_list.json())

    except WebSocketDisconnect:
        logging.info('Football Socket Closed')
