from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

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


nginx_auth = _load_module(
    "nginx_auth_for_tests",
    ACCOUNT_DIR / "nginx_auth.py",
)
user_model = _load_module(
    "user_model_for_nginx_auth_tests",
    ACCOUNT_DIR / "user_model.py",
)

User = user_model.User
NGINX_AUTH_REQUIRE_OVERSEERR = nginx_auth.NGINX_AUTH_REQUIRE_OVERSEERR
NGINX_AUTH_REQUIRE_TOOLS = nginx_auth.NGINX_AUTH_REQUIRE_TOOLS
nginx_auth_requirement_allowed = nginx_auth.nginx_auth_requirement_allowed
user_can_use_overseerr = nginx_auth.user_can_use_overseerr
user_can_use_tools = nginx_auth.user_can_use_tools


class NginxAuthHelperTests(unittest.TestCase):
    def test_missing_overseerr_flag_is_false(self) -> None:
        user = SimpleNamespace(can_use_tools=True)
        self.assertFalse(user_can_use_overseerr(user))
        self.assertFalse(
            nginx_auth_requirement_allowed(user, NGINX_AUTH_REQUIRE_OVERSEERR)
        )

    def test_user_model_defaults_overseerr_to_false(self) -> None:
        user = User(
            username="demo",
            first_name="Demo",
            last_name="User",
            disabled=False,
            can_use_tools=True,
        )
        self.assertFalse(user.can_use_overseerr)
        self.assertFalse(user_can_use_overseerr(user))

    def test_tools_requirement(self) -> None:
        allowed = SimpleNamespace(can_use_tools=True, can_use_overseerr=False)
        denied = SimpleNamespace(can_use_tools=False, can_use_overseerr=True)

        self.assertTrue(user_can_use_tools(allowed))
        self.assertTrue(nginx_auth_requirement_allowed(allowed, NGINX_AUTH_REQUIRE_TOOLS))
        self.assertFalse(nginx_auth_requirement_allowed(denied, NGINX_AUTH_REQUIRE_TOOLS))

    def test_overseerr_requirement_independent_of_tools(self) -> None:
        overseerr_only = SimpleNamespace(can_use_tools=False, can_use_overseerr=True)
        tools_only = SimpleNamespace(can_use_tools=True, can_use_overseerr=False)

        self.assertTrue(
            nginx_auth_requirement_allowed(overseerr_only, NGINX_AUTH_REQUIRE_OVERSEERR)
        )
        self.assertFalse(
            nginx_auth_requirement_allowed(tools_only, NGINX_AUTH_REQUIRE_OVERSEERR)
        )

    def test_unknown_requirement_fails_closed(self) -> None:
        user = SimpleNamespace(can_use_tools=True, can_use_overseerr=True)
        self.assertFalse(nginx_auth_requirement_allowed(user, "any"))
        self.assertFalse(nginx_auth_requirement_allowed(user, ""))


if __name__ == "__main__":
    unittest.main()
