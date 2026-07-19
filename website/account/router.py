from __future__ import annotations

import logging
from collections import deque
from datetime import UTC, datetime, timedelta
from hashlib import sha256
import os
from secrets import token_bytes, token_urlsafe
from time import time
from urllib.parse import urlencode, urlparse
from typing import Any, Mapping

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from pymongo import ASCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError
from starlette.responses import RedirectResponse, Response

from . import email_link_token_collection, user_collection, webauthn_challenge_collection
from .admin import (
    authenticate_user,
    get_login_response,
    get_login_json_response,
    get_user,
    get_user_in_db,
    is_user_passkey_enrolled,
    is_user_passkey_migration_required,
)
from .csrf import validate_csrf
from .emailer import send_email
from .passkeys import (
    authentication_options_as_dict,
    bytes_to_b64url,
    registration_options_as_dict,
    verify_authentication_response_payload,
    verify_registration_response_payload,
    webauthn_context_for_request,
)
from .user_model import PasskeyCredential, User, UserInDB
from .nginx_auth import (
    NGINX_AUTH_REQUIRE_VALUES,
    nginx_auth_requirement_allowed,
    user_can_use_overseerr,
    user_can_use_tools,
)
from .next_path import (
    build_create_url as _build_create_url,
    build_login_url as _build_login_url,
    redirect_target_from_next as _redirect_target_from_next,
    safe_next_path as _safe_next_path,
)
from ..utils.user_management_access import require_user_management_access
from ..utils.cookie_policy import cookie_domain_for_request

# Set the Jinja template location
TEMPLATES = Jinja2Templates("/app/templates")

# Create an account router
account_router = APIRouter(prefix="/account")
logger = logging.getLogger(__name__)

OVERSEERR_WHATSAPP_URL = os.getenv("OVERSEERR_WHATSAPP_URL", "").strip()

SIGNUP_WINDOW_SECONDS = 15 * 60
SIGNUP_MAX_ATTEMPTS_PER_WINDOW = 6
SIGNUP_MIN_FORM_FILL_SECONDS = 2.5
SIGNUP_MAX_FORM_AGE_SECONDS = 2 * 60 * 60
WEBAUTHN_CHALLENGE_TTL_SECONDS = 5 * 60
EMAIL_LINK_TTL_SECONDS = 15 * 60
EMAIL_LINK_MAX_PER_IP_WINDOW = 5
EMAIL_LINK_MAX_PER_EMAIL_WINDOW = 5
EMAIL_LINK_MAX_PER_EMAIL_PER_DAY = 20
CANONICAL_LINK_BASE_URL = "https://schleising.net"

_webauthn_challenge_indexes_ready = False
_email_link_token_indexes_ready = False

signup_attempts_by_ip: dict[str, deque[float]] = {}
email_link_attempts_by_ip: dict[str, deque[float]] = {}
email_link_attempts_by_email: dict[str, deque[float]] = {}
email_link_daily_counts_by_email: dict[str, tuple[str, int]] = {}


class PasskeyRegisterBeginPayload(BaseModel):
    firstname: str
    lastname: str
    username: str
    website: str = ""
    form_loaded_at: str = ""


class PasskeyRegisterCompletePayload(BaseModel):
    challenge_id: str
    credential: dict[str, Any]
    next_path: str | None = None


class PasskeyAuthBeginPayload(BaseModel):
    username: str | None = None
    next_path: str | None = None


class PasskeyAuthCompletePayload(BaseModel):
    challenge_id: str
    credential: dict[str, Any]
    next_path: str | None = None


class PasskeyMigrateBeginPayload(BaseModel):
    username: str | None = None
    password: str | None = None
    next_path: str | None = None


class PasskeyMigrateCompletePayload(BaseModel):
    challenge_id: str
    credential: dict[str, Any]
    next_path: str | None = None


class SignupEmailRequestPayload(BaseModel):
    firstname: str
    lastname: str
    username: str
    website: str = ""
    form_loaded_at: str = ""
    next_path: str | None = None


class VerifiedSignupRegisterBeginPayload(BaseModel):
    signup_session_token: str


class VerifiedSignupRegisterCompletePayload(BaseModel):
    challenge_id: str
    credential: dict[str, Any]
    next_path: str | None = None


class RecoveryEmailRequestPayload(BaseModel):
    username: str


class RecoveryRegisterBeginPayload(BaseModel):
    recovery_session_token: str


class RecoveryRegisterCompletePayload(BaseModel):
    challenge_id: str
    credential: dict[str, Any]
    next_path: str | None = None


def _delete_auth_cookie(response: Response, request: Request) -> None:
    # Clear both host-only and shared-domain variants to handle legacy cookies.
    response.delete_cookie(key="token", path="/")

    cookie_kwargs: dict[str, Any] = {
        "key": "token",
        "path": "/",
    }
    cookie_domain = cookie_domain_for_request(request)
    if cookie_domain is not None:
        cookie_kwargs["domain"] = cookie_domain

    response.delete_cookie(**cookie_kwargs)


def _client_ip(request: Request) -> str:
    client = request.client
    host = getattr(client, "host", None)
    if isinstance(host, str) and host.strip() != "":
        return host.strip()
    return "unknown"


def _prune_signup_attempts(now_ts: float, attempts: deque[float]) -> None:
    cutoff = now_ts - SIGNUP_WINDOW_SECONDS
    while len(attempts) > 0 and attempts[0] < cutoff:
        attempts.popleft()


def _is_signup_rate_limited(request: Request) -> bool:
    now_ts = time()
    ip = _client_ip(request)
    attempts = signup_attempts_by_ip.setdefault(ip, deque())
    _prune_signup_attempts(now_ts, attempts)
    return len(attempts) >= SIGNUP_MAX_ATTEMPTS_PER_WINDOW


def _record_signup_attempt(request: Request) -> None:
    now_ts = time()
    ip = _client_ip(request)
    attempts = signup_attempts_by_ip.setdefault(ip, deque())
    _prune_signup_attempts(now_ts, attempts)
    attempts.append(now_ts)


def _is_bot_like_create_submission(website: str, form_loaded_at: str) -> bool:
    # Honeypot should stay empty for human users.
    if website.strip() != "":
        return True

    now_ts = time()
    try:
        loaded_at = float(form_loaded_at)
    except (TypeError, ValueError):
        return True

    elapsed = now_ts - loaded_at
    if elapsed < SIGNUP_MIN_FORM_FILL_SECONDS:
        return True
    if elapsed > SIGNUP_MAX_FORM_AGE_SECONDS:
        return True

    return False


def _normalise_username(raw_username: str) -> str:
    return raw_username.strip().lower()


def _user_has_legacy_password(user: UserInDB) -> bool:
    return isinstance(user.hashed_password, str) and user.hashed_password.strip() != ""


def _format_user_management_timestamp(value: datetime | None) -> str:
    if value is None:
        return "Never"

    return value.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")


def _format_user_management_token_expiry(seconds: int | None) -> str:
    if seconds is None:
        return "Default"

    if seconds < 60:
        return f"{seconds} seconds"

    if seconds < 60 * 60:
        minutes = seconds // 60
        return f"{minutes} minute{'s' if minutes != 1 else ''}"

    if seconds < 60 * 60 * 24:
        hours = seconds // (60 * 60)
        return f"{hours} hour{'s' if hours != 1 else ''}"

    days = seconds // (60 * 60 * 24)
    return f"{days} day{'s' if days != 1 else ''}"


def _build_user_management_auth_label(user: UserInDB) -> str:
    active_passkey_count = len(
        [credential for credential in user.passkey_credentials if not credential.revoked]
    )
    has_legacy_password = _user_has_legacy_password(user)

    if active_passkey_count > 0 and has_legacy_password:
        return "Passkeys and legacy password"
    if active_passkey_count > 0:
        return "Passkeys enabled"
    if has_legacy_password:
        return "Legacy password only"
    return "No active credentials"


def _build_user_management_row(
    user: UserInDB, current_username: str | None
) -> dict[str, Any]:
    active_passkeys = [
        credential for credential in user.passkey_credentials if not credential.revoked
    ]
    revoked_passkey_count = len(user.passkey_credentials) - len(active_passkeys)
    last_passkey_used = max(
        (
            credential.last_used_at
            for credential in active_passkeys
            if credential.last_used_at is not None
        ),
        default=None,
    )
    full_name = f"{user.first_name} {user.last_name}".strip() or user.username

    return {
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": full_name,
        "disabled": user.disabled,
        "can_use_tools": user.can_use_tools,
        "can_use_overseerr": user_can_use_overseerr(user),
        "token_expiry_label": _format_user_management_token_expiry(user.token_expiry),
        "auth_mode_label": _build_user_management_auth_label(user),
        "passkey_count": len(active_passkeys),
        "revoked_passkey_count": revoked_passkey_count,
        "last_passkey_used": _format_user_management_timestamp(last_passkey_used),
        "user_handle": user.user_handle_b64url or "Not set",
        "is_current_user": current_username == user.username,
    }


def _build_user_management_summary(users: list[UserInDB]) -> dict[str, int]:
    return {
        "total_users": len(users),
        "tools_users": len([user for user in users if user_can_use_tools(user)]),
        "overseerr_users": len([user for user in users if user_can_use_overseerr(user)]),
        "disabled_users": len([user for user in users if user.disabled]),
        "legacy_password_users": len(
            [user for user in users if _user_has_legacy_password(user)]
        ),
    }


def _is_web_app_login_target(next_target: str | None) -> bool:
    if next_target is None:
        return False

    candidate = next_target.strip()
    if candidate == "":
        return False

    parsed = urlparse(candidate)
    host = (parsed.hostname or "").lower()
    if host in {"feeds.schleising.net", "football.schleising.net", "units.schleising.net"}:
        return True

    return False


async def _ensure_webauthn_challenge_indexes() -> None:
    global _webauthn_challenge_indexes_ready

    if _webauthn_challenge_indexes_ready:
        return

    if webauthn_challenge_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Challenge storage is unavailable.",
        )

    await webauthn_challenge_collection.create_index("challenge_id", unique=True)
    await webauthn_challenge_collection.create_index("expires_at", expireAfterSeconds=0)
    await webauthn_challenge_collection.create_index(
        [("username", ASCENDING), ("flow", ASCENDING), ("consumed", ASCENDING)]
    )

    _webauthn_challenge_indexes_ready = True


async def _store_webauthn_challenge(
    *,
    username: str,
    flow: str,
    challenge: str,
    rp_id: str,
    origin: str,
    context: dict[str, Any],
) -> str:
    await _ensure_webauthn_challenge_indexes()

    if webauthn_challenge_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Challenge storage is unavailable.",
        )

    now = datetime.now(tz=UTC)
    expires_at = now + timedelta(seconds=WEBAUTHN_CHALLENGE_TTL_SECONDS)

    for _ in range(3):
        challenge_id = token_urlsafe(24)
        challenge_document = {
            "challenge_id": challenge_id,
            "username": username,
            "flow": flow,
            "challenge": challenge,
            "rp_id": rp_id,
            "origin": origin,
            "context": context,
            "created_at": now,
            "expires_at": expires_at,
            "consumed": False,
        }

        try:
            await webauthn_challenge_collection.insert_one(challenge_document)
            return challenge_id
        except DuplicateKeyError:
            continue

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Unable to create challenge record.",
    )


async def _consume_webauthn_challenge(challenge_id: str, flow: str) -> Mapping[str, Any] | None:
    if webauthn_challenge_collection is None:
        return None

    now = datetime.now(tz=UTC)

    return await webauthn_challenge_collection.find_one_and_update(
        {
            "challenge_id": challenge_id,
            "flow": flow,
            "consumed": False,
            "expires_at": {"$gt": now},
        },
        {"$set": {"consumed": True, "consumed_at": now}},
        return_document=ReturnDocument.AFTER,
    )


def _challenge_context_value(challenge_doc: Mapping[str, Any], key: str) -> str | None:
    context = challenge_doc.get("context")
    if not isinstance(context, dict):
        return None

    value = context.get(key)
    if isinstance(value, str) and value.strip() != "":
        return value

    return None


def _active_passkey_credentials(user: UserInDB) -> list[PasskeyCredential]:
    return [credential for credential in user.passkey_credentials if not credential.revoked]


def _passkey_credential_by_id(user: UserInDB, credential_id: str) -> PasskeyCredential | None:
    for credential in _active_passkey_credentials(user):
        if credential.credential_id == credential_id:
            return credential
    return None


async def _user_in_db_by_credential_id(credential_id: str) -> UserInDB | None:
    if user_collection is None:
        return None

    user_document = await user_collection.find_one(
        {
            "passkey_credentials": {
                "$elemMatch": {
                    "credential_id": credential_id,
                    "revoked": {"$ne": True},
                }
            }
        }
    )

    if user_document is None:
        return None

    return UserInDB.model_validate(user_document)


def _credential_id_from_payload(credential_payload: dict[str, Any]) -> str | None:
    credential_id = credential_payload.get("id")
    if isinstance(credential_id, str) and credential_id.strip() != "":
        return credential_id.strip()

    raw_id = credential_payload.get("rawId")
    if isinstance(raw_id, str) and raw_id.strip() != "":
        return raw_id.strip()

    return None


def _registration_transports(credential_payload: dict[str, Any]) -> list[str]:
    response_payload = credential_payload.get("response")
    if not isinstance(response_payload, dict):
        return []

    transports = response_payload.get("transports")
    if not isinstance(transports, list):
        return []

    values: list[str] = []
    for item in transports:
        if isinstance(item, str):
            candidate = item.strip()
            if candidate != "":
                values.append(candidate)

    return values


def _build_display_name(firstname: str, lastname: str, username: str) -> str:
    parts = [firstname.strip(), lastname.strip()]
    joined = " ".join(part for part in parts if part != "")
    return joined if joined != "" else username


def _migration_url(username: str | None, next_path: str | None, result: str) -> str:
    params: list[tuple[str, str]] = [("result", result)]
    if username:
        params.append(("username", username))
    if next_path:
        params.append(("next", next_path))
    return f"/account/migrate/?{urlencode(params)}"


def _token_hash(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def _canonical_link(path: str, token: str) -> str:
    base = CANONICAL_LINK_BASE_URL.rstrip("/")
    return f"{base}{path}?{urlencode({'token': token})}"


def _email_link_window_key(now_utc: datetime) -> str:
    return now_utc.strftime("%Y-%m-%d")


def _record_email_link_attempt(ip: str, username: str) -> None:
    now_ts = time()

    ip_attempts = email_link_attempts_by_ip.setdefault(ip, deque())
    _prune_signup_attempts(now_ts, ip_attempts)
    ip_attempts.append(now_ts)

    email_attempts = email_link_attempts_by_email.setdefault(username, deque())
    _prune_signup_attempts(now_ts, email_attempts)
    email_attempts.append(now_ts)

    now_utc = datetime.now(tz=UTC)
    day_key = _email_link_window_key(now_utc)
    existing = email_link_daily_counts_by_email.get(username)

    if existing is None or existing[0] != day_key:
        email_link_daily_counts_by_email[username] = (day_key, 1)
    else:
        email_link_daily_counts_by_email[username] = (day_key, existing[1] + 1)


def _is_email_link_rate_limited(ip: str, username: str) -> bool:
    now_ts = time()

    ip_attempts = email_link_attempts_by_ip.setdefault(ip, deque())
    _prune_signup_attempts(now_ts, ip_attempts)
    if len(ip_attempts) >= EMAIL_LINK_MAX_PER_IP_WINDOW:
        return True

    email_attempts = email_link_attempts_by_email.setdefault(username, deque())
    _prune_signup_attempts(now_ts, email_attempts)
    if len(email_attempts) >= EMAIL_LINK_MAX_PER_EMAIL_WINDOW:
        return True

    now_utc = datetime.now(tz=UTC)
    day_key = _email_link_window_key(now_utc)
    existing = email_link_daily_counts_by_email.get(username)
    if existing is None:
        return False

    if existing[0] != day_key:
        return False

    return existing[1] >= EMAIL_LINK_MAX_PER_EMAIL_PER_DAY


async def _ensure_email_link_token_indexes() -> None:
    global _email_link_token_indexes_ready

    if _email_link_token_indexes_ready:
        return

    if email_link_token_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Email token storage is unavailable.",
        )

    await email_link_token_collection.create_index("token_hash", unique=True)
    await email_link_token_collection.create_index("expires_at", expireAfterSeconds=0)
    await email_link_token_collection.create_index(
        [("username", ASCENDING), ("flow", ASCENDING), ("consumed", ASCENDING)]
    )

    _email_link_token_indexes_ready = True


async def _store_email_link_token(
    *,
    username: str,
    flow: str,
    context: dict[str, Any],
    ttl_seconds: int = EMAIL_LINK_TTL_SECONDS,
) -> str:
    await _ensure_email_link_token_indexes()

    if email_link_token_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Email token storage is unavailable.",
        )

    now = datetime.now(tz=UTC)
    expires_at = now + timedelta(seconds=ttl_seconds)

    for _ in range(3):
        plain_token = token_urlsafe(32)
        token_document = {
            "token_hash": _token_hash(plain_token),
            "username": username,
            "flow": flow,
            "context": context,
            "created_at": now,
            "expires_at": expires_at,
            "consumed": False,
        }

        try:
            await email_link_token_collection.insert_one(token_document)
            return plain_token
        except DuplicateKeyError:
            continue

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Unable to create email token.",
    )


async def _consume_email_link_token(token: str, flow: str) -> Mapping[str, Any] | None:
    if email_link_token_collection is None:
        return None

    now = datetime.now(tz=UTC)
    return await email_link_token_collection.find_one_and_update(
        {
            "token_hash": _token_hash(token),
            "flow": flow,
            "consumed": False,
            "expires_at": {"$gt": now},
        },
        {
            "$set": {
                "consumed": True,
                "consumed_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )


async def _send_signup_verification_email(
    *,
    username: str,
    firstname: str,
    verify_token: str,
) -> None:
    verify_link = _canonical_link("/account/email/verify-signup/", verify_token)
    greeting_name = firstname if firstname != "" else "there"
    await send_email(
        username,
        "Verify your Schleising Website signup",
        (
            f"Hello {greeting_name},\n\n"
            "Please verify your email to continue creating your account.\n"
            f"This link is valid for 15 minutes and can be used once:\n\n{verify_link}\n\n"
            "If you did not request this, you can ignore this email."
        ),
    )


async def _send_recovery_request_email(*, username: str, recovery_token: str) -> None:
    recovery_link = _canonical_link("/account/email/verify-recovery/", recovery_token)
    await send_email(
        username,
        "Passkey recovery requested",
        (
            "A request was made to recover access and register a new passkey.\n"
            "If this was you, use the one-time link below within 15 minutes:\n\n"
            f"{recovery_link}\n\n"
            "If this was not you, ignore this email and consider reviewing account security."
        ),
    )


async def _send_recovery_completed_email(*, username: str) -> None:
    await send_email(
        username,
        "Passkey recovery completed",
        (
            "A new passkey was successfully enrolled and prior passkeys were revoked.\n"
            "If you did not perform this action, contact support immediately."
        ),
    )


@account_router.get("/login", response_class=HTMLResponse)
@account_router.get("/login/", response_class=HTMLResponse)
async def get_login_page(
    request: Request,
    result: str | None = None,
    next: str | None = None,
):
    next_path = _safe_next_path(next)
    hide_left_sidebar = _is_web_app_login_target(next)

    request_user = getattr(request.state, "user", None)
    if isinstance(request_user, User) and not is_user_passkey_enrolled(request_user):
        return RedirectResponse(
            _migration_url(request_user.username, next_path, "migration_required"),
            status_code=status.HTTP_303_SEE_OTHER,
        )

    # Render the login page
    return TEMPLATES.TemplateResponse(
        request,
        "account/login.html",
        {
            "request": request,
            "result": result,
            "next_path": next_path,
            "render_left_sidebar": not hide_left_sidebar,
        },
    )


@account_router.get("/migrate", response_class=HTMLResponse)
@account_router.get("/migrate/", response_class=HTMLResponse)
async def get_migrate_page(
    request: Request,
    result: str | None = None,
    username: str | None = None,
    next: str | None = None,
):
    next_path = _safe_next_path(next)

    request_user = getattr(request.state, "user", None)
    if isinstance(request_user, User) and not is_user_passkey_enrolled(request_user):
        session_migration = True
        prefilled_username = request_user.username
    else:
        session_migration = False
        prefilled_username = _normalise_username(username or "")

    return TEMPLATES.TemplateResponse(
        request,
        "account/migrate.html",
        {
            "request": request,
            "result": result,
            "username": prefilled_username,
            "next_path": next_path,
            "session_migration": session_migration,
        },
    )


@account_router.get("/logout", response_class=HTMLResponse)
@account_router.get("/logout/", response_class=HTMLResponse)
async def get_logout_page(request: Request, result: str | None = None):
    # Clear the user from the request
    request.state.user = None

    # Get the response
    response = TEMPLATES.TemplateResponse(
        request, "account/logout.html", {"request": request, "result": result}
    )

    # Ensure the cookie gets deleted
    _delete_auth_cookie(response, request)

    # Render the logout page
    return response


@account_router.post("/token", response_class=HTMLResponse)
@account_router.post("/token/", response_class=HTMLResponse)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    _: None = Depends(validate_csrf),
):
    submitted_form = await request.form()
    submitted_next = submitted_form.get("next")
    raw_next = submitted_next if isinstance(submitted_next, str) else None
    next_path = _safe_next_path(raw_next)

    username = _normalise_username(form_data.username)

    # Check the username and password, if valid the user will be returned, if not it will be None
    user = await authenticate_user(username, form_data.password)

    if user is None:
        # If the user has not beee authenticated, redirect back to the lgin page
        response = RedirectResponse(_build_login_url("login_failed", next_path), status_code=status.HTTP_303_SEE_OTHER)

        # Ensure that the response deletes any cookie which may still be in the browser
        _delete_auth_cookie(response, request)

        # Return the redirect response
        return response

    user_in_db = await get_user_in_db(username)
    if is_user_passkey_migration_required(user_in_db):
        return RedirectResponse(
            _migration_url(username, next_path, "migration_required"),
            status_code=status.HTTP_303_SEE_OTHER,
        )

    # Password login is disabled once passkey support is enabled.
    response = RedirectResponse(
        _build_login_url("passkey_required", next_path),
        status_code=status.HTTP_303_SEE_OTHER,
    )
    _delete_auth_cookie(response, request)
    return response


@account_router.get("/login_success", response_class=HTMLResponse)
@account_router.get("/login_success/", response_class=HTMLResponse)
async def login_success(request: Request):
    # Render the login success page
    return TEMPLATES.TemplateResponse(
        request, r"account/login_success.html", {"request": request}
    )


@account_router.get("/create", response_class=HTMLResponse)
@account_router.get("/create/", response_class=HTMLResponse)
async def get_create_page(
    request: Request,
    result: str | None = None,
    next: str | None = None,
):
    next_path = _safe_next_path(next)
    # Render the create account page
    return TEMPLATES.TemplateResponse(
        request,
        "account/create.html",
        {
            "request": request,
            "result": result,
            "next_path": next_path,
            "form_loaded_at": f"{time():.6f}",
        },
    )


@account_router.post("/create_user")
@account_router.post("/create_user/")
async def create_user(
    _: None = Depends(validate_csrf),
):
    # Password signup is replaced by email verification + passkey ceremonies.
    return RedirectResponse(
        _build_create_url(result="email_verification_required"),
        status_code=status.HTTP_303_SEE_OTHER,
    )


@account_router.get("/recover", response_class=HTMLResponse)
@account_router.get("/recover/", response_class=HTMLResponse)
async def get_recover_page(request: Request, result: str | None = None):
    return TEMPLATES.TemplateResponse(
        request,
        "account/recover.html",
        {
            "request": request,
            "result": result,
        },
    )


@account_router.get("/email/verify-signup", response_class=HTMLResponse)
@account_router.get("/email/verify-signup/", response_class=HTMLResponse)
async def verify_signup_email_link(request: Request, token: str | None = None):
    token_value = (token or "").strip()
    if token_value == "":
        return TEMPLATES.TemplateResponse(
            request,
            "account/create.html",
            {
                "request": request,
                "result": "email_link_invalid",
                "next_path": None,
                "form_loaded_at": f"{time():.6f}",
            },
        )

    consumed = await _consume_email_link_token(token_value, "signup_verify")
    if consumed is None:
        return TEMPLATES.TemplateResponse(
            request,
            "account/create.html",
            {
                "request": request,
                "result": "email_link_invalid",
                "next_path": None,
                "form_loaded_at": f"{time():.6f}",
            },
        )

    firstname = _challenge_context_value(consumed, "firstname") or ""
    lastname = _challenge_context_value(consumed, "lastname") or ""
    username = _challenge_context_value(consumed, "username")
    next_path = _safe_next_path(_challenge_context_value(consumed, "next_path"))

    if username is None:
        return TEMPLATES.TemplateResponse(
            request,
            "account/create.html",
            {
                "request": request,
                "result": "email_link_invalid",
                "next_path": next_path,
                "form_loaded_at": f"{time():.6f}",
            },
        )

    signup_session_context: dict[str, str] = {
        "firstname": firstname,
        "lastname": lastname,
        "username": username,
    }
    if next_path is not None:
        signup_session_context["next_path"] = next_path

    signup_session_token = await _store_email_link_token(
        username=username,
        flow="signup_session",
        context=signup_session_context,
    )

    return TEMPLATES.TemplateResponse(
        request,
        "account/verify_signup.html",
        {
            "request": request,
            "firstname": firstname,
            "lastname": lastname,
            "username": username,
            "signup_session_token": signup_session_token,
            "next_path": next_path,
        },
    )


@account_router.get("/email/verify-recovery", response_class=HTMLResponse)
@account_router.get("/email/verify-recovery/", response_class=HTMLResponse)
async def verify_recovery_email_link(request: Request, token: str | None = None):
    token_value = (token or "").strip()
    if token_value == "":
        return RedirectResponse(
            "/account/recover/?result=recovery_link_invalid",
            status_code=status.HTTP_303_SEE_OTHER,
        )

    consumed = await _consume_email_link_token(token_value, "recovery_verify")
    if consumed is None:
        return RedirectResponse(
            "/account/recover/?result=recovery_link_invalid",
            status_code=status.HTTP_303_SEE_OTHER,
        )

    username = _challenge_context_value(consumed, "username")
    if username is None:
        return RedirectResponse(
            "/account/recover/?result=recovery_link_invalid",
            status_code=status.HTTP_303_SEE_OTHER,
        )

    user_in_db = await get_user_in_db(username)
    if user_in_db is None:
        return RedirectResponse(
            "/account/recover/?result=recovery_link_invalid",
            status_code=status.HTTP_303_SEE_OTHER,
        )

    recovery_session_token = await _store_email_link_token(
        username=username,
        flow="recovery_session",
        context={"username": username},
    )

    return TEMPLATES.TemplateResponse(
        request,
        "account/recover_verify.html",
        {
            "request": request,
            "username": username,
            "recovery_session_token": recovery_session_token,
        },
    )


@account_router.post("/email/signup/request")
@account_router.post("/email/signup/request/")
async def request_signup_email_verification(
    request: Request,
    payload: SignupEmailRequestPayload,
    _: None = Depends(validate_csrf),
):
    username = _normalise_username(payload.username)
    firstname = payload.firstname.strip()
    lastname = payload.lastname.strip()

    ip = _client_ip(request)
    if _is_email_link_rate_limited(ip, username):
        return JSONResponse(
            {
                "status": "ok",
                "reason": "email_sent",
            }
        )

    _record_email_link_attempt(ip, username)

    if _is_bot_like_create_submission(payload.website, payload.form_loaded_at):
        return JSONResponse(
            {
                "status": "ok",
                "reason": "email_sent",
            }
        )

    if firstname == "" or lastname == "" or username == "":
        return JSONResponse(
            {"status": "error", "reason": "invalid_input"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    existing_user = await get_user_in_db(username)
    if existing_user is not None:
        # Neutral response to avoid account enumeration.
        return JSONResponse(
            {
                "status": "ok",
                "reason": "email_sent",
            }
        )

    next_path = _safe_next_path(payload.next_path)
    verify_context: dict[str, str] = {
        "firstname": firstname,
        "lastname": lastname,
        "username": username,
    }
    if next_path is not None:
        verify_context["next_path"] = next_path

    verify_token = await _store_email_link_token(
        username=username,
        flow="signup_verify",
        context=verify_context,
    )

    try:
        await _send_signup_verification_email(
            username=username,
            firstname=firstname,
            verify_token=verify_token,
        )
    except Exception:
        logger.exception("Failed to send signup verification email for %s", username)
        return JSONResponse(
            {"status": "error", "reason": "email_send_failed"},
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return JSONResponse({"status": "ok", "reason": "email_sent"})


@account_router.post("/email/recovery/request")
@account_router.post("/email/recovery/request/")
async def request_recovery_email_verification(
    request: Request,
    payload: RecoveryEmailRequestPayload,
    _: None = Depends(validate_csrf),
):
    username = _normalise_username(payload.username)

    if username == "":
        return JSONResponse(
            {"status": "error", "reason": "invalid_input"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    ip = _client_ip(request)
    if _is_email_link_rate_limited(ip, username):
        return JSONResponse(
            {"status": "ok", "reason": "email_sent"}
        )

    _record_email_link_attempt(ip, username)

    user_in_db = await get_user_in_db(username)
    if user_in_db is None:
        return JSONResponse(
            {"status": "ok", "reason": "email_sent"}
        )

    recovery_token = await _store_email_link_token(
        username=username,
        flow="recovery_verify",
        context={"username": username},
    )

    try:
        await _send_recovery_request_email(username=username, recovery_token=recovery_token)
    except Exception:
        logger.exception("Failed to send recovery email for %s", username)
        return JSONResponse(
            {"status": "error", "reason": "email_send_failed"},
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return JSONResponse({"status": "ok", "reason": "email_sent"})


@account_router.post("/webauthn/register/begin")
@account_router.post("/webauthn/register/begin/")
async def webauthn_register_begin(
    request: Request,
    payload: PasskeyRegisterBeginPayload,
    _: None = Depends(validate_csrf),
):
    return JSONResponse(
        {
            "status": "error",
            "reason": "email_verification_required",
        }
    )


@account_router.post("/webauthn/register-from-email/begin")
@account_router.post("/webauthn/register-from-email/begin/")
async def webauthn_register_from_email_begin(
    request: Request,
    payload: VerifiedSignupRegisterBeginPayload,
    _: None = Depends(validate_csrf),
):
    consumed = await _consume_email_link_token(payload.signup_session_token, "signup_session")
    if consumed is None:
        return JSONResponse(
            {"status": "error", "reason": "email_link_invalid"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    firstname = _challenge_context_value(consumed, "firstname")
    lastname = _challenge_context_value(consumed, "lastname")
    username = _challenge_context_value(consumed, "username")

    if firstname is None or lastname is None or username is None:
        return JSONResponse(
            {"status": "error", "reason": "email_link_invalid"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    existing_user = await get_user_in_db(username)
    if existing_user is not None:
        return JSONResponse(
            {"status": "error", "reason": "username_taken"},
            status_code=status.HTTP_409_CONFLICT,
        )

    rp_id, origin = webauthn_context_for_request(request)
    user_handle_b64url = bytes_to_b64url(token_bytes(32))

    options = registration_options_as_dict(
        rp_id=rp_id,
        username=username,
        display_name=_build_display_name(firstname, lastname, username),
        user_handle_b64url=user_handle_b64url,
        exclude_credential_ids=[],
    )

    challenge = options.get("challenge")
    if not isinstance(challenge, str) or challenge.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration challenge generation failed.",
        )

    challenge_context: dict[str, str] = {
        "firstname": firstname,
        "lastname": lastname,
        "username": username,
        "user_handle_b64url": user_handle_b64url,
    }
    next_path = _safe_next_path(_challenge_context_value(consumed, "next_path"))
    if next_path is not None:
        challenge_context["next_path"] = next_path

    challenge_id = await _store_webauthn_challenge(
        username=username,
        flow="register",
        challenge=challenge,
        rp_id=rp_id,
        origin=origin,
        context=challenge_context,
    )

    return JSONResponse(
        {
            "status": "ok",
            "challenge_id": challenge_id,
            "public_key": options,
        }
    )


@account_router.post("/webauthn/register/complete")
@account_router.post("/webauthn/register/complete/")
async def webauthn_register_complete(
    request: Request,
    payload: PasskeyRegisterCompletePayload,
    _: None = Depends(validate_csrf),
):
    challenge_doc = await _consume_webauthn_challenge(payload.challenge_id, "register")
    if challenge_doc is None:
        return JSONResponse(
            {"status": "error", "reason": "challenge_invalid"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    try:
        registration_verification = verify_registration_response_payload(
            credential=payload.credential,
            challenge_b64url=str(challenge_doc["challenge"]),
            rp_id=str(challenge_doc["rp_id"]),
            origin=str(challenge_doc["origin"]),
        )
    except Exception:
        return JSONResponse(
            {"status": "error", "reason": "verification_failed"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    firstname = _challenge_context_value(challenge_doc, "firstname")
    lastname = _challenge_context_value(challenge_doc, "lastname")
    username = _challenge_context_value(challenge_doc, "username")
    user_handle_b64url = _challenge_context_value(challenge_doc, "user_handle_b64url")

    if (
        firstname is None
        or lastname is None
        or username is None
        or user_handle_b64url is None
    ):
        return JSONResponse(
            {"status": "error", "reason": "challenge_invalid"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    new_credential = PasskeyCredential(
        credential_id=bytes_to_b64url(registration_verification.credential_id),
        public_key=bytes_to_b64url(registration_verification.credential_public_key),
        sign_count=int(registration_verification.sign_count or 0),
        transports=_registration_transports(payload.credential),
        last_used_at=datetime.now(tz=UTC),
    )

    if user_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User storage is unavailable.",
        )

    new_user = UserInDB(
        first_name=firstname,
        last_name=lastname,
        username=username,
        disabled=False,
        hashed_password=None,
        user_handle_b64url=user_handle_b64url,
        passkey_credentials=[new_credential],
    )

    try:
        await user_collection.insert_one(new_user.model_dump())
    except DuplicateKeyError:
        return JSONResponse(
            {"status": "error", "reason": "username_taken"},
            status_code=status.HTTP_409_CONFLICT,
        )

    user = await get_user(username)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not load newly created user.",
        )

    next_path = _safe_next_path(payload.next_path)
    challenge_next = _safe_next_path(_challenge_context_value(challenge_doc, "next_path"))
    redirect_target = _redirect_target_from_next(
        next_path,
        challenge_next,
        default="/account/create_success/",
    )
    return get_login_json_response(user, redirect_target, request)


@account_router.post("/webauthn/recovery/begin")
@account_router.post("/webauthn/recovery/begin/")
async def webauthn_recovery_begin(
    request: Request,
    payload: RecoveryRegisterBeginPayload,
    _: None = Depends(validate_csrf),
):
    consumed = await _consume_email_link_token(payload.recovery_session_token, "recovery_session")
    if consumed is None:
        return JSONResponse(
            {"status": "error", "reason": "recovery_link_invalid"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    username = _challenge_context_value(consumed, "username")
    if username is None:
        return JSONResponse(
            {"status": "error", "reason": "recovery_link_invalid"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    user_in_db = await get_user_in_db(username)
    if user_in_db is None or user_in_db.disabled:
        return JSONResponse(
            {"status": "error", "reason": "recovery_link_invalid"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    rp_id, origin = webauthn_context_for_request(request)
    user_handle_b64url = user_in_db.user_handle_b64url or bytes_to_b64url(token_bytes(32))

    options = registration_options_as_dict(
        rp_id=rp_id,
        username=user_in_db.username,
        display_name=_build_display_name(
            user_in_db.first_name,
            user_in_db.last_name,
            user_in_db.username,
        ),
        user_handle_b64url=user_handle_b64url,
        exclude_credential_ids=[],
    )

    challenge = options.get("challenge")
    if not isinstance(challenge, str) or challenge.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Recovery challenge generation failed.",
        )

    challenge_id = await _store_webauthn_challenge(
        username=user_in_db.username,
        flow="recovery",
        challenge=challenge,
        rp_id=rp_id,
        origin=origin,
        context={
            "username": user_in_db.username,
            "user_handle_b64url": user_handle_b64url,
        },
    )

    return JSONResponse(
        {
            "status": "ok",
            "challenge_id": challenge_id,
            "public_key": options,
        }
    )


@account_router.post("/webauthn/recovery/complete")
@account_router.post("/webauthn/recovery/complete/")
async def webauthn_recovery_complete(
    request: Request,
    payload: RecoveryRegisterCompletePayload,
    _: None = Depends(validate_csrf),
):
    challenge_doc = await _consume_webauthn_challenge(payload.challenge_id, "recovery")
    if challenge_doc is None:
        return JSONResponse(
            {"status": "error", "reason": "challenge_invalid"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    username = str(challenge_doc.get("username") or "")
    user_in_db = await get_user_in_db(username)
    if user_in_db is None:
        return JSONResponse(
            {"status": "error", "reason": "recovery_failed"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    try:
        registration_verification = verify_registration_response_payload(
            credential=payload.credential,
            challenge_b64url=str(challenge_doc["challenge"]),
            rp_id=str(challenge_doc["rp_id"]),
            origin=str(challenge_doc["origin"]),
        )
    except Exception:
        return JSONResponse(
            {"status": "error", "reason": "verification_failed"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    user_handle_b64url = _challenge_context_value(challenge_doc, "user_handle_b64url")
    if user_handle_b64url is None:
        user_handle_b64url = user_in_db.user_handle_b64url or bytes_to_b64url(token_bytes(32))

    new_credential = PasskeyCredential(
        credential_id=bytes_to_b64url(registration_verification.credential_id),
        public_key=bytes_to_b64url(registration_verification.credential_public_key),
        sign_count=int(registration_verification.sign_count or 0),
        transports=_registration_transports(payload.credential),
        last_used_at=datetime.now(tz=UTC),
    )

    if user_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User storage is unavailable.",
        )

    revoked_credentials = [
        credential.model_copy(update={"revoked": True})
        for credential in user_in_db.passkey_credentials
    ]
    updated_credentials = revoked_credentials + [new_credential]

    await user_collection.update_one(
        {"username": username},
        {
            "$set": {
                "user_handle_b64url": user_handle_b64url,
                "passkey_credentials": [credential.model_dump() for credential in updated_credentials],
                "hashed_password": None,
            },
        },
    )

    try:
        await _send_recovery_completed_email(username=username)
    except Exception:
        # Do not block recovery completion on notification delivery failure.
        logger.exception("Failed to send recovery completion notification for %s", username)

    user = await get_user(username)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not load recovered user.",
        )

    next_path = _safe_next_path(payload.next_path)
    redirect_target = next_path or "/account/login_success/"
    return get_login_json_response(user, redirect_target, request)


@account_router.post("/webauthn/authenticate/begin")
@account_router.post("/webauthn/authenticate/begin/")
async def webauthn_authenticate_begin(
    request: Request,
    payload: PasskeyAuthBeginPayload,
    _: None = Depends(validate_csrf),
):
    username = _normalise_username(payload.username or "")

    credential_ids: list[str] = []
    if username != "":
        user_in_db = await get_user_in_db(username)

        if user_in_db is None:
            return JSONResponse(
                {"status": "error", "reason": "login_failed"},
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        if user_in_db.disabled:
            return JSONResponse(
                {"status": "error", "reason": "login_failed"},
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        if not is_user_passkey_enrolled(user_in_db):
            if is_user_passkey_migration_required(user_in_db):
                return JSONResponse(
                    {
                        "status": "error",
                        "reason": "migration_required",
                        "migration_url": _migration_url(username, _safe_next_path(payload.next_path), "migration_required"),
                    },
                    status_code=status.HTTP_409_CONFLICT,
                )

            return JSONResponse(
                {"status": "error", "reason": "login_failed"},
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        credential_ids = [
            credential.credential_id
            for credential in _active_passkey_credentials(user_in_db)
        ]

        if len(credential_ids) == 0:
            return JSONResponse(
                {"status": "error", "reason": "login_failed"},
                status_code=status.HTTP_400_BAD_REQUEST,
            )

    rp_id, origin = webauthn_context_for_request(request)
    options = authentication_options_as_dict(rp_id=rp_id, credential_ids=credential_ids)

    challenge = options.get("challenge")
    if not isinstance(challenge, str) or challenge.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication challenge generation failed.",
        )

    next_path = _safe_next_path(payload.next_path)
    challenge_id = await _store_webauthn_challenge(
        username=username,
        flow="authenticate",
        challenge=challenge,
        rp_id=rp_id,
        origin=origin,
        context={"next_path": next_path or ""},
    )

    return JSONResponse(
        {
            "status": "ok",
            "challenge_id": challenge_id,
            "public_key": options,
        }
    )


@account_router.post("/webauthn/authenticate/complete")
@account_router.post("/webauthn/authenticate/complete/")
async def webauthn_authenticate_complete(
    request: Request,
    payload: PasskeyAuthCompletePayload,
    _: None = Depends(validate_csrf),
):
    challenge_doc = await _consume_webauthn_challenge(payload.challenge_id, "authenticate")
    if challenge_doc is None:
        return JSONResponse(
            {"status": "error", "reason": "challenge_invalid"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    credential_id = _credential_id_from_payload(payload.credential)
    if credential_id is None:
        return JSONResponse(
            {"status": "error", "reason": "credential_invalid"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    challenge_username = str(challenge_doc.get("username") or "")
    if challenge_username != "":
        user_in_db = await get_user_in_db(challenge_username)
    else:
        user_in_db = await _user_in_db_by_credential_id(credential_id)

    if user_in_db is None or user_in_db.disabled:
        return JSONResponse(
            {"status": "error", "reason": "login_failed"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    credential = _passkey_credential_by_id(user_in_db, credential_id)
    if credential is None:
        return JSONResponse(
            {"status": "error", "reason": "credential_invalid"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    try:
        authentication_verification = verify_authentication_response_payload(
            credential=payload.credential,
            challenge_b64url=str(challenge_doc["challenge"]),
            rp_id=str(challenge_doc["rp_id"]),
            origin=str(challenge_doc["origin"]),
            credential_public_key_b64url=credential.public_key,
            credential_current_sign_count=credential.sign_count,
        )
    except Exception:
        return JSONResponse(
            {"status": "error", "reason": "verification_failed"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    if user_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User storage is unavailable.",
        )

    new_sign_count = int(
        getattr(authentication_verification, "new_sign_count", credential.sign_count)
    )

    await user_collection.update_one(
        {
            "username": user_in_db.username,
            "passkey_credentials.credential_id": credential_id,
        },
        {
            "$set": {
                "passkey_credentials.$.sign_count": new_sign_count,
                "passkey_credentials.$.last_used_at": datetime.now(tz=UTC),
            }
        },
    )

    user = await get_user(user_in_db.username)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not load authenticated user.",
        )

    next_path = _safe_next_path(payload.next_path)
    challenge_next = _challenge_context_value(challenge_doc, "next_path")
    redirect_target = next_path or challenge_next or "/account/login_success/"
    return get_login_json_response(user, redirect_target, request)


@account_router.post("/webauthn/migrate/begin")
@account_router.post("/webauthn/migrate/begin/")
async def webauthn_migrate_begin(
    request: Request,
    payload: PasskeyMigrateBeginPayload,
    _: None = Depends(validate_csrf),
):
    request_user = getattr(request.state, "user", None)

    user_in_db: UserInDB | None = None
    if isinstance(request_user, User) and not is_user_passkey_enrolled(request_user):
        user_in_db = await get_user_in_db(request_user.username)
    else:
        username = _normalise_username(payload.username or "")
        password = payload.password or ""

        if username == "" or password == "":
            return JSONResponse(
                {"status": "error", "reason": "credentials_required"},
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        auth_user = await authenticate_user(username, password)
        if auth_user is None:
            return JSONResponse(
                {"status": "error", "reason": "migration_failed"},
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        user_in_db = await get_user_in_db(auth_user.username)

    if user_in_db is None:
        return JSONResponse(
            {"status": "error", "reason": "migration_failed"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    if is_user_passkey_enrolled(user_in_db):
        return JSONResponse(
            {"status": "error", "reason": "already_enrolled"},
            status_code=status.HTTP_409_CONFLICT,
        )

    rp_id, origin = webauthn_context_for_request(request)
    user_handle_b64url = user_in_db.user_handle_b64url or bytes_to_b64url(token_bytes(32))

    options = registration_options_as_dict(
        rp_id=rp_id,
        username=user_in_db.username,
        display_name=_build_display_name(
            user_in_db.first_name,
            user_in_db.last_name,
            user_in_db.username,
        ),
        user_handle_b64url=user_handle_b64url,
        exclude_credential_ids=[],
    )

    challenge = options.get("challenge")
    if not isinstance(challenge, str) or challenge.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Migration challenge generation failed.",
        )

    next_path = _safe_next_path(payload.next_path)
    challenge_id = await _store_webauthn_challenge(
        username=user_in_db.username,
        flow="migrate",
        challenge=challenge,
        rp_id=rp_id,
        origin=origin,
        context={
            "user_handle_b64url": user_handle_b64url,
            "next_path": next_path or "",
        },
    )

    return JSONResponse(
        {
            "status": "ok",
            "challenge_id": challenge_id,
            "public_key": options,
        }
    )


@account_router.post("/webauthn/migrate/complete")
@account_router.post("/webauthn/migrate/complete/")
async def webauthn_migrate_complete(
    request: Request,
    payload: PasskeyMigrateCompletePayload,
    _: None = Depends(validate_csrf),
):
    challenge_doc = await _consume_webauthn_challenge(payload.challenge_id, "migrate")
    if challenge_doc is None:
        return JSONResponse(
            {"status": "error", "reason": "challenge_invalid"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    username = str(challenge_doc.get("username") or "")
    user_in_db = await get_user_in_db(username)
    if user_in_db is None:
        return JSONResponse(
            {"status": "error", "reason": "migration_failed"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    if is_user_passkey_enrolled(user_in_db):
        return JSONResponse(
            {"status": "error", "reason": "already_enrolled"},
            status_code=status.HTTP_409_CONFLICT,
        )

    try:
        registration_verification = verify_registration_response_payload(
            credential=payload.credential,
            challenge_b64url=str(challenge_doc["challenge"]),
            rp_id=str(challenge_doc["rp_id"]),
            origin=str(challenge_doc["origin"]),
        )
    except Exception:
        return JSONResponse(
            {"status": "error", "reason": "verification_failed"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    user_handle_b64url = _challenge_context_value(challenge_doc, "user_handle_b64url")
    if user_handle_b64url is None:
        user_handle_b64url = user_in_db.user_handle_b64url or bytes_to_b64url(token_bytes(32))

    new_credential = PasskeyCredential(
        credential_id=bytes_to_b64url(registration_verification.credential_id),
        public_key=bytes_to_b64url(registration_verification.credential_public_key),
        sign_count=int(registration_verification.sign_count or 0),
        transports=_registration_transports(payload.credential),
        last_used_at=datetime.now(tz=UTC),
    )

    if user_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User storage is unavailable.",
        )

    await user_collection.update_one(
        {"username": username},
        {
            "$set": {
                "user_handle_b64url": user_handle_b64url,
                "hashed_password": None,
            },
            "$push": {
                "passkey_credentials": new_credential.model_dump(),
            },
        },
    )

    user = await get_user(username)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not load migrated user.",
        )

    next_path = _safe_next_path(payload.next_path)
    challenge_next = _challenge_context_value(challenge_doc, "next_path")
    redirect_target = next_path or challenge_next or "/"
    return get_login_json_response(user, redirect_target, request)


@account_router.get("/users", response_class=HTMLResponse)
@account_router.get("/users/", response_class=HTMLResponse)
async def user_management_page(request: Request):
    require_user_management_access(request)

    if user_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User storage is unavailable.",
        )

    request_user = getattr(request.state, "user", None)
    current_username = request_user.username if isinstance(request_user, User) else None
    user_documents = await user_collection.find({}).sort("username", ASCENDING).to_list(
        length=None
    )
    users = [UserInDB.model_validate(document) for document in user_documents]

    return TEMPLATES.TemplateResponse(
        request,
        "account/users.html",
        {
            "request": request,
            "summary": _build_user_management_summary(users),
            "users": [
                _build_user_management_row(user, current_username) for user in users
            ],
        },
    )


@account_router.post("/users/update")
@account_router.post("/users/update/")
async def update_managed_user(
    request: Request,
    username: str = Form(...),
    first_name: str = Form(...),
    last_name: str = Form(...),
    can_use_tools: str | None = Form(default=None),
    can_use_overseerr: str | None = Form(default=None),
    disabled: str | None = Form(default=None),
    _: None = Depends(validate_csrf),
):
    require_user_management_access(request)

    if user_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User storage is unavailable.",
        )

    target_username = _normalise_username(username)
    first_name_value = first_name.strip()
    last_name_value = last_name.strip()

    if target_username == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username is required.",
        )

    if first_name_value == "" or last_name_value == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="First and last name are required.",
        )

    updated_document = await user_collection.find_one_and_update(
        {"username": target_username},
        {
            "$set": {
                "first_name": first_name_value,
                "last_name": last_name_value,
                "can_use_tools": can_use_tools is not None,
                "can_use_overseerr": can_use_overseerr is not None,
                "disabled": disabled is not None,
            }
        },
        return_document=ReturnDocument.AFTER,
    )

    if updated_document is None:
        return RedirectResponse("/account/users/", status_code=status.HTTP_303_SEE_OTHER)

    updated_user = User.model_validate(updated_document)
    request_user = getattr(request.state, "user", None)
    is_current_user = (
        isinstance(request_user, User) and request_user.username == target_username
    )

    if not is_current_user:
        return RedirectResponse("/account/users/", status_code=status.HTTP_303_SEE_OTHER)

    if updated_user.disabled:
        response = RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)
        _delete_auth_cookie(response, request)
        return response

    target_url = "/account/users/" if updated_user.can_use_tools else "/"
    return get_login_response(updated_user, target_url, request)


@account_router.post("/users/delete")
@account_router.post("/users/delete/")
async def delete_managed_user(
    request: Request,
    username: str = Form(...),
    _: None = Depends(validate_csrf),
):
    require_user_management_access(request)

    if user_collection is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User storage is unavailable.",
        )

    target_username = _normalise_username(username)
    if target_username == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username is required.",
        )

    deleted_document = await user_collection.find_one_and_delete(
        {"username": target_username}
    )

    request_user = getattr(request.state, "user", None)
    is_current_user = (
        deleted_document is not None
        and isinstance(request_user, User)
        and request_user.username == target_username
    )
    if is_current_user:
        response = RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)
        _delete_auth_cookie(response, request)
        return response

    return RedirectResponse("/account/users/", status_code=status.HTTP_303_SEE_OTHER)


@account_router.get("/create_success", response_class=HTMLResponse)
@account_router.get("/create_success/", response_class=HTMLResponse)
async def create_success(request: Request):
    # Render the login success page
    return TEMPLATES.TemplateResponse(
        request, "account/create_success.html", {"request": request}
    )


@account_router.get("/nginx-auth")
@account_router.get("/nginx-auth/")
async def nginx_auth_gate(
    request: Request,
    require: str = "tools",
) -> Response:
    """Authorize nginx auth_request subrequests for gated webapps."""

    session_user = getattr(request.state, "user", None)
    if not isinstance(session_user, User):
        return Response(status_code=status.HTTP_401_UNAUTHORIZED)

    live_user = await get_user(session_user.username)
    if live_user is None or live_user.disabled:
        return Response(status_code=status.HTTP_401_UNAUTHORIZED)

    normalized_require = str(require or "").strip().lower()
    if normalized_require not in NGINX_AUTH_REQUIRE_VALUES:
        return Response(status_code=status.HTTP_403_FORBIDDEN)

    if not nginx_auth_requirement_allowed(live_user, normalized_require):
        return Response(status_code=status.HTTP_403_FORBIDDEN)

    headers = {
        "X-Website-Username": live_user.username,
        "X-Website-Can-Use-Tools": "true" if user_can_use_tools(live_user) else "false",
        "X-Website-Can-Use-Overseerr": (
            "true" if user_can_use_overseerr(live_user) else "false"
        ),
    }
    return Response(status_code=status.HTTP_200_OK, headers=headers)


@account_router.get("/access-denied", response_class=HTMLResponse)
@account_router.get("/access-denied/", response_class=HTMLResponse)
async def access_denied_page(
    request: Request,
    app: str | None = None,
) -> HTMLResponse:
    """Show Access Denied for authenticated users blocked by an nginx auth gate."""

    normalized_app = str(app or "").strip().lower()
    is_overseerr = normalized_app == "overseerr"

    return TEMPLATES.TemplateResponse(
        request,
        "account/access_denied.html",
        {
            "request": request,
            "is_overseerr": is_overseerr,
            "whatsapp_url": OVERSEERR_WHATSAPP_URL if is_overseerr else "",
        },
        status_code=status.HTTP_403_FORBIDDEN,
    )


@account_router.get("/protected")
@account_router.get("/protected/")
async def protected(request: Request) -> User | None:
    user: User = request.state.user
    if user is not None:
        return user
    else:
        return None
