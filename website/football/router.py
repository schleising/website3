from datetime import datetime
import json
import logging

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.encoders import jsonable_encoder

from ..database.database import get_data_by_date

from ..account.user_model import User
from ..account.admin import ws_get_current_active_user

from .models import Match, MatchList
from . import pl_matches

TEMPLATES = Jinja2Templates('/app/templates')

football_router = APIRouter(prefix='/football')

@football_router.get('/', response_class=HTMLResponse)
async def get_aircraft_page(request: Request):
    logging.info('Football')
    matches = await retreive_matches(datetime.today().replace(hour=0, minute=0, second=0, microsecond=0), datetime.today().replace(hour=23, minute=59, second=59, microsecond=0))
    logging.info('Got matches')
    return TEMPLATES.TemplateResponse('football/match_template.html', {'request': request, 'matches': matches})

async def retreive_matches(date_from: datetime, date_to: datetime) -> list[Match]:
    matches: list[Match] = []

    logging.info(f'Getting Matches from {date_from} to {date_to}')

    if pl_matches is not None:
        matches:list[Match] = await get_data_by_date(pl_matches, 'utc_date', date_from, date_to, Match)
    else:
        logging.info('No DB connection')

    return matches

# def get_match(self) -> Match | None:
#     try:
#         response = requests.get(f'https://api.football-data.org/v4/matches/416171', headers=HEADERS, timeout=3)
#     except requests.exceptions.Timeout:
#         print('Request Timed Out')
#         return None
#     else:
#         if response.status_code == requests.status_codes.codes.ok:
#             match = Match.parse_raw(response.content)
#             print(response.headers)

#             print(f'{match.home_team.short_name} {match.score.full_time.home} {match.score.full_time.away} {match.away_team.short_name} {match.status}')

#             return match
        
#         else:
#             print(f'Failed: {response.status_code}')
#             return None
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
