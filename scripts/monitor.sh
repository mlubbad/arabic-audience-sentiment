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
#   monitor    The probe's own configuration. A monitor that cannot run must
#              say so as loudly as a failing check (2026-10-16: a crontab
#              entry on the owner's Mac had been refused by macOS privacy
#              protection on every run since it was installed on 2026-09-19).
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
#   freshness  Channels being collected (selected videos, not paused) whose
#              last successful collection is over 48 hours old. Any such
#              channel fails the run. The platform's newest prediction is not
#              the measure: one healthy channel hid 16 stalled ones on
#              2026-10-16 (20261030000000).
#   site       The deployed front-end, when PREVIEW_URL is set; basic auth
#              only when PREVIEW_BASIC_AUTH_USER is.
#
# It runs every 30 minutes from .github/workflows/monitor.yml on a hosted
# runner, away from the Mac that runs the worker: a monitor on the worker's
# machine sleeps and dies with it. There each failing check opens one GitHub
# issue and its recovery closes it (scripts/monitor-alerts.mjs).
#
# Run by hand, alerts are edge-triggered: a state file per check
# ($MONITOR_STATE_DIR, default .cache) records its last level, and
# ALERT_WEBHOOK_URL, when set, fires only on a transition.
#
# Exit codes: 0 healthy · 1 warning · 2 failure.
#
# Configuration comes from the environment, or from .env.local when that
# exists (gitignored). This script prints statuses and counts only — never a
# key, a URL with a token, a customer's data, or a response body that could
# carry one: its output lands in a public repository's workflow log.
set -u
cd "$(dirname "$0")/.."

STATE_FILE="${MONITOR_STATE_DIR:-.cache}/monitor-state"
mkdir -p "$(dirname "$STATE_FILE")"

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
  [ -n "${ALERT_WEBHOOK_URL:-}" ] || return 0
  # A generic JSON text payload: Slack, Discord (via /slack compat) and most
  # relays accept it. The message names the check, never a credential.
  curl -sS --max-time 10 -X POST "$ALERT_WEBHOOK_URL" \
    -H 'content-type: application/json' \
    -d "{\"text\":\"$1\"}" >/dev/null 2>&1 || true
}

# --- 0. Configuration ------------------------------------------------------
# MONITOR_ENV_FILE="" reads the environment alone; the tests set it so the
# owner's .env.local can never point them at production.
ENV_FILE="${MONITOR_ENV_FILE-.env.local}"
if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "./$ENV_FILE"
fi
missing=""
need() { [ -n "$2" ] || missing="${missing:+$missing,}$1"; }
need SUPABASE_URL "${SUPABASE_URL:-}"
need SUPABASE_SERVICE_ROLE_KEY "${SUPABASE_SERVICE_ROLE_KEY:-}"
need WORKER_API_BASE_URL "${WORKER_API_BASE_URL:-}"
need WORKER_CREDENTIAL "${WORKER_CREDENTIAL:-}"
if [ -n "$missing" ]; then
  # The names of what is missing, never a value.
  settle monitor fail "not_configured:$missing"
  echo "$(stamp) DONE overall=$overall"
  exit "$worst"
fi
settle monitor ok "configured"

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

# An integer field of a flat JSON object, or nothing.
json_int() {
  printf '%s' "$2" | sed -n "s/.*\"$1\" *: *\([0-9][0-9]*\).*/\1/p"
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

# --- 6. Collection freshness, channel by channel ---------------------------
fresh=$(curl -sS --max-time 40 -X POST \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$SUPABASE_URL/rest/v1/rpc/svc_monitor_channel_freshness" 2>/dev/null)
collected=$(json_int collected "$fresh")
stale=$(json_int stale "$fresh")
never=$(json_int never "$fresh")
case "$collected:$stale:$never" in
  *::*|:*|*:) settle freshness warn "unreadable_counts" ;;
  *)
    if [ "$stale" -gt 0 ]; then
      settle freshness fail "${stale}_of_${collected}_collected_channels_stale_48h_${never}_never_collected"
    else
      settle freshness ok "${collected}_collected_channels_fresh"
    fi
    ;;
esac

# --- 7. Deployed front-end (only when configured) --------------------------
if [ -n "${PREVIEW_URL:-}" ]; then
  if [ -n "${PREVIEW_BASIC_AUTH_USER:-}" ]; then
    code=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' \
      -u "$PREVIEW_BASIC_AUTH_USER:${PREVIEW_BASIC_AUTH_PASSWORD:-}" \
      "$PREVIEW_URL" 2>/dev/null)
  else
    code=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$PREVIEW_URL" 2>/dev/null)
  fi
  case "$code" in
    200) settle site ok "200" ;;
    000) settle site fail "timeout_or_unreachable" ;;
    *)   settle site fail "http_$code" ;;
  esac
fi

echo "$(stamp) DONE overall=$overall"
exit "$worst"
