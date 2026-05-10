from __future__ import annotations

from types import SimpleNamespace
import unittest

from fastapi import HTTPException
from starlette.requests import Request

from website.utils.user_management_access import (
    request_can_manage_users,
    require_user_management_access,
)


class AccountToolsAccessTests(unittest.TestCase):
    def _request(self, user: object | None = None) -> Request:
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "https",
            "path": "/account/users/",
            "raw_path": b"/account/users/",
            "query_string": b"",
            "headers": [(b"host", b"example.test")],
            "client": ("127.0.0.1", 12345),
            "server": ("example.test", 443),
        }
        request = Request(scope)
        request.state.user = user
        return request

    def test_request_can_manage_users_when_user_has_flag(self) -> None:
        request = self._request(SimpleNamespace(can_use_tools=True))
        self.assertTrue(request_can_manage_users(request))

    def test_request_can_manage_users_when_user_missing_flag(self) -> None:
        request = self._request(SimpleNamespace())
        self.assertFalse(request_can_manage_users(request))

    def test_require_user_management_access_raises_for_unauthorized_request(self) -> None:
        request = self._request(SimpleNamespace(can_use_tools=False))

        with self.assertRaises(HTTPException) as raised:
            require_user_management_access(request)

        self.assertEqual(raised.exception.status_code, 404)

    def test_require_user_management_access_allows_authorized_request(self) -> None:
        request = self._request(SimpleNamespace(can_use_tools=True))
        require_user_management_access(request)


if __name__ == "__main__":
    unittest.main()