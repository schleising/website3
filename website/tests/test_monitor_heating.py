"""Heating changes on the Monitor timeseries payload.

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


def _change(
    device_name: str,
    timestamp: str,
    hvac_status: str,
    mode: str | None = None,
    heat_celsius: float | None = None,
    cool_celsius: float | None = None,
) -> Any:
    return MODELS.HeatingChange(
        device_name=device_name,
        timestamp=datetime.fromisoformat(timestamp),
        hvac_status=hvac_status,
        mode=mode,
        heat_celsius=heat_celsius,
        cool_celsius=cool_celsius,
    )


class BuildHeatingSeriesTests(unittest.TestCase):
    def test_empty_changes_leave_heating_unset(self) -> None:
        self.assertIsNone(MODELS.build_heating_series([]))
        self.assertIsNone(MODELS.select_heating_changes([]))
        payload = MODELS.TimeseriesDataResponse(data=[]).model_dump(exclude_none=True)
        self.assertNotIn("heating", payload)

    def test_heat_change_omits_cool_and_keeps_mode_and_setpoint(self) -> None:
        series = MODELS.build_heating_series(
            [
                _change(
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
        self.assertFalse(hasattr(series, "sample_interval_secs"))
        self.assertEqual(series.device_name, "Living Room Nest")
        self.assertEqual(series.device_id, "living-room-nest")

        payload = series.model_dump(mode="json", exclude_none=True)
        self.assertNotIn("samples", payload)
        change = payload["changes"][0]
        self.assertEqual(change["hvac_status"], "HEATING")
        self.assertEqual(change["mode"], "HEAT")
        self.assertEqual(change["heat_celsius"], 20.0)
        self.assertNotIn("cool_celsius", change)
        self.assertTrue(change["timestamp"].startswith("2026-10-24T17:00:00"))

    def test_cool_change_omits_heat_setpoint(self) -> None:
        series = MODELS.build_heating_series(
            [
                _change(
                    "Living Room Nest",
                    "2026-10-24T18:00:00+00:00",
                    "COOLING",
                    mode="COOL",
                    cool_celsius=24.0,
                )
            ]
        )
        assert series is not None
        change = series.model_dump(mode="json", exclude_none=True)["changes"][0]
        self.assertEqual(change["hvac_status"], "COOLING")
        self.assertEqual(change["cool_celsius"], 24.0)
        self.assertNotIn("heat_celsius", change)

    def test_off_without_mode_or_setpoint_omits_those_fields(self) -> None:
        series = MODELS.build_heating_series(
            [_change("Living Room Nest", "2026-10-24T19:00:00+00:00", "OFF")]
        )
        assert series is not None
        change = series.model_dump(mode="json", exclude_none=True)["changes"][0]
        self.assertEqual(change["hvac_status"], "OFF")
        self.assertNotIn("mode", change)
        self.assertNotIn("heat_celsius", change)
        self.assertNotIn("cool_celsius", change)

    def test_missing_document_fields_default_to_absent(self) -> None:
        change = MODELS.HeatingChange.model_validate(
            {
                "device_name": "Living Room Nest",
                "timestamp": datetime(2026, 10, 24, 17, 0, tzinfo=timezone.utc),
                "hvac_status": "HEATING",
            }
        )
        self.assertIsNone(change.mode)
        self.assertIsNone(change.heat_celsius)
        self.assertIsNone(change.cool_celsius)

    def test_naive_timestamp_is_formatted_as_utc(self) -> None:
        series = MODELS.build_heating_series(
            [
                MODELS.HeatingChange(
                    device_name="Living Room Nest",
                    timestamp=datetime(2026, 10, 24, 17, 0),
                    hvac_status="HEATING",
                )
            ]
        )
        assert series is not None
        self.assertTrue(series.changes[0].timestamp.startswith("2026-10-24T17:00:00"))

    def test_one_thermostat_keeps_every_status_in_time_order(self) -> None:
        series = MODELS.build_heating_series(
            [
                _change("Living Room Nest", "2026-10-24T18:00:00+00:00", "OFF"),
                _change(
                    "Living Room Nest",
                    "2026-10-24T17:00:00+00:00",
                    "HEATING",
                    mode="HEAT",
                    heat_celsius=21.0,
                ),
                _change(
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
            [change.hvac_status for change in series.changes],
            ["HEATING", "COOLING", "OFF"],
        )

    def test_two_devices_in_the_window_omit_heating(self) -> None:
        selected = MODELS.select_heating_changes(
            [
                _change(
                    "Hall Nest",
                    "2026-10-24T12:00:00+00:00",
                    "HEATING",
                    mode="HEAT",
                    heat_celsius=19.0,
                ),
                _change("Living Room Nest", "2026-10-24T17:00:00+00:00", "OFF"),
            ]
        )
        self.assertIsNone(selected)
        self.assertIsNone(
            MODELS.build_heating_series(
                [
                    _change("Hall Nest", "2026-10-24T12:00:00+00:00", "HEATING"),
                    _change("Living Room Nest", "2026-10-24T17:00:00+00:00", "OFF"),
                ]
            )
        )

    def test_prior_row_for_the_same_device_is_included(self) -> None:
        selected = MODELS.select_heating_changes(
            [_change("Living Room Nest", "2026-10-24T17:00:00+00:00", "OFF")],
            _change(
                "Living Room Nest",
                "2026-10-24T12:00:00+00:00",
                "HEATING",
                mode="HEAT",
                heat_celsius=20.0,
            ),
        )
        assert selected is not None
        series = MODELS.build_heating_series(selected)
        assert series is not None
        self.assertEqual(series.device_name, "Living Room Nest")
        self.assertEqual(
            [change.hvac_status for change in series.changes],
            ["HEATING", "OFF"],
        )
        self.assertEqual(series.changes[0].heat_celsius, 20.0)

    def test_prior_row_for_another_device_is_ignored(self) -> None:
        selected = MODELS.select_heating_changes(
            [_change("Living Room Nest", "2026-10-24T17:00:00+00:00", "OFF")],
            _change(
                "Hall Nest",
                "2026-10-24T12:00:00+00:00",
                "HEATING",
                mode="HEAT",
                heat_celsius=19.0,
            ),
        )
        assert selected is not None
        series = MODELS.build_heating_series(selected)
        assert series is not None
        self.assertEqual(series.device_name, "Living Room Nest")
        self.assertEqual(len(series.changes), 1)
        self.assertEqual(series.changes[0].hvac_status, "OFF")

    def test_steady_single_device_uses_its_newest_row(self) -> None:
        newest = _change(
            "Living Room Nest",
            "2026-10-01T08:00:00+00:00",
            "HEATING",
            mode="HEAT",
            heat_celsius=19.0,
        )
        selected = MODELS.select_heating_changes(
            [],
            steady_newest=newest,
            steady_has_other_device=False,
        )
        assert selected is not None
        series = MODELS.build_heating_series(selected)
        assert series is not None
        self.assertEqual(len(series.changes), 1)
        self.assertEqual(series.changes[0].hvac_status, "HEATING")

    def test_steady_log_with_two_devices_omits_heating(self) -> None:
        newest = _change("Living Room Nest", "2026-10-01T08:00:00+00:00", "HEATING")
        self.assertIsNone(
            MODELS.select_heating_changes(
                [],
                steady_newest=newest,
                steady_has_other_device=True,
            )
        )


if __name__ == "__main__":
    unittest.main()
