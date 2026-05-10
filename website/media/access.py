from fastapi import HTTPException, Request, status


def request_can_use_media(request: Request) -> bool:
    """Return True when the current request user can access the media manager."""

    user = getattr(request.state, "user", None)
    if user is None:
        return False

    return bool(getattr(user, "can_use_tools", False))


def require_media_access(request: Request) -> None:
    """Raise 404 when the current request user lacks media manager access."""

    if request_can_use_media(request):
        return

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Not Found",
    )