#!/usr/bin/env zsh
# Watch football-data.org match statuses every 10s and alert on flips
# (e.g. IN_PLAY <-> TIMED/SCHEDULED, or any status that reverses).
#
# Usage (from repo root):
#   ./scripts/football_status_flip_watch.zsh
#
# Optional environment variables:
#   FOOTBALL_API_TOKEN_FILE   path to token file (default: backend/src/secrets/football_api_token.txt)
#   COMPETITION              PL or WC (default: PL)
#   DATE_FROM                API dateFrom (default: today UTC)
#   DATE_TO                  API dateTo   (default: DATE_FROM for PL; tomorrow UTC for WC)
#   SEASON                   season year for WC (default: 2026)
#   INTERVAL                 seconds between requests (default: 10)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_FILE="${FOOTBALL_API_TOKEN_FILE:-$ROOT/backend/src/secrets/football_api_token.txt}"

if [[ ! -f "$TOKEN_FILE" ]]; then
  print -u2 "Token file not found: $TOKEN_FILE"
  exit 1
fi

TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
if [[ -z "$TOKEN" ]]; then
  print -u2 "Token file is empty: $TOKEN_FILE"
  exit 1
fi

COMPETITION="${COMPETITION:-PL}"
INTERVAL="${INTERVAL:-10}"
SEASON="${SEASON:-2026}"
DATE_FROM="${DATE_FROM:-$(date -u +%Y-%m-%d)}"

if [[ -n "${DATE_TO:-}" ]]; then
  :
elif [[ "$COMPETITION" == "PL" ]]; then
  DATE_TO="$DATE_FROM"
elif date -u -v+1d +%Y-%m-%d >/dev/null 2>&1; then
  DATE_TO="$(date -u -v+1d +%Y-%m-%d)"
else
  DATE_TO="$(date -u -d tomorrow +%Y-%m-%d)"
fi

case "$COMPETITION" in
  WC)
    URL="https://api.football-data.org/v4/competitions/WC/matches?dateFrom=${DATE_FROM}&dateTo=${DATE_TO}&season=${SEASON}"
    ;;
  PL)
    URL="https://api.football-data.org/v4/competitions/PL/matches?dateFrom=${DATE_FROM}&dateTo=${DATE_TO}"
    ;;
  *)
    print -u2 "COMPETITION must be PL or WC (got: $COMPETITION)"
    exit 1
    ;;
esac

# match_id -> last seen API status
typeset -A LAST_STATUS
# match_id -> space-separated status history (for flip detection)
typeset -A STATUS_HISTORY
# match_id -> "Home vs Away" label
typeset -A MATCH_LABEL

FLIP_COUNT=0
CHANGE_COUNT=0
POLL_COUNT=0

# Display labels used by the site (Not Started / In Play) alongside API enums.
display_status() {
  case "$1" in
    SCHEDULED|TIMED|AWARDED) print "Not Started ($1)" ;;
    IN_PLAY) print "In Play ($1)" ;;
    PAUSED) print "Paused ($1)" ;;
    FINISHED) print "Finished ($1)" ;;
    SUSPENDED) print "Suspended ($1)" ;;
    POSTPONED) print "Postponed ($1)" ;;
    CANCELLED) print "Cancelled ($1)" ;;
    *) print "$1" ;;
  esac
}

# True if status is a "not started" bucket for flip messaging.
is_not_started() {
  case "$1" in
    SCHEDULED|TIMED|AWARDED) return 0 ;;
    *) return 1 ;;
  esac
}

is_in_play() {
  [[ "$1" == "IN_PLAY" ]]
}

extract_matches() {
  # Prints one line per match: id|status|home|away|score
  local body_file="$1"
  python3 - "$body_file" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)

matches = payload.get("matches")
if not isinstance(matches, list):
    raise SystemExit(0)

def team_name(match: dict, side: str) -> str:
    team = match.get(f"{side}Team") or {}
    return (team.get("shortName") or team.get("name") or "?").replace("|", "/")

def format_score(match: dict) -> str:
    score = match.get("score") or {}
    full_time = score.get("fullTime") or {}
    home = full_time.get("home")
    away = full_time.get("away")
    if home is None or away is None:
        return "-"
    return f"{home}-{away}"

for match in matches:
    if not isinstance(match, dict):
        continue
    match_id = match.get("id")
    status = match.get("status") or "?"
    if match_id is None:
        continue
    home = team_name(match, "home")
    away = team_name(match, "away")
    score = format_score(match)
    print(f"{match_id}|{status}|{home}|{away}|{score}")
PY
}

trap 'print; print "Stopped after ${POLL_COUNT} polls — ${CHANGE_COUNT} status change(s), ${FLIP_COUNT} flip(s)."; exit 0' INT TERM

print "Watching match status flips every ${INTERVAL}s — press Ctrl+C to stop"
print "Competition: $COMPETITION"
print "Token file: $TOKEN_FILE"
print "URL: $URL"
print

while true; do
  (( POLL_COUNT += 1 )) || true
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  body_file="$(mktemp)"
  http_code=""

  set +e
  http_code="$(
    curl -sS -o "$body_file" -w '%{http_code}' \
      --connect-timeout 5 --max-time 10 \
      -H "X-Auth-Token: ${TOKEN}" \
      -H "X-Api-Version: v4.1" \
      "$URL"
  )"
  curl_exit=$?
  set -e

  if [[ $curl_exit -ne 0 ]]; then
    print -u2 "$ts ERROR curl exit ${curl_exit}"
    rm -f "$body_file"
    sleep "$INTERVAL"
    continue
  fi

  if [[ "$http_code" != "200" ]]; then
    print -u2 "$ts ERROR HTTP ${http_code}"
    rm -f "$body_file"
    sleep "$INTERVAL"
    continue
  fi

  poll_changes=0
  poll_flips=0
  match_lines=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && match_lines+=("$line")
  done < <(extract_matches "$body_file")
  rm -f "$body_file"

  print "$ts  matches=${#match_lines}  flips_total=${FLIP_COUNT}"

  for line in "${match_lines[@]}"; do
    # Avoid `status` — it is a read-only special in zsh (alias for $?).
    IFS='|' read -r match_id match_status home away score <<< "$line"
    label="${home} ${score} ${away}"
    MATCH_LABEL[$match_id]="$label"
    prev="${LAST_STATUS[$match_id]:-}"
    status_disp="$(display_status "$match_status")"
    note=""

    if [[ -z "$prev" ]]; then
      LAST_STATUS[$match_id]="$match_status"
      STATUS_HISTORY[$match_id]="$match_status"
      print "  ${status_disp}  ${label}"
      continue
    fi

    if [[ "$match_status" == "$prev" ]]; then
      print "  ${status_disp}  ${label}"
      continue
    fi

    (( poll_changes += 1 )) || true
    (( CHANGE_COUNT += 1 )) || true
    LAST_STATUS[$match_id]="$match_status"

    hist="${STATUS_HISTORY[$match_id]}"
    STATUS_HISTORY[$match_id]="${hist} ${match_status}"

    # Flip = new status already appeared earlier in this match's history
    # (e.g. TIMED -> IN_PLAY -> TIMED, or any A -> B -> A).
    flipped=0
    for seen in ${=hist}; do
      if [[ "$seen" == "$match_status" ]]; then
        flipped=1
        break
      fi
    done

    prev_disp="$(display_status "$prev")"

    if [[ $flipped -eq 1 ]]; then
      (( poll_flips += 1 )) || true
      (( FLIP_COUNT += 1 )) || true
      note="  *** FLIP *** ${prev_disp} -> ${status_disp}"
      if { is_in_play "$prev" && is_not_started "$match_status"; } || \
         { is_not_started "$prev" && is_in_play "$match_status"; }; then
        note="${note} (In Play <-> Not Started)"
      fi
    else
      note="  *** CHANGE *** ${prev_disp} -> ${status_disp}"
    fi

    print "  ${status_disp}  ${label}${note}"
  done

  print

  sleep "$INTERVAL"
done
