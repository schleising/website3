from pydantic import BaseModel, Field

class AircraftModel(BaseModel):
    icao24: str
    timestamp: str
    acars: str
    adsb: str
    built: str
    categoryDescription: str
    country: str
    engines: str
    firstFlightDate: str
    firstSeen: str
    icaoAircraftClass: str
    lineNumber: str
    manufacturerIcao: str
    manufacturerName: str
    model: str
    modes: str
    nextReg: str
    operator: str
    operatorCallsign: str
    operatorIata: str
    operatorIcao: str
    owner: str
    prevReg: str
    regUntil: str
    registered: str
    registration: str
    selCal: str
    serialNumber: str
    status: str
    typecode: str
    vdl: str

class TailNumberLookup(BaseModel):
    tail_no: str

class TailNumbersResponse(BaseModel):
    tail_numbers: list[str] = Field(default_factory=list)
