"""Check the Cryptics abbreviation catalogue against the design rules."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PATH = ROOT / "website" / "static" / "data" / "cryptics" / "abbreviations.json"
CATEGORIES = frozenset({"general", "chemistry", "roman", "chess", "compass", "foreign", "rank"})
ABBR_RE = re.compile(r"^[A-Z]{1,6}$")
LETTER_RE = re.compile(r"[A-Za-z]")
ENTRY_KEYS = frozenset({"abbr", "means", "category", "note"})


def validate(payload: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["Catalogue must be a JSON object"]
    if payload.get("v") != 1:
        errors.append("v must be 1")
    entries = payload.get("entries")
    if not isinstance(entries, list):
        errors.append("entries must be a list")
        return errors

    seen: set[tuple[str, str]] = set()
    for index, entry in enumerate(entries):
        where = f"entries[{index}]"
        if not isinstance(entry, dict):
            errors.append(f"{where} must be an object")
            continue
        extra = set(entry) - ENTRY_KEYS
        if extra:
            errors.append(f"{where} has unexpected fields: {', '.join(sorted(extra))}")
        abbr = entry.get("abbr")
        means = entry.get("means")
        category = entry.get("category")
        if not isinstance(abbr, str) or ABBR_RE.fullmatch(abbr) is None:
            errors.append(f"{where} abbr must be 1 to 6 uppercase letters")
        if not isinstance(means, str) or not 1 <= len(means) <= 40 or LETTER_RE.search(means) is None:
            errors.append(f"{where} means must be 1 to 40 characters and include a letter")
        if category not in CATEGORIES:
            errors.append(f"{where} category is unknown")
        if "note" in entry:
            note = entry.get("note")
            if not isinstance(note, str) or not 1 <= len(note) <= 40:
                errors.append(f"{where} note must be 1 to 40 characters")
        if isinstance(abbr, str) and isinstance(means, str):
            pair = (abbr, means.casefold())
            if pair in seen:
                errors.append(f"{where} duplicates {abbr} / {means}")
            seen.add(pair)
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Check the Cryptics abbreviation catalogue")
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_PATH)
    args = parser.parse_args()
    try:
        payload = json.loads(args.path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"Invalid JSON: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(exc, file=sys.stderr)
        return 1
    errors = validate(payload)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    entries = payload["entries"]
    print(f"{len(entries)} abbreviations ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
