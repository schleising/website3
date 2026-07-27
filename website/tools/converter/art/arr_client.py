"""Async Sonarr / Radarr client for poster lookup."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urljoin

import aiohttp

from .config import (
    ARR_LIBRARY_TTL_SECONDS,
    MAX_POSTER_BYTES,
    radarr_api_key,
    radarr_url,
    sonarr_api_key,
    sonarr_url,
)
from .identity import MediaIdentity
from .models import ArtProvider
from .title_match import pick_best_item_by_title


@dataclass(frozen=True)
class ArrPosterResult:
    provider: ArtProvider
    provider_id: str | None
    remote_url: str
    use_api_key: bool = False
    api_key: str | None = None
    matched_title: str | None = None


class _LibraryCache:
    items: list[dict[str, Any]]
    fetched_at: float

    def __init__(self) -> None:
        self.items = []
        self.fetched_at = 0.0

    def is_fresh(self) -> bool:
        return bool(self.items) and (time.monotonic() - self.fetched_at) < ARR_LIBRARY_TTL_SECONDS


_sonarr_cache = _LibraryCache()
_radarr_cache = _LibraryCache()


def find_poster(images: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    if not images:
        return None
    posters = [
        image
        for image in images
        if str(image.get("coverType", "")).lower() == "poster"
    ]
    if posters:
        return posters[0]
    return images[0] if images else None


def find_item_by_title(
    items: list[dict[str, Any]],
    title: str,
    year: int | None = None,
) -> dict[str, Any] | None:
    def candidate_titles(item: dict[str, Any]) -> list[str]:
        values: list[str] = []
        for key in ("title", "sortTitle", "cleanTitle"):
            value = item.get(key)
            if value:
                values.append(str(value))
        return values

    def item_year(item: dict[str, Any]) -> int | None:
        value = item.get("year")
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    return pick_best_item_by_title(
        items,
        title,
        year,
        candidate_titles=candidate_titles,
        item_year=item_year,
    )

def _absolute_arr_url(base_url: str, maybe_relative: str | None) -> str | None:
    if not maybe_relative:
        return None
    if maybe_relative.startswith("http://") or maybe_relative.startswith("https://"):
        return maybe_relative
    return urljoin(base_url.rstrip("/") + "/", maybe_relative.lstrip("/"))


def choose_download_url(
    base_url: str,
    poster: dict[str, Any],
    api_key: str,
) -> tuple[str, bool] | None:
    remote = poster.get("remoteUrl")
    if isinstance(remote, str) and remote.strip():
        return remote.strip(), False

    local = _absolute_arr_url(base_url, poster.get("url") if isinstance(poster.get("url"), str) else None)
    if local is None:
        return None
    separator = "&" if "?" in local else "?"
    return f"{local}{separator}{urlencode({'apikey': api_key})}", True


async def _request_json(
    session: aiohttp.ClientSession,
    base_url: str,
    api_key: str,
    path: str,
    query: dict[str, str] | None = None,
) -> Any:
    url = f"{base_url.rstrip('/')}{path}"
    if query:
        url = f"{url}?{urlencode(query)}"
    headers = {
        "X-Api-Key": api_key,
        "Accept": "application/json",
        "User-Agent": "website3-converter-cover-art/1.0",
    }
    async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=20)) as response:
        response.raise_for_status()
        return await response.json()


async def _get_library(
    session: aiohttp.ClientSession,
    *,
    kind: str,
    base_url: str,
    api_key: str,
    path: str,
    cache: _LibraryCache,
) -> list[dict[str, Any]]:
    if cache.is_fresh():
        return cache.items
    try:
        payload = await _request_json(session, base_url, api_key, path)
    except Exception as exc:  # noqa: BLE001
        logging.warning("%s library fetch failed: %s", kind, exc)
        return cache.items
    if not isinstance(payload, list):
        logging.warning("%s library response was not a list", kind)
        return cache.items
    cache.items = [item for item in payload if isinstance(item, dict)]
    cache.fetched_at = time.monotonic()
    return cache.items


async def lookup_arr_poster(
    session: aiohttp.ClientSession,
    identity: MediaIdentity,
) -> ArrPosterResult | None:
    if identity.kind == "film":
        return await _lookup_radarr(session, identity)
    if identity.kind == "tv":
        return await _lookup_sonarr(session, identity)
    return None


async def _lookup_radarr(
    session: aiohttp.ClientSession,
    identity: MediaIdentity,
) -> ArrPosterResult | None:
    api_key = radarr_api_key()
    if not api_key:
        logging.getLogger("converter.cover_art").warning(
            "Radarr API key not configured; film lookup skipped for %s",
            identity.cache_key,
        )
        return None
    base_url = radarr_url()
    library = await _get_library(
        session,
        kind="Radarr",
        base_url=base_url,
        api_key=api_key,
        path="/api/v3/movie",
        cache=_radarr_cache,
    )
    item = find_item_by_title(library, identity.title, identity.year)
    if item is None:
        try:
            lookup = await _request_json(
                session,
                base_url,
                api_key,
                "/api/v3/movie/lookup",
                {"term": identity.title},
            )
            if isinstance(lookup, list):
                item = find_item_by_title(
                    [entry for entry in lookup if isinstance(entry, dict)],
                    identity.title,
                    identity.year,
                )
        except Exception as exc:  # noqa: BLE001
            logging.warning("Radarr lookup failed for %s: %s", identity.title, exc)

    if item is None:
        return None

    poster = find_poster(item.get("images") if isinstance(item.get("images"), list) else None)
    if poster is None:
        return None
    chosen = choose_download_url(base_url, poster, api_key)
    if chosen is None:
        return None
    url, use_api_key = chosen
    provider_id = str(item.get("tmdbId") or item.get("id") or "")
    matched_title = str(item.get("title") or "") or None
    return ArrPosterResult(
        provider="radarr",
        provider_id=provider_id or None,
        remote_url=url,
        use_api_key=use_api_key,
        api_key=api_key if use_api_key else None,
        matched_title=matched_title,
    )


async def _lookup_sonarr(
    session: aiohttp.ClientSession,
    identity: MediaIdentity,
) -> ArrPosterResult | None:
    api_key = sonarr_api_key()
    if not api_key:
        logging.getLogger("converter.cover_art").warning(
            "Sonarr API key not configured; TV lookup skipped for %s",
            identity.cache_key,
        )
        return None
    base_url = sonarr_url()
    library = await _get_library(
        session,
        kind="Sonarr",
        base_url=base_url,
        api_key=api_key,
        path="/api/v3/series",
        cache=_sonarr_cache,
    )
    item = find_item_by_title(library, identity.title)
    if item is None:
        try:
            lookup = await _request_json(
                session,
                base_url,
                api_key,
                "/api/v3/series/lookup",
                {"term": identity.title},
            )
            if isinstance(lookup, list):
                item = find_item_by_title(
                    [entry for entry in lookup if isinstance(entry, dict)],
                    identity.title,
                )
        except Exception as exc:  # noqa: BLE001
            logging.warning("Sonarr lookup failed for %s: %s", identity.title, exc)

    if item is None:
        return None

    poster = find_poster(item.get("images") if isinstance(item.get("images"), list) else None)
    if poster is None:
        return None
    chosen = choose_download_url(base_url, poster, api_key)
    if chosen is None:
        return None
    url, use_api_key = chosen
    provider_id = str(item.get("tvdbId") or item.get("id") or "")
    matched_title = str(item.get("title") or "") or None
    return ArrPosterResult(
        provider="sonarr",
        provider_id=provider_id or None,
        remote_url=url,
        use_api_key=use_api_key,
        api_key=api_key if use_api_key else None,
        matched_title=matched_title,
    )


async def download_image(
    session: aiohttp.ClientSession,
    url: str,
    *,
    api_key: str | None = None,
) -> tuple[bytes, str | None]:
    headers = {
        "Accept": "image/*,*/*",
        "User-Agent": "website3-converter-cover-art/1.0",
    }
    if api_key:
        headers["X-Api-Key"] = api_key

    async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as response:
        response.raise_for_status()
        content_type = response.headers.get("Content-Type")
        data = await response.read()
        if len(data) > MAX_POSTER_BYTES:
            raise ValueError(f"Poster exceeds {MAX_POSTER_BYTES} bytes")
        if not data:
            raise ValueError("Empty poster response")
        return data, content_type
