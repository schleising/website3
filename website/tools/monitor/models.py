from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


# The instance type of the capability, e.g. "online" or "sensorTemperature"
class InstanceType(str, Enum):
    ONLINE = "online"
    TEMPERATURE = "sensorTemperature"
    HUMIDITY = "sensorHumidity"


# The value of the humidity capability
class HumidityValue(BaseModel):
    current_humidity: float = Field(alias="currentHumidity")


# The state of the capability, e.g. the temperature value
# Offline devices can return an empty string for sensor readings.
class State(BaseModel):
    value: float | bool | HumidityValue | None

    @field_validator("value", mode="before")
    @classmethod
    def empty_string_to_none(cls, value: Any) -> Any:
        if value == "":
            return None
        return value


# The container for the capability data
class Capability(BaseModel):
    type: str
    instance: InstanceType
    state: State | None = None


# The device information
class Device(BaseModel):
    sku: str
    device: str
    device_name: str = Field(alias="deviceName")
    type: str
    capabilities: list[Capability]


# The response from the Govee API for the list of devices
class GoveeDeviceResponse(BaseModel):
    code: int
    message: str
    data: list[Device]


# The payload for the status request
class GoveeStatusRequestPayload(BaseModel):
    sku: str
    device: str
    capabilities: list[Capability] | None = None


# The request to get the status of a device
class GoveeStatusRequest(BaseModel):
    request_id: str = Field(default="uuid", alias="requestId")
    payload: GoveeStatusRequestPayload


# The response from the Govee API for the status request
class GoveeStatusResponse(BaseModel):
    request_id: str = Field(alias="requestId")
    code: int
    msg: str
    payload: GoveeStatusRequestPayload


# Measurement data from the sensor stored in the database
class SensorData(BaseModel):
    device_name: str
    timestamp: datetime
    online: bool
    temperature: float
    humidity: float


# The message to send sensor data to the client
class SensorDataMessage(SensorData):
    device_id: str


# The data points to send to the client
class SensorDataPoints(BaseModel):
    data: list[SensorDataMessage]


# Timeseries data point
class TimeseriesDataPoint(BaseModel):
    timestamp: str
    temp: float
    humidity: float


# Timeseries data
class TimeseriesData(BaseModel):
    device_id: str
    data: list[TimeseriesDataPoint]


# One thermostat change stored in web_database.heating_changes.
class HeatingChange(BaseModel):
    device_name: str
    timestamp: datetime
    hvac_status: str
    mode: str | None = None
    heat_celsius: float | None = None
    cool_celsius: float | None = None


# One change on the timeseries payload. Mode and thresholds are carried for the
# Stats dialog and a later usage page, and are not drawn on the wash.
class HeatingChangePoint(BaseModel):
    timestamp: str
    hvac_status: str
    mode: str | None = None
    heat_celsius: float | None = None
    cool_celsius: float | None = None


# The single thermostat timeline painted on every room chart.
class HeatingSeries(BaseModel):
    device_name: str
    device_id: str
    changes: list[HeatingChangePoint]


# Timeseries data response. `heating` is omitted when there is no series.
class TimeseriesDataResponse(BaseModel):
    data: list[TimeseriesData]
    heating: HeatingSeries | None = None


def _utc_isoformat(timestamp: datetime) -> str:
    """Format a stored UTC timestamp. A naive value is UTC, matching the collection."""
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc).isoformat()


def select_heating_changes(
    window: list[HeatingChange],
    prior: HeatingChange | None = None,
    *,
    steady_newest: HeatingChange | None = None,
    steady_has_other_device: bool = False,
) -> list[HeatingChange] | None:
    """Choose one thermostat's changes for the timeseries payload.

    `window` is the rows with timestamp >= since. Those rows choose the device.
    More than one device_name in the window omits the series. `prior` is that
    device's newest row before since; a prior row for any other name is ignored.
    When the window is empty, `steady_newest` is the series only if the
    collection has that single device.
    """
    device_names = {row.device_name for row in window}
    if len(device_names) > 1:
        return None
    if len(device_names) == 1:
        device_name = next(iter(device_names))
        chosen = list(window)
        if prior is not None and prior.device_name == device_name:
            chosen.append(prior)
        return chosen
    if steady_newest is None or steady_has_other_device:
        return None
    return [steady_newest]


def build_heating_series(changes: list[HeatingChange]) -> HeatingSeries | None:
    """Build the one heating series for the timeseries payload.

    Empty input, or more than one device name, omits `heating`. Rows stay in
    timestamp order. A missing mode or threshold stays None so the response
    can leave it off the JSON.
    """
    if not changes:
        return None

    device_names = {change.device_name for change in changes}
    if len(device_names) != 1:
        return None

    ordered = sorted(changes, key=lambda change: change.timestamp)
    device_name = ordered[0].device_name
    return HeatingSeries(
        device_name=device_name,
        device_id=device_name.lower().replace(" ", "-"),
        changes=[
            HeatingChangePoint(
                timestamp=_utc_isoformat(change.timestamp),
                hvac_status=change.hvac_status,
                mode=change.mode,
                heat_celsius=change.heat_celsius,
                cool_celsius=change.cool_celsius,
            )
            for change in ordered
        ],
    )
