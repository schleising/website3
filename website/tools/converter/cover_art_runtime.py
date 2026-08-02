"""Website3 runtime for media-cover-art (sync client + async display queue).

Uses a dedicated sync pymongo-backed :class:`CoverArtClient` so Motor stays
isolated to the rest of the FastAPI app. Websocket/list paths call
:func:`resolve_art_for_display_many` which returns immediately from cache and
enqueues hydrate/resolve on a background asyncio worker.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from media_cover_art import (
    PLACEHOLDER_ART_URL,
    ArtDisplayFields,
    CoverArtClient,
    CoverArtSettings,
    art_url_for_cache_key,
)

logger = logging.getLogger("converter.cover_art")

_client: CoverArtClient | None = None
_queue: asyncio.Queue[str] | None = None
_worker_task: asyncio.Task[None] | None = None
_purge_task: asyncio.Task[None] | None = None
_pending_paths: set[str] = set()
_client_lock = asyncio.Lock()

_PURGE_INTERVAL_SECONDS = 6 * 60 * 60


def _keys_file_candidates() -> list[Path]:
    return [
        Path("/run/secrets/arr-keys.txt"),
        Path("/app/secrets/arr-keys.txt"),
        Path(__file__).resolve().parents[2] / "secrets" / "arr-keys.txt",
    ]


def _first_existing_keys_file() -> Path | None:
    for candidate in _keys_file_candidates():
        if candidate.exists():
            return candidate
    return None


def get_cover_art_client() -> CoverArtClient:
    """Return the process-wide sync cover-art client (lazy init)."""
    global _client
    if _client is not None:
        return _client

    keys_file = _first_existing_keys_file()
    settings = CoverArtSettings.from_env(keys_file=keys_file)
    # Ensure cache dir default matches website Docker volume when unset.
    if settings.cache_dir is None:
        raw = os.getenv("CONVERTER_ART_CACHE_DIR") or os.getenv(
            "MEDIA_COVER_ART_CACHE_DIR"
        )
        cache_dir = Path(raw) if raw else Path("/var/cache/converter-art")
        settings = CoverArtSettings(
            **{**settings.__dict__, "cache_dir": cache_dir}
        )

    _client = CoverArtClient(settings)
    logger.info(
        "Cover art client ready: cache_dir=%s sonarr=%s radarr=%s tmdb=%s",
        settings.cache_dir,
        bool(settings.sonarr_api_key),
        bool(settings.radarr_api_key),
        bool(settings.tmdb_api_key),
    )
    return _client


def art_cache_dir() -> Path:
    """Local poster cache directory used by the art HTTP endpoint."""
    client = get_cover_art_client()
    cache_dir = client.settings.cache_dir
    if cache_dir is None:
        return Path("/var/cache/converter-art")
    return cache_dir


async def resolve_art_for_display(source_path: str) -> ArtDisplayFields:
    return (await resolve_art_for_display_many([source_path]))[0]


async def resolve_art_for_display_many(
    source_paths: list[str],
) -> list[ArtDisplayFields]:
    """Peek cache for display fields; enqueue hydrate/resolve off the hot path."""
    await _ensure_runtime()
    client = get_cover_art_client()
    fields, needs_work = await asyncio.to_thread(
        client.peek_for_display_many, source_paths
    )
    for path in needs_work:
        _enqueue_resolve(path)
    return fields


async def refresh_art_for_path(source_path: str) -> ArtDisplayFields:
    await _ensure_runtime()
    client = get_cover_art_client()
    return await asyncio.to_thread(client.refresh, source_path)


def _enqueue_resolve(source_path: str) -> None:
    if source_path in _pending_paths or _queue is None:
        return
    _pending_paths.add(source_path)
    try:
        _queue.put_nowait(source_path)
    except Exception:  # noqa: BLE001
        _pending_paths.discard(source_path)


async def _ensure_runtime() -> None:
    global _queue, _worker_task, _purge_task
    async with _client_lock:
        _ = get_cover_art_client()
        if _queue is None:
            _queue = asyncio.Queue()
        if _worker_task is None or _worker_task.done():
            _worker_task = asyncio.create_task(
                _worker_loop(), name="converter-cover-art-worker"
            )
        if _purge_task is None or _purge_task.done():
            _purge_task = asyncio.create_task(
                _purge_loop(), name="converter-cover-art-purge"
            )


async def _worker_loop() -> None:
    assert _queue is not None
    client = get_cover_art_client()
    while True:
        source_path = await _queue.get()
        try:
            _ = await asyncio.to_thread(
                client.resolve_for_display, source_path
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Cover art worker failed for %s: %s", source_path, exc)
        finally:
            _pending_paths.discard(source_path)
            _queue.task_done()


async def _purge_loop() -> None:
    client = get_cover_art_client()
    while True:
        try:
            await asyncio.to_thread(client.purge_expired)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Cover art purge failed: %s", exc)
        await asyncio.sleep(_PURGE_INTERVAL_SECONDS)


async def serve_cached_poster(cache_key: str):
    """Return ``(path, content_type)`` for a ready local poster, or ``None``."""
    client = get_cover_art_client()

    def _lookup():
        record = client.cache.get_cache_record(cache_key)
        if record is None:
            return None
        path = client.cache.resolve_local_path(record)
        if path is None:
            return None
        try:
            path.resolve().relative_to(art_cache_dir().resolve())
        except ValueError:
            return None
        client.touch_access(cache_key)
        return path, record.content_type or "image/jpeg"

    return await asyncio.to_thread(_lookup)


__all__ = [
    "PLACEHOLDER_ART_URL",
    "ArtDisplayFields",
    "art_cache_dir",
    "art_url_for_cache_key",
    "get_cover_art_client",
    "refresh_art_for_path",
    "resolve_art_for_display",
    "resolve_art_for_display_many",
    "serve_cached_poster",
]
