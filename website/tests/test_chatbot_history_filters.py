from __future__ import annotations

from datetime import UTC, date, datetime
import importlib.util
from pathlib import Path
import sys
import unittest

from pydantic import ValidationError


WEBSITE_ROOT = Path(__file__).resolve().parents[1]


def _load_module(module_name: str, path: Path):
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load module from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


chatbot_history_models = _load_module(
    "chatbot_history_models_for_tests",
    WEBSITE_ROOT / "football" / "chatbot_history_models.py",
)
FootballHistoryFilters = chatbot_history_models.FootballHistoryFilters


class FootballHistoryDateFilterTests(unittest.TestCase):
    def test_iso_dates_parse_into_calendar_dates(self) -> None:
        filters = FootballHistoryFilters.model_validate(
            {
                "date_from": "2026-09-20",
                "date_to": "2026-09-21",
            }
        )

        self.assertEqual(filters.date_from, date(2026, 9, 20))
        self.assertEqual(filters.date_to, date(2026, 9, 21))

    def test_single_date_from_covers_that_utc_day(self) -> None:
        filters = FootballHistoryFilters.model_validate({"date_from": "2026-09-20"})

        self.assertEqual(
            filters.match_query_bounds_utc(),
            (
                datetime(2026, 9, 20, tzinfo=UTC),
                datetime(2026, 9, 21, tzinfo=UTC),
            ),
        )

    def test_date_to_only_covers_that_utc_day(self) -> None:
        filters = FootballHistoryFilters.model_validate({"date_to": "2026-09-20"})

        self.assertEqual(
            filters.match_query_bounds_utc(),
            (
                datetime(2026, 9, 20, tzinfo=UTC),
                datetime(2026, 9, 21, tzinfo=UTC),
            ),
        )

    def test_inclusive_range_uses_exclusive_end_bound(self) -> None:
        filters = FootballHistoryFilters(
            date_from=date(2026, 9, 20),
            date_to=date(2026, 9, 22),
        )

        self.assertEqual(
            filters.match_query_bounds_utc(),
            (
                datetime(2026, 9, 20, tzinfo=UTC),
                datetime(2026, 9, 23, tzinfo=UTC),
            ),
        )

    def test_reversed_dates_are_swapped(self) -> None:
        filters = FootballHistoryFilters(
            date_from=date(2026, 9, 22),
            date_to=date(2026, 9, 20),
        )

        self.assertEqual(
            filters.match_query_bounds_utc(),
            (
                datetime(2026, 9, 20, tzinfo=UTC),
                datetime(2026, 9, 23, tzinfo=UTC),
            ),
        )

    def test_missing_dates_do_not_restrict_the_query(self) -> None:
        filters = FootballHistoryFilters()
        self.assertIsNone(filters.match_query_bounds_utc())

    def test_invalid_calendar_date_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            FootballHistoryFilters.model_validate({"date_from": "2026-13-40"})


if __name__ == "__main__":
    unittest.main()
