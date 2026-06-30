#!/usr/bin/env bash
# Poll football-data.org every 4s (same cadence as the backend worker) until Ctrl+C.
#
# Usage (from repo root):
#   ./scripts/football_api_poll.sh
#
# Compare with scripts/football_live_poll.py (USE_SESSION True/False).
# Note: each poll spawns a new curl process, so there is no cross-poll connection
# pool like requests.Session — both modes here use a fresh TCP connection each poll.
# USE_CONNECTION_REUSE only toggles curl keep-alive / Connection: close behaviour
# within that single transfer (mainly useful for consistency with curl docs).
#
# Optional environment variables:
#   FOOTBALL_API_TOKEN_FILE   path to token file (default: backend/src/secrets/football_api_token.txt)
#   DATE_FROM                 API dateFrom (default: today UTC)
#   DATE_TO                   API dateTo   (default: tomorrow UTC)
#   SEASON                    season year  (default: 2026)
#   INTERVAL                  seconds between requests (default: 4)
#   USE_CONNECTION_REUSE      1 = curl default; 0 = --no-keepalive + Connection: close (default: 1)
#   VERBOSE_ON_FAILURE        set to 0 to disable verbose trace on connection errors (default: 1)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_FILE="${FOOTBALL_API_TOKEN_FILE:-$ROOT/backend/src/secrets/football_api_token.txt}"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Token file not found: $TOKEN_FILE" >&2
  exit 1
fi

TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
if [[ -z "$TOKEN" ]]; then
  echo "Token file is empty: $TOKEN_FILE" >&2
  exit 1
fi

DATE_FROM="${DATE_FROM:-$(date -u +%Y-%m-%d)}"
if [[ -n "${DATE_TO:-}" ]]; then
  :
elif date -u -v+1d +%Y-%m-%d >/dev/null 2>&1; then
  DATE_TO="$(date -u -v+1d +%Y-%m-%d)"
else
  DATE_TO="$(date -u -d tomorrow +%Y-%m-%d)"
fi

SEASON="${SEASON:-2026}"
INTERVAL="${INTERVAL:-4}"
USE_CONNECTION_REUSE="${USE_CONNECTION_REUSE:-1}"
VERBOSE_ON_FAILURE="${VERBOSE_ON_FAILURE:-1}"

URL="https://api.football-data.org/v4/competitions/WC/matches?dateFrom=${DATE_FROM}&dateTo=${DATE_TO}&season=${SEASON}"

CURL_HEADERS=(
  -H "X-Auth-Token: ${TOKEN}"
  -H "X-Api-Version: v4.1"
)

CURL_TIMEOUT_OPTS=(
  --connect-timeout 5
  --max-time 5
)

# Pipe-delimited write-out: code|namelookup|connect|appconnect|starttransfer|total|connects
CURL_STATS_FORMAT='%{http_code}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_starttransfer}|%{time_total}|%{num_connects}|%{size_download}'

format_elapsed_ms() {
  local stats="$1"
  IFS='|' read -r _http_code _dns _tcp _tls _ttfb total _connects _size <<< "$stats"
  awk -v total="$total" 'BEGIN { printf "%.0f", total * 1000 }'
}

extract_rate_headers() {
  local verbose_file="$1"
  # --trace-time prefixes lines with timestamps, so match the header anywhere on the line.
  grep -Ei '(x-request[^:]*|x-ratelimit[^:]*|retry-after):' "$verbose_file" 2>/dev/null \
    | sed -E 's/^.*<[[:space:]]*//; s/:[[:space:]]*/=/; s/[[:space:]]+$//' \
    | paste -sd ', ' - 2>/dev/null \
    || true
}

count_matches() {
  local body_file="$1"
  python3 - "$body_file" <<'PY' 2>/dev/null || echo "?"
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
matches = payload.get("matches")
print(len(matches) if isinstance(matches, list) else "?")
PY
}

match_status_summary() {
  local body_file="$1"
  python3 - "$body_file" <<'PY' 2>/dev/null || echo "in_play=? statuses=?"
import json
import sys
from collections import Counter

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
matches = payload.get("matches")
if not isinstance(matches, list):
    print("in_play=? statuses=?")
    raise SystemExit(0)

live_statuses = {"IN_PLAY", "PAUSED", "SUSPENDED"}
in_play = sum(
    1 for match in matches
    if isinstance(match, dict) and match.get("status") in live_statuses
)
counts = Counter(
    match.get("status", "?")
    for match in matches
    if isinstance(match, dict)
)
status_bits = ",".join(f"{status}:{count}" for status, count in sorted(counts.items()))
print(f"in_play={in_play} statuses={{{status_bits}}}")
PY
}

print_match_statuses() {
  local body_file="$1"
  python3 - "$body_file" <<'PY' 2>/dev/null || true
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
matches = payload.get("matches")
if not isinstance(matches, list):
    raise SystemExit(0)


def team_name(match: dict, side: str) -> str:
    team = match.get(f"{side}Team") or {}
    return team.get("shortName") or team.get("name") or "?"


def format_score(match: dict) -> str:
    score = match.get("score") or {}
    full_time = score.get("fullTime") or {}
    home = full_time.get("home")
    away = full_time.get("away")
    if home is None or away is None:
        return "-"
    return f"{home}-{away}"


def format_status(match: dict) -> str:
    status = match.get("status") or "?"
    minute = match.get("minute")
    if status in {"IN_PLAY", "PAUSED", "SUSPENDED"} and minute is not None:
        injury = match.get("injuryTime")
        if injury:
            return f"{status} {minute}+{injury}'"
        return f"{status} {minute}'"
    return status


for match in sorted(matches, key=lambda item: item.get("utcDate") or ""):
    if not isinstance(match, dict):
        continue
    home = team_name(match, "home")
    away = team_name(match, "away")
    score = format_score(match)
    stage = match.get("stage") or "?"
    status = format_status(match)
    print(f"  {status:14} {home} {score} {away} ({stage})")
PY
}

show_verbose_trace() {
  local label="$1"
  local verbose_file="$2"

  if [[ ! -s "$verbose_file" ]]; then
    return 0
  fi

  echo "--- ${label} verbose ---" >&2
  sed "s/${TOKEN}/***REDACTED***/g" "$verbose_file" | sed 's/^/  /' >&2
  echo "--- end verbose ---" >&2
}

failure_summary() {
  local verbose_file="$1"
  local curl_exit="$2"

  local line
  line="$(grep -E 'curl: \(|Recv failure|Connection reset|closed connection|timed out|SSL|' "$verbose_file" 2>/dev/null | tail -1 || true)"
  if [[ -n "$line" ]]; then
    echo "${line#*curl: }"
    return 0
  fi

  line="$(grep -E '^[[:space:]]*\* ' "$verbose_file" 2>/dev/null | tail -1 || true)"
  if [[ -n "$line" ]]; then
    echo "${line#* }"
    return 0
  fi

  echo "curl exit ${curl_exit}"
}

trap 'echo; echo "Stopped."; exit 0' INT TERM

echo "Polling every ${INTERVAL}s — press Ctrl+C to stop"
echo "use_connection_reuse=${USE_CONNECTION_REUSE} (each poll is still a new curl process)"
echo "Token file: $TOKEN_FILE"
echo "URL: $URL"
echo

while true; do
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  verbose_file="$(mktemp)"
  body_file="$(mktemp)"

  set +e
  curl_args=(
    -sS -o "$body_file" -w "$CURL_STATS_FORMAT"
    --trace-time -v
    "${CURL_TIMEOUT_OPTS[@]}"
  )
  if [[ "$USE_CONNECTION_REUSE" == "0" ]]; then
    curl_args+=(--no-keepalive -H "Connection: close")
  fi
  curl_args+=("${CURL_HEADERS[@]}" "$URL")
  stats="$(curl "${curl_args[@]}" 2>"$verbose_file")"
  curl_exit=$?
  set -e

  rate_headers="$(extract_rate_headers "$verbose_file")"
  if [[ -z "$rate_headers" ]]; then
    rate_headers="n/a"
  fi

  if [[ $curl_exit -ne 0 ]]; then
    failure_msg="$(failure_summary "$verbose_file" "$curl_exit")"
    elapsed_ms="$(awk -v stats="$stats" -F'|' 'NF >= 6 { printf "%.0f", $6 * 1000; found=1 } END { if (!found) print "?" }')"
    echo "$ts ERROR CONNECTION ERROR after ${elapsed_ms}ms" >&2
    echo "url=$URL" >&2
    echo "use_connection_reuse=${USE_CONNECTION_REUSE}" >&2
    echo "$failure_msg" >&2
    echo "rate_headers=${rate_headers}" >&2
    if [[ "$VERBOSE_ON_FAILURE" == "1" ]]; then
      show_verbose_trace "FAILED request" "$verbose_file"
    fi
    echo >&2
  elif [[ "$stats" == *"|"* ]]; then
    IFS='|' read -r http_code _dns _tcp _tls _ttfb time_total _connects _size <<< "$stats"
    elapsed_ms="$(format_elapsed_ms "$stats")"
    if [[ "$http_code" == "200" ]]; then
      match_count="$(count_matches "$body_file")"
      status_summary="$(match_status_summary "$body_file")"
      echo "$ts SUCCESS HTTP $http_code elapsed=${elapsed_ms}ms matches=${match_count} ${status_summary} rate={${rate_headers}}"
      print_match_statuses "$body_file"
    else
      echo "$ts ERROR HTTP $http_code elapsed=${elapsed_ms}ms rate={${rate_headers}}" >&2
      echo >&2
    fi
  else
    echo "$ts ERROR unexpected curl output: $stats" >&2
    echo >&2
  fi

  rm -f "$verbose_file" "$body_file"
  sleep "$INTERVAL"
done
