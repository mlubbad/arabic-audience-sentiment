#!/bin/sh
# External health monitor for the SentimentAnalysis control plane.
#
# This is the alarm the database cannot raise for itself. The 2026-09-18/19
# PostgREST wedge answered every request with a 504 for a full day while
# Postgres itself stayed healthy — from inside the database, nothing was
# wrong. Only something outside can see that, so this script probes over the
# same HTTP paths a real worker and a real browser use.
#
# Checks, in order of severity:
#   rest       GET /rest/v1/workspaces — the whole API path (Kong → PostgREST
#              → Postgres), authenticated with the service role.
#   gateway    POST /worker/claim {"types":["__monitor__"]} — the full edge
#              function path including the claim RPC. The type is one no job
#              can ever have, so a healthy system answers 204 and the probe
#              claims nothing, holds no lease, and leaves no trace.
#   leases     Jobs running with a lease expired >10 minutes. The queue
#              recovers these on its own; a persistent count means no worker
#              is polling, which is a different fault with the same smell.
#   failures   Jobs that ended failed or blocked in the last 24 hours.
#   worker     worker_seen freshness — no sighting in 30 minutes means the
#              worker stopped asking (the «متصل» panel shows the same fact).
#   freshness  The newest prediction's age. A quiet channel is healthy; a
#              channel being collected is not. This check is advisory: it
#              warns, it never fails the run.
#   site       The deployed front-end, when PREVIEW_URL and basic-auth
#              credentials are configured.
#
# Alerts are edge-triggered: a state file (.cache/monitor-state) records the
# last status of each check, and a webhook fires only on a transition — one
# alarm when something breaks, one when it recovers, never a stream. Every
# run is logged either way.
#
# Exit codes: 0 healthy · 1 warning · 2 failure (used by cron/launchd).
#
# Cron (every 5 minutes):
#   */5 * * * * cd <repo> && ./scripts/monitor.sh >> .worker-logs/monitor.log 2>&1
#
# Secrets come from .env.local, which is gitignored. This script prints
# statuses and codes only — never a key, a URL with a token, or a response
# body that could carry one.
set -u
cd "$(dirname "$0")/.."

STATE_FILE=".cache/monitor-state"
mkdir -p .cache .worker-logs

if [ ! -f .env.local ]; then
  echo "$(stamp) FAIL monitor no_env_file"
  exit 2
fi
# shellcheck disable=SC1091
. ./.env.local

ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
stamp() { date -u '+%Y-%m-%dT%H:%M:%S%z'; }
# ISO timestamp offset into the past; BSD (macOS) and GNU date both covered.
iso_ago() {
  case "$(date -u -d '1 minute' +%s 2>/dev/null)" in
    ""|*[!0-9]*) date -u -v-"$1" '+%Y-%m-%dT%H:%M:%SZ' ;;       # BSD: -v-10M / -v-24H
    *) date -u -d "-$1" '+%Y-%m-%dT%H:%M:%SZ' ;;                # GNU: -10 minutes / -24 hours
  esac
}

worst=0   # 0 ok, 1 warn, 2 fail
overall="ok"

# Record the check's result, alert on transition, and escalate the run.
settle() {
  name="$1"; level="$2"; detail="$3"
  last=""
  if [ -f "$STATE_FILE.$name" ]; then last="$(cat "$STATE_FILE.$name" 2>/dev/null)"; fi
  echo "$(stamp) $(echo "$level" | tr '[:lower:]' '[:upper:]') $name $detail"
  if [ "$level" != "$last" ]; then
    notify "monitor: $name -> $level ($detail)"
    echo "$level" > "$STATE_FILE.$name"
  fi
  case "$level" in
    fail) worst=2; overall="fail" ;;
    warn) [ "$worst" -lt 1 ] && worst=1; [ "$overall" = "ok" ] && overall="warn" ;;
  esac
}

notify() {
  [ -n "$ALERT_WEBHOOK_URL" ] || return 0
  # A generic JSON text payload: Slack, Discord (via /slack compat) and most
  # relays accept it. The message names the check, never a credential.
  curl -sS --max-time 10 -X POST "$ALERT_WEBHOOK_URL" \
    -H 'content-type: application/json' \
    -d "{\"text\":\"$1\"}" >/dev/null 2>&1 || true
}

# PostgREST count via HEAD: Prefer: count=exact puts the total into
# Content-Range, so no response body (and no jq) is needed.
rest_count() {
  path="$1"
  curl -sS --max-time 15 -o /dev/null -D - \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Prefer: count=exact" \
    "$SUPABASE_URL/rest/v1/$path" 2>/dev/null \
    | grep -i '^content-range:' \
    | sed -n 's|.*/||p' \
    | tr -d '\r'
}

# --- 1. REST path ----------------------------------------------------------
code=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_URL/rest/v1/workspaces?select=id&limit=1" 2>/dev/null)
case "$code" in
  200) settle rest ok "200" ;;
  000) settle rest fail "timeout_or_unreachable" ;;
  *)   settle rest fail "http_$code" ;;
esac

# --- 2. Worker gateway path (claims nothing: the type cannot exist) --------
code=$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' \
  -X POST "${WORKER_API_BASE_URL%/}/claim" \
  -H "Authorization: Bearer $WORKER_CREDENTIAL" \
  -H "Content-Type: application/json" \
  -d '{"types":["__monitor__"]}' 2>/dev/null)
case "$code" in
  204) settle gateway ok "204_no_work" ;;
  200) settle gateway warn "200_claimed_unknown_type_should_not_exist" ;;
  000) settle gateway fail "timeout_or_unreachable" ;;
  *)   settle gateway fail "http_$code" ;;
esac

# --- 3. Leases expired >10 minutes while still running ---------------------
stuck=$(rest_count "jobs?select=id&status=eq.running&lease_expires_at=lt.$(iso_ago 10M)")
case "$stuck" in
  ""|*[!0-9]*) settle leases warn "unreadable_count" ;;
  0)           settle leases ok "none" ;;
  *)           settle leases warn "${stuck}_expired_leases_running" ;;
esac

# --- 4. Failed or blocked jobs in the last 24 hours ------------------------
bad=$(rest_count "jobs?select=id&status=in.(failed,blocked)&not_before=gt.$(iso_ago 24H)")
case "$bad" in
  ""|*[!0-9]*) settle failures warn "unreadable_count" ;;
  0)           settle failures ok "none" ;;
  *)           settle failures fail "${bad}_failed_or_blocked_24h" ;;
esac

# --- 5. Worker sighting ----------------------------------------------------
seen=$(curl -sS --max-time 15 \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_URL/rest/v1/worker_seen?select=last_seen_at&order=last_seen_at.desc&limit=1" 2>/dev/null \
  | sed 's/.*"last_seen_at":"\([^"]*\)".*/\1/')
last_epoch=$(date -u -j -f '%Y-%m-%dT%H:%M:%S' "$(echo "$seen" | cut -c1-19)" +%s 2>/dev/null \
  || date -u -d "$seen" +%s 2>/dev/null)
now_epoch=$(date -u +%s)
case "$last_epoch" in
  ""|*[!0-9]*) settle worker warn "no_sighting" ;;
  *)
    age=$(( (now_epoch - last_epoch) / 60 ))
    if [ "$age" -gt 30 ]; then
      settle worker warn "no_worker_for_${age}m"
    else
      settle worker ok "seen_${age}m_ago"
    fi
    ;;
esac

# --- 6. Newest prediction age (advisory) -----------------------------------
pred=$(curl -sS --max-time 15 \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_URL/rest/v1/sentiment_predictions?select=predicted_at&order=predicted_at.desc&limit=1" 2>/dev/null \
  | sed 's/.*"predicted_at":"\([^"]*\)".*/\1/')
pred_epoch=$(date -u -j -f '%Y-%m-%dT%H:%M:%S' "$(echo "$pred" | cut -c1-19)" +%s 2>/dev/null \
  || date -u -d "$pred" +%s 2>/dev/null)
case "$pred_epoch" in
  ""|*[!0-9]*) settle freshness warn "no_predictions_readable" ;;
  *)
    age_h=$(( (now_epoch - pred_epoch) / 3600 ))
    if [ "$age_h" -gt 48 ]; then
      settle freshness warn "newest_prediction_${age_h}h_old"
    else
      settle freshness ok "newest_${age_h}h_old"
    fi
    ;;
esac

# --- 7. Deployed front-end (only when configured) --------------------------
if [ -n "${PREVIEW_URL:-}" ] && [ -n "${PREVIEW_BASIC_AUTH_USER:-}" ]; then
  code=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' \
    -u "$PREVIEW_BASIC_AUTH_USER:$PREVIEW_BASIC_AUTH_PASSWORD" \
    "$PREVIEW_URL" 2>/dev/null)
  case "$code" in
    200) settle site ok "200" ;;
    000) settle site fail "timeout_or_unreachable" ;;
    *)   settle site fail "http_$code" ;;
  esac
fi

echo "$(stamp) DONE overall=$overall"
exit "$worst"
