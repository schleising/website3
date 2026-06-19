#!/usr/bin/env bash
# Poll football-data.org every 4s (same cadence as the backend worker) until Ctrl+C.
#
# Usage (from repo root):
#   ./scripts/football_api_poll.sh
#
# Optional environment variables:
#   FOOTBALL_API_TOKEN_FILE  path to token file (default: backend/src/secrets/football_api_token.txt)
#   DATE_FROM                API dateFrom (default: today UTC)
#   DATE_TO                  API dateTo   (default: tomorrow UTC)
#   SEASON                   season year  (default: 2026)
#   INTERVAL                 seconds between requests (default: 4)
#   SLOW_THRESHOLD           seconds — show verbose trace when total exceeds this (default: 1.0)
#   VERBOSE_ON_SLOW          set to 0 to disable verbose trace on slow/failed requests (default: 1)

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
SLOW_THRESHOLD="${SLOW_THRESHOLD:-1.0}"
VERBOSE_ON_SLOW="${VERBOSE_ON_SLOW:-1}"

URL="https://api.football-data.org/v4/competitions/WC/matches?dateFrom=${DATE_FROM}&dateTo=${DATE_TO}&season=${SEASON}"

CURL_HEADERS=(
  -H "X-Auth-Token: ${TOKEN}"
  -H "X-Api-Version: v4.1"
)

# Pipe-delimited write-out: code|namelookup|connect|appconnect|starttransfer|total|connects
CURL_STATS_FORMAT='%{http_code}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_starttransfer}|%{time_total}|%{num_connects}'

format_timing_line() {
  local stats="$1"
  IFS='|' read -r http_code dns tcp tls ttfb total connects <<< "$stats"
  printf 'total=%ss dns=%ss tcp=%ss tls=%ss ttfb=%ss connects=%s' \
    "$total" "$dns" "$tcp" "$tls" "$ttfb" "$connects"
}

is_slow() {
  local total="$1"
  awk -v total="$total" -v threshold="$SLOW_THRESHOLD" \
    'BEGIN { exit !(total + 0 > threshold + 0) }'
}

show_verbose_trace() {
  local label="$1"
  local verbose_file="$2"

  if [[ "$VERBOSE_ON_SLOW" != "1" || ! -s "$verbose_file" ]]; then
    return 0
  fi

  echo "--- ${label} verbose ---" >&2
  sed 's/^/  /' "$verbose_file" >&2
  echo "--- end verbose ---" >&2
}

trap 'echo; echo "Stopped."; exit 0' INT TERM

echo "Polling every ${INTERVAL}s — press Ctrl+C to stop"
echo "Slow threshold: ${SLOW_THRESHOLD}s (verbose trace from the same request when exceeded)"
echo "Token file: $TOKEN_FILE"
echo "URL: $URL"
echo

while true; do
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  verbose_file="$(mktemp)"

  set +e
  stats="$(curl -sS -o /dev/null -w "$CURL_STATS_FORMAT" \
    --trace-time -v \
    "${CURL_HEADERS[@]}" \
    "$URL" 2>"$verbose_file")"
  curl_exit=$?
  set -e

  if [[ $curl_exit -ne 0 ]]; then
    failure_msg="$(grep -E '^[[:space:]]*\* |curl:' "$verbose_file" | tail -1 || true)"
    if [[ -z "$failure_msg" ]]; then
      failure_msg="curl exit ${curl_exit}"
    fi
    echo "$ts FAILURE ${failure_msg#* }"
    show_verbose_trace "FAILED request" "$verbose_file"
  elif [[ "$stats" == *"|"* ]]; then
    IFS='|' read -r http_code _dns _tcp _tls _ttfb time_total _connects <<< "$stats"
    timing="$(format_timing_line "$stats")"
    if [[ "$http_code" == "200" ]]; then
      echo "$ts SUCCESS HTTP $http_code $timing"
    else
      echo "$ts FAILURE HTTP $http_code $timing"
    fi
    if is_slow "$time_total"; then
      show_verbose_trace "SLOW request (${time_total}s > ${SLOW_THRESHOLD}s)" "$verbose_file"
    fi
  else
    echo "$ts FAILURE unexpected curl output: $stats"
    show_verbose_trace "FAILED request" "$verbose_file"
  fi

  rm -f "$verbose_file"
  sleep "$INTERVAL"
done
