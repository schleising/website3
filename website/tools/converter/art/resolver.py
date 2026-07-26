"""Lazy cover-art resolver with async background queue."""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

import aiohttp

from .arr_client import download_image, lookup_arr_poster
from .cache import (
    clear_error_cache_records,
    display_fields_for,
    ensure_cache_dir,
    ensure_indexes,
    get_cache_record,
    get_cache_records,
    mark_status,
    should_enqueue,
    upsert_cache_record,
    write_poster_bytes,
)
from .config import (
    art_cache_dir,
    radarr_api_key,
    radarr_url,
    sonarr_api_key,
    sonarr_url,
    tmdb_api_key,
)
from .identity import MediaIdentity, parse_media_identity
from .models import ArtDisplayFields
from .tmdb_client import download_tmdb_image, lookup_tmdb_poster
from ..database import cover_art_cache_collection

logger = logging.getLogger("converter.cover_art")

_queue: asyncio.Queue[MediaIdentity] | None = None
_worker_task: asyncio.Task[None] | None = None
_pending_keys: set[str] = set()
_indexes_ready = False
_config_logged = False
_errors_cleared = False
_worker_lock = asyncio.Lock()


def _log_runtime_config() -> None:
    global _config_logged
    if _config_logged:
        return
    _config_logged = True
    cache_dir = art_cache_dir()
    logger.info(
        "Cover art config: cache_dir=%s exists=%s writable=%s "
        "sonarr_url=%s radarr_url=%s sonarr_key=%s radarr_key=%s tmdb_key=%s "
        "mongo_collection=%s",
        cache_dir,
        cache_dir.exists(),
        os_access_writable(cache_dir),
        sonarr_url(),
        radarr_url(),
        bool(sonarr_api_key()),
        bool(radarr_api_key()),
        bool(tmdb_api_key()),
        cover_art_cache_collection is not None,
    )


def os_access_writable(path: Path) -> bool:
    try:
        if path.exists():
            return os.access(path, os.W_OK)
        parent = path.parent
        return parent.exists() and os.access(parent, os.W_OK)
    except OSError:
        return False


async def resolve_art_for_display(source_path: str) -> ArtDisplayFields:
    fields = await resolve_art_for_display_many([source_path])
    return fields[0]


async def resolve_art_for_display_many(source_paths: list[str]) -> list[ArtDisplayFields]:
    if not source_paths:
        return []

    await _ensure_runtime()
    identities = [parse_media_identity(path) for path in source_paths]
    records = await get_cache_records([identity.cache_key for identity in identities])

    enqueue_count = 0
    status_counts: dict[str, int] = {}
    results: list[ArtDisplayFields] = []
    for identity in identities:
        record = records.get(identity.cache_key)
        if should_enqueue(identity, record):
            enqueue_resolve(identity)
            enqueue_count += 1
        fields = display_fields_for(identity, record)
        status_counts[fields.cover_art_status] = (
            status_counts.get(fields.cover_art_status, 0) + 1
        )
        results.append(fields)

    logger.debug(
        "Art display batch size=%s enqueue=%s pending_keys=%s queue=%s statuses=%s",
        len(source_paths),
        enqueue_count,
        len(_pending_keys),
        None if _queue is None else _queue.qsize(),
        status_counts,
    )
    return results


def enqueue_resolve(identity: MediaIdentity) -> None:
    if identity.kind == "unknown":
        logger.debug("Skip enqueue unknown path=%s", identity.source_path)
        return
    if identity.cache_key in _pending_keys:
        logger.debug("Skip enqueue already pending key=%s", identity.cache_key)
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning(
            "No running loop; skipping art enqueue for %s", identity.cache_key
        )
        return

    _pending_keys.add(identity.cache_key)
    logger.info(
        "Enqueue art resolve key=%s kind=%s title=%s",
        identity.cache_key,
        identity.kind,
        identity.title,
    )
    _ = loop.create_task(_enqueue_async(identity))


async def _enqueue_async(identity: MediaIdentity) -> None:
    await _ensure_runtime()
    assert _queue is not None
    await _queue.put(identity)
    logger.debug(
        "Queued art resolve key=%s queue_size=%s", identity.cache_key, _queue.qsize()
    )


async def _ensure_runtime() -> None:
    global _queue, _worker_task, _indexes_ready, _errors_cleared

    async with _worker_lock:
        _log_runtime_config()
        cache_dir = ensure_cache_dir()
        logger.debug(
            "Cache dir ready path=%s exists=%s writable=%s",
            cache_dir,
            cache_dir.exists(),
            os_access_writable(cache_dir),
        )
        if not _indexes_ready:
            try:
                await ensure_indexes()
                logger.debug("Cover art Mongo index ensured")
            except Exception as exc:  # noqa: BLE001
                logger.warning("Cover art index setup failed: %s", exc)
            _indexes_ready = True

        if not _errors_cleared:
            try:
                await clear_error_cache_records()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed clearing cover art errors: %s", exc)
            _errors_cleared = True

        if _queue is None:
            _queue = asyncio.Queue()

        if _worker_task is None or _worker_task.done():
            if _worker_task is not None and _worker_task.done():
                try:
                    exc = _worker_task.exception()
                except asyncio.CancelledError:
                    exc = None
                if exc is not None:
                    logger.error("Cover art worker previously died: %s", exc)
            _worker_task = asyncio.create_task(
                _worker_loop(), name="converter-cover-art-worker"
            )
            logger.debug("Cover art worker task created")


async def _worker_loop() -> None:
    assert _queue is not None
    logger.info("Converter cover-art worker started")
    async with aiohttp.ClientSession() as session:
        while True:
            identity = await _queue.get()
            logger.debug(
                "Worker picked key=%s kind=%s title=%s remaining_queue=%s",
                identity.cache_key,
                identity.kind,
                identity.title,
                _queue.qsize(),
            )
            try:
                await _resolve_one(session, identity)
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Cover art resolve failed for %s: %s", identity.cache_key, exc
                )
                try:
                    await upsert_cache_record(
                        mark_status(
                            identity,
                            "error",
                            provider="none",
                            error_detail=f"{type(exc).__name__}: {exc}",
                        )
                    )
                except Exception as persist_exc:  # noqa: BLE001
                    logger.warning("Failed to persist art error state: %s", persist_exc)
            finally:
                _pending_keys.discard(identity.cache_key)
                _queue.task_done()


async def _resolve_one(session: aiohttp.ClientSession, identity: MediaIdentity) -> None:
    existing = await get_cache_record(identity.cache_key)
    logger.debug(
        "Resolve start key=%s existing=%s",
        identity.cache_key,
        None
        if existing is None
        else f"status={existing.status} provider={existing.provider} local={existing.local_path}",
    )
    if (
        existing is not None
        and existing.status == "ready"
        and existing.local_path
        and Path(existing.local_path).is_file()
    ):
        logger.debug("Resolve skip already ready key=%s", identity.cache_key)
        return
    if existing is not None and not should_enqueue(identity, existing):
        logger.debug(
            "Resolve skip fresh negative key=%s status=%s",
            identity.cache_key,
            existing.status,
        )
        return

    arr_result = await lookup_arr_poster(session, identity)
    if arr_result is not None:
        logger.debug(
            "Arr hit key=%s provider=%s url=%s",
            identity.cache_key,
            arr_result.provider,
            arr_result.remote_url,
        )
        data, content_type = await download_image(
            session,
            arr_result.remote_url,
            api_key=arr_result.api_key,
        )
        logger.debug(
            "Arr download ok key=%s bytes=%s content_type=%s",
            identity.cache_key,
            len(data),
            content_type,
        )
        local_path, stored_type = write_poster_bytes(
            identity.cache_key, data, content_type
        )
        await upsert_cache_record(
            mark_status(
                identity,
                "ready",
                provider=arr_result.provider,
                provider_id=arr_result.provider_id,
                remote_url=arr_result.remote_url,
                local_path=local_path,
                content_type=stored_type,
            )
        )
        logger.info(
            "Cover art ready via %s for %s", arr_result.provider, identity.cache_key
        )
        return

    logger.debug("Arr miss key=%s; trying TMDB", identity.cache_key)
    tmdb_result = await lookup_tmdb_poster(session, identity)
    if tmdb_result is not None:
        logger.debug(
            "TMDB hit key=%s id=%s url=%s",
            identity.cache_key,
            tmdb_result.provider_id,
            tmdb_result.remote_url,
        )
        data, content_type = await download_tmdb_image(session, tmdb_result.remote_url)
        local_path, stored_type = write_poster_bytes(
            identity.cache_key, data, content_type
        )
        await upsert_cache_record(
            mark_status(
                identity,
                "ready",
                provider="tmdb",
                provider_id=tmdb_result.provider_id,
                remote_url=tmdb_result.remote_url,
                local_path=local_path,
                content_type=stored_type,
            )
        )
        logger.info("Cover art ready via tmdb for %s", identity.cache_key)
        return

    await upsert_cache_record(mark_status(identity, "missing", provider="none"))
    logger.info("Cover art missing for %s", identity.cache_key)


async def refresh_art_for_path(source_path: str) -> ArtDisplayFields:
    """Force re-resolve (debug / admin)."""
    identity = parse_media_identity(source_path)
    _pending_keys.discard(identity.cache_key)
    await _ensure_runtime()
    async with aiohttp.ClientSession() as session:
        await _resolve_one(session, identity)
    record = await get_cache_record(identity.cache_key)
    return display_fields_for(identity, record)
