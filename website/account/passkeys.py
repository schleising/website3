from __future__ import annotations

from base64 import urlsafe_b64decode, urlsafe_b64encode
import json
from typing import Any

from fastapi import HTTPException, Request, status

from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)  # pyright: ignore[reportMissingImports]
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)  # pyright: ignore[reportMissingImports]

PASSKEY_RP_NAME = "schleising.net"
PASSKEY_PRIMARY_DOMAIN = "schleising.net"


def bytes_to_b64url(value: bytes) -> str:
    return urlsafe_b64encode(value).decode("ascii").rstrip("=")


def b64url_to_bytes(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return urlsafe_b64decode((value + padding).encode("ascii"))


def _request_netloc(request: Request) -> str:
    forwarded_host = request.headers.get("x-forwarded-host")
    host_header = request.headers.get("host")
    host = (forwarded_host or host_header or request.url.netloc).split(",")[0].strip().lower()
    if host == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing host information for WebAuthn request.",
        )
    return host


def _hostname_from_netloc(netloc: str) -> str:
    return netloc.split(":", 1)[0]


def _request_scheme(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return proto.lower()


def webauthn_context_for_request(request: Request) -> tuple[str, str]:
    netloc = _request_netloc(request)
    hostname = _hostname_from_netloc(netloc)
    scheme = _request_scheme(request)

    if hostname == PASSKEY_PRIMARY_DOMAIN or hostname.endswith(f".{PASSKEY_PRIMARY_DOMAIN}"):
        if scheme != "https":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Passkeys require HTTPS on schleising.net hosts.",
            )
        return PASSKEY_PRIMARY_DOMAIN, f"{scheme}://{netloc}"

    if hostname == "localhost":
        return "localhost", f"{scheme}://{netloc}"

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Host is not allowed for WebAuthn operations.",
    )


def registration_options_as_dict(
    *,
    rp_id: str,
    username: str,
    display_name: str,
    user_handle_b64url: str,
    exclude_credential_ids: list[str],
) -> dict[str, Any]:
    exclude_credentials = [
        PublicKeyCredentialDescriptor(id=b64url_to_bytes(credential_id))
        for credential_id in exclude_credential_ids
    ]

    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=PASSKEY_RP_NAME,
        user_id=b64url_to_bytes(user_handle_b64url),
        user_name=username,
        user_display_name=display_name,
        timeout=60000,
        attestation=AttestationConveyancePreference.NONE,
        exclude_credentials=exclude_credentials,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )

    return json.loads(options_to_json(options))


def authentication_options_as_dict(
    *,
    rp_id: str,
    credential_ids: list[str],
) -> dict[str, Any]:
    allow_credentials = [
        PublicKeyCredentialDescriptor(id=b64url_to_bytes(credential_id))
        for credential_id in credential_ids
    ]

    options = generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=allow_credentials,
        timeout=60000,
        user_verification=UserVerificationRequirement.REQUIRED,
    )

    return json.loads(options_to_json(options))


def verify_registration_response_payload(
    *,
    credential: dict[str, Any],
    challenge_b64url: str,
    rp_id: str,
    origin: str,
):
    return verify_registration_response(
        credential=credential,
        expected_challenge=b64url_to_bytes(challenge_b64url),
        expected_rp_id=rp_id,
        expected_origin=origin,
        require_user_verification=True,
    )


def verify_authentication_response_payload(
    *,
    credential: dict[str, Any],
    challenge_b64url: str,
    rp_id: str,
    origin: str,
    credential_public_key_b64url: str,
    credential_current_sign_count: int,
):
    return verify_authentication_response(
        credential=credential,
        expected_challenge=b64url_to_bytes(challenge_b64url),
        expected_rp_id=rp_id,
        expected_origin=origin,
        credential_public_key=b64url_to_bytes(credential_public_key_b64url),
        credential_current_sign_count=credential_current_sign_count,
        require_user_verification=True,
    )
