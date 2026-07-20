from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest

WEBSITE_ROOT = Path(__file__).resolve().parents[1]
FOOTBALL_DIR = WEBSITE_ROOT / "football"

if str(WEBSITE_ROOT.parent) not in sys.path:
    sys.path.insert(0, str(WEBSITE_ROOT.parent))


def _load_module(module_name: str, path: Path):
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load module from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


utils = _load_module("world_cup_utils_museum_tests", FOOTBALL_DIR / "world_cup_utils.py")


class WorldCupMuseumModeTests(unittest.TestCase):
    def test_no_live_edition_in_museum_mode(self) -> None:
        self.assertIsNone(utils.WC_LIVE_EDITION)

    def test_2026_is_historic_and_default(self) -> None:
        self.assertEqual(utils.WC_DEFAULT_EDITION, "2026")
        self.assertEqual(utils.WC_CURRENT_EDITION, "2026")
        self.assertTrue(utils.edition_is_historic("2026"))
        self.assertFalse(utils.edition_is_live("2026"))
        self.assertTrue(utils.edition_is_historic("2022"))

    def test_2026_summary_synopsis_exists(self) -> None:
        synopsis = utils.edition_summary_synopsis("2026")
        self.assertIsNotNone(synopsis)
        assert synopsis is not None
        self.assertEqual(synopsis.get("winner"), "Spain")
        self.assertEqual(synopsis.get("runner_up"), "Argentina")


if __name__ == "__main__":
    unittest.main()
