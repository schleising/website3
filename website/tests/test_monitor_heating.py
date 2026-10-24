"""Heating series on the Monitor timeseries payload.

Loads monitor models directly so the package init does not open Mongo.
The loaded module is typed as Any because it is imported by path.
"""
# pyright: reportAny=false, reportExplicitAny=false, reportUnusedCallResult=false

from __future__ import annotations

import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _load_models() -> Any:
    path = Path(__file__).resolve().parents[1] / "tools" / "monitor" / "models.py"
    spec = importlib.util.spec_from_file_location("monitor_heating_models", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MODELS = _load_models()


def _sample(
    device_name: str,
    timestamp: str,
    hvac_status: str,
    mode: str | None = None,
    heat_celsius: float | None = None,
    cool_celsius: float | None = None,
) -> Any:
    return MODELS.HeatingSample(
        device_name=device_name,
        timestamp=datetime.fromisoformat(timestamp),
        hvac_status=hvac_status,
        mode=mode,
        heat_celsius=heat_celsius,
        cool_celsius=cool_celsius,
    )


class BuildHeatingSeriesTests(unittest.TestCase):
    def test_empty_samples_leave_heating_unset(self) -> None:
        self.assertIsNone(MODELS.build_heating_series([]))
        payload = MODELS.TimeseriesDataResponse(data=[]).model_dump(exclude_none=True)
        self.assertNotIn("heating", payload)

    def test_heat_sample_omits_cool_and_keeps_mode_and_setpoint(self) -> None:
        series = MODELS.build_heating_series(
            [
                _sample(
                    "Living Room Nest",
                    "2026-10-24T17:00:00+00:00",
                    "HEATING",
                    mode="HEAT",
                    heat_celsius=20.0,
                )
            ]
        )
        self.assertIsNotNone(series)
        assert series is not None
        self.assertEqual(series.sample_interval_secs, 300)
        self.assertEqual(series.device_name, "Living Room Nest")
        self.assertEqual(series.device_id, "living-room-nest")

        payload = series.model_dump(mode="json", exclude_none=True)
        sample = payload["samples"][0]
        self.assertEqual(sample["hvac_status"], "HEATING")
        self.assertEqual(sample["mode"], "HEAT")
        self.assertEqual(sample["heat_celsius"], 20.0)
        self.assertNotIn("cool_celsius", sample)
        self.assertTrue(sample["timestamp"].startswith("2026-10-24T17:00:00"))

    def test_cool_sample_omits_heat_setpoint(self) -> None:
        series = MODELS.build_heating_series(
            [
                _sample(
                    "Living Room Nest",
                    "2026-10-24T18:00:00+00:00",
                    "COOLING",
                    mode="COOL",
                    cool_celsius=24.0,
                )
            ]
        )
        assert series is not None
        sample = series.model_dump(mode="json", exclude_none=True)["samples"][0]
        self.assertEqual(sample["hvac_status"], "COOLING")
        self.assertEqual(sample["cool_celsius"], 24.0)
        self.assertNotIn("heat_celsius", sample)

    def test_off_without_mode_or_setpoint_omits_those_fields(self) -> None:
        series = MODELS.build_heating_series(
            [_sample("Living Room Nest", "2026-10-24T19:00:00+00:00", "OFF")]
        )
        assert series is not None
        sample = series.model_dump(mode="json", exclude_none=True)["samples"][0]
        self.assertEqual(sample["hvac_status"], "OFF")
        self.assertNotIn("mode", sample)
        self.assertNotIn("heat_celsius", sample)
        self.assertNotIn("cool_celsius", sample)

    def test_missing_document_fields_default_to_absent(self) -> None:
        sample = MODELS.HeatingSample.model_validate(
            {
                "device_name": "Living Room Nest",
                "timestamp": datetime(2026, 10, 24, 17, 0, tzinfo=timezone.utc),
                "hvac_status": "HEATING",
            }
        )
        self.assertIsNone(sample.mode)
        self.assertIsNone(sample.heat_celsius)
        self.assertIsNone(sample.cool_celsius)

    def test_one_thermostat_keeps_every_status_in_time_order(self) -> None:
        series = MODELS.build_heating_series(
            [
                _sample(
                    "Living Room Nest",
                    "2026-10-24T18:00:00+00:00",
                    "OFF",
                ),
                _sample(
                    "Living Room Nest",
                    "2026-10-24T17:00:00+00:00",
                    "HEATING",
                    mode="HEAT",
                    heat_celsius=21.0,
                ),
                _sample(
                    "Living Room Nest",
                    "2026-10-24T17:30:00+00:00",
                    "COOLING",
                    mode="COOL",
                    cool_celsius=23.0,
                ),
            ]
        )
        assert series is not None
        self.assertEqual(
            [sample.hvac_status for sample in series.samples],
            ["HEATING", "COOLING", "OFF"],
        )

    def test_newest_thermostat_is_the_only_series(self) -> None:
        series = MODELS.build_heating_series(
            [
                _sample(
                    "Hall Nest",
                    "2026-10-24T12:00:00+00:00",
                    "HEATING",
                    mode="HEAT",
                    heat_celsius=19.0,
                ),
                _sample(
                    "Living Room Nest",
                    "2026-10-24T17:00:00+00:00",
                    "OFF",
                ),
            ]
        )
        assert series is not None
        self.assertEqual(series.device_name, "Living Room Nest")
        self.assertEqual(series.device_id, "living-room-nest")
        self.assertEqual(len(series.samples), 1)
        self.assertEqual(series.samples[0].hvac_status, "OFF")


if __name__ == "__main__":
    unittest.main()
