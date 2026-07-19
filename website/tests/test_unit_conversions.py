from __future__ import annotations

import unittest

from website.units.conversions import (
    CATEGORIES,
    canonical_value_string,
    convert,
    format_number,
    get_category,
    parse_value,
    result_path,
)


class UnitConversionsTests(unittest.TestCase):
    def test_category_inventory_counts(self) -> None:
        self.assertEqual(len(CATEGORIES), 19)
        self.assertEqual(sum(len(category.units) for category in CATEGORIES), 160)

    def test_length_inch_to_millimetre(self) -> None:
        category = get_category("length")
        assert category is not None
        self.assertAlmostEqual(convert(category, 1.0, "in", "mm") or 0.0, 25.4)

    def test_temperature_celsius_to_fahrenheit(self) -> None:
        category = get_category("temperature")
        assert category is not None
        self.assertAlmostEqual(convert(category, 100.0, "c", "f") or 0.0, 212.0)
        self.assertAlmostEqual(convert(category, 0.0, "c", "f") or 0.0, 32.0)

    def test_speed_mph_to_kmh(self) -> None:
        category = get_category("speed")
        assert category is not None
        self.assertAlmostEqual(convert(category, 60.0, "mph", "km-h") or 0.0, 96.56064)

    def test_fuel_economy_l100km_to_kml(self) -> None:
        category = get_category("fuel-economy")
        assert category is not None
        self.assertAlmostEqual(convert(category, 1.0, "l-100km", "km-l") or 0.0, 100.0)

    def test_fuel_economy_non_positive_is_undefined(self) -> None:
        category = get_category("fuel-economy")
        assert category is not None
        self.assertIsNone(convert(category, 0.0, "mpg-uk", "l-100km"))
        self.assertIsNone(convert(category, -1.0, "mpg-uk", "l-100km"))

    def test_data_gb_to_gib(self) -> None:
        category = get_category("data")
        assert category is not None
        expected = 1e9 / (1024**3)
        self.assertAlmostEqual(convert(category, 1.0, "gb", "gib") or 0.0, expected)

    def test_parse_and_canonical_value(self) -> None:
        self.assertEqual(parse_value("1.5e3"), 1500.0)
        self.assertIsNone(parse_value("nope"))
        self.assertIsNone(parse_value("inf"))
        self.assertEqual(canonical_value_string(60.0), "60")
        self.assertEqual(canonical_value_string(1.5), "1.5")

    def test_result_path_shape(self) -> None:
        self.assertEqual(
            result_path("speed", 60.0, "mph", "km-h"),
            "/units/speed/60/mph/to/km-h/",
        )

    def test_format_number_undefined(self) -> None:
        self.assertEqual(format_number(None), "—")


if __name__ == "__main__":
    unittest.main()
