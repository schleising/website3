"""Mongo models for Converter cover-art cache."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

ArtProvider = Literal["radarr", "sonarr", "tmdb", "none"]
ArtStatus = Literal["ready", "missing", "error", "pending"]


class CoverArtCacheRecord(BaseModel):
    cache_key: str
    kind: Literal["film", "tv", "unknown"]
    provider: ArtProvider = "none"
    provider_id: str | None = None
    remote_url: str | None = None
    local_path: str | None = None
    status: ArtStatus = "pending"
    last_attempt_at: datetime | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    content_type: str | None = None
    error_detail: str | None = None


class ArtDisplayFields(BaseModel):
    filename: str
    display_title: str
    media_kind: Literal["film", "tv", "unknown"]
    cover_art_url: str
    cache_key: str
    cover_art_status: str = "pending"
