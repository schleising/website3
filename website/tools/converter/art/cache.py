"""Mongo + filesystem cover-art cache helpers."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
import os
from typing import cast

from .config import (
    ERROR_TTL_SECONDS,
    MISSING_TTL_SECONDS,
    PLACEHOLDER_ART_URL,
    art_cache_dir,
    art_url_for_cache_key,
    local_filename_for_cache_key,
)
from .identity import MediaIdentity
from .models import ArtDisplayFields, ArtProvider, ArtStatus, CoverArtCacheRecord

from ..database import cover_art_cache_collection


def ensure_cache_dir() -> Path:
    directory = art_cache_dir()
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logging.error("Cannot create cover art cache dir %s: %s", directory, exc)
    return directory


async def clear_error_cache_records() -> int:
    """Clear error rows so resolution can retry after a fix/redeploy."""
    logger = logging.getLogger("converter.cover_art")
    if cover_art_cache_collection is None:
        return 0
    result = await cover_art_cache_collection.delete_many({"status": "error"})
    deleted = int(result.deleted_count)
    if deleted:
        logger.info("Cleared %s cover art error cache records for retry", deleted)
    return deleted


async def ensure_indexes() -> None:
    if cover_art_cache_collection is None:
        return
    _ = await cover_art_cache_collection.create_index("cache_key", unique=True)


def _as_record(document: Mapping[str, object] | None) -> CoverArtCacheRecord | None:
    if document is None:
        return None
    payload = {str(key): value for key, value in document.items()}
    payload.pop("_id", None)
    try:
        return CoverArtCacheRecord.model_validate(payload)
    except Exception as exc:  # noqa: BLE001 — corrupt cache rows should not break WS
        logging.warning("Invalid cover art cache document: %s", exc)
        return None


async def get_cache_record(cache_key: str) -> CoverArtCacheRecord | None:
    if cover_art_cache_collection is None:
        return None
    document = await cover_art_cache_collection.find_one({"cache_key": cache_key})
    return _as_record(cast(Mapping[str, object] | None, document))


async def get_cache_records(cache_keys: list[str]) -> dict[str, CoverArtCacheRecord]:
    if cover_art_cache_collection is None or not cache_keys:
        return {}
    unique_keys = list(dict.fromkeys(cache_keys))
    cursor = cover_art_cache_collection.find({"cache_key": {"$in": unique_keys}})
    documents = await cursor.to_list(length=len(unique_keys))
    records: dict[str, CoverArtCacheRecord] = {}
    for document in documents:
        record = _as_record(cast(Mapping[str, object], document))
        if record is not None:
            records[record.cache_key] = record
    return records


def record_is_fresh_negative(record: CoverArtCacheRecord) -> bool:
    if record.last_attempt_at is None:
        return False
    age = datetime.now(UTC) - _as_utc(record.last_attempt_at)
    if record.status == "missing":
        return age < timedelta(seconds=MISSING_TTL_SECONDS)
    if record.status == "error":
        return age < timedelta(seconds=ERROR_TTL_SECONDS)
    return False


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def should_enqueue(identity: MediaIdentity, record: CoverArtCacheRecord | None) -> bool:
    if identity.kind == "unknown":
        return False
    if record is None:
        return True
    if record.status == "ready" and record.local_path and Path(record.local_path).is_file():
        return False
    if record.status in {"missing", "error"} and record_is_fresh_negative(record):
        return False
    return True


def display_fields_for(
    identity: MediaIdentity,
    record: CoverArtCacheRecord | None,
) -> ArtDisplayFields:
    basename = Path(identity.source_path).name
    if identity.kind == "unknown":
        status = "unknown"
        cover_art_url = PLACEHOLDER_ART_URL
    elif (
        record is not None
        and record.status == "ready"
        and record.local_path
        and Path(record.local_path).is_file()
    ):
        status = "ready"
        cover_art_url = art_url_for_cache_key(identity.cache_key)
    elif record is not None and record.status == "ready" and record.local_path:
        status = "ready_missing_file"
        cover_art_url = PLACEHOLDER_ART_URL
    elif record is not None:
        status = record.status
        cover_art_url = PLACEHOLDER_ART_URL
        if record.error_detail:
            status = f"{record.status}:{record.error_detail[:80]}"
    else:
        status = "pending"
        cover_art_url = PLACEHOLDER_ART_URL

    return ArtDisplayFields(
        filename=basename,
        display_title=identity.display_title,
        media_kind=identity.kind,
        cover_art_url=cover_art_url,
        cache_key=identity.cache_key,
        cover_art_status=status,
    )


async def upsert_cache_record(record: CoverArtCacheRecord) -> None:
    logger = logging.getLogger("converter.cover_art")
    if cover_art_cache_collection is None:
        logger.error(
            "cover_art_cache collection is None; cannot persist %s status=%s",
            record.cache_key,
            record.status,
        )
        return
    payload = record.model_dump()
    result = await cover_art_cache_collection.update_one(
        {"cache_key": record.cache_key},
        {"$set": payload},
        upsert=True,
    )
    logger.info(
        "upsert %s status=%s provider=%s matched=%s modified=%s upserted=%s local=%s",
        record.cache_key,
        record.status,
        record.provider,
        result.matched_count,
        result.modified_count,
        result.upserted_id is not None,
        record.local_path,
    )


def write_poster_bytes(
    cache_key: str,
    data: bytes,
    content_type: str | None,
) -> tuple[str, str]:
    """Write poster bytes to the cache dir. Returns (local_path, content_type)."""
    logger = logging.getLogger("converter.cover_art")
    cache_dir = ensure_cache_dir()
    extension = ".jpg"
    resolved_type = (content_type or "image/jpeg").split(";")[0].strip().lower()
    if resolved_type == "image/png":
        extension = ".png"
    elif resolved_type == "image/webp":
        extension = ".webp"
    elif resolved_type not in {"image/jpeg", "image/jpg"}:
        # Default unknown image payloads to jpeg extension.
        resolved_type = "image/jpeg"
        extension = ".jpg"

    filename = local_filename_for_cache_key(cache_key, extension)
    path = cache_dir / filename
    try:
        _ = path.write_bytes(data)
    except OSError as exc:
        logger.exception(
            "Failed writing poster for %s to %s (%s bytes): %s",
            cache_key,
            path,
            len(data),
            exc,
        )
        raise
    logger.info(
        "Wrote poster %s (%s bytes, %s) writable_dir=%s",
        path,
        len(data),
        resolved_type,
        os.access(cache_dir, os.W_OK),
    )
    return str(path), resolved_type


def resolve_local_path(record: CoverArtCacheRecord) -> Path | None:
    if not record.local_path:
        return None
    path = Path(record.local_path)
    if path.is_file():
        return path
    return None


def mark_status(
    identity: MediaIdentity,
    status: ArtStatus,
    *,
    provider: ArtProvider = "none",
    provider_id: str | None = None,
    remote_url: str | None = None,
    local_path: str | None = None,
    content_type: str | None = None,
    error_detail: str | None = None,
) -> CoverArtCacheRecord:
    return CoverArtCacheRecord(
        cache_key=identity.cache_key,
        kind=identity.kind if identity.kind != "unknown" else "unknown",
        provider=provider,
        provider_id=provider_id,
        remote_url=remote_url,
        local_path=local_path,
        status=status,
        last_attempt_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        content_type=content_type,
        error_detail=error_detail,
    )
