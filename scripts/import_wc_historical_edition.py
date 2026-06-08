#!/usr/bin/env python3
"""Import a historical World Cup edition from openfootball into MongoDB."""

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
SUPPORTED_EDITIONS = ("1934", "2022")


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


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import a historical World Cup edition from openfootball."
    )
    parser.add_argument(
        "edition",
        choices=SUPPORTED_EDITIONS,
        help="Edition year to import (1934 or 2022 for this first pass).",
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
    args = parser.parse_args()

    mongo_uri = (
        args.mongo_uri
        if args.mongo_uri is not None
        else f"mongodb://{args.host}:27017"
    )

    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=10_000)
    client.admin.command("ping")
    database = client[args.database]

    matches_collection = database[f"wc_matches_{args.edition}"]
    standings_collection = (
        database[f"wc_standings_{args.edition}"]
        if edition_has_group_stage(args.edition)
        else None
    )

    match_count, standings_count = write_edition_to_mongo(
        args.edition,
        matches_collection=matches_collection,
        standings_collection=standings_collection,
        drop_existing=args.drop,
    )
    print(
        f"Imported {match_count} matches into wc_matches_{args.edition}"
        + (
            f" and {standings_count} group standings into wc_standings_{args.edition}"
            if standings_count > 0
            else ""
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
