from __future__ import annotations

import unittest

from starlette.requests import Request

from website.utils.cookie_policy import cookie_domain_for_request


class CookiePolicyTests(unittest.TestCase):
    def _request(self, headers: list[tuple[str, str]]) -> Request:
        encoded_headers = [(name.encode("latin-1"), value.encode("latin-1")) for name, value in headers]
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "https",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": encoded_headers,
            "client": ("127.0.0.1", 12345),
            "server": ("example", 443),
        }
        return Request(scope)

    def test_cookie_domain_for_subdomain(self) -> None:
        request = self._request([("host", "feeds.schleising.net")])
        self.assertEqual(cookie_domain_for_request(request), ".schleising.net")

    def test_cookie_domain_for_apex_domain(self) -> None:
        request = self._request([("host", "schleising.net")])
        self.assertEqual(cookie_domain_for_request(request), ".schleising.net")

    def test_cookie_domain_none_for_other_hosts(self) -> None:
        request = self._request([("host", "localhost:8081")])
        self.assertIsNone(cookie_domain_for_request(request))

    def test_cookie_domain_prefers_forwarded_host(self) -> None:
        request = self._request(
            [
                ("host", "localhost:8081"),
                ("x-forwarded-host", "feeds.schleising.net:8443"),
            ]
        )
        self.assertEqual(cookie_domain_for_request(request), ".schleising.net")


if __name__ == "__main__":
    unittest.main()
