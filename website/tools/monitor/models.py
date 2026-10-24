import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator

# Nest poll interval (POLL_INTERVAL_SECS in rust-backend). Reported on the
# timeseries payload so the chart does not hardcode 300.
HEATING_SAMPLE_INTERVAL_SECS = 300


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


# One Nest HVAC heartbeat stored in web_database.heating_samples.
class HeatingSample(BaseModel):
    device_name: str
    timestamp: datetime
    hvac_status: str
    mode: str | None = None
    heat_celsius: float | None = None
    cool_celsius: float | None = None


# One sample on the timeseries payload. Mode and setpoints are carried for a
# later usage page and are not drawn.
class HeatingSamplePoint(BaseModel):
    timestamp: str
    hvac_status: str
    mode: str | None = None
    heat_celsius: float | None = None
    cool_celsius: float | None = None


# The single thermostat timeline painted on every room chart.
class HeatingSeries(BaseModel):
    sample_interval_secs: int
    device_name: str
    device_id: str
    samples: list[HeatingSamplePoint]


# Timeseries data response. `heating` is omitted when there are no samples.
class TimeseriesDataResponse(BaseModel):
    data: list[TimeseriesData]
    heating: HeatingSeries | None = None


def build_heating_series(samples: list[HeatingSample]) -> HeatingSeries | None:
    """Build the one heating series for the timeseries payload.

    This house has one thermostat. If more than one device name is stored, the
    series is the device with the newest sample. Every status is kept, including
    OFF and COOLING. Empty input means the chart should draw no wash.
    """
    if not samples:
        return None

    ordered = sorted(samples, key=lambda sample: (sample.timestamp, sample.device_name))
    device_name = ordered[-1].device_name
    device_names = {sample.device_name for sample in ordered}
    if len(device_names) > 1:
        logging.warning(
            "heating_samples has %s thermostats; chart series uses %s",
            len(device_names),
            device_name,
        )

    device_samples = [sample for sample in ordered if sample.device_name == device_name]
    return HeatingSeries(
        sample_interval_secs=HEATING_SAMPLE_INTERVAL_SECS,
        device_name=device_name,
        device_id=device_name.lower().replace(" ", "-"),
        samples=[
            HeatingSamplePoint(
                timestamp=sample.timestamp.astimezone(timezone.utc).isoformat(),
                hvac_status=sample.hvac_status,
                mode=sample.mode,
                heat_celsius=sample.heat_celsius,
                cool_celsius=sample.cool_celsius,
            )
            for sample in device_samples
        ],
    )
