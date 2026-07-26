"""Lazy cover-art resolver with async background queue."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import aiohttp

from .arr_client import download_image, lookup_arr_poster
from .cache import (
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
from .identity import MediaIdentity, parse_media_identity
from .models import ArtDisplayFields
from .tmdb_client import download_tmdb_image, lookup_tmdb_poster

_queue: asyncio.Queue[MediaIdentity] | None = None
_worker_task: asyncio.Task[None] | None = None
_pending_keys: set[str] = set()
_indexes_ready = False
_worker_lock = asyncio.Lock()


async def resolve_art_for_display(source_path: str) -> ArtDisplayFields:
    fields = await resolve_art_for_display_many([source_path])
    return fields[0]


async def resolve_art_for_display_many(source_paths: list[str]) -> list[ArtDisplayFields]:
    await _ensure_runtime()
    identities = [parse_media_identity(path) for path in source_paths]
    records = await get_cache_records([identity.cache_key for identity in identities])

    results: list[ArtDisplayFields] = []
    for identity in identities:
        record = records.get(identity.cache_key)
        if should_enqueue(identity, record):
            enqueue_resolve(identity)
        results.append(display_fields_for(identity, record))
    return results


def enqueue_resolve(identity: MediaIdentity) -> None:
    if identity.kind == "unknown":
        return
    if identity.cache_key in _pending_keys:
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logging.debug("No running loop; skipping art enqueue for %s", identity.cache_key)
        return

    _pending_keys.add(identity.cache_key)
    _ = loop.create_task(_enqueue_async(identity))


async def _enqueue_async(identity: MediaIdentity) -> None:
    await _ensure_runtime()
    assert _queue is not None
    await _queue.put(identity)


async def _ensure_runtime() -> None:
    global _queue, _worker_task, _indexes_ready

    async with _worker_lock:
        _ = ensure_cache_dir()
        if not _indexes_ready:
            try:
                await ensure_indexes()
            except Exception as exc:  # noqa: BLE001
                logging.warning("Cover art index setup failed: %s", exc)
            _indexes_ready = True

        if _queue is None:
            _queue = asyncio.Queue()

        if _worker_task is None or _worker_task.done():
            _worker_task = asyncio.create_task(
                _worker_loop(), name="converter-cover-art-worker"
            )


async def _worker_loop() -> None:
    assert _queue is not None
    logging.info("Converter cover-art worker started")
    async with aiohttp.ClientSession() as session:
        while True:
            identity = await _queue.get()
            try:
                await _resolve_one(session, identity)
            except Exception as exc:  # noqa: BLE001
                logging.exception(
                    "Cover art resolve failed for %s: %s", identity.cache_key, exc
                )
                try:
                    await upsert_cache_record(
                        mark_status(identity, "error", provider="none")
                    )
                except Exception as persist_exc:  # noqa: BLE001
                    logging.warning("Failed to persist art error state: %s", persist_exc)
            finally:
                _pending_keys.discard(identity.cache_key)
                _queue.task_done()


async def _resolve_one(session: aiohttp.ClientSession, identity: MediaIdentity) -> None:
    existing = await get_cache_record(identity.cache_key)
    if (
        existing is not None
        and existing.status == "ready"
        and existing.local_path
        and Path(existing.local_path).is_file()
    ):
        return
    if existing is not None and not should_enqueue(identity, existing):
        return

    arr_result = await lookup_arr_poster(session, identity)
    if arr_result is not None:
        data, content_type = await download_image(
            session,
            arr_result.remote_url,
            api_key=arr_result.api_key,
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
        logging.info(
            "Cover art ready via %s for %s", arr_result.provider, identity.cache_key
        )
        return

    tmdb_result = await lookup_tmdb_poster(session, identity)
    if tmdb_result is not None:
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
        logging.info("Cover art ready via tmdb for %s", identity.cache_key)
        return

    await upsert_cache_record(mark_status(identity, "missing", provider="none"))
    logging.info("Cover art missing for %s", identity.cache_key)


async def refresh_art_for_path(source_path: str) -> ArtDisplayFields:
    """Force re-resolve (debug / admin)."""
    identity = parse_media_identity(source_path)
    _pending_keys.discard(identity.cache_key)
    await _ensure_runtime()
    async with aiohttp.ClientSession() as session:
        await _resolve_one(session, identity)
    record = await get_cache_record(identity.cache_key)
    return display_fields_for(identity, record)
