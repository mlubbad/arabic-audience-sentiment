#!/bin/sh
# One tick of the Mac's standby for the Oracle worker. launchd runs it every
# five minutes (com.skydevelop.sentiment-standby.plist).
#
# The primary worker runs on Oracle Cloud. This Mac keeps its own worker
# service (com.skydevelop.sentiment-worker) installed but disabled, and starts
# it only when the primary has been down for STANDBY_THRESHOLD ticks in a row;
# it stops it again once the primary has been up for as many. Two in a row,
# not one: a single lost probe (Wi-Fi, a sleeping lid, a slow SSH) must not
# flap the service.
#
# Overlap is safe by construction: a job is claimed `for update skip locked`
# under a five-minute lease, so two workers never take the same job, and a
# job held by a dead worker returns to the queue when its lease ends. A wrong
# decision here costs resources, never correctness.
#
# The probe is one SSH call with a key the server restricts to a single
# command (see docs/cloud-worker-deployment.md, "Mac standby"): it reads the
# container's state and nothing else.
#
# Test seams: STANDBY_DIR, STANDBY_PROBE (a shell command printing the probe's
# answer), STANDBY_LAUNCHCTL (a launchctl stand-in), STANDBY_NOTIFY=0.
set -eu

SVC="${STANDBY_DIR:-$HOME/Library/Application Support/sentiment-worker}"
CONF="$SVC/standby.env"
STATE="$SVC/standby.state"
LABEL=com.skydevelop.sentiment-worker
PLIST="${STANDBY_WORKER_PLIST:-$HOME/Library/LaunchAgents/$LABEL.plist}"
THRESHOLD="${STANDBY_THRESHOLD:-2}"
DOMAIN="gui/$(id -u)"

[ -f "$CONF" ] || { echo "no $CONF; nothing to do" >&2; exit 0; }
# ORACLE_HOST (required), ORACLE_USER (default ubuntu), ORACLE_KEY (the probe key).
. "$CONF"
: "${ORACLE_HOST:?set ORACLE_HOST in $CONF}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
lctl() { ${STANDBY_LAUNCHCTL:-launchctl} "$@"; }
notify() {
  [ "${STANDBY_NOTIFY:-1}" = 1 ] || return 0
  command -v osascript >/dev/null 2>&1 || return 0
  osascript -e "display notification \"$1\" with title \"Sentiment worker\"" >/dev/null 2>&1 || true
}

# "up" when the primary's container runs and is not in a restart loop.
probe() {
  if [ -n "${STANDBY_PROBE:-}" ]; then
    answer=$(sh -c "$STANDBY_PROBE" 2>/dev/null || true)
  else
    answer=$(ssh -i "${ORACLE_KEY:-$HOME/.ssh/oracle_standby}" \
      -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
      "${ORACLE_USER:-ubuntu}@$ORACLE_HOST" \
      'docker inspect -f "{{.State.Running}} {{.State.Restarting}}" sentiment-worker' \
      2>/dev/null || true)
  fi
  [ "$answer" = "true false" ] && echo up || echo down
}

local_running() { lctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }

go_active() {
  lctl enable "$DOMAIN/$LABEL" || true
  local_running || lctl bootstrap "$DOMAIN" "$PLIST"
}

# bootout sends SIGTERM; the loop finishes the job in hand, then exits.
# disable keeps launchd from starting it again at the next login.
go_standby() {
  local_running && { lctl bootout "$DOMAIN/$LABEL" || true; }
  lctl disable "$DOMAIN/$LABEL" || true
}

mode=standby fails=0 oks=0
[ -f "$STATE" ] && read -r mode fails oks < "$STATE" || true

if [ "$(probe)" = up ]; then
  fails=0 oks=$((oks + 1))
  if [ "$mode" = active ] && [ "$oks" -ge "$THRESHOLD" ]; then
    go_standby
    mode=standby
    log "primary up for $oks checks: local worker stopped (standby)"
    notify "Oracle worker is back. This Mac is on standby again."
  elif [ "$mode" = standby ] && local_running; then
    # Started by hand or by an update while the primary was healthy.
    go_standby
    log "primary up: stray local worker stopped"
  fi
else
  oks=0 fails=$((fails + 1))
  if [ "$mode" = standby ] && [ "$fails" -ge "$THRESHOLD" ]; then
    go_active
    mode=active
    log "primary down for $fails checks: local worker started (failover)"
    notify "Oracle worker is down. This Mac took over."
  elif [ "$mode" = active ] && ! local_running; then
    go_active
    log "primary still down: local worker restarted"
  fi
fi

printf '%s %s %s\n' "$mode" "$fails" "$oks" > "$STATE"
