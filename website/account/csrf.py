from __future__ import annotations

from hmac import compare_digest
from secrets import token_urlsafe
from urllib.parse import urlparse

from fastapi import HTTPException, Request, status

CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "x-csrf-token"
CSRF_FORM_FIELD_NAME = "csrf_token"



def _normalise_origin(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.scheme == "" or parsed.netloc == "":
        return None

    # Compare scheme+host(+port) for strict same-origin matching.
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"



def _request_origin(request: Request) -> str | None:
    # Prefer forwarded proto when running behind reverse proxy.
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("host")

    if host is None or host.strip() == "":
        return None

    return f"{proto.lower()}://{host.strip().lower()}"



def _is_same_origin_request(request: Request) -> bool:
    expected_origin = _request_origin(request)
    if expected_origin is None:
        return False

    origin_header = request.headers.get("origin")
    if origin_header:
        normalised_origin = _normalise_origin(origin_header)
        return normalised_origin == expected_origin

    referer_header = request.headers.get("referer")
    if referer_header:
        normalised_referer_origin = _normalise_origin(referer_header)
        return normalised_referer_origin == expected_origin

    # Some installed web app contexts may omit Origin/Referer for same-origin
    # fetch requests. Fall back to Fetch Metadata when available.
    fetch_site = (request.headers.get("sec-fetch-site") or "").strip().lower()
    if fetch_site in {"same-origin", "none"}:
        return True

    return False



def ensure_csrf_token(request: Request) -> str:
    token = request.cookies.get(CSRF_COOKIE_NAME)
    if isinstance(token, str) and token.strip() != "":
        return token

    return token_urlsafe(32)


async def validate_csrf(request: Request) -> None:
    if request.method.upper() in {"GET", "HEAD", "OPTIONS", "TRACE"}:
        return

    if not _is_same_origin_request(request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed: origin mismatch.",
        )

    cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
    if not isinstance(cookie_token, str) or cookie_token.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed: missing cookie token.",
        )

    submitted_token = request.headers.get(CSRF_HEADER_NAME)

    if not submitted_token:
        form_data = await request.form()
        form_token = form_data.get(CSRF_FORM_FIELD_NAME)
        submitted_token = form_token if isinstance(form_token, str) else None

    if not isinstance(submitted_token, str) or submitted_token.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed: missing request token.",
        )

    if not compare_digest(cookie_token, submitted_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed: token mismatch.",
        )
