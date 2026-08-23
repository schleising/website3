from __future__ import annotations

from typing import TypedDict

SITE_ORIGIN = "https://www.schleising.net"

_SERVICE_NAMES: dict[str, str] = {
    "overseerr.schleising.net": "Overseerr",
    "tautulli.schleising.net": "Tautulli",
    "sonarr.schleising.net": "Sonarr",
    "radarr.schleising.net": "Radarr",
    "prowlarr.schleising.net": "Prowlarr",
    "plex.schleising.net": "Plex",
    "transmission.schleising.net": "Transmission",
}


class Nginx5xxTemplateContext(TypedDict):
    error_code: int
    error_heading: str
    error_title: str
    error_message: str
    retry_url: str
    site_origin: str
    login_next: str


def parse_nginx_status(raw_status: str | None) -> int:
    try:
        status_code = int((raw_status or "").strip())
    except ValueError:
        return 502

    if 500 <= status_code <= 599:
        return status_code
    return 502


def safe_original_host(raw_host: str | None) -> str:
    host = (raw_host or "").strip().lower().split(",")[0].split(":")[0]
    if host == "" or " " in host or "/" in host or "\\" in host:
        return ""

    if host == "schleising.net" or host.endswith(".schleising.net"):
        return host
    return ""


def original_request_url(host: str, raw_uri: str | None) -> str:
    if host == "":
        return ""

    uri = (raw_uri or "/").strip()
    if uri == "" or not uri.startswith("/"):
        uri = "/"
    return f"https://{host}{uri}"


def service_label(host: str) -> str:
    return _SERVICE_NAMES.get(host, "This application")


def _copy_for_status(status_code: int, name: str) -> tuple[str, str, str]:
    subject = name if name != "This application" else "The application"

    if status_code == 500:
        return (
            "Internal Server Error",
            f"{subject} hit an unexpected server error.",
            (
                f"{subject} encountered an unexpected problem while handling this "
                "request. That is a fault on the server, not in your browser. "
                "Please try again in a moment."
            ),
        )

    if status_code == 502:
        return (
            "Bad Gateway",
            f"{subject} could not be reached.",
            (
                "The reverse proxy could not get a valid response from the upstream "
                "service. That usually means the application is stopped, crashed, "
                "or refusing connections. Please try again shortly."
            ),
        )

    if status_code == 503:
        return (
            "Service Unavailable",
            f"{subject} is temporarily unavailable.",
            (
                "The service is not accepting requests right now. It may be "
                "overloaded, restarting, or temporarily taken offline for "
                "maintenance. Please try again shortly."
            ),
        )

    if status_code == 504:
        return (
            "Gateway Timeout",
            f"{subject} took too long to respond.",
            (
                "The reverse proxy waited for the upstream service, but no "
                "response arrived in time. The application may be overloaded or "
                "stuck. Please try again shortly."
            ),
        )

    return (
        "Server Error",
        f"{subject} returned an unexpected server error.",
        (
            f"The server returned HTTP {status_code}, which means this request "
            "could not be completed. Please try again shortly."
        ),
    )


def nginx_5xx_page_context(
    *,
    raw_status: str | None,
    raw_host: str | None,
    raw_uri: str | None,
) -> Nginx5xxTemplateContext:
    status_code = parse_nginx_status(raw_status)
    host = safe_original_host(raw_host)
    retry_url = original_request_url(host, raw_uri)
    heading, title, message = _copy_for_status(status_code, service_label(host))

    site_origin = SITE_ORIGIN if host != "" and host != "www.schleising.net" else ""
    login_next = retry_url if retry_url != "" else "/"

    return {
        "error_code": status_code,
        "error_heading": heading,
        "error_title": title,
        "error_message": message,
        "retry_url": retry_url,
        "site_origin": site_origin,
        "login_next": login_next,
    }
