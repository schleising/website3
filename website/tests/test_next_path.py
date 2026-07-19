from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest
from urllib.parse import parse_qs, urlparse

WEBSITE_ROOT = Path(__file__).resolve().parents[1]
ACCOUNT_DIR = WEBSITE_ROOT / "account"

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


next_path = _load_module("next_path_for_tests", ACCOUNT_DIR / "next_path.py")

safe_next_path = next_path.safe_next_path
build_create_url = next_path.build_create_url
redirect_target_from_next = next_path.redirect_target_from_next


class SafeNextPathTests(unittest.TestCase):
    def test_allows_overseerr_absolute_url(self) -> None:
        target = "https://overseerr.schleising.net/"
        self.assertEqual(safe_next_path(target), target)

    def test_rejects_external_host(self) -> None:
        self.assertIsNone(safe_next_path("https://evil.example/"))

    def test_build_create_url_preserves_next(self) -> None:
        url = build_create_url(next_path="https://overseerr.schleising.net/")
        parsed = urlparse(url)
        self.assertEqual(parsed.path, "/account/create/")
        self.assertEqual(
            parse_qs(parsed.query)["next"],
            ["https://overseerr.schleising.net/"],
        )

    def test_redirect_prefers_first_safe_candidate(self) -> None:
        self.assertEqual(
            redirect_target_from_next(
                None,
                "https://overseerr.schleising.net/",
                default="/account/create_success/",
            ),
            "https://overseerr.schleising.net/",
        )


if __name__ == "__main__":
    unittest.main()
