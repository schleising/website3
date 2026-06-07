import logging

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from .football_utils import update_match_timezone
from .world_cup_db import (
    get_available_wc_editions,
    infer_current_wc_edition,
    list_group_summaries,
    normalise_group_table,
    retrieve_all_group_standings,
    retrieve_group_matches,
    retrieve_group_standings,
    world_cup_nav_available,
)
from .world_cup_utils import (
    WC_GROUP_ORDER,
    edition_label,
    group_slug_to_label,
    normalise_group_slug,
)

world_cup_router = APIRouter()
TEMPLATES = Jinja2Templates("/app/templates")


def _football_context_helpers():
    from .router import _build_football_mode_context

    return _build_football_mode_context


async def _build_world_cup_context(
    request: Request,
    requested_edition: str | None,
    *,
    show_edition_selector: bool = True,
) -> dict:
    mode_context = _football_context_helpers()(request)
    football_root_path = str(mode_context["football_root_path"])
    world_cup_root = f"{football_root_path}world-cup/"

    available_editions = await get_available_wc_editions()
    current_edition = await infer_current_wc_edition()
    if len(available_editions) == 0:
        available_editions = [current_edition]

    selected_edition = (
        requested_edition
        if requested_edition in available_editions
        else current_edition
    )

    return {
        "world_cup_section": True,
        "show_world_cup_nav": await world_cup_nav_available(),
        "show_edition_selector": show_edition_selector and len(available_editions) > 1,
        "available_editions": [
            {
                "key": edition,
                "label": edition_label(edition),
                "selected": edition == selected_edition,
                "is_current": edition == current_edition,
            }
            for edition in available_editions
        ],
        "selected_edition": selected_edition,
        "selected_edition_label": edition_label(selected_edition),
        "current_edition": current_edition,
        "edition_switch_path": f"{world_cup_root}groups/",
        "world_cup_overview_url": world_cup_root,
        "world_cup_groups_url": f"{world_cup_root}groups/",
        "world_cup_knockout_url": f"{world_cup_root}knockout/",
        "world_cup_matches_url": f"{world_cup_root}matches/",
        **mode_context,
    }


def _build_matchday_groups(matches: list) -> list[dict]:
    grouped_matches: dict[int, list] = {}

    for match in matches:
        matchday = match.matchday if match.matchday is not None else 0
        grouped_matches.setdefault(matchday, []).append(match)

    day_groups: list[dict] = []
    for matchday in sorted(grouped_matches):
        label = f"Matchday {matchday}" if matchday > 0 else "Fixtures"
        day_groups.append(
            {
                "label": label,
                "matches": grouped_matches[matchday],
            }
        )

    return day_groups


def _validate_group_slug(group_slug: str) -> str:
    slug = normalise_group_slug(group_slug)
    if slug not in WC_GROUP_ORDER:
        raise HTTPException(status_code=404, detail="Group not found")
    return slug


@world_cup_router.get("/groups", response_class=HTMLResponse)
@world_cup_router.get("/groups/", response_class=HTMLResponse)
async def get_world_cup_groups_index(
    request: Request,
    edition: str | None = Query(default=None, pattern=r"^\d{4}$"),
):
    logging.debug("/football/world-cup/groups/: %s", request)
    context = await _build_world_cup_context(request, edition)
    selected_edition = context["selected_edition"]
    group_summaries = await list_group_summaries(selected_edition)

    return TEMPLATES.TemplateResponse(
        request,
        "football/world-cup/groups_index.html",
        {
            "request": request,
            "title": "World Cup Groups",
            "group_summaries": group_summaries,
            **context,
        },
    )


@world_cup_router.get("/groups/{group_slug}", response_class=HTMLResponse)
@world_cup_router.get("/groups/{group_slug}/", response_class=HTMLResponse)
async def get_world_cup_group(
    request: Request,
    group_slug: str,
    edition: str | None = Query(default=None, pattern=r"^\d{4}$"),
):
    logging.debug("/football/world-cup/groups/%s: %s", group_slug, request)
    slug = _validate_group_slug(group_slug)
    context = await _build_world_cup_context(request, edition)
    selected_edition = context["selected_edition"]

    standings = await retrieve_group_standings(selected_edition, slug)
    if standings is None:
        all_groups = await retrieve_all_group_standings(selected_edition)
        if not any(group.group_slug == slug for group in all_groups):
            raise HTTPException(status_code=404, detail="Group not found")
        standings = next(group for group in all_groups if group.group_slug == slug)

    matches = await retrieve_group_matches(selected_edition, slug)
    matches = update_match_timezone(matches)
    standings = standings.model_copy(
        update={"table": normalise_group_table(standings.table, matches)}
    )
    matchday_groups = _build_matchday_groups(matches)

    context["edition_switch_path"] = (
        f"{context['football_root_path']}world-cup/groups/{slug}/"
    )

    return TEMPLATES.TemplateResponse(
        request,
        "football/world-cup/group.html",
        {
            "request": request,
            "title": group_slug_to_label(slug),
            "group_slug": slug,
            "group_label": group_slug_to_label(slug),
            "standings": standings,
            "matchday_groups": matchday_groups,
            **context,
        },
    )
