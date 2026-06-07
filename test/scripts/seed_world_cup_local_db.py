#!/usr/bin/env python3
"""Copy World Cup collections from macmini2 into the local test MongoDB.

Read-only against macmini2. Writes only to the local docker-compose-test Mongo
instance (127.0.0.1:27018 by default).
"""

from __future__ import annotations

import argparse
import sys

from pymongo import MongoClient

DEFAULT_SOURCE_HOST = "macmini2"
DEFAULT_TARGET_URI = "mongodb://127.0.0.1:27018"
DEFAULT_DB = "web_database"
DEFAULT_EDITION = "2026"


def _copy_collection(
    source_db,
    target_db,
    collection_name: str,
    *,
    drop_target: bool,
) -> int:
    source = source_db[collection_name]
    target = target_db[collection_name]
    documents = list(source.find({}))
    if drop_target:
        target.drop()
    if len(documents) == 0:
        return 0
    target.insert_many(documents)
    return len(documents)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed local test Mongo with World Cup data copied from macmini2."
    )
    parser.add_argument(
        "--source-host",
        default=DEFAULT_SOURCE_HOST,
        help="MongoDB hostname to read from (default: macmini2).",
    )
    parser.add_argument(
        "--target-uri",
        default=DEFAULT_TARGET_URI,
        help="MongoDB URI for the local test database.",
    )
    parser.add_argument("--database", default=DEFAULT_DB)
    parser.add_argument("--edition", default=DEFAULT_EDITION)
    parser.add_argument(
        "--drop",
        action="store_true",
        help="Drop target collections before inserting copied documents.",
    )
    args = parser.parse_args()

    source_client = MongoClient(
        f"mongodb://{args.source_host}:27017",
        serverSelectionTimeoutMS=10_000,
    )
    target_client = MongoClient(args.target_uri, serverSelectionTimeoutMS=5_000)

    source_client.admin.command("ping")
    target_client.admin.command("ping")

    source_db = source_client[args.database]
    target_db = target_client[args.database]

    collection_names = [
        f"wc_matches_{args.edition}",
        f"wc_standings_{args.edition}",
    ]

    for collection_name in collection_names:
        if collection_name not in source_db.list_collection_names():
            print(f"skip {collection_name}: not present on {args.source_host}", file=sys.stderr)
            continue
        copied = _copy_collection(
            source_db,
            target_db,
            collection_name,
            drop_target=args.drop,
        )
        print(f"copied {copied} documents into {collection_name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
