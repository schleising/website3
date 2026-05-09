from __future__ import annotations

import asyncio
import os
import smtplib
from email.message import EmailMessage


def _smtp_host() -> str:
    return os.getenv("WEBSITE_SMTP_HOST", "smtp.gmail.com")


def _smtp_port() -> int:
    raw_port = os.getenv("WEBSITE_SMTP_PORT", "465").strip()
    try:
        return int(raw_port)
    except ValueError:
        return 465


def _smtp_username() -> str:
    return os.getenv("WEBSITE_SMTP_USERNAME", "").strip()


def _is_google_smtp_host() -> bool:
    host = _smtp_host().lower()
    return host.endswith("gmail.com") or host.endswith("googlemail.com")


def _smtp_login_username() -> str:
    explicit = os.getenv("WEBSITE_SMTP_LOGIN_USERNAME", "").strip()
    if explicit != "":
        return explicit

    username = _smtp_username()
    if username == "" or "@" in username:
        return username

    if _is_google_smtp_host():
        # Default for standard Gmail accounts when only local-part is provided.
        return f"{username}@gmail.com"

    return username


def _smtp_password() -> str:
    return os.getenv("WEBSITE_SMTP_PASSWORD", "").strip()


def _sender_email() -> str:
    return os.getenv("WEBSITE_EMAIL_FROM", "website@schleising.net").strip()


def _sender_name() -> str:
    return os.getenv("WEBSITE_EMAIL_FROM_NAME", "Schleising Website").strip()


def _reply_to_email() -> str | None:
    raw = os.getenv("WEBSITE_EMAIL_REPLY_TO", "").strip()
    if raw == "":
        return None
    return raw


def _send_email_sync(to_email: str, subject: str, plain_body: str) -> None:
    smtp_username = _smtp_login_username()
    smtp_password = _smtp_password()

    if smtp_username == "" or smtp_password == "":
        raise RuntimeError("SMTP credentials are not configured.")

    from_email = _sender_email()
    if from_email == "":
        from_email = smtp_username

    # Google SMTP can reject a custom From unless it is a configured alias.
    if _is_google_smtp_host() and from_email.lower() != smtp_username.lower():
        from_email = smtp_username

    from_name = _sender_name()

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{from_name} <{from_email}>"
    message["To"] = to_email

    reply_to = _reply_to_email()
    if reply_to is not None:
        message["Reply-To"] = reply_to

    message.set_content(plain_body)

    with smtplib.SMTP_SSL(_smtp_host(), _smtp_port()) as smtp_client:
        try:
            smtp_client.login(smtp_username, smtp_password)
        except smtplib.SMTPAuthenticationError as exc:
            auth_error = exc.smtp_error
            if isinstance(auth_error, bytes):
                auth_message = auth_error.decode("utf-8", errors="replace")
            else:
                auth_message = str(auth_error)
            raise RuntimeError(
                f"SMTP authentication failed for configured account ({exc.smtp_code}): {auth_message}"
            ) from exc

        smtp_client.send_message(message)


async def send_email(to_email: str, subject: str, plain_body: str) -> None:
    await asyncio.to_thread(_send_email_sync, to_email, subject, plain_body)
