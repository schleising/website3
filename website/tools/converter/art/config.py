"""Configuration and secrets for Converter cover art."""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path

DEFAULT_SONARR_URL = "http://steveds920:8989"
DEFAULT_RADARR_URL = "http://steveds920:7878"
DEFAULT_ART_CACHE_DIR = "/var/cache/converter-art"
PLACEHOLDER_ART_URL = "/icons/tools/converter/art-placeholder.svg"
MISSING_TTL_SECONDS = 7 * 24 * 60 * 60
ERROR_TTL_SECONDS = 2 * 60
ARR_LIBRARY_TTL_SECONDS = 30 * 60
# Converted list is last 7 days; keep posters a bit longer, then delete.
READY_RETENTION_SECONDS = 14 * 24 * 60 * 60
PURGE_INTERVAL_SECONDS = 6 * 60 * 60
MAX_POSTER_BYTES = 5 * 1024 * 1024

_KEY_FILE_CANDIDATES = (
    Path("/run/secrets/arr-keys.txt"),
    Path("/app/secrets/arr-keys.txt"),
    Path(__file__).resolve().parents[3] / "secrets" / "arr-keys.txt",
)


def art_cache_dir() -> Path:
    return Path(os.getenv("CONVERTER_ART_CACHE_DIR", DEFAULT_ART_CACHE_DIR))


def sonarr_url() -> str:
    return os.getenv("SONARR_URL", DEFAULT_SONARR_URL).rstrip("/")


def radarr_url() -> str:
    return os.getenv("RADARR_URL", DEFAULT_RADARR_URL).rstrip("/")


def tmdb_api_key() -> str | None:
    env_key = os.getenv("TMDB_API_KEY", "").strip()
    if env_key:
        return env_key
    keys = load_arr_keys()
    for name in ("tmdb_key", "tmdb_api_key"):
        value = keys.get(name, "").strip()
        if value:
            return value
    return None


def load_arr_keys() -> dict[str, str]:
    """Load key=value pairs from arr-keys.txt (or empty dict if missing)."""
    for candidate in _KEY_FILE_CANDIDATES:
        if not candidate.exists():
            continue
        try:
            return _parse_keys_file(candidate)
        except (OSError, ValueError) as exc:
            logging.warning("Failed to read Arr keys from %s: %s", candidate, exc)
    return {}


@lru_cache(maxsize=1)
def _parse_keys_file(keys_file: Path) -> dict[str, str]:
    keys: dict[str, str] = {}
    for line_number, raw_line in enumerate(
        keys_file.read_text(encoding="utf-8").splitlines(), start=1
    ):
        line = raw_line.strip()
        if line == "" or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(
                f"Invalid keys line {line_number} in {keys_file}: expected key=value"
            )
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip("'").strip('"')
        if name == "" or value == "":
            raise ValueError(
                f"Invalid keys line {line_number} in {keys_file}: empty name or value"
            )
        keys[name] = value
    return keys


def sonarr_api_key() -> str | None:
    env_key = os.getenv("SONARR_API_KEY", "").strip()
    if env_key:
        return env_key
    return load_arr_keys().get("sonarr_key")


def radarr_api_key() -> str | None:
    env_key = os.getenv("RADARR_API_KEY", "").strip()
    if env_key:
        return env_key
    return load_arr_keys().get("radarr_key")


def art_url_for_cache_key(
    cache_key: str,
    *,
    version: int | str | None = None,
) -> str:
    # Relative to the Converter page URL. On converter.schleising.net, nginx
    # already prefixes /tools/converter/, so an absolute /tools/converter/art/...
    # would be doubled (see WS construction which appends "ws/" the same way).
    # `version` (typically updated_at unix time) busts browser cache when the
    # poster bytes for the same key change after a re-resolve.
    from urllib.parse import quote

    url = f"art/{quote(cache_key, safe='')}"
    if version is None or version == "":
        return url
    return f"{url}?v={version}"


def local_filename_for_cache_key(cache_key: str, extension: str = ".jpg") -> str:
    safe = cache_key.replace(":", "_").replace("/", "_")
    if not extension.startswith("."):
        extension = f".{extension}"
    return f"{safe}{extension}"
