#!/usr/bin/env python3
"""Rebuild wc_team_registry.json and wc_flag_registry.json per design/World-Cup.md §7.3."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
TEAM_REGISTRY_PATH = ROOT / "website" / "football" / "wc_team_registry.json"
FLAG_REGISTRY_PATH = ROOT / "website" / "football" / "wc_flag_registry.json"
CREST_DIR = ROOT / "website" / "static" / "images" / "football" / "crests" / "wc"
DEFAULT_HOST = "macmini2"
DEFAULT_DB = "web_database"
LIVE_EDITION = "2026"
SYNTHETIC_MIN = 9100
SYNTHETIC_MAX = 9199

# openfootball country name -> football-data.org / Mongo team name (2026 squad)
TIER_A_ALIASES: dict[str, str] = {
    "Czech Republic": "Czechia",
    "Côte d'Ivoire": "Ivory Coast",
    "USA": "United States",
}

# Stable tier-B synthetic ids (project-assigned, never reused).
TIER_B_IDS: dict[str, int] = {
    "Angola": 9110,
    "Bolivia": 9111,
    "Bulgaria": 9112,
    "Cameroon": 9115,
    "Chile": 9120,
    "China": 9113,
    "Costa Rica": 9123,
    "Cuba": 9114,
    "Czechoslovakia": 9147,
    "Denmark": 9128,
    "Dutch East Indies": 9116,
    "East Germany": 9117,
    "El Salvador": 9118,
    "Greece": 9119,
    "Honduras": 9121,
    "Hungary": 9132,
    "Iceland": 9122,
    "Ireland": 9124,
    "Israel": 9125,
    "Italy": 9133,
    "Jamaica": 9126,
    "Kuwait": 9127,
    "Nigeria": 9129,
    "North Korea": 9130,
    "Northern Ireland": 9131,
    "Peru": 9134,
    "Poland": 9138,
    "Romania": 9142,
    "Russia": 9148,
    "Serbia": 9149,
    "Serbia and Montenegro": 9135,
    "Slovakia": 9136,
    "Slovenia": 9137,
    "Soviet Union": 9139,
    "Togo": 9140,
    "Trinidad and Tobago": 9141,
    "Ukraine": 9150,
    "United Arab Emirates": 9143,
    "Wales": 9151,
    "West Germany": 9144,
    "Yugoslavia": 9145,
    "Zaire": 9146,
}


def _load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _save_json(path: Path, payload: dict) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def _live_teams(host: str, database_name: str) -> dict[str, dict[str, object]]:
    client = MongoClient(f"mongodb://{host}:27017/")
    collection = client[database_name][f"wc_matches_{LIVE_EDITION}"]
    teams: dict[str, dict[str, object]] = {}
    for document in collection.find({}, {"home_team": 1, "away_team": 1}):
        for side in ("home_team", "away_team"):
            team = document.get(side) or {}
            team_id = team.get("id")
            name = team.get("name")
            if not isinstance(team_id, int) or not isinstance(name, str):
                continue
            teams[name] = {
                "id": team_id,
                "tla": team.get("tla"),
                "short_name": team.get("short_name") or name,
            }
    return teams


def _tier_a_lookup(
    country: str,
    live_teams: dict[str, dict[str, object]],
) -> dict[str, object] | None:
    candidates = [country]
    alias = TIER_A_ALIASES.get(country)
    if alias is not None:
        candidates.append(alias)
    for candidate in candidates:
        if candidate in live_teams:
            return live_teams[candidate]
    return None


def _commons_by_country(old_flag_registry: dict[str, dict[str, str]]) -> dict[str, str]:
    return {entry["country"]: entry["commons_file"] for entry in old_flag_registry.values()}


def _remap_crests(
    old_flag_registry: dict[str, dict[str, str]],
    new_flag_registry: dict[str, dict[str, str]],
) -> list[str]:
    country_to_old_id = {
        entry["country"]: team_id for team_id, entry in old_flag_registry.items()
    }
    # Snapshot originals first — ids can chain (A->B, B->C) during remapping.
    originals: dict[str, bytes] = {}
    for country, old_id in country_to_old_id.items():
        source = CREST_DIR / f"{old_id}.svg"
        if source.is_file():
            originals[country] = source.read_bytes()

    actions: list[str] = []
    for new_id, entry in new_flag_registry.items():
        country = entry["country"]
        old_id = country_to_old_id.get(country)
        if old_id is None or old_id == new_id:
            continue
        destination = CREST_DIR / f"{new_id}.svg"
        if country in originals:
            destination.write_bytes(originals[country])
            actions.append(f"copied {old_id}.svg -> {new_id}.svg ({country})")
        elif not destination.is_file():
            actions.append(f"pending download: {new_id}.svg ({country})")
    return actions


def _remove_orphan_crests(flag_registry: dict[str, dict[str, str]]) -> list[str]:
    removed: list[str] = []
    valid_ids = set(flag_registry)
    for path in sorted(CREST_DIR.glob("*.svg")):
        if path.stem.isdigit() and path.stem not in valid_ids:
            path.unlink()
            removed.append(f"removed orphan {path.name}")
    for path in sorted(CREST_DIR.glob("*.png")):
        if path.stem.isdigit():
            path.unlink()
            removed.append(f"removed orphan {path.name}")
    return removed


def build_registries(
    old_team_registry: dict[str, dict[str, object]],
    old_flag_registry: dict[str, dict[str, str]],
    live_teams: dict[str, dict[str, object]],
) -> tuple[dict[str, dict[str, object]], dict[str, dict[str, str]], list[str]]:
    commons_by_country = _commons_by_country(old_flag_registry)
    new_team_registry: dict[str, dict[str, object]] = {}
    changes: list[str] = []

    for country in sorted(old_team_registry):
        tier_a = _tier_a_lookup(country, live_teams)
        if tier_a is not None:
            entry = {
                "id": tier_a["id"],
                "tla": tier_a.get("tla") or old_team_registry[country].get("tla"),
                "short_name": tier_a.get("short_name") or country,
            }
        elif country in TIER_B_IDS:
            entry = {
                "id": TIER_B_IDS[country],
                "tla": old_team_registry[country].get("tla"),
                "short_name": old_team_registry[country].get("short_name") or country,
            }
        else:
            raise KeyError(f"No tier-A or tier-B mapping for {country}")

        old_id = old_team_registry[country].get("id")
        new_id = entry["id"]
        if old_id != new_id:
            changes.append(f"{country}: {old_id} -> {new_id}")
        new_team_registry[country] = entry

    new_flag_registry: dict[str, dict[str, str]] = {}
    for country, entry in sorted(new_team_registry.items(), key=lambda item: item[0]):
        team_id = str(entry["id"])
        commons_file = commons_by_country.get(country)
        if commons_file is None:
            alias = TIER_A_ALIASES.get(country)
            if alias is not None:
                commons_file = commons_by_country.get(alias)
        if commons_file is None:
            raise KeyError(f"No Wikimedia mapping for {country}")
        new_flag_registry[team_id] = {"country": country, "commons_file": commons_file}

    used_ids = {int(entry["id"]) for entry in new_team_registry.values()}
    tier_b_used = sorted(team_id for team_id in used_ids if SYNTHETIC_MIN <= team_id <= SYNTHETIC_MAX)
    if len(tier_b_used) != len({entry["id"] for c, entry in new_team_registry.items() if c in TIER_B_IDS}):
        raise ValueError("Duplicate synthetic id assigned")

    return new_team_registry, new_flag_registry, changes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--database", default=DEFAULT_DB)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print changes without writing files.",
    )
    args = parser.parse_args()

    old_team_registry = _load_json(TEAM_REGISTRY_PATH)
    old_flag_registry = _load_json(FLAG_REGISTRY_PATH)
    live_teams = _live_teams(args.host, args.database)

    new_team_registry, new_flag_registry, changes = build_registries(
        old_team_registry,
        old_flag_registry,
        live_teams,
    )

    print(f"Tier A nations: {len(live_teams)} from wc_matches_{LIVE_EDITION}")
    print(f"Registry nations: {len(new_team_registry)}")
    if changes:
        print("ID changes:")
        for change in changes:
            print(f"  {change}")

    if args.dry_run:
        return 0

    crest_actions = _remap_crests(old_flag_registry, new_flag_registry)
    _save_json(TEAM_REGISTRY_PATH, new_team_registry)
    _save_json(FLAG_REGISTRY_PATH, new_flag_registry)

    print(f"Wrote {TEAM_REGISTRY_PATH.name} ({len(new_team_registry)} teams)")
    print(f"Wrote {FLAG_REGISTRY_PATH.name} ({len(new_flag_registry)} flags)")
    if crest_actions:
        print("Crest actions:")
        for action in crest_actions:
            print(f"  {action}")

    removed = _remove_orphan_crests(new_flag_registry)
    if removed:
        print("Orphan cleanup:")
        for line in removed:
            print(f"  {line}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
