from __future__ import annotations

from typing import Any


NGINX_AUTH_REQUIRE_TOOLS = "tools"
NGINX_AUTH_REQUIRE_OVERSEERR = "overseerr"
NGINX_AUTH_REQUIRE_VALUES = {
    NGINX_AUTH_REQUIRE_TOOLS,
    NGINX_AUTH_REQUIRE_OVERSEERR,
}


def user_can_use_tools(user: Any | None) -> bool:
    """Return True when the user has tools access enabled."""

    return bool(getattr(user, "can_use_tools", False))


def user_can_use_overseerr(user: Any | None) -> bool:
    """Return True when the user has explicit Overseerr access enabled.

    Missing fields are treated as False.
    """

    return bool(getattr(user, "can_use_overseerr", False))


def nginx_auth_requirement_allowed(user: Any | None, require: str) -> bool:
    """Return True when *user* satisfies the nginx auth gate requirement."""

    normalized_require = str(require or "").strip().lower()
    if normalized_require == NGINX_AUTH_REQUIRE_TOOLS:
        return user_can_use_tools(user)
    if normalized_require == NGINX_AUTH_REQUIRE_OVERSEERR:
        return user_can_use_overseerr(user)
    return False
