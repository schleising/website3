"""Mongo + filesystem cover-art cache helpers."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
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
    if (
        record is not None
        and record.status == "ready"
        and record.local_path
        and Path(record.local_path).is_file()
    ):
        cover_art_url = art_url_for_cache_key(identity.cache_key)
    else:
        cover_art_url = PLACEHOLDER_ART_URL

    return ArtDisplayFields(
        filename=basename,
        display_title=identity.display_title,
        media_kind=identity.kind,
        cover_art_url=cover_art_url,
        cache_key=identity.cache_key,
    )


async def upsert_cache_record(record: CoverArtCacheRecord) -> None:
    if cover_art_cache_collection is None:
        return
    payload = record.model_dump()
    _ = await cover_art_cache_collection.update_one(
        {"cache_key": record.cache_key},
        {"$set": payload},
        upsert=True,
    )


def write_poster_bytes(
    cache_key: str,
    data: bytes,
    content_type: str | None,
) -> tuple[str, str]:
    """Write poster bytes to the cache dir. Returns (local_path, content_type)."""
    _ = ensure_cache_dir()
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
    path = art_cache_dir() / filename
    _ = path.write_bytes(data)
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
    )
