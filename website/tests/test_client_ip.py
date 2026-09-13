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


client_ip = _load_module(
    "client_ip_for_tests",
    WEBSITE_ROOT / "utils" / "client_ip.py",
)

client_ip_for_request = client_ip.client_ip_for_request
resolve_client_ip = client_ip.resolve_client_ip


class ClientIpTests(unittest.TestCase):
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
            "query_string": b"",
            "headers": encoded_headers,
            "client": (client_host, 12345),
            "server": ("football.schleising.net", 443),
        }
        return Request(scope)

    def test_real_ip_from_nginx_through_docker_gateway(self) -> None:
        self.assertEqual(
            resolve_client_ip(
                "192.168.65.1",
                x_real_ip="75.83.108.96",
                x_forwarded_for="75.83.108.96",
            ),
            "75.83.108.96",
        )

    def test_request_uses_x_real_ip_behind_docker_proxy(self) -> None:
        request = self._request([("x-real-ip", "73.119.237.112")])
        self.assertEqual(client_ip_for_request(request), "73.119.237.112")

    def test_xff_used_when_real_ip_missing(self) -> None:
        self.assertEqual(
            resolve_client_ip(
                "172.17.0.1",
                x_forwarded_for="203.0.113.20, 192.168.65.1",
            ),
            "203.0.113.20",
        )

    def test_public_peer_is_not_replaced_by_spoofed_header(self) -> None:
        self.assertEqual(
            resolve_client_ip(
                "8.8.8.8",
                x_real_ip="203.0.113.20",
            ),
            "8.8.8.8",
        )

    def test_explicit_trusted_public_proxy_uses_forwarded_ip(self) -> None:
        self.assertEqual(
            resolve_client_ip(
                "8.8.8.8",
                x_real_ip="203.0.113.20",
                trusted_proxies=["8.8.8.8"],
            ),
            "203.0.113.20",
        )


if __name__ == "__main__":
    unittest.main()
