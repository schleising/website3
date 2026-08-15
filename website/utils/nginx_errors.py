from __future__ import annotations

from typing import TypedDict

SITE_ORIGIN = "https://www.schleising.net"

_SERVICE_NAMES: dict[str, str] = {
    "overseerr.schleising.net": "Overseerr",
    "tautulli.schleising.net": "Tautulli",
}

_GENERIC_5XX: dict[int, tuple[str, str, str]] = {
    500: (
        "Server Error",
        "Something went wrong on the server.",
        (
            "The request could not be completed because the site encountered "
            "an unexpected problem. Please try again shortly."
        ),
    ),
    502: (
        "Bad Gateway",
        "This application could not be reached.",
        (
            "The service behind this address is not responding. "
            "Please try again shortly."
        ),
    ),
    503: (
        "Service Unavailable",
        "This application is temporarily unavailable.",
        "The service is not accepting requests right now. Please try again shortly.",
    ),
    504: (
        "Gateway Timeout",
        "This application took too long to respond.",
        "The service did not answer in time. Please try again shortly.",
    ),
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


def nginx_5xx_page_context(
    *,
    raw_status: str | None,
    raw_host: str | None,
    raw_uri: str | None,
    raw_variant: str | None,
) -> Nginx5xxTemplateContext:
    status_code = parse_nginx_status(raw_status)
    host = safe_original_host(raw_host)
    retry_url = original_request_url(host, raw_uri)
    variant = (raw_variant or "").strip().lower()
    heading, title, message = _GENERIC_5XX.get(status_code, _GENERIC_5XX[502])

    if variant == "rebuild":
        name = service_label(host)
        heading = "Storage Rebuild"
        title = f"{name} is temporarily offline."
        message = (
            f"{name} is offline while the NAS storage pool is rebuilt after a "
            "drive failure. The rest of the site is unaffected. Please try again "
            "once the rebuild has finished."
        )
    elif host != "" and status_code != 500:
        name = service_label(host)
        if name != "This application":
            title = f"{name} could not be reached."

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
