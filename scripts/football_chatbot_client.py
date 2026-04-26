from __future__ import annotations

from typing import Any

import requests


class FootballHistoryApiClient:
    def __init__(self, base_url: str, api_key: str, timeout_seconds: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds

    def query(self, request_payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}/football/api/history/query/"
        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={"request": request_payload},
            timeout=self.timeout_seconds,
        )

        response.raise_for_status()
        return response.json()


if __name__ == "__main__":
    # Example usage for quick manual testing.
    CLIENT = FootballHistoryApiClient(
        base_url="https://www.schleising.net",
        api_key="fha_530d690a_WNKe7JgmfyASxMFaVI6fKi0hShLSOS4FpvY_OzMgncU",
    )

    EXAMPLE_REQUEST = {
        "action": "get_aggregate_stats",
        "filters": {
            "teams": ["Arsenal"],
            "competitions": ["Premier League"],
            "season_start": "2018/19",
            "season_end": "2023/24",
            "venue": "both",
        },
        "metrics": ["goals_for", "goals_against", "points", "matches_played"],
        "group_by": ["team", "season"],
        "sort_by": {"field": "points", "order": "desc"},
        "limit": 10,
    }

    print(CLIENT.query(EXAMPLE_REQUEST))
