#!/usr/bin/env python3
"""Download World Cup national team flags from Wikimedia Commons."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
FLAG_REGISTRY_PATH = ROOT / "website" / "football" / "wc_flag_registry.json"
TEAM_REGISTRY_PATH = ROOT / "website" / "football" / "wc_team_registry.json"
CREST_DIR = ROOT / "website" / "static" / "images" / "football" / "crests" / "wc"
COMMONS_FILE_PATH = "https://commons.wikimedia.org/wiki/Special:FilePath/{filename}"
USER_AGENT = "website3-wc-flag-fetch/1.0 (personal football stats site)"
REQUEST_DELAY_SECONDS = 1.25
MAX_RETRIES = 4


def _load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _commons_url(filename: str) -> str:
    return COMMONS_FILE_PATH.format(filename=quote(filename))


def _download_flag(filename: str) -> bytes:
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        if attempt > 0:
            time.sleep(REQUEST_DELAY_SECONDS * (attempt + 1))
        try:
            request = Request(
                _commons_url(filename),
                headers={"User-Agent": USER_AGENT},
            )
            with urlopen(request, timeout=60) as response:
                payload = response.read()
            if len(payload) == 0:
                raise ValueError(f"Empty response for {filename}")
            return payload
        except HTTPError as error:
            last_error = error
            if error.code == 429 and attempt + 1 < MAX_RETRIES:
                continue
            raise
        except URLError as error:
            last_error = error
            if attempt + 1 < MAX_RETRIES:
                continue
            raise
    if last_error is not None:
        raise last_error
    raise RuntimeError(f"Failed to download {filename}")


def _is_svg(payload: bytes) -> bool:
    stripped = payload.lstrip()
    return stripped.startswith(b"<svg") or stripped.startswith(b"<?xml")


def _audit_existing(flag_registry: dict[str, dict[str, str]]) -> list[str]:
    issues: list[str] = []
    for team_id, entry in sorted(flag_registry.items(), key=lambda item: int(item[0])):
        crest_path = CREST_DIR / f"{team_id}.svg"
        if not crest_path.is_file():
            issues.append(f"missing: {team_id} ({entry['country']})")
            continue
        content = crest_path.read_text(encoding="utf-8", errors="ignore")
        country = entry["country"]
        described_match = re.search(r"<desc>Flag of ([^<]+)</desc>", content)
        if described_match is not None:
            described = described_match.group(1)
            acceptable = {
                country.casefold(),
                country.replace(" ", "").casefold(),
            }
            if country == "West Germany":
                acceptable.add("germany")
            if country == "Dutch East Indies":
                acceptable.update({"netherlands", "the netherlands"})
            if described.casefold() not in acceptable:
                issues.append(
                    f"mismatch: {team_id} ({country}) file says '{described}'"
                )
    orphan_ids = sorted(
        int(path.stem)
        for path in CREST_DIR.glob("*.svg")
        if path.stem.isdigit() and path.stem not in flag_registry
    )
    for orphan_id in orphan_ids:
        issues.append(f"orphan file: {orphan_id}.svg (not in wc_flag_registry.json)")
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download WC team flags from Wikimedia Commons."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download flags even when the SVG already exists.",
    )
    parser.add_argument(
        "--audit",
        action="store_true",
        help="Report missing or suspect local flags without downloading.",
    )
    parser.add_argument(
        "--team-id",
        type=int,
        action="append",
        dest="team_ids",
        help="Only fetch flags for the given team id (repeatable).",
    )
    args = parser.parse_args()

    flag_registry = _load_json(FLAG_REGISTRY_PATH)
    team_registry = _load_json(TEAM_REGISTRY_PATH)
    registry_team_ids = {
        str(entry["id"])
        for entry in team_registry.values()
        if entry.get("id") is not None
    }
    missing_registry = sorted(registry_team_ids - set(flag_registry), key=int)
    if len(missing_registry) > 0:
        print(
            "Warning: team ids missing from wc_flag_registry.json:",
            ", ".join(missing_registry),
            file=sys.stderr,
        )

    if args.audit:
        issues = _audit_existing(flag_registry)
        registry_team_ids = {
            str(entry["id"])
            for entry in team_registry.values()
            if entry.get("id") is not None
        }
        if registry_team_ids != set(flag_registry):
            missing = sorted(registry_team_ids - set(flag_registry), key=int)
            extra = sorted(set(flag_registry) - registry_team_ids, key=int)
            if missing:
                issues.append(
                    "team registry ids missing from flag registry: "
                    + ", ".join(missing)
                )
            if extra:
                issues.append(
                    "flag registry ids missing from team registry: "
                    + ", ".join(extra)
                )
        if len(issues) == 0:
            print("No flag issues found.")
            return 0
        print("Flag audit issues:")
        for issue in issues:
            print(f"  - {issue}")
        return 1

    CREST_DIR.mkdir(parents=True, exist_ok=True)
    selected_ids = (
        {str(team_id) for team_id in args.team_ids}
        if args.team_ids is not None
        else set(flag_registry)
    )

    failures: list[str] = []
    downloaded = 0
    skipped = 0

    for team_id in sorted(selected_ids, key=int):
        if team_id not in flag_registry:
            failures.append(f"{team_id}: not in wc_flag_registry.json")
            continue

        entry = flag_registry[team_id]
        destination = CREST_DIR / f"{team_id}.svg"
        png_path = CREST_DIR / f"{team_id}.png"
        if destination.is_file() and not args.force:
            skipped += 1
            continue

        try:
            payload = _download_flag(entry["commons_file"])
            if not _is_svg(payload):
                failures.append(
                    f"{team_id} ({entry['country']}): response is not SVG"
                )
                continue
            destination.write_bytes(payload)
            if png_path.is_file():
                png_path.unlink()
            downloaded += 1
            print(f"Downloaded {team_id}.svg ({entry['country']})")
            time.sleep(REQUEST_DELAY_SECONDS)
        except (HTTPError, URLError, TimeoutError, ValueError) as error:
            failures.append(f"{team_id} ({entry['country']}): {error}")
            time.sleep(REQUEST_DELAY_SECONDS)

    print(f"Done: downloaded={downloaded}, skipped={skipped}, failed={len(failures)}")
    if len(failures) > 0:
        print("Failures:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
