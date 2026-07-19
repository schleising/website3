from __future__ import annotations

from urllib.parse import urlencode, urlparse


def safe_next_path(raw_next: str | None) -> str | None:
    if raw_next is None:
        return None

    candidate = raw_next.strip()
    if candidate == "":
        return None

    parsed = urlparse(candidate)

    is_absolute = parsed.scheme != "" or parsed.netloc != ""
    if is_absolute:
        if parsed.scheme.lower() not in {"http", "https"}:
            return None

        host = (parsed.hostname or "").lower()
        if host == "" or (host != "schleising.net" and not host.endswith(".schleising.net")):
            return None
    elif not candidate.startswith("/"):
        return None

    # Avoid protocol-relative redirects.
    if candidate.startswith("//"):
        return None

    # Prevent redirect loops back into login/token endpoints.
    blocked_prefixes = (
        "/account/login",
        "/account/token",
        "/account/logout",
    )
    lower_path = parsed.path.lower()
    if any(lower_path.startswith(prefix) for prefix in blocked_prefixes):
        return None

    return candidate


def build_login_url(result: str | None, next_path: str | None) -> str:
    params: list[tuple[str, str]] = []
    if result:
        params.append(("result", result))
    if next_path:
        params.append(("next", next_path))

    if len(params) == 0:
        return "/account/login/"

    return f"/account/login/?{urlencode(params)}"


def build_create_url(*, next_path: str | None = None, result: str | None = None) -> str:
    params: list[tuple[str, str]] = []
    if result:
        params.append(("result", result))
    if next_path:
        params.append(("next", next_path))

    if len(params) == 0:
        return "/account/create/"

    return f"/account/create/?{urlencode(params)}"


def redirect_target_from_next(*candidates: str | None, default: str) -> str:
    for candidate in candidates:
        safe = safe_next_path(candidate)
        if safe is not None:
            return safe
    return default
