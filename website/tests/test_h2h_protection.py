from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest

from starlette.requests import Request

WEBSITE_ROOT = Path(__file__).resolve().parents[1]


def _load_module(module_name: str, path: Path):
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load module from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


h2h_protection = _load_module(
    "h2h_protection_for_tests",
    WEBSITE_ROOT / "football" / "h2h_protection.py",
)

H2H_RATE_LIMIT_MAX_REQUESTS = h2h_protection.H2H_RATE_LIMIT_MAX_REQUESTS
allows_expensive_h2h_lookup = h2h_protection.allows_expensive_h2h_lookup
consume_h2h_rate_limit = h2h_protection.consume_h2h_rate_limit
h2h_client_ip = h2h_protection.h2h_client_ip
is_parameterized_h2h_request = h2h_protection.is_parameterized_h2h_request
is_same_origin_fetch = h2h_protection.is_same_origin_fetch
request_looks_like_scraper = h2h_protection.request_looks_like_scraper
reset_h2h_rate_limit_state = h2h_protection.reset_h2h_rate_limit_state


class HeadToHeadProtectionTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_h2h_rate_limit_state()

    def _request(
        self,
        headers: list[tuple[str, str]],
        client_host: str = "192.168.65.1",
    ) -> Request:
        encoded_headers = [
            (name.encode("latin-1"), value.encode("latin-1")) for name, value in headers
        ]
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "https",
            "path": "/football/head-to-head/",
            "raw_path": b"/football/head-to-head/",
            "query_string": b"season=1990_1991&team_a=61&team_b=57",
            "headers": encoded_headers,
            "client": (client_host, 12345),
            "server": ("football.schleising.net", 443),
        }
        return Request(scope)

    def test_parameterized_request_requires_a_team(self) -> None:
        self.assertFalse(is_parameterized_h2h_request(None, None))
        self.assertTrue(is_parameterized_h2h_request(61, None))
        self.assertTrue(is_parameterized_h2h_request(None, 57))
        self.assertTrue(is_parameterized_h2h_request(61, 57))

    def test_empty_user_agent_is_a_scraper(self) -> None:
        request = self._request([])
        self.assertTrue(request_looks_like_scraper(request))

    def test_googlebot_is_a_scraper(self) -> None:
        request = self._request(
            [
                ("user-agent", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
                ("accept-language", "en-GB"),
                ("sec-fetch-dest", "document"),
                ("sec-fetch-mode", "navigate"),
            ]
        )
        self.assertTrue(request_looks_like_scraper(request))

    def test_browser_navigation_is_not_a_scraper(self) -> None:
        request = self._request(
            [
                (
                    "user-agent",
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0",
                ),
                ("accept-language", "en-GB,en;q=0.9"),
                ("sec-fetch-dest", "document"),
                ("sec-fetch-mode", "navigate"),
            ]
        )
        self.assertFalse(request_looks_like_scraper(request))

    def test_legacy_browser_without_fetch_metadata_is_allowed(self) -> None:
        request = self._request(
            [
                (
                    "user-agent",
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
                ),
                ("accept-language", "en-GB"),
            ]
        )
        self.assertFalse(request_looks_like_scraper(request))

    def test_missing_browser_headers_is_a_scraper(self) -> None:
        request = self._request(
            [
                (
                    "user-agent",
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0",
                )
            ]
        )
        self.assertTrue(request_looks_like_scraper(request))

    def test_client_ip_uses_real_ip_behind_docker_proxy(self) -> None:
        request = self._request([("x-real-ip", "203.0.113.20")])
        self.assertEqual(h2h_client_ip(request), "203.0.113.20")

    def test_client_ip_uses_peer_when_not_private(self) -> None:
        request = self._request(
            [("x-real-ip", "203.0.113.20")],
            client_host="8.8.8.8",
        )
        self.assertEqual(h2h_client_ip(request), "8.8.8.8")

    def test_rate_limit_trips_after_max_parameterized_hits(self) -> None:
        request = self._request(
            [
                ("x-real-ip", "203.0.113.20"),
                (
                    "user-agent",
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0",
                ),
                ("accept-language", "en-GB"),
            ]
        )

        for _ in range(H2H_RATE_LIMIT_MAX_REQUESTS):
            self.assertFalse(consume_h2h_rate_limit(request))

        self.assertTrue(consume_h2h_rate_limit(request))

    def test_mobile_chrome_document_navigation_cannot_run_expensive_lookup(self) -> None:
        request = self._request(
            [
                (
                    "user-agent",
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/148.0.0.0 Mobile/15E148 Safari/604.1",
                ),
                ("accept-language", "en-US,en;q=0.9"),
                ("sec-fetch-dest", "document"),
                ("sec-fetch-mode", "navigate"),
                ("sec-fetch-site", "none"),
            ]
        )
        self.assertFalse(request_looks_like_scraper(request))
        self.assertFalse(is_same_origin_fetch(request))
        self.assertFalse(allows_expensive_h2h_lookup(request))

    def test_same_origin_fetch_with_csrf_can_run_expensive_lookup(self) -> None:
        request = self._request(
            [
                (
                    "user-agent",
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/148.0.0.0 Mobile/15E148 Safari/604.1",
                ),
                ("accept-language", "en-US,en;q=0.9"),
                ("sec-fetch-dest", "empty"),
                ("sec-fetch-mode", "cors"),
                ("sec-fetch-site", "same-origin"),
                ("cookie", "csrf_token=h2h-csrf-token"),
                ("x-csrf-token", "h2h-csrf-token"),
            ]
        )
        self.assertTrue(is_same_origin_fetch(request))
        self.assertTrue(allows_expensive_h2h_lookup(request))

    def test_same_origin_fetch_without_csrf_cannot_run_expensive_lookup(self) -> None:
        request = self._request(
            [
                (
                    "user-agent",
                    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36",
                ),
                ("accept-language", "en-US,en;q=0.9"),
                ("sec-fetch-dest", "empty"),
                ("sec-fetch-mode", "cors"),
                ("sec-fetch-site", "same-origin"),
            ]
        )
        self.assertTrue(is_same_origin_fetch(request))
        self.assertFalse(allows_expensive_h2h_lookup(request))


if __name__ == "__main__":
    unittest.main()
