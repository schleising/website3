from __future__ import annotations

from .world_cup_db import infer_current_wc_edition, retrieve_distinct_teams


async def get_wc_subscribable_team_ids(edition: str | None = None) -> set[int]:
    selected_edition = edition or await infer_current_wc_edition()
    teams = await retrieve_distinct_teams(selected_edition)
    return {team.id for team in teams if team.id is not None}


def merge_subscription_team_ids(
    *,
    existing_team_ids: list[int],
    submitted_team_ids: list[int],
    scope_valid_ids: set[int],
    other_valid_ids: set[int],
) -> list[int]:
    selected_in_scope = {
        team_id for team_id in submitted_team_ids if team_id in scope_valid_ids
    }
    preserved_other = {
        team_id for team_id in existing_team_ids if team_id in other_valid_ids
    }
    return sorted(selected_in_scope | preserved_other)
