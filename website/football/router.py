from datetime import datetime
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from ..database.database import get_data_by_date

from .models import Match
from . import pl_matches

TEMPLATES = Jinja2Templates('/app/templates')

football_router = APIRouter(prefix='/football')

@football_router.get('/', response_class=HTMLResponse)
async def get_aircraft_page(request: Request):
    matches = await retreive_matches(datetime.today().replace(hour=0, minute=0, second=0, microsecond=0), datetime.today().replace(hour=23, minute=59, second=59, microsecond=0))
    return TEMPLATES.TemplateResponse('football/match_template.html', {'request': request, 'matches': matches})

async def retreive_matches(date_from: datetime, date_to: datetime) -> list[Match]:
    matches: list[Match] = []

    if pl_matches is not None:
        matches:list[Match] = await get_data_by_date(pl_matches, 'utc_date', date_from, date_to, Match)

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
