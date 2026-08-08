from fastapi import HTTPException, Request, status


def request_can_manage_system_notifications(request: Request) -> bool:
    """Return True when the current request user can manage system notifications."""

    user = getattr(request.state, "user", None)
    if user is None:
        return False

    return bool(getattr(user, "can_use_tools", False))


def require_system_notifications_access(request: Request) -> None:
    """Raise 404 when the current request user lacks system notification access."""

    if request_can_manage_system_notifications(request):
        return

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Not Found",
    )
