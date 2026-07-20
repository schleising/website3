#!/usr/bin/env python3
"""Migrate Premier League and World Cup collections out of web_database.

Creates two dedicated databases on the same MongoDB host:

- ``pl_database`` — Premier League matches, tables, live table, team colours
- ``wc_database`` — World Cup matches, standings, live standings

Cross-cutting football app data stays in ``web_database``:

- ``football_push_subscriptions``
- ``football_chatbot_api_keys``

Default mode is a dry run (no writes). Review the plan, then re-run with
``--execute`` when ready. After a successful copy, optionally pass
``--drop-source`` to remove the migrated collections from ``web_database``.

Example (review only)::

    python3 scripts/migrate_football_databases.py --host macmini2

Example (copy, then drop source after count verification)::

    python3 scripts/migrate_football_databases.py --host macmini2 --execute --drop-source
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Callable
from typing import Any

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database
from pymongo.errors import CollectionInvalid

DEFAULT_HOST = "macmini2"
SOURCE_DB = "web_database"
PL_DB = "pl_database"
WC_DB = "wc_database"

PL_COLLECTION_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^pl_matches_\d{4}_\d{4}$"),
    re.compile(r"^pl_table_\d{4}_\d{4}$"),
    re.compile(r"^live_pl_table$"),
    re.compile(r"^pl_team_primary_colours$"),
)

WC_COLLECTION_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^wc_matches_\d{4}$"),
    re.compile(r"^wc_standings_\d{4}$"),
    re.compile(r"^live_wc_standings_\d{4}$"),
)

BATCH_SIZE = 1_000


def _matches_any(name: str, patterns: tuple[re.Pattern[str], ...]) -> bool:
    return any(pattern.match(name) for pattern in patterns)


def _classify_collections(source_db: Database) -> tuple[list[str], list[str]]:
    pl_names: list[str] = []
    wc_names: list[str] = []
    for name in sorted(source_db.list_collection_names()):
        if _matches_any(name, PL_COLLECTION_PATTERNS):
            pl_names.append(name)
        elif _matches_any(name, WC_COLLECTION_PATTERNS):
            wc_names.append(name)
    return pl_names, wc_names


def _copy_indexes(source: Collection, target: Collection) -> int:
    copied = 0
    for index in source.list_indexes():
        index_doc = dict(index)
        name = index_doc.get("name")
        if name == "_id_":
            continue

        keys = index_doc.get("key")
        if keys is None:
            continue

        create_kwargs: dict[str, Any] = {}
        for option in (
            "unique",
            "sparse",
            "expireAfterSeconds",
            "partialFilterExpression",
            "collation",
            "weights",
            "default_language",
            "language_override",
            "textIndexVersion",
            "2dsphereIndexVersion",
            "bits",
            "min",
            "max",
            "bucketSize",
            "wildcardProjection",
            "hidden",
        ):
            if option in index_doc:
                create_kwargs[option] = index_doc[option]

        if isinstance(name, str) and name != "":
            create_kwargs["name"] = name

        key_list: list[tuple[str, Any]]
        if hasattr(keys, "items"):
            key_list = [(str(field), direction) for field, direction in keys.items()]
        elif isinstance(keys, list):
            key_list = [(str(field), direction) for field, direction in keys]
        else:
            continue

        try:
            target.create_index(key_list, **create_kwargs)
            copied += 1
        except Exception as error:  # noqa: BLE001 - keep migration moving
            # Equivalent index may already exist under another name.
            print(
                f"    warning: could not recreate index {name!r} "
                f"on {target.full_name}: {error}",
                flush=True,
            )
    return copied


def _copy_collection(
    source_db: Database,
    target_db: Database,
    collection_name: str,
    *,
    execute: bool,
    drop_target_first: bool,
    log: Callable[[str], None],
) -> tuple[int, int]:
    source = source_db[collection_name]
    source_count = source.estimated_document_count()

    if not execute:
        log(
            f"  [dry-run] would copy {collection_name}: "
            f"{source_count} docs → {target_db.name}.{collection_name}"
        )
        return source_count, 0

    target_exists = collection_name in target_db.list_collection_names()
    if target_exists:
        existing_count = target_db[collection_name].estimated_document_count()
        if existing_count > 0 and not drop_target_first:
            raise RuntimeError(
                f"{target_db.name}.{collection_name} already has {existing_count} "
                "documents. Re-run with --drop-target-first to replace, "
                "or drop it manually."
            )
        if drop_target_first:
            target_db.drop_collection(collection_name)
            log(f"  dropped existing {target_db.name}.{collection_name}")

    try:
        target_db.create_collection(collection_name)
    except CollectionInvalid:
        pass

    target = target_db[collection_name]
    copied = 0
    batch: list[dict] = []
    for document in source.find({}):
        batch.append(document)
        if len(batch) >= BATCH_SIZE:
            target.insert_many(batch, ordered=False)
            copied += len(batch)
            batch.clear()
    if batch:
        target.insert_many(batch, ordered=False)
        copied += len(batch)

    index_count = _copy_indexes(source, target)
    target_count = target.count_documents({})
    source_exact = source.count_documents({})
    log(
        f"  copied {collection_name}: {copied} docs "
        f"(source={source_exact}, target={target_count}, indexes={index_count})"
    )
    if target_count != source_exact:
        raise RuntimeError(
            f"Count mismatch for {collection_name}: "
            f"source={source_exact} target={target_count}"
        )
    return source_exact, copied


def _drop_source_collections(
    source_db: Database,
    collection_names: list[str],
    *,
    execute: bool,
    log: Callable[[str], None],
) -> None:
    for name in collection_names:
        if not execute:
            log(f"  [dry-run] would drop {source_db.name}.{name}")
            continue
        source_db.drop_collection(name)
        log(f"  dropped {source_db.name}.{name}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Copy PL/WC collections from web_database into pl_database and "
            "wc_database on the same MongoDB host."
        )
    )
    parser.add_argument(
        "--host",
        default=DEFAULT_HOST,
        help=f"MongoDB hostname (default: {DEFAULT_HOST}).",
    )
    parser.add_argument(
        "--source-db",
        default=SOURCE_DB,
        help=f"Source database (default: {SOURCE_DB}).",
    )
    parser.add_argument(
        "--pl-db",
        default=PL_DB,
        help=f"Premier League target database (default: {PL_DB}).",
    )
    parser.add_argument(
        "--wc-db",
        default=WC_DB,
        help=f"World Cup target database (default: {WC_DB}).",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Perform the copy. Without this flag, only print the plan.",
    )
    parser.add_argument(
        "--drop-target-first",
        action="store_true",
        help="Drop each target collection before copying (safe re-run).",
    )
    parser.add_argument(
        "--drop-source",
        action="store_true",
        help=(
            "After a successful verified copy, drop the migrated collections "
            "from the source database. Ignored during dry-run."
        ),
    )
    args = parser.parse_args()

    def log(message: str) -> None:
        print(message, flush=True)

    if args.drop_source and not args.execute:
        log("Error: --drop-source requires --execute.")
        return 2

    client = MongoClient(
        f"mongodb://{args.host}:27017",
        serverSelectionTimeoutMS=10_000,
    )
    client.admin.command("ping")

    source_db = client[args.source_db]
    pl_db = client[args.pl_db]
    wc_db = client[args.wc_db]

    pl_names, wc_names = _classify_collections(source_db)

    mode = "EXECUTE" if args.execute else "DRY-RUN"
    log(f"Mode: {mode}")
    log(f"Host: {args.host}")
    log(f"Source: {args.source_db}")
    log(f"PL target: {args.pl_db} ({len(pl_names)} collections)")
    log(f"WC target: {args.wc_db} ({len(wc_names)} collections)")
    log("")
    log("Staying in web_database (not migrated):")
    log("  - football_push_subscriptions")
    log("  - football_chatbot_api_keys")
    log("")

    if len(pl_names) == 0 and len(wc_names) == 0:
        log("No matching PL/WC collections found in the source database.")
        return 0

    log("Premier League collections:")
    for name in pl_names:
        _copy_collection(
            source_db,
            pl_db,
            name,
            execute=args.execute,
            drop_target_first=args.drop_target_first,
            log=log,
        )

    log("")
    log("World Cup collections:")
    for name in wc_names:
        _copy_collection(
            source_db,
            wc_db,
            name,
            execute=args.execute,
            drop_target_first=args.drop_target_first,
            log=log,
        )

    if args.drop_source:
        log("")
        log("Dropping migrated collections from source:")
        _drop_source_collections(
            source_db,
            pl_names + wc_names,
            execute=args.execute,
            log=log,
        )

    log("")
    if args.execute:
        log("Migration complete.")
        if not args.drop_source:
            log(
                "Source collections were left in place. "
                "Re-run with --drop-source after verifying the site, "
                "or drop them manually."
            )
    else:
        log("Dry run complete. Re-run with --execute to apply.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - top-level CLI
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
