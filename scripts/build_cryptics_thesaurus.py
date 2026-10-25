"""Build Cryptics thesaurus shards from a local WordNet 3.1 checkout.

The checkout is not committed. This script only reads that directory and
british.json, then writes the shards the site serves.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path
from typing import TypedDict


class Sense(TypedDict):
    pos: str
    gloss: str
    words: list[str]


class Inflected(TypedDict):
    lemma: str
    senses: list[Sense]


Entry = list[Sense] | Inflected

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "website" / "static" / "data" / "cryptics" / "thesaurus"
# One letter of WordNet, glosses trimmed, is about 530KB gzipped for "s".
GZIP_LIMIT = 600 * 1024
POS_LABELS = {
    "n": "noun",
    "v": "verb",
    "a": "adjective",
    "s": "adjective",
    "r": "adverb",
}
INDEX_FILES = ("noun", "verb", "adj", "adv")


class Synset:
    def __init__(self, ss_type: str, words: list[str], gloss: str) -> None:
        self.ss_type = ss_type
        self.words = words
        self.gloss = gloss


def _first_sentence(gloss: str) -> str:
    head, _, _rest = gloss.partition(";")
    sentence = head.strip().strip('"').strip()
    # Long WordNet clauses would push a letter shard over the gzip budget.
    if len(sentence) <= 80:
        return sentence
    clipped = sentence[:80].rsplit(" ", 1)[0].rstrip(" ,;:")
    return clipped if clipped else sentence[:80].rstrip()


def _dedupe(words: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for word in words:
        if word == "" or word in seen:
            continue
        seen.add(word)
        unique.append(word)
    return unique


def _read_lines(path: Path) -> list[str]:
    return path.read_text(encoding="latin-1").splitlines()


def _parse_data_file(path: Path) -> dict[str, Synset]:
    synsets: dict[str, Synset] = {}
    for line in _read_lines(path):
        if line == "" or line.startswith(" "):
            continue
        body, separator, gloss = line.partition("|")
        if separator == "":
            continue
        parts = body.split()
        if len(parts) < 6:
            continue
        offset = parts[0]
        ss_type = parts[2]
        word_count = int(parts[3], 16)
        words: list[str] = []
        cursor = 4
        for _ in range(word_count):
            words.append(parts[cursor].replace("_", " ").lower())
            cursor += 2
        synsets[offset] = Synset(ss_type, _dedupe(words), _first_sentence(gloss.strip()))
    return synsets


def _parse_index_file(path: Path) -> list[tuple[str, list[str]]]:
    entries: list[tuple[str, list[str]]] = []
    for line in _read_lines(path):
        if line == "" or line.startswith(" "):
            continue
        parts = line.split()
        if len(parts) < 6:
            continue
        lemma = parts[0].replace("_", " ").lower()
        synset_count = int(parts[2])
        pointer_count = int(parts[3])
        offset_at = 4 + pointer_count + 2
        offsets = parts[offset_at : offset_at + synset_count]
        if len(offsets) != synset_count:
            continue
        entries.append((lemma, offsets))
    return entries


def _parse_exceptions(path: Path) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    if not path.is_file():
        return pairs
    for line in _read_lines(path):
        if line == "" or line.startswith(" "):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        surface = parts[0].replace("_", " ").lower()
        lemma = parts[1].replace("_", " ").lower()
        pairs.append((surface, lemma))
    return pairs


def _license_text(data_noun: Path) -> str:
    """Copy the WordNet notice from the data-file header, without its line numbers."""
    lines: list[str] = []
    for raw in data_noun.read_text(encoding="latin-1").splitlines():
        if raw[:1].isdigit():
            break
        if raw.strip() == "":
            lines.append("")
            continue
        text = raw.strip()
        parts = text.split(" ", 1)
        if parts[0].isdigit():
            text = parts[1] if len(parts) == 2 else ""
        lines.append(text.rstrip())
    return "\n".join(lines).strip() + "\n"


def _senses_for(synsets: dict[str, Synset], offsets: list[str]) -> list[Sense]:
    senses: list[Sense] = []
    seen: set[str] = set()
    for offset in offsets:
        if offset in seen:
            continue
        seen.add(offset)
        synset = synsets.get(offset)
        if synset is None or len(synset.words) < 2:
            continue
        label = POS_LABELS.get(synset.ss_type)
        if label is None:
            continue
        senses.append({"pos": label, "gloss": synset.gloss, "words": synset.words})
    return senses


def _lemma_senses(keys: dict[str, Entry], lemma: str) -> tuple[str, list[Sense]] | None:
    entry = keys.get(lemma)
    if isinstance(entry, list) and entry != []:
        return lemma, entry
    if isinstance(entry, dict):
        root = entry.get("lemma")
        senses = entry.get("senses")
        if isinstance(root, str) and isinstance(senses, list) and senses != []:
            return root, senses
    return None


def _apply_alias(
    keys: dict[str, Entry],
    alias: str,
    lemma: str,
) -> bool:
    if alias in keys:
        return True
    resolved = _lemma_senses(keys, lemma)
    if resolved is None:
        return False
    root, senses = resolved
    keys[alias] = {"lemma": root, "senses": list(senses)}
    return True


def build(wordnet: Path, output: Path) -> None:
    keys: dict[str, Entry] = {}
    exceptions: list[tuple[str, str]] = []
    for name in INDEX_FILES:
        synsets = _parse_data_file(wordnet / f"data.{name}")
        for lemma, offsets in _parse_index_file(wordnet / f"index.{name}"):
            senses = _senses_for(synsets, offsets)
            if senses == []:
                continue
            current = keys.get(lemma)
            if isinstance(current, list):
                current.extend(senses)
            elif current is None:
                keys[lemma] = senses
        exceptions.extend(_parse_exceptions(wordnet / f"{name}.exc"))
    missed_inflections = 0
    for surface, lemma in exceptions:
        if not _apply_alias(keys, surface, lemma):
            missed_inflections += 1

    british_path = output / "british.json"
    british = json.loads(british_path.read_text(encoding="utf-8"))
    if not isinstance(british, dict):
        raise SystemExit("british.json must be an object")
    for alias, lemma in british.items():
        if not isinstance(alias, str) or not isinstance(lemma, str):
            raise SystemExit("british.json values must be strings")
        if not _apply_alias(keys, alias.lower(), lemma.lower()):
            print(f"British alias {alias} skipped; {lemma} has no senses", file=sys.stderr)

    buckets: dict[str, dict[str, Entry]] = {letter: {} for letter in "abcdefghijklmnopqrstuvwxyz"}
    buckets["other"] = {}
    for key, entry in keys.items():
        first = key[:1]
        bucket = first if first in buckets and first != "other" else "other"
        buckets[bucket][key] = entry

    output.mkdir(parents=True, exist_ok=True)
    (output / "LICENSE").write_text(_license_text(wordnet / "data.noun"), encoding="utf-8")

    largest_name = ""
    largest_gzip = 0
    for name in sorted(buckets):
        ordered = {key: buckets[name][key] for key in sorted(buckets[name])}
        payload = json.dumps(ordered, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        payload += b"\n"
        compressed = len(gzip.compress(payload, compresslevel=9))
        if compressed > GZIP_LIMIT:
            raise SystemExit(f"{name}.json is {compressed} bytes gzipped, over {GZIP_LIMIT}")
        (output / f"{name}.json").write_bytes(payload)
        print(f"{name}.json {len(ordered)} keys, {compressed} bytes gzipped")
        if compressed > largest_gzip:
            largest_gzip = compressed
            largest_name = name

    print(f"{len(keys)} keys")
    print(f"{missed_inflections} inflections had no synonym senses")
    print(f"largest shard {largest_name}.json {largest_gzip} bytes gzipped")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Cryptics thesaurus shards from WordNet 3.1")
    parser.add_argument("--wordnet", type=Path, required=True, help="Path to the WordNet dict directory")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    wordnet = args.wordnet
    if not (wordnet / "data.noun").is_file():
        raise SystemExit(f"No data.noun in {wordnet}")
    build(wordnet, args.output)


if __name__ == "__main__":
    main()
