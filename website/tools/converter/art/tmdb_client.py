"""TMDB fallback for Converter cover art."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlencode

import aiohttp

from .config import MAX_POSTER_BYTES, tmdb_api_key
from .identity import MediaIdentity, normalize_title

TMDB_API_BASE = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"


class TmdbPosterResult:
    def __init__(self, provider_id: str, remote_url: str) -> None:
        self.provider = "tmdb"
        self.provider_id = provider_id
        self.remote_url = remote_url


async def lookup_tmdb_poster(
    session: aiohttp.ClientSession,
    identity: MediaIdentity,
) -> TmdbPosterResult | None:
    api_key = tmdb_api_key()
    if not api_key:
        return None

    if identity.kind == "film":
        return await _search_movie(session, api_key, identity)
    if identity.kind == "tv":
        return await _search_tv(session, api_key, identity)
    return None


async def _tmdb_get(
    session: aiohttp.ClientSession,
    path: str,
    api_key: str,
    query: dict[str, str],
) -> dict[str, Any] | None:
    params = {"api_key": api_key, **query}
    url = f"{TMDB_API_BASE}{path}?{urlencode(params)}"
    headers = {
        "Accept": "application/json",
        "User-Agent": "website3-converter-cover-art/1.0",
    }
    try:
        async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=20)) as response:
            if response.status == 401:
                logging.warning("TMDB API key rejected")
                return None
            response.raise_for_status()
            payload = await response.json()
            return payload if isinstance(payload, dict) else None
    except Exception as exc:  # noqa: BLE001
        logging.warning("TMDB request failed (%s): %s", path, exc)
        return None


def _pick_result(
    results: list[dict[str, Any]],
    title: str,
    year: int | None,
    title_keys: tuple[str, ...],
    date_key: str,
) -> dict[str, Any] | None:
    needle = normalize_title(title)
    exact: list[dict[str, Any]] = []
    partial: list[dict[str, Any]] = []

    for item in results:
        candidates = [str(item.get(key) or "") for key in title_keys]
        item_year: int | None = None
        date_value = item.get(date_key)
        if isinstance(date_value, str) and len(date_value) >= 4 and date_value[:4].isdigit():
            item_year = int(date_value[:4])

        for candidate in candidates:
            if not candidate:
                continue
            normalized = normalize_title(candidate)
            year_ok = year is None or item_year is None or item_year == year
            if not year_ok:
                continue
            if normalized == needle:
                exact.append(item)
                break
            if needle in normalized or normalized in needle:
                partial.append(item)
                break

    if exact:
        return exact[0]
    if partial:
        return partial[0]
    return None


async def _search_movie(
    session: aiohttp.ClientSession,
    api_key: str,
    identity: MediaIdentity,
) -> TmdbPosterResult | None:
    query: dict[str, str] = {"query": identity.title}
    if identity.year is not None:
        query["year"] = str(identity.year)
    payload = await _tmdb_get(session, "/search/movie", api_key, query)
    if payload is None:
        return None
    results = payload.get("results")
    if not isinstance(results, list):
        return None
    item = _pick_result(
        [entry for entry in results if isinstance(entry, dict)],
        identity.title,
        identity.year,
        ("title", "original_title"),
        "release_date",
    )
    return _poster_from_item(item)


async def _search_tv(
    session: aiohttp.ClientSession,
    api_key: str,
    identity: MediaIdentity,
) -> TmdbPosterResult | None:
    payload = await _tmdb_get(
        session,
        "/search/tv",
        api_key,
        {"query": identity.title},
    )
    if payload is None:
        return None
    results = payload.get("results")
    if not isinstance(results, list):
        return None
    item = _pick_result(
        [entry for entry in results if isinstance(entry, dict)],
        identity.title,
        identity.year,
        ("name", "original_name"),
        "first_air_date",
    )
    return _poster_from_item(item)


def _poster_from_item(item: dict[str, Any] | None) -> TmdbPosterResult | None:
    if item is None:
        return None
    poster_path = item.get("poster_path")
    item_id = item.get("id")
    if not isinstance(poster_path, str) or not poster_path:
        return None
    if item_id is None:
        return None
    return TmdbPosterResult(
        provider_id=str(item_id),
        remote_url=f"{TMDB_IMAGE_BASE}{poster_path}",
    )


async def download_tmdb_image(
    session: aiohttp.ClientSession,
    url: str,
) -> tuple[bytes, str | None]:
    headers = {
        "Accept": "image/*,*/*",
        "User-Agent": "website3-converter-cover-art/1.0",
    }
    async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as response:
        response.raise_for_status()
        content_type = response.headers.get("Content-Type")
        data = await response.read()
        if len(data) > MAX_POSTER_BYTES:
            raise ValueError(f"Poster exceeds {MAX_POSTER_BYTES} bytes")
        if not data:
            raise ValueError("Empty poster response")
        return data, content_type
