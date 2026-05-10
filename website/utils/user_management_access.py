from fastapi import HTTPException, Request, status


def request_can_manage_users(request: Request) -> bool:
    """Return True when the current request user can access user management."""

    user = getattr(request.state, "user", None)
    if user is None:
        return False

    return bool(getattr(user, "can_use_tools", False))


def require_user_management_access(request: Request) -> None:
    """Raise 404 when the current request user lacks user management access."""

    if request_can_manage_users(request):
        return

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Not Found",
    )