from datetime import date
from typing import Union

from pydantic import BaseModel

class AircraftModel(BaseModel):
    icao24: str
    registration: str
    manufacturericao: str
    manufacturername: str
    model: str
    typecode: str
    serialnumber: str
    linenumber: str
    icaoaircrafttype: str
    operator: str
    operatorcallsign: str
    operatoricao: str
    operatoriata: str
    owner: str
    testreg: str
    registered: Union[date, str]
    reguntil: Union[date, str]
    status: str
    built: Union[date, str]
    firstflightdate: Union[date, str]
    seatconfiguration: str
    engines: str
    modes: str
    adsb: str
    acars: str
    notes: str
    categoryDescription: str
