#!/usr/bin/env python3
"""Probe Sonarr and Radarr APIs for Converter cover-art design support.

Validates the assumptions in design/Converter-Cover-Art.md:
  - API auth via X-Api-Key
  - Library items expose poster images
  - Title / path lookup can find TV shows and films
  - Poster URLs are fetchable for local caching

Keys are read from website/secrets/arr-keys.txt by default:

  sonarr_key=...
  radarr_key=...

Default API bases (LAN — public *.schleising.net hosts are nginx-gated):
  Sonarr: http://steveds920:8989
  Radarr: http://steveds920:7878

Usage:
  python3 scripts/probe_sonarr_cover_art.py
  python3 scripts/probe_sonarr_cover_art.py --only sonarr
  python3 scripts/probe_sonarr_cover_art.py --only radarr
  python3 scripts/probe_sonarr_cover_art.py --tv-title "100 Foot Wave"
  python3 scripts/probe_sonarr_cover_art.py --film-title "1917"
  python3 scripts/probe_sonarr_cover_art.py \\
      --tv-path "/Media/TV/100 Foot Wave/Season 1/100 Foot Wave - S01E01.mkv" \\
      --film-path "/Media/Films/1917 (2019)/1917 (2019) Bluray-1080p.mkv" \\
      --download-dir /tmp/arr-posters

Stdlib only — no third-party packages required.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal


DEFAULT_SONARR_URL = "http://steveds920:8989"
DEFAULT_RADARR_URL = "http://steveds920:7878"
DEFAULT_KEYS_FILE = (
    Path(__file__).resolve().parents[1] / "website" / "secrets" / "arr-keys.txt"
)
QUALITY_TOKENS = re.compile(
    r"\b(bluray|blu-ray|webdl|web-dl|webrip|hdtv|remux|x264|x265|h264|h265|"
    r"hevc|aac|dts|truehd|atmos|hdr|dv|2160p|1080p|720p|480p)\b",
    re.IGNORECASE,
)
YEAR_IN_PARENS = re.compile(r"^(?P<title>.+?)\s*\((?P<year>19\d{2}|20\d{2})\)$")


ArrKind = Literal["sonarr", "radarr"]


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str


@dataclass
class ProbeReport:
    app_name: str
    checks: list[CheckResult] = field(default_factory=list)

    def add(self, name: str, ok: bool, detail: str) -> None:
        self.checks.append(CheckResult(name=name, ok=ok, detail=detail))

    @property
    def passed(self) -> bool:
        return bool(self.checks) and all(check.ok for check in self.checks)

    def print(self) -> None:
        print()
        print(f"=== {self.app_name} cover-art probe ===")
        for check in self.checks:
            mark = "PASS" if check.ok else "FAIL"
            print(f"[{mark}] {check.name}: {check.detail}")
        print()
        if self.passed:
            print(f"Verdict: {self.app_name} can support the Converter cover-art design.")
        else:
            print(f"Verdict: {self.app_name} — one or more checks failed.")


class ArrClient:
    def __init__(self, app_name: str, base_url: str, api_key: str, timeout: float = 20.0) -> None:
        self.app_name = app_name
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def request_json(self, path: str, query: dict[str, str] | None = None) -> Any:
        url = self._url(path, query)
        request = urllib.request.Request(
            url,
            headers={
                "X-Api-Key": self.api_key,
                "Accept": "application/json",
                "User-Agent": "website3-arr-cover-art-probe/1.1",
            },
            method="GET",
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            body = response.read()
            content_type = response.headers.get("Content-Type", "")
            if not body:
                raise ValueError(f"Empty response from {url} (Content-Type={content_type!r})")
            try:
                return json.loads(body.decode("utf-8"))
            except json.JSONDecodeError as exc:
                preview = body[:120].decode("utf-8", errors="replace").replace("\n", " ")
                raise ValueError(
                    f"Non-JSON response from {url} "
                    f"(HTTP {response.status}, Content-Type={content_type!r}): {preview!r}"
                ) from exc

    def request_bytes(self, url: str, use_api_key_header: bool = False) -> tuple[int, str, bytes]:
        headers = {
            "Accept": "*/*",
            "User-Agent": "website3-arr-cover-art-probe/1.1",
        }
        if use_api_key_header:
            headers["X-Api-Key"] = self.api_key

        request = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            content_type = response.headers.get("Content-Type", "")
            return response.status, content_type, response.read()

    def _url(self, path: str, query: dict[str, str] | None = None) -> str:
        if not path.startswith("/"):
            path = "/" + path
        url = f"{self.base_url}{path}"
        if query:
            url = f"{url}?{urllib.parse.urlencode(query)}"
        return url


def load_arr_keys(keys_file: Path) -> dict[str, str]:
    """Load key=value pairs from website/secrets/arr-keys.txt."""
    if not keys_file.exists():
        raise FileNotFoundError(f"Arr keys file not found: {keys_file}")

    keys: dict[str, str] = {}
    for line_number, raw_line in enumerate(keys_file.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if line == "" or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"Invalid keys line {line_number} in {keys_file}: expected key=value")
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip("'").strip('"')
        if name == "" or value == "":
            raise ValueError(f"Invalid keys line {line_number} in {keys_file}: empty name or value")
        keys[name] = value

    return keys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Probe Sonarr and Radarr APIs for Converter cover art.",
    )
    parser.add_argument(
        "--only",
        choices=("both", "sonarr", "radarr"),
        default="both",
        help="Which Arr apps to probe (default: both)",
    )
    parser.add_argument(
        "--sonarr-url",
        default=DEFAULT_SONARR_URL,
        help=f"Sonarr base URL (default {DEFAULT_SONARR_URL})",
    )
    parser.add_argument(
        "--radarr-url",
        default=DEFAULT_RADARR_URL,
        help=f"Radarr base URL (default {DEFAULT_RADARR_URL})",
    )
    parser.add_argument(
        "--keys-file",
        type=Path,
        default=DEFAULT_KEYS_FILE,
        help=f"Arr keys file (default {DEFAULT_KEYS_FILE})",
    )
    parser.add_argument(
        "--tv-title",
        action="append",
        default=[],
        help="TV series title for Sonarr (repeatable).",
    )
    parser.add_argument(
        "--film-title",
        action="append",
        default=[],
        help="Film title for Radarr (repeatable).",
    )
    parser.add_argument(
        "--tv-path",
        action="append",
        default=[],
        help="Full /Media/TV/... path; show title is parsed from it (repeatable).",
    )
    parser.add_argument(
        "--film-path",
        action="append",
        default=[],
        help="Full /Media/Films/... path; film title/year are parsed from it (repeatable).",
    )
    parser.add_argument(
        "--download-dir",
        type=Path,
        default=None,
        help="If set, save the first downloaded poster per app under this directory.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=20.0,
        help="HTTP timeout in seconds (default: 20)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=5,
        help="Max library samples to print per app (default: 5)",
    )
    return parser.parse_args()


def extract_show_title_from_path(path: str) -> str | None:
    """Mirror the design-doc TV parse: /Media/TV/{Show}/Season N/..."""
    normalized = path.replace("\\", "/")
    match = re.search(r"/TV/([^/]+)/", normalized, flags=re.IGNORECASE)
    if match is None:
        return None
    return urllib.parse.unquote(match.group(1)).strip()


def extract_film_identity_from_path(path: str) -> tuple[str, int | None] | None:
    """Mirror the design-doc film parse: /Media/Films/{Title (Year)}/..."""
    normalized = path.replace("\\", "/")
    match = re.search(r"/Films/([^/]+)/", normalized, flags=re.IGNORECASE)
    if match is None:
        return None

    folder = urllib.parse.unquote(match.group(1)).strip()
    year_match = YEAR_IN_PARENS.match(folder)
    if year_match is not None:
        return year_match.group("title").strip(), int(year_match.group("year"))
    return folder, None


def normalize_title(value: str) -> str:
    cleaned = QUALITY_TOKENS.sub(" ", value)
    cleaned = re.sub(r"[._]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().lower()
    return cleaned


def find_poster(images: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    if not images:
        return None
    posters = [image for image in images if str(image.get("coverType", "")).lower() == "poster"]
    if posters:
        return posters[0]
    return images[0] if images else None


def absolute_arr_url(base_url: str, maybe_relative: str | None) -> str | None:
    if not maybe_relative:
        return None
    if maybe_relative.startswith("http://") or maybe_relative.startswith("https://"):
        return maybe_relative
    return urllib.parse.urljoin(base_url.rstrip("/") + "/", maybe_relative.lstrip("/"))


def find_item_by_title(
    items: list[dict[str, Any]],
    title: str,
    year: int | None = None,
) -> dict[str, Any] | None:
    needle = normalize_title(title)
    exact: list[dict[str, Any]] = []
    partial: list[dict[str, Any]] = []

    for item in items:
        candidates = [
            item.get("title"),
            item.get("sortTitle"),
            item.get("cleanTitle"),
        ]
        item_year = item.get("year")
        for candidate in candidates:
            if not candidate:
                continue
            normalized = normalize_title(str(candidate))
            year_ok = year is None or item_year is None or int(item_year) == int(year)
            if not year_ok:
                continue
            if normalized == needle:
                exact.append(item)
                break
            if needle in normalized or normalized in needle:
                partial.append(item)
                break

    if exact:
        return exact[0]
    if partial:
        return partial[0]
    return None


def item_summary(item: dict[str, Any]) -> str:
    title = item.get("title", "?")
    year = item.get("year", "?")
    item_id = item.get("id", "?")
    path = item.get("path", "")
    return f"{title} ({year}) id={item_id} path={path}"


def poster_coverage(items: list[dict[str, Any]]) -> tuple[int, int, float]:
    with_poster = 0
    with_remote = 0
    for item in items:
        poster = find_poster(item.get("images"))
        if poster is None:
            continue
        with_poster += 1
        if poster.get("remoteUrl") or poster.get("url"):
            with_remote += 1
    total = len(items)
    coverage = (with_poster / total * 100.0) if total else 0.0
    return with_poster, with_remote, coverage


def choose_download_url(
    client: ArrClient,
    poster: dict[str, Any],
) -> tuple[str | None, bool]:
    remote = poster.get("remoteUrl")
    if remote:
        return str(remote), False

    local = absolute_arr_url(client.base_url, poster.get("url"))
    if local is None:
        return None, False

    separator = "&" if "?" in local else "?"
    return f"{local}{separator}apikey={urllib.parse.quote(client.api_key)}", True


def probe_arr_app(
    *,
    kind: ArrKind,
    client: ArrClient,
    library_path: str,
    lookup_path: str,
    titles: list[tuple[str, int | None]],
    limit: int,
    download_dir: Path | None,
) -> ProbeReport:
    report = ProbeReport(app_name=client.app_name)
    noun = "series" if kind == "sonarr" else "movies"
    id_field = "tvdbId" if kind == "sonarr" else "tmdbId"

    print()
    print(f"Target: {client.app_name} @ {client.base_url}")

    try:
        status = client.request_json("/api/v3/system/status")
        version = status.get("version", "unknown") if isinstance(status, dict) else "unknown"
        app_name = status.get("appName", client.app_name) if isinstance(status, dict) else client.app_name
        report.add("system/status", True, f"{app_name} version {version}")
    except urllib.error.HTTPError as exc:
        report.add("system/status", False, f"HTTP {exc.code}: {exc.reason}")
        return report
    except Exception as exc:  # noqa: BLE001
        report.add("system/status", False, f"{type(exc).__name__}: {exc}")
        return report

    try:
        library = client.request_json(library_path)
        if not isinstance(library, list):
            raise TypeError(f"Expected list, got {type(library).__name__}")
    except Exception as exc:  # noqa: BLE001
        report.add(f"{noun} library", False, f"{type(exc).__name__}: {exc}")
        return report

    with_poster, with_remote, coverage = poster_coverage(library)
    total = len(library)
    report.add(
        f"{noun} library",
        total > 0 and with_poster > 0,
        f"{total} {noun}; {with_poster} with poster ({coverage:.0f}%); "
        f"{with_remote} with url/remoteUrl",
    )

    print()
    print(f"Sample {client.app_name} library (up to {limit}):")
    for item in library[: max(limit, 0)]:
        poster = find_poster(item.get("images"))
        remote = poster.get("remoteUrl") if poster else None
        local = poster.get("url") if poster else None
        print(f"  - {item_summary(item)}")
        print(f"      poster remoteUrl={remote!r}")
        print(f"      poster url={local!r}")

    if not titles:
        if kind == "sonarr":
            titles = [("100 Foot Wave", None), ("Severance", None), ("The Expanse", None)]
        else:
            titles = [("1917", 2019), ("Arrival", 2016), ("Dune", 2021)]

    first_downloadable_url: str | None = None
    first_downloadable_uses_header = False

    for title, year in titles:
        label = f"{title}" if year is None else f"{title} ({year})"
        print()
        print(f"Resolving {client.app_name} title: {label!r}")

        matched = find_item_by_title(library, title, year=year)
        if matched is None:
            report.add(f"library-match:{label}", False, f"No close title match in {library_path}")
        else:
            report.add(f"library-match:{label}", True, item_summary(matched))
            poster = find_poster(matched.get("images"))
            if poster is None:
                report.add(f"library-poster:{label}", False, "Matched item has no poster image")
            else:
                remote = poster.get("remoteUrl")
                local = absolute_arr_url(client.base_url, poster.get("url"))
                report.add(
                    f"library-poster:{label}",
                    bool(remote or local),
                    f"remoteUrl={remote!r} url={local!r}",
                )
                if first_downloadable_url is None:
                    first_downloadable_url, first_downloadable_uses_header = choose_download_url(
                        client, poster
                    )

        try:
            lookup_term = title if year is None else f"{title} {year}"
            lookup = client.request_json(lookup_path, {"term": lookup_term})
            if not isinstance(lookup, list):
                raise TypeError(f"Expected list, got {type(lookup).__name__}")
            if not lookup:
                report.add(f"lookup:{label}", False, "Lookup returned no results")
                continue

            top = lookup[0]
            poster = find_poster(top.get("images"))
            remote = poster.get("remoteUrl") if poster else None
            report.add(
                f"lookup:{label}",
                True,
                f"top={top.get('title')!r} year={top.get('year')!r} "
                f"{id_field}={top.get(id_field)!r} poster_remote={remote!r}",
            )
            if remote and first_downloadable_url is None:
                first_downloadable_url = str(remote)
                first_downloadable_uses_header = False
        except Exception as exc:  # noqa: BLE001
            report.add(f"lookup:{label}", False, f"{type(exc).__name__}: {exc}")

    if first_downloadable_url is None:
        report.add("poster-download", False, "No poster URL available to fetch")
    else:
        try:
            status_code, content_type, payload = client.request_bytes(
                first_downloadable_url,
                use_api_key_header=first_downloadable_uses_header,
            )
            is_image = content_type.startswith("image/") or payload[:3] == b"\xff\xd8\xff"
            ok = status_code == 200 and is_image and len(payload) > 0
            report.add(
                "poster-download",
                ok,
                f"HTTP {status_code}, type={content_type!r}, bytes={len(payload)}, "
                f"url={first_downloadable_url}",
            )
            if ok and download_dir is not None:
                download_dir.mkdir(parents=True, exist_ok=True)
                suffix = ".jpg"
                if "png" in content_type:
                    suffix = ".png"
                elif "webp" in content_type:
                    suffix = ".webp"
                out_path = download_dir / f"{kind}-poster{suffix}"
                out_path.write_bytes(payload)
                report.add("poster-save", True, f"Wrote {out_path} ({len(payload)} bytes)")
        except Exception as exc:  # noqa: BLE001
            report.add("poster-download", False, f"{type(exc).__name__}: {exc}")

    return report


def collect_sonarr_titles(args: argparse.Namespace, report: ProbeReport) -> list[tuple[str, int | None]]:
    titles: list[tuple[str, int | None]] = [(title, None) for title in args.tv_title]
    for media_path in args.tv_path:
        parsed = extract_show_title_from_path(media_path)
        if parsed is None:
            report.add(
                f"path-parse:{media_path}",
                False,
                "Could not extract show title (expected /TV/{Show}/...)",
            )
        else:
            report.add(f"path-parse:{media_path}", True, f"parsed title={parsed!r}")
            titles.append((parsed, None))
    return titles


def collect_radarr_titles(args: argparse.Namespace, report: ProbeReport) -> list[tuple[str, int | None]]:
    titles: list[tuple[str, int | None]] = [(title, None) for title in args.film_title]
    for media_path in args.film_path:
        parsed = extract_film_identity_from_path(media_path)
        if parsed is None:
            report.add(
                f"path-parse:{media_path}",
                False,
                "Could not extract film title (expected /Films/{Title (Year)}/...)",
            )
        else:
            title, year = parsed
            year_label = "none" if year is None else str(year)
            report.add(
                f"path-parse:{media_path}",
                True,
                f"parsed title={title!r} year={year_label}",
            )
            titles.append((title, year))
    return titles


def run_probe(args: argparse.Namespace) -> int:
    try:
        arr_keys = load_arr_keys(args.keys_file)
    except (FileNotFoundError, ValueError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    reports: list[ProbeReport] = []
    run_sonarr = args.only in ("both", "sonarr")
    run_radarr = args.only in ("both", "radarr")

    if run_sonarr:
        sonarr_key = arr_keys.get("sonarr_key", "").strip()
        pre = ProbeReport(app_name="Sonarr")
        if sonarr_key == "":
            pre.add("api-key", False, f"Missing sonarr_key in {args.keys_file}")
            reports.append(pre)
        else:
            pre.add("api-key", True, f"Loaded sonarr_key from {args.keys_file}")
            titles = collect_sonarr_titles(args, pre)
            client = ArrClient("Sonarr", args.sonarr_url, sonarr_key, timeout=args.timeout)
            report = probe_arr_app(
                kind="sonarr",
                client=client,
                library_path="/api/v3/series",
                lookup_path="/api/v3/series/lookup",
                titles=titles,
                limit=args.limit,
                download_dir=args.download_dir,
            )
            report.checks = pre.checks + report.checks
            reports.append(report)

    if run_radarr:
        radarr_key = arr_keys.get("radarr_key", "").strip()
        pre = ProbeReport(app_name="Radarr")
        if radarr_key == "":
            pre.add("api-key", False, f"Missing radarr_key in {args.keys_file}")
            reports.append(pre)
        else:
            pre.add("api-key", True, f"Loaded radarr_key from {args.keys_file}")
            titles = collect_radarr_titles(args, pre)
            client = ArrClient("Radarr", args.radarr_url, radarr_key, timeout=args.timeout)
            report = probe_arr_app(
                kind="radarr",
                client=client,
                library_path="/api/v3/movie",
                lookup_path="/api/v3/movie/lookup",
                titles=titles,
                limit=args.limit,
                download_dir=args.download_dir,
            )
            report.checks = pre.checks + report.checks
            reports.append(report)

    overall_ok = True
    for report in reports:
        report.print()
        overall_ok = overall_ok and report.passed

    print("Design mapping:")
    print("  - Auth via X-Api-Key header on LAN Arr hosts")
    print("  - Sonarr: /api/v3/series (+ lookup) for TV posters")
    print("  - Radarr: /api/v3/movie (+ lookup) for film posters")
    print("  - Prefer images[coverType=poster].remoteUrl for local cache downloads")
    print("  - Hot path should use local cache; do not call Arr on every WS ping")

    if overall_ok:
        print()
        print("Overall verdict: Sonarr and Radarr support the Converter cover-art design.")
        return 0

    print()
    print("Overall verdict: One or more Arr probes failed.")
    return 2


def main() -> int:
    args = parse_args()
    try:
        return run_probe(args)
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
