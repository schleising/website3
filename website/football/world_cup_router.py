import logging

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from .football_utils import update_match_timezone
from .world_cup_db import (
    build_overview_group_blocks,
    build_overview_knockout_sections,
    get_available_wc_editions,
    infer_current_wc_edition,
    list_available_knockout_rounds,
    list_group_summaries,
    normalise_group_table,
    retrieve_all_group_standings,
    retrieve_group_matches,
    retrieve_group_standings,
    retrieve_knockout_matches,
    world_cup_nav_available,
)
from .world_cup_utils import (
    WC_GROUP_ORDER,
    edition_label,
    filter_confirmed_knockout_matches,
    group_slug_to_label,
    is_valid_round_slug,
    knockout_match_has_confirmed_teams,
    knockout_winner_side,
    normalise_group_slug,
    normalise_round_slug,
    round_slug_to_label,
    round_slug_to_stage,
)

world_cup_router = APIRouter()
TEMPLATES = Jinja2Templates("/app/templates")
TEMPLATES.env.filters["knockout_winner_side"] = knockout_winner_side
TEMPLATES.env.filters["knockout_match_has_confirmed_teams"] = (
    knockout_match_has_confirmed_teams
)


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


def _build_date_groups(matches: list) -> list[dict]:
    grouped_matches: dict[str, list] = {}
    labels: dict[str, str] = {}

    for match in matches:
        match_date = match.local_date if match.local_date is not None else match.utc_date
        date_key = match_date.strftime("%Y-%m-%d")
        grouped_matches.setdefault(date_key, []).append(match)
        labels[date_key] = match_date.strftime("%a %d %b")

    day_groups: list[dict] = []
    for date_key in sorted(grouped_matches):
        day_groups.append(
            {
                "label": labels[date_key],
                "anchor_id": f"wc-date-{date_key}",
                "matches": grouped_matches[date_key],
            }
        )

    return day_groups


def _build_overview_jump_targets(
    knockout_sections: list,
    group_blocks: list,
) -> list[dict]:
    jump_targets: list[dict] = []

    for section in knockout_sections:
        slug = section["slug"] if isinstance(section, dict) else section.slug
        label = section["label"] if isinstance(section, dict) else section.label
        jump_targets.append(
            {
                "label": label,
                "anchor": f"wc-round-{slug}",
            }
        )

    if len(group_blocks) > 0:
        jump_targets.append({"label": "Group Stage", "anchor": "wc-group-stage"})

    for block in group_blocks:
        jump_targets.append(
            {
                "label": block.label,
                "anchor": f"wc-group-{block.slug}",
            }
        )

    return jump_targets


def _validate_group_slug(group_slug: str) -> str:
    slug = normalise_group_slug(group_slug)
    if slug not in WC_GROUP_ORDER:
        raise HTTPException(status_code=404, detail="Group not found")
    return slug


def _validate_round_slug(round_slug: str) -> str:
    slug = normalise_round_slug(round_slug)
    if not is_valid_round_slug(slug):
        raise HTTPException(status_code=404, detail="Knockout round not found")
    return slug


@world_cup_router.get("", response_class=HTMLResponse)
@world_cup_router.get("/", response_class=HTMLResponse)
async def get_world_cup_overview(
    request: Request,
    edition: str | None = Query(default=None, pattern=r"^\d{4}$"),
):
    logging.debug("/football/world-cup/: %s", request)
    context = await _build_world_cup_context(request, edition)
    selected_edition = context["selected_edition"]

    knockout_rounds = await build_overview_knockout_sections(selected_edition)
    group_blocks = await build_overview_group_blocks(selected_edition)

    overview_knockout_sections: list[dict] = []
    for round_section in knockout_rounds:
        matches = filter_confirmed_knockout_matches(
            update_match_timezone(round_section.matches)
        )
        if len(matches) == 0:
            continue

        date_groups = [
            {
                **day_group,
                "matches": [
                    match
                    for match in day_group["matches"]
                    if knockout_match_has_confirmed_teams(match)
                ],
            }
            for day_group in _build_date_groups(matches)
        ]
        date_groups = [
            day_group for day_group in date_groups if len(day_group["matches"]) > 0
        ]
        if len(date_groups) == 0:
            continue

        overview_knockout_sections.append(
            {
                "slug": round_section.slug,
                "label": round_section.label,
                "stage": round_section.stage,
                "date_groups": date_groups,
            }
        )

    overview_group_blocks: list[dict] = []
    for block in group_blocks:
        matches = update_match_timezone(block.matches)
        overview_group_blocks.append(
            {
                "slug": block.slug,
                "label": block.label,
                "table": block.table,
                "matchday_groups": _build_matchday_groups(matches),
            }
        )

    context["edition_switch_path"] = f"{context['football_root_path']}world-cup/"

    return TEMPLATES.TemplateResponse(
        request,
        "football/world-cup/overview.html",
        {
            "request": request,
            **context,
            "title": "World Cup Overview",
            "overview_knockout_sections": overview_knockout_sections,
            "group_blocks": overview_group_blocks,
            "jump_targets": _build_overview_jump_targets(
                overview_knockout_sections,
                group_blocks,
            ),
        },
    )


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

    context["edition_switch_path"] = f"{context['football_root_path']}world-cup/groups/"

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


@world_cup_router.get("/knockout", response_class=HTMLResponse)
@world_cup_router.get("/knockout/", response_class=HTMLResponse)
async def get_world_cup_knockout_index(
    request: Request,
    edition: str | None = Query(default=None, pattern=r"^\d{4}$"),
):
    logging.debug("/football/world-cup/knockout/: %s", request)
    context = await _build_world_cup_context(request, edition)
    selected_edition = context["selected_edition"]
    knockout_rounds = await list_available_knockout_rounds(selected_edition)

    context["edition_switch_path"] = f"{context['football_root_path']}world-cup/knockout/"

    return TEMPLATES.TemplateResponse(
        request,
        "football/world-cup/knockout_index.html",
        {
            "request": request,
            "title": "World Cup Knockout",
            "knockout_rounds": knockout_rounds,
            **context,
        },
    )


@world_cup_router.get("/knockout/{round_slug}", response_class=HTMLResponse)
@world_cup_router.get("/knockout/{round_slug}/", response_class=HTMLResponse)
async def get_world_cup_knockout_round(
    request: Request,
    round_slug: str,
    edition: str | None = Query(default=None, pattern=r"^\d{4}$"),
):
    logging.debug("/football/world-cup/knockout/%s: %s", round_slug, request)
    slug = _validate_round_slug(round_slug)
    context = await _build_world_cup_context(request, edition)
    selected_edition = context["selected_edition"]
    stage = round_slug_to_stage(slug)

    matches = filter_confirmed_knockout_matches(
        await retrieve_knockout_matches(selected_edition, stage)
    )
    if len(matches) == 0:
        raise HTTPException(status_code=404, detail="Knockout round not found")

    matches = update_match_timezone(matches)
    date_groups = _build_date_groups(matches)

    context["edition_switch_path"] = (
        f"{context['football_root_path']}world-cup/knockout/{slug}/"
    )

    return TEMPLATES.TemplateResponse(
        request,
        "football/world-cup/knockout_round.html",
        {
            "request": request,
            "title": round_slug_to_label(slug),
            "round_slug": slug,
            "round_label": round_slug_to_label(slug),
            "date_groups": date_groups,
            "highlight_knockout_winner": True,
            **context,
        },
    )
