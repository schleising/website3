from calendar import monthrange, month_name
from datetime import datetime
import json
import logging

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect, Path
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from ..database.database import get_data_by_date

from ..account.user_model import User
from ..account.admin import ws_get_current_active_user

from .models import Match, MatchList, TableItem
from . import pl_matches, pl_table

TEMPLATES = Jinja2Templates('/app/templates')

football_router = APIRouter(prefix='/football')

@football_router.get('/', response_class=HTMLResponse)
async def get_live_matches(request: Request):
    matches = await retreive_matches(datetime.today().replace(hour=0, minute=0, second=0, microsecond=0), datetime.today().replace(hour=23, minute=59, second=59, microsecond=0))
    return TEMPLATES.TemplateResponse('football/match_template.html', {'request': request, 
                                                                       'matches': matches, 
                                                                       'title': 'Today', 
                                                                       'live_matches': True})

@football_router.get('/matches/{month}', response_class=HTMLResponse)
async def get_months_matches( request: Request, month: int = Path(ge=1, le=12)):
    if month > 5:
        year = 2022
    else:
        year = 2023

    _, last_day_of_month = monthrange(year, month)

    start_date = datetime(year, month, 1, 0, 0, 0)
    end_date = datetime(year, month, last_day_of_month, 23, 59, 59)

    matches = await retreive_matches(start_date, end_date)

    return TEMPLATES.TemplateResponse('football/match_template.html', {'request': request, 
                                                                       'matches': matches, 
                                                                       'title': month_name[month], 
                                                                       'live_matches': False})

@football_router.get('/table/', response_class=HTMLResponse)
async def get_table(request: Request):
    table_list: list[TableItem] = []

    if pl_table is not None:
        table_cursor = pl_table.find({}).sort('position')

        table_list = await table_cursor.to_list(None)

    return TEMPLATES.TemplateResponse('football/table_template.html', {'request': request, 'title': 'Premier League Table', 'table_list': table_list})

async def retreive_matches(date_from: datetime, date_to: datetime) -> list[Match]:
    matches: list[Match] = []

    logging.info(f'Getting Matches from {date_from} to {date_to}')

    if pl_matches is not None:
        matches:list[Match] = await get_data_by_date(pl_matches, 'utc_date', date_from, date_to, Match)
    else:
        logging.info('No DB connection')

    return matches

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
