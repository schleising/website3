#!/usr/bin/env python3
"""Import historical World Cup editions from openfootball into MongoDB."""

from __future__ import annotations

import argparse
import importlib.util
import sys
import types
from pathlib import Path

from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
WEBSITE_DIR = ROOT / "website"
FOOTBALL_DIR = WEBSITE_DIR / "football"
DEFAULT_HOST = "macmini2"
DEFAULT_DB = "web_database"
LIVE_EDITION = "2026"


def _load_football_module(module_name: str):
    """Load a website/football module without running football/__init__.py."""
    football_pkg = sys.modules.get("football")
    if football_pkg is None:
        football_pkg = types.ModuleType("football")
        football_pkg.__path__ = [str(FOOTBALL_DIR)]
        sys.modules["football"] = football_pkg

    qualified_name = f"football.{module_name}"
    if qualified_name in sys.modules:
        return sys.modules[qualified_name]

    module_path = FOOTBALL_DIR / f"{module_name}.py"
    spec = importlib.util.spec_from_file_location(
        qualified_name,
        module_path,
        submodule_search_locations=[str(FOOTBALL_DIR)],
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load football module from {module_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[qualified_name] = module
    spec.loader.exec_module(module)
    return module


def _load_import_dependencies():
    _load_football_module("models")
    return _load_football_module("world_cup_import")


world_cup_utils = _load_football_module("world_cup_utils")
world_cup_import = _load_import_dependencies()
write_edition_to_mongo = world_cup_import.write_edition_to_mongo
edition_has_group_stage = world_cup_utils.edition_has_group_stage
WC_OPENFOOTBALL_EDITIONS = world_cup_utils.WC_OPENFOOTBALL_EDITIONS


def import_edition(
    edition: str,
    *,
    database,
    drop_existing: bool,
) -> tuple[int, int]:
    matches_collection = database[f"wc_matches_{edition}"]
    standings_collection = (
        database[f"wc_standings_{edition}"]
        if edition_has_group_stage(edition)
        else None
    )
    return write_edition_to_mongo(
        edition,
        matches_collection=matches_collection,
        standings_collection=standings_collection,
        drop_existing=drop_existing,
    )


def main() -> int:
    historical_editions = [
        edition for edition in WC_OPENFOOTBALL_EDITIONS if edition != LIVE_EDITION
    ]
    parser = argparse.ArgumentParser(
        description="Import historical World Cup editions from openfootball."
    )
    parser.add_argument(
        "edition",
        nargs="?",
        choices=[*historical_editions, "all"],
        help="Edition year to import, or 'all' for every historical edition.",
    )
    parser.add_argument(
        "--host",
        default=DEFAULT_HOST,
        help=f"MongoDB hostname (default: {DEFAULT_HOST}).",
    )
    parser.add_argument(
        "--mongo-uri",
        default=None,
        help="MongoDB URI. Overrides --host when set.",
    )
    parser.add_argument("--database", default=DEFAULT_DB)
    parser.add_argument(
        "--drop",
        action="store_true",
        help="Drop target collections before importing.",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip editions that already have a wc_matches_{year} collection.",
    )
    args = parser.parse_args()

    if args.edition is None:
        parser.error("edition is required (year or 'all')")

    mongo_uri = (
        args.mongo_uri
        if args.mongo_uri is not None
        else f"mongodb://{args.host}:27017"
    )

    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=10_000)
    client.admin.command("ping")
    database = client[args.database]

    editions = historical_editions if args.edition == "all" else [args.edition]
    failures: list[str] = []

    for edition in editions:
        collection_name = f"wc_matches_{edition}"
        if args.skip_existing and collection_name in database.list_collection_names():
            print(f"Skipping {edition}: {collection_name} already exists")
            continue

        try:
            match_count, standings_count = import_edition(
                edition,
                database=database,
                drop_existing=args.drop,
            )
        except Exception as error:
            failures.append(f"{edition}: {error}")
            print(f"FAILED {edition}: {error}")
            continue

        summary = f"Imported {match_count} matches into {collection_name}"
        if standings_count > 0:
            summary += (
                f" and {standings_count} group standings into wc_standings_{edition}"
            )
        print(summary)

    if len(failures) > 0:
        print("Import failures:")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
