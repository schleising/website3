#!/usr/bin/env python3
from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import argparse
import secrets
import sys

import bcrypt
from pymongo import ASCENDING, MongoClient
from pymongo.errors import DuplicateKeyError


DEFAULT_DB_SERVER_FILE = Path(__file__).resolve().parents[1] / "website" / "database" / "db_server.txt"


def _read_db_server(db_server_file: Path) -> str:
    if not db_server_file.exists():
        raise FileNotFoundError(f"No db server file found at {db_server_file}")

    server_name = db_server_file.read_text(encoding="utf-8").strip()

    if server_name == "":
        raise ValueError(f"Database server file is empty: {db_server_file}")

    return server_name


def _build_api_key() -> tuple[str, str, str]:
    key_id = secrets.token_hex(4)
    secret = secrets.token_urlsafe(32).rstrip("=")
    full_key = f"fha_{key_id}_{secret}"
    return key_id, secret, full_key


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a football history API key and store its bcrypt hash in MongoDB."
    )
    parser.add_argument(
        "--name",
        required=True,
        help="Friendly name for this API key (for example: production-chatbot).",
    )
    parser.add_argument(
        "--db-server-file",
        default=str(DEFAULT_DB_SERVER_FILE),
        help="Path to a db_server.txt file containing the Mongo hostname.",
    )
    parser.add_argument(
        "--inactive",
        action="store_true",
        help="Create the key as inactive.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    db_server_file = Path(args.db_server_file).expanduser().resolve()

    try:
        server_name = _read_db_server(db_server_file)
    except (FileNotFoundError, ValueError) as ex:
        print(f"Error: {ex}", file=sys.stderr)
        return 1

    mongo_client = MongoClient(server_name, 27017)
    collection = mongo_client["web_database"]["football_chatbot_api_keys"]

    collection.create_index([("key_id", ASCENDING)], unique=True)

    for _ in range(5):
        key_id, raw_secret, full_key = _build_api_key()
        key_hash = bcrypt.hashpw(raw_secret.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        now = datetime.now(tz=UTC)

        document = {
            "key_id": key_id,
            "name": args.name,
            "key_hash": key_hash,
            "is_active": not args.inactive,
            "created_at": now,
            "updated_at": now,
            "last_used_at": None,
            "use_count": 0,
        }

        try:
            collection.insert_one(document)
            print("Football history API key created successfully.")
            print(f"name: {args.name}")
            print(f"key_id: {key_id}")
            print(f"active: {not args.inactive}")
            print()
            print("Copy this API key now. It cannot be recovered from the hash:")
            print(full_key)
            return 0
        except DuplicateKeyError:
            continue

    print("Error: could not generate a unique key id after several attempts.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
