from __future__ import annotations

from fastapi import Request

PRIMARY_COOKIE_DOMAIN = ".schleising.net"


def _request_host(request: Request) -> str | None:
    """Return normalized request host without port information."""

    raw_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if raw_host is None:
        return None

    primary_host = raw_host.split(",")[0].strip().lower()
    if primary_host == "":
        return None

    return primary_host.split(":")[0]


def cookie_domain_for_request(request: Request) -> str | None:
    """Return shared cookie domain for schleising.net requests."""

    host = _request_host(request)
    if host is None:
        return None

    if host == "schleising.net" or host.endswith(".schleising.net"):
        return PRIMARY_COOKIE_DOMAIN

    return None
