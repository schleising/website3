from datetime import datetime, UTC
import logging

from fastapi import HTTPException, status
from starlette.requests import HTTPConnection

# Dependency to get the user from the request state and return a 404 if the user is not logged in or can't use the tools
async def check_user_can_use_tools(request: HTTPConnection) -> None:
    logging.debug(f"Checking user can use tools: {request.state.user}")

    if request.state.user is None or not request.state.user.can_use_tools:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

def calculate_time_remaining(start_time: datetime | None, progress: float) -> str:
    """Calculate the time remaining for a conversion.

    Args:
        start_time (datetime | None): The start time of the conversion.
        progress (float): The percentage complete of the conversion.

    Returns:
        str: The time remaining for the conversion.
    """
    # Calculate the time remaining
    if progress != 0 and start_time is not None:
        time_remaining = (datetime.now().astimezone(UTC) - start_time) / progress * (100 - progress)
        time_string = str(time_remaining).split('.')[0]
    else:
        time_string = 'Calculating...'

    # Return the time remaining
    return time_string
