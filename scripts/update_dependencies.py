#!/usr/bin/env python3
"""Upgrade project dependencies and refresh the per-service requirements files.

Git sources in ``[tool.uv.sources]`` that are pinned to a tag are moved to the
latest stable version tag before the lockfile is upgraded. PyPI packages are
upgraded by ``uv lock --upgrade``. Each dependency group that already has a
``<group>/requirements.txt`` is exported again for Docker.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import cast

ROOT = Path(__file__).resolve().parents[1]
PYPROJECT_PATH = ROOT / "pyproject.toml"
GIT_LS_REMOTE_TIMEOUT_SECONDS = 30

_SEMVER = re.compile(
    r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)(?:-(?P<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
_TAG_VALUE = re.compile(r"""(tag\s*=\s*)(['"])([^'"]*)\2""")


class _Args(argparse.Namespace):
    def __init__(self) -> None:
        super().__init__()
        self.dry_run: bool = False


def _parse_args() -> bool:
    parser = argparse.ArgumentParser(
        description="Move git dependencies to their latest version tags, upgrade the uv lock, sync .venv, and export requirements.txt for each service."
    )
    _ = parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show tag updates and commands without changing files or the environment.",
    )
    return parser.parse_args(namespace=_Args()).dry_run


def _string_dict(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    raw = cast(dict[object, object], value)
    mapped: dict[str, object] = {}
    for key, item in raw.items():
        if isinstance(key, str):
            mapped[key] = item
    return mapped


def _find_uv() -> str:
    found = shutil.which("uv")
    if found is not None:
        return found

    local_uv = Path.home() / ".local" / "bin" / "uv"
    if local_uv.is_file():
        return str(local_uv)

    raise SystemExit("uv was not found on PATH or at ~/.local/bin/uv")


def _load_pyproject() -> dict[str, object]:
    with PYPROJECT_PATH.open("rb") as handle:
        loaded = tomllib.load(handle)
    return _string_dict(loaded) or {}


def _git_sources(pyproject: dict[str, object]) -> dict[str, dict[str, str]]:
    tool = _string_dict(pyproject.get("tool"))
    if tool is None:
        return {}
    uv_config = _string_dict(tool.get("uv"))
    if uv_config is None:
        return {}
    sources = _string_dict(uv_config.get("sources"))
    if sources is None:
        return {}

    git_sources: dict[str, dict[str, str]] = {}
    for name, source_value in sources.items():
        source = _string_dict(source_value)
        if source is None:
            continue
        git_url = source.get("git")
        if not isinstance(git_url, str):
            continue
        normalized: dict[str, str] = {"git": git_url}
        for key in ("tag", "branch", "rev"):
            value = source.get(key)
            if isinstance(value, str):
                normalized[key] = value
        git_sources[name] = normalized
    return git_sources


def _dependency_groups(pyproject: dict[str, object]) -> list[str]:
    groups = _string_dict(pyproject.get("dependency-groups"))
    if groups is None:
        return []
    return sorted(groups)


def _repo_url(git_url: str) -> str:
    if git_url.startswith("git+"):
        return git_url.removeprefix("git+")
    return git_url


def _semver_key(tag: str) -> tuple[int, int, int, tuple[tuple[int, int | str], ...]] | None:
    version = tag[1:] if tag.startswith("v") else tag
    match = _SEMVER.fullmatch(version)
    if match is None:
        return None

    identifiers: list[tuple[int, int | str]] = []
    pre = match.group("pre")
    if pre is not None:
        for part in pre.split("."):
            if part.isdigit():
                if len(part) > 1 and part.startswith("0"):
                    return None
                # Numeric identifiers have lower precedence than alphanumeric ones.
                identifiers.append((0, int(part)))
            else:
                identifiers.append((1, part))

    return (
        int(match.group("major")),
        int(match.group("minor")),
        int(match.group("patch")),
        tuple(identifiers),
    )


def _latest_version_tag(tags: list[str]) -> str | None:
    parsed: list[tuple[str, tuple[int, int, int, tuple[tuple[int, int | str], ...]]]] = []
    for tag in tags:
        key = _semver_key(tag)
        if key is not None:
            parsed.append((tag, key))

    stable = [item for item in parsed if not item[1][3]]
    candidates = stable or parsed
    if not candidates:
        return None
    return max(candidates, key=lambda item: item[1])[0]


def _list_remote_tags(repo_url: str) -> list[str]:
    result = subprocess.run(
        ["git", "ls-remote", "--tags", "--refs", repo_url],
        check=False,
        capture_output=True,
        text=True,
        timeout=GIT_LS_REMOTE_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or f"git ls-remote exited {result.returncode}"
        raise SystemExit(f"Could not list tags for {repo_url}: {detail}")

    tags: list[str] = []
    for line in result.stdout.splitlines():
        _sha, separator, ref = line.strip().partition("\t")
        if separator == "" or not ref.startswith("refs/tags/"):
            continue
        tag = ref.removeprefix("refs/tags/")
        if tag != "":
            tags.append(tag)
    return tags


def _latest_tag_updates(sources: dict[str, dict[str, str]]) -> dict[str, tuple[str, str]]:
    updates: dict[str, tuple[str, str]] = {}
    for name, source in sources.items():
        current = source.get("tag")
        if current is None:
            tracked = source.get("branch") or source.get("rev") or "the default branch"
            print(f"{name}: no tag pin; uv will refresh {tracked}")
            continue

        latest = _latest_version_tag(_list_remote_tags(_repo_url(source["git"])))
        if latest is None:
            raise SystemExit(f"{name}: no version tags found at {source['git']}")
        if latest == current:
            print(f"{name}: already at {current}")
            continue
        print(f"{name}: {current} -> {latest}")
        updates[name] = (current, latest)
    return updates


def _replace_source_tag(text: str, package: str, old: str, new: str) -> str:
    lines = text.splitlines(keepends=True)
    header_names = {
        f"[tool.uv.sources.{package}]",
        f'[tool.uv.sources."{package}"]',
    }
    key_pattern = re.compile(
        rf"""^\s*(?:{re.escape(package)}|"{re.escape(package)}")\s*="""
    )
    in_package_table = False
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            in_package_table = stripped in header_names

        if not in_package_table and key_pattern.match(line) is None:
            continue

        match = _TAG_VALUE.search(line)
        if match is None or match.group(3) != old:
            continue
        quote = match.group(2)
        lines[index] = (
            f"{line[: match.start()]}{match.group(1)}{quote}{new}{quote}{line[match.end() :]}"
        )
        return "".join(lines)

    raise SystemExit(f"Could not find tag {old!r} for {package} in {PYPROJECT_PATH}")


def _apply_tag_updates(updates: dict[str, tuple[str, str]], *, dry_run: bool) -> None:
    if not updates:
        return

    text = PYPROJECT_PATH.read_text(encoding="utf-8")
    for package, (old, new) in updates.items():
        text = _replace_source_tag(text, package, old, new)

    if dry_run:
        return

    _ = PYPROJECT_PATH.write_text(text, encoding="utf-8")


def _run(command: list[str], *, dry_run: bool) -> None:
    print("+", " ".join(command), flush=True)
    if dry_run:
        return
    result = subprocess.run(command, cwd=ROOT, check=False)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def _export_groups(uv: str, groups: list[str], *, dry_run: bool) -> None:
    for group in groups:
        requirements = ROOT / group / "requirements.txt"
        if not requirements.is_file():
            continue
        relative_requirements = requirements.relative_to(ROOT).as_posix()
        _run(
            [
                uv,
                "export",
                "--frozen",
                "--only-group",
                group,
                "--no-hashes",
                "--no-annotate",
                "--no-emit-project",
                "--output-file",
                relative_requirements,
            ],
            dry_run=dry_run,
        )


def main() -> None:
    dry_run = _parse_args()
    uv = _find_uv()
    pyproject = _load_pyproject()
    updates = _latest_tag_updates(_git_sources(pyproject))
    _apply_tag_updates(updates, dry_run=dry_run)
    _run([uv, "lock", "--upgrade"], dry_run=dry_run)
    _run([uv, "sync"], dry_run=dry_run)
    _export_groups(uv, _dependency_groups(pyproject), dry_run=dry_run)


if __name__ == "__main__":
    try:
        main()
    except subprocess.TimeoutExpired as exc:
        print("Timed out while listing git tags", file=sys.stderr)
        raise SystemExit(1) from exc
