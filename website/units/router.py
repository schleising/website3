from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from starlette.exceptions import HTTPException as StarletteHTTPException

from .conversions import (
    CATEGORIES,
    DEFAULT_CATEGORY_SLUG,
    CategoryDef,
    ConversionRow,
    canonical_value_string,
    convert_all,
    get_category,
    parse_value,
    result_path,
)


TEMPLATES = Jinja2Templates("/app/templates")

units_router = APIRouter(prefix="/units")


def _category_nav(current_slug: str) -> list[dict[str, Any]]:
    return [
        {
            "slug": category.slug,
            "label": category.label,
            "group": category.group,
            "href": f"/units/{category.slug}/",
            "is_current": category.slug == current_slug,
        }
        for category in CATEGORIES
    ]


def _unit_lookup(category: CategoryDef, slug: str) -> dict[str, str] | None:
    unit = category.unit(slug)
    if unit is None:
        return None
    return {
        "slug": unit.slug,
        "label": f"{unit.name} ({unit.symbol})",
        "symbol": unit.symbol,
        "name": unit.name,
    }


def _unit_options(category: CategoryDef) -> list[dict[str, str]]:
    options: list[dict[str, str]] = []
    for unit in category.units:
        looked_up = _unit_lookup(category, unit.slug)
        if looked_up is not None:
            options.append(looked_up)
    return options


def _render_convert_page(
    request: Request,
    *,
    category: CategoryDef,
    value_raw: str = "",
    from_slug: str | None = None,
    to_slug: str | None = None,
    error: str | None = None,
    result_rows: tuple[ConversionRow, ...] | None = None,
    primary_display: str | None = None,
    share_path: str | None = None,
    share_url: str | None = None,
    swap_path: str | None = None,
) -> HTMLResponse:
    selected_from = from_slug or category.default_from
    selected_to = to_slug or category.default_to
    from_unit = _unit_lookup(category, selected_from)
    to_unit = _unit_lookup(category, selected_to)
    nav = _category_nav(category.slug)
    return TEMPLATES.TemplateResponse(
        request,
        "units/convert.html",
        {
            "request": request,
            "category": category,
            "categories_nav": nav,
            "basic_nav": [item for item in nav if item["group"] == "basic"],
            "compound_nav": [item for item in nav if item["group"] == "compound"],
            "unit_options": _unit_options(category),
            "value_raw": value_raw,
            "from_slug": selected_from,
            "to_slug": selected_to,
            "from_unit": from_unit,
            "to_unit": to_unit,
            "error": error,
            "result_rows": result_rows,
            "primary_display": primary_display,
            "share_path": share_path,
            "share_url": share_url or share_path,
            "swap_path": swap_path,
            "has_result": result_rows is not None,
        },
    )


@units_router.get("/", response_class=HTMLResponse, response_model=None)
@units_router.get("", response_class=HTMLResponse, response_model=None)
async def units_root() -> RedirectResponse:
    return RedirectResponse(url=f"/units/{DEFAULT_CATEGORY_SLUG}/", status_code=302)


@units_router.get("/{category_slug}", response_class=HTMLResponse, response_model=None)
@units_router.get("/{category_slug}/", response_class=HTMLResponse, response_model=None)
async def units_category(
    request: Request,
    category_slug: str,
    v: str | None = None,
    from_unit: str | None = Query(default=None, alias="from"),
    to: str | None = None,
) -> Response:
    category = get_category(category_slug)
    if category is None:
        raise StarletteHTTPException(status_code=404, detail="Unknown unit category")

    if v is not None or from_unit is not None or to is not None:
        value_raw = (v or "").strip()
        selected_from = from_unit or category.default_from
        selected_to = to or category.default_to

        if category.unit(selected_from) is None or category.unit(selected_to) is None:
            raise StarletteHTTPException(status_code=404, detail="Unknown unit")

        value = parse_value(value_raw)
        if value is None:
            logging.info("Units form validation failed for category=%s", category_slug)
            return _render_convert_page(
                request,
                category=category,
                value_raw=value_raw,
                from_slug=selected_from,
                to_slug=selected_to,
                error="Enter a valid number to convert.",
            )

        return RedirectResponse(
            url=result_path(category.slug, value, selected_from, selected_to),
            status_code=302,
        )

    logging.info("Units category page requested: %s", category_slug)
    return _render_convert_page(request, category=category)


@units_router.get(
    "/{category_slug}/{value}/{from_slug}/to/{to_slug}",
    response_class=HTMLResponse,
    response_model=None,
)
@units_router.get(
    "/{category_slug}/{value}/{from_slug}/to/{to_slug}/",
    response_class=HTMLResponse,
    response_model=None,
)
async def units_result(
    request: Request,
    category_slug: str,
    value: str,
    from_slug: str,
    to_slug: str,
) -> Response:
    category = get_category(category_slug)
    if category is None:
        raise StarletteHTTPException(status_code=404, detail="Unknown unit category")
    if category.unit(from_slug) is None or category.unit(to_slug) is None:
        raise StarletteHTTPException(status_code=404, detail="Unknown unit")

    parsed = parse_value(value)
    if parsed is None:
        return _render_convert_page(
            request,
            category=category,
            value_raw=value,
            from_slug=from_slug,
            to_slug=to_slug,
            error="Enter a valid number to convert.",
        )

    canonical = canonical_value_string(parsed)
    if value != canonical:
        return RedirectResponse(
            url=result_path(category.slug, parsed, from_slug, to_slug),
            status_code=302,
        )

    rows = convert_all(category, parsed, from_slug, to_slug)
    primary = next((row for row in rows if row.is_primary), None)
    primary_display = primary.display if primary is not None else "—"
    share = result_path(category.slug, parsed, from_slug, to_slug)
    swap = result_path(category.slug, parsed, to_slug, from_slug)
    share_absolute = str(request.base_url).rstrip("/") + share

    logging.info(
        "Units conversion %s: %s %s -> %s",
        category_slug,
        value,
        from_slug,
        to_slug,
    )
    return _render_convert_page(
        request,
        category=category,
        value_raw=canonical,
        from_slug=from_slug,
        to_slug=to_slug,
        result_rows=rows,
        primary_display=primary_display,
        share_path=share,
        share_url=share_absolute,
        swap_path=swap,
    )
