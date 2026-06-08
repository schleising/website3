import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from ..account.csrf import validate_csrf
from .football_utils import update_match_timezone
from .models import (
    SubscriptionPreferencesResponse,
    SubscriptionPreferencesUpdateRequest,
    PushSubscriptionDocument,
)
from .subscription_scope import get_wc_subscribable_team_ids, merge_subscription_team_ids
from .world_cup_db import (
    build_knockout_bracket_diagram,
    build_overview_group_stage_sections,
    build_overview_knockout_sections,
    get_available_wc_editions,
    infer_current_wc_edition,
    list_available_knockout_rounds,
    list_group_stage_summary_sections,
    prepare_group_table_for_display,
    apply_live_qualification_labels,
    retrieve_all_edition_matches,
    retrieve_all_group_standings,
    retrieve_distinct_teams,
    retrieve_group_matches,
    retrieve_group_standings,
    retrieve_knockout_matches,
    retrieve_team_matches,
    world_cup_nav_available,
)
from .world_cup_utils import (
    adjacent_group_slugs,
    edition_has_group_stage,
    edition_has_knockout_stage,
    edition_label,
    group_order_for_edition,
    filter_confirmed_knockout_matches,
    group_slug_to_label,
    is_valid_round_slug,
    knockout_match_has_confirmed_teams,
    knockout_winner_side,
    world_cup_edition_query,
    build_group_matchday_groups,
    world_cup_display_score,
    world_cup_score_annotation,
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
TEMPLATES.env.filters["world_cup_display_score"] = world_cup_display_score
TEMPLATES.env.filters["world_cup_score_annotation"] = world_cup_score_annotation


def _football_context_helpers():
    from .router import _build_football_mode_context

    return _build_football_mode_context


def _redirect_to_world_cup_overview(context: dict) -> RedirectResponse:
    overview_url = (
        f"{context['football_root_path']}world-cup/{context['edition_query']}"
    )
    return RedirectResponse(url=overview_url, status_code=302)


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
    is_current_edition = selected_edition == current_edition
    has_group_stage = edition_has_group_stage(selected_edition)
    has_knockout_stage = edition_has_knockout_stage(selected_edition)
    edition_query = world_cup_edition_query(selected_edition)

    return {
        "world_cup_section": True,
        "is_current_edition": is_current_edition,
        "has_group_stage": has_group_stage,
        "has_knockout_stage": has_knockout_stage,
        "show_groups_nav": has_group_stage,
        "show_knockout_nav": has_knockout_stage,
        "enable_live_updates": is_current_edition,
        "enable_live_standings": False,
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
        "edition_query": edition_query,
        "edition_switch_path": (
            f"{world_cup_root}groups/{edition_query}"
            if has_group_stage
            else f"{world_cup_root}{edition_query}"
        ),
        "world_cup_overview_url": f"{world_cup_root}{edition_query}",
        "world_cup_groups_url": f"{world_cup_root}groups/{edition_query}",
        "world_cup_knockout_url": f"{world_cup_root}knockout/{edition_query}",
        "world_cup_matches_url": f"{world_cup_root}matches/{edition_query}",
        "world_cup_subscriptions_url": f"{world_cup_root}subscriptions/{edition_query}",
        **mode_context,
    }


def _subscription_router_helpers():
    from .football_db import get_push_subscription, upsert_push_subscription
    from .router import (
        _assert_subscription_owner,
        _build_football_auth_links,
        _get_current_season_teams,
        _get_current_season_key,
        _require_logged_in_username,
        _request_username,
    )

    return {
        "get_push_subscription": get_push_subscription,
        "upsert_push_subscription": upsert_push_subscription,
        "_assert_subscription_owner": _assert_subscription_owner,
        "_build_football_auth_links": _build_football_auth_links,
        "_get_current_season_teams": _get_current_season_teams,
        "_get_current_season_key": _get_current_season_key,
        "_require_logged_in_username": _require_logged_in_username,
        "_request_username": _request_username,
    }


def _build_matchday_groups(matches: list) -> list[dict]:
    if len(matches) > 0 and matches[0].stage == "GROUP_STAGE":
        return build_group_matchday_groups(matches)

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
    group_stage_sections: list,
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

    for stage_section in group_stage_sections:
        stage_label = (
            stage_section["label"]
            if isinstance(stage_section, dict)
            else stage_section.label
        )
        stage_anchor = (
            stage_section["anchor"]
            if isinstance(stage_section, dict)
            else stage_section.anchor
        )
        jump_targets.append({"label": stage_label, "anchor": stage_anchor})

        blocks = (
            stage_section["blocks"]
            if isinstance(stage_section, dict)
            else stage_section.blocks
        )
        for block in blocks:
            block_label = block["label"] if isinstance(block, dict) else block.label
            block_slug = block["slug"] if isinstance(block, dict) else block.slug
            jump_targets.append(
                {
                    "label": block_label,
                    "anchor": f"wc-group-{block_slug}",
                }
            )

    return jump_targets


def _validate_group_slug(group_slug: str, edition: str) -> str:
    slug = normalise_group_slug(group_slug)
    if slug not in group_order_for_edition(edition):
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
    group_stage_sections = await build_overview_group_stage_sections(selected_edition)

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

    overview_group_stage_sections: list[dict] = []
    for stage_section in group_stage_sections:
        overview_blocks: list[dict] = []
        for block in stage_section.blocks:
            matches = update_match_timezone(block.matches)
            overview_blocks.append(
                {
                    "slug": block.slug,
                    "label": block.label,
                    "table": block.table,
                    "matchday_groups": _build_matchday_groups(matches),
                }
            )

        overview_group_stage_sections.append(
            {
                "label": stage_section.label,
                "anchor": stage_section.anchor,
                "blocks": overview_blocks,
            }
        )

    context["edition_switch_path"] = (
        f"{context['football_root_path']}world-cup/{context['edition_query']}"
    )

    context["enable_live_standings"] = context["is_current_edition"]

    return TEMPLATES.TemplateResponse(
        request,
        "football/world-cup/overview.html",
        {
            "request": request,
            **context,
            "title": "World Cup Overview",
            "overview_knockout_sections": overview_knockout_sections,
            "group_stage_sections": overview_group_stage_sections,
            "jump_targets": _build_overview_jump_targets(
                overview_knockout_sections,
                overview_group_stage_sections,
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
    if not context["has_group_stage"]:
        return _redirect_to_world_cup_overview(context)

    group_stage_sections = await list_group_stage_summary_sections(selected_edition)

    context["edition_switch_path"] = (
        f"{context['football_root_path']}world-cup/groups/{context['edition_query']}"
    )

    return TEMPLATES.TemplateResponse(
        request,
        "football/world-cup/groups_index.html",
        {
            "request": request,
            "title": "World Cup Groups",
            "group_stage_sections": group_stage_sections,
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
    context = await _build_world_cup_context(request, edition)
    selected_edition = context["selected_edition"]
    if not context["has_group_stage"]:
        return _redirect_to_world_cup_overview(context)

    slug = _validate_group_slug(group_slug, selected_edition)

    standings = await retrieve_group_standings(selected_edition, slug)
    if standings is None:
        all_groups = await retrieve_all_group_standings(selected_edition)
        if not any(group.group_slug == slug for group in all_groups):
            raise HTTPException(status_code=404, detail="Group not found")
        standings = next(group for group in all_groups if group.group_slug == slug)

    matches = await retrieve_group_matches(selected_edition, slug)
    matches = update_match_timezone(matches)
    prepared_table = await prepare_group_table_for_display(
        selected_edition,
        slug,
        standings.table,
        matches,
    )
    standings = standings.model_copy(update={"table": prepared_table})
    matchday_groups = _build_matchday_groups(matches)

    context["edition_switch_path"] = (
        f"{context['football_root_path']}world-cup/groups/{slug}/{context['edition_query']}"
    )

    football_root_path = str(context["football_root_path"])
    edition_query = context["edition_query"]
    prev_slug, next_slug = adjacent_group_slugs(slug, selected_edition)

    def _group_nav_target(group_slug_value: str) -> dict:
        return {
            "slug": group_slug_value,
            "label": group_slug_to_label(group_slug_value),
            "url": (
                f"{football_root_path}world-cup/groups/{group_slug_value}/{edition_query}"
            ),
        }

    context["enable_live_standings"] = context["is_current_edition"]

    return TEMPLATES.TemplateResponse(
        request,
        "football/world-cup/group.html",
        {
            "request": request,
            "title": group_slug_to_label(slug),
            "group_slug": slug,
            "group_label": group_slug_to_label(slug),
            "prev_group": _group_nav_target(prev_slug),
            "next_group": _group_nav_target(next_slug),
            "standings": standings,
            "matchday_groups": matchday_groups,
            **context,
        },
    )


@world_cup_router.get("/teams/{team_id}", response_class=HTMLResponse)
@world_cup_router.get("/teams/{team_id}/", response_class=HTMLResponse)
async def get_world_cup_team_fixtures(
    request: Request,
    team_id: int,
    edition: str | None = Query(default=None, pattern=r"^\d{4}$"),
):
    logging.debug("/football/world-cup/teams/%s: %s", team_id, request)
    context = await _build_world_cup_context(request, edition)
    selected_edition = context["selected_edition"]

    team_name, matches = await retrieve_team_matches(selected_edition, team_id)
    if len(matches) == 0:
        raise HTTPException(status_code=404, detail="Team not found")

    matches = update_match_timezone(matches)
    date_groups = _build_date_groups(matches)
    jump_targets = [
        {"label": day_group["label"], "anchor": day_group["anchor_id"]}
        for day_group in date_groups
    ]

    context["edition_switch_path"] = (
        f"{context['football_root_path']}world-cup/teams/{team_id}/{context['edition_query']}"
    )

    return TEMPLATES.TemplateResponse(
        request,
        "football/world-cup/team_fixtures.html",
        {
            "request": request,
            "title": team_name,
            "team_name": team_name,
            "team_id": team_id,
            "date_groups": date_groups,
            "jump_targets": jump_targets,
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
    if not context["has_knockout_stage"]:
        return _redirect_to_world_cup_overview(context)

    selected_edition = context["selected_edition"]
    knockout_rounds = await list_available_knockout_rounds(selected_edition)
    knockout_bracket = await build_knockout_bracket_diagram(
        selected_edition,
        football_root=str(context["football_root_path"]),
    )

    context["edition_switch_path"] = (
        f"{context['football_root_path']}world-cup/knockout/{context['edition_query']}"
    )

    return TEMPLATES.TemplateResponse(
        request,
        "football/world-cup/knockout_index.html",
        {
            "request": request,
            "title": "World Cup Knockout",
            "knockout_rounds": knockout_rounds,
            "knockout_bracket": knockout_bracket,
            **context,
        },
    )


@world_cup_router.get("/matches", response_class=HTMLResponse)
@world_cup_router.get("/matches/", response_class=HTMLResponse)
async def get_world_cup_all_matches(
    request: Request,
    edition: str | None = Query(default=None, pattern=r"^\d{4}$"),
):
    logging.debug("/football/world-cup/matches/: %s", request)
    context = await _build_world_cup_context(request, edition)
    selected_edition = context["selected_edition"]

    matches = await retrieve_all_edition_matches(selected_edition)
    matches = update_match_timezone(matches)
    date_groups = _build_date_groups(matches)
    jump_targets = [
        {"label": day_group["label"], "anchor": day_group["anchor_id"]}
        for day_group in date_groups
    ]

    context["edition_switch_path"] = (
        f"{context['football_root_path']}world-cup/matches/{context['edition_query']}"
    )

    return TEMPLATES.TemplateResponse(
        request,
        "football/world-cup/all_matches.html",
        {
            "request": request,
            "title": "World Cup All Matches",
            "date_groups": date_groups,
            "jump_targets": jump_targets,
            "all_matches_view": True,
            **context,
        },
    )


@world_cup_router.get("/subscriptions", response_class=HTMLResponse)
@world_cup_router.get("/subscriptions/", response_class=HTMLResponse)
async def get_world_cup_subscriptions_page(
    request: Request,
    edition: str | None = Query(default=None, pattern=r"^\d{4}$"),
):
    logging.debug("/football/world-cup/subscriptions/: %s", request)
    helpers = _subscription_router_helpers()
    context = await _build_world_cup_context(request, edition, show_edition_selector=False)
    selected_edition = context["selected_edition"]
    teams = await retrieve_distinct_teams(selected_edition)
    auth_links = helpers["_build_football_auth_links"](request)
    football_root = str(context["football_root_path"])

    return TEMPLATES.TemplateResponse(
        request,
        "football/world-cup/subscriptions.html",
        {
            "request": request,
            "title": "World Cup Notifications",
            "live_matches": False,
            "enable_live_updates": False,
            "matches": [],
            "teams": teams,
            "can_manage_subscriptions": helpers["_request_username"](request)
            != "Anonymous User",
            "subscription_save_url": (
                f"{football_root}world-cup/subscription/preferences/"
            ),
            **auth_links,
            **context,
        },
    )


@world_cup_router.put(
    "/subscription/preferences",
    response_model=SubscriptionPreferencesResponse,
)
@world_cup_router.put(
    "/subscription/preferences/",
    response_model=SubscriptionPreferencesResponse,
)
async def update_world_cup_subscription_preferences(
    request: Request,
    payload: SubscriptionPreferencesUpdateRequest,
    _: None = Depends(validate_csrf),
):
    helpers = _subscription_router_helpers()
    wc_valid_ids = await get_wc_subscribable_team_ids()
    current_teams = await helpers["_get_current_season_teams"](
        await helpers["_get_current_season_key"]()
    )
    pl_valid_ids = {team.id for team in current_teams if team.id is not None}

    username = helpers["_require_logged_in_username"](request)
    existing_subscription = await helpers["get_push_subscription"](
        payload.subscription,
        username=username,
        client_id=payload.client_id,
    )
    helpers["_assert_subscription_owner"](existing_subscription, username)

    existing_team_ids = (
        existing_subscription.team_ids if existing_subscription is not None else []
    )
    selected_team_ids = merge_subscription_team_ids(
        existing_team_ids=existing_team_ids,
        submitted_team_ids=payload.team_ids,
        scope_valid_ids=wc_valid_ids,
        other_valid_ids=pl_valid_ids,
    )

    if len(selected_team_ids) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least one valid team.",
        )

    subscription_doc = PushSubscriptionDocument(
        subscription=payload.subscription,
        team_ids=selected_team_ids,
        username=username,
        client_id=payload.client_id,
    )
    ok = await helpers["upsert_push_subscription"](subscription_doc)

    if not ok:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to save subscription preferences.",
        )

    return SubscriptionPreferencesResponse(
        is_subscribed=True,
        team_ids=selected_team_ids,
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
    if not context["has_knockout_stage"]:
        return _redirect_to_world_cup_overview(context)

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
        f"{context['football_root_path']}world-cup/knockout/{slug}/{context['edition_query']}"
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
