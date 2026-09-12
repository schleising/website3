from __future__ import annotations

from pathlib import Path

WEBSITE_ROOT = Path(__file__).resolve().parents[1]
TOASTER_DIR = WEBSITE_ROOT / "toaster-bom"

TOASTER_FILES: dict[str, str] = {
    "index.html": "text/html; charset=utf-8",
    "app.js": "application/javascript",
    "styles.css": "text/css",
    "graph.json": "application/json",
}


def resolve_toaster_file(filename: str) -> tuple[Path, str] | None:
    media_type = TOASTER_FILES.get(filename)
    if media_type is None:
        return None

    toaster_root = TOASTER_DIR.resolve()
    file_path = (TOASTER_DIR / filename).resolve()
    if not file_path.is_file() or not file_path.is_relative_to(toaster_root):
        return None

    return file_path, media_type
