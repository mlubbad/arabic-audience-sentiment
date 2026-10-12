#!/bin/sh
# Put this Mac on standby for the Oracle worker, or take it off.
#
#   scripts/worker-standby-install.sh            install or update the standby
#   scripts/worker-standby-install.sh --remove   remove it; this Mac is primary again
#
# Install only once the Oracle worker is verified running (its log shows
# "loaded CAMeL-Lab/...@b0df630d23e5"): from then on this Mac's worker runs
# only when Oracle has been down for two checks in a row.
#
# Needs ~/Library/Application Support/sentiment-worker/standby.env with
#   ORACLE_HOST=<the VM's public IP>
#   ORACLE_KEY=$HOME/.ssh/oracle_standby
# (the probe key; the runbook says how to restrict it on the server).
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SVC="$HOME/Library/Application Support/sentiment-worker"
WORKER=com.skydevelop.sentiment-worker
STANDBY=com.skydevelop.sentiment-standby
DOMAIN="gui/$(id -u)"
AGENTS="$HOME/Library/LaunchAgents"

if [ "${1:-}" = --remove ]; then
  launchctl bootout "$DOMAIN/$STANDBY" 2>/dev/null || true
  rm -f "$AGENTS/$STANDBY.plist" "$SVC/standby.state"
  launchctl enable "$DOMAIN/$WORKER"
  launchctl print "$DOMAIN/$WORKER" >/dev/null 2>&1 \
    || launchctl bootstrap "$DOMAIN" "$AGENTS/$WORKER.plist"
  echo "standby removed; this Mac's worker runs as primary again"
  exit 0
fi

if [ ! -f "$SVC/standby.env" ]; then
  echo "create $SVC/standby.env first (ORACLE_HOST, ORACLE_KEY); see docs/cloud-worker-deployment.md" >&2
  exit 1
fi

# Bring the worker service's checkout, venv and plist to the current main
# without starting it: from here on the standby agent decides.
WORKER_SERVICE_NO_START=1 sh "$REPO/scripts/worker-service-update.sh"
launchctl disable "$DOMAIN/$WORKER"
printf 'standby 0 0\n' > "$SVC/standby.state"

sed "s|/Users/mlubbad|$HOME|g" "$SVC/checkout/scripts/$STANDBY.plist" > "$AGENTS/$STANDBY.plist"
launchctl bootout "$DOMAIN/$STANDBY" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$AGENTS/$STANDBY.plist"
echo "standby installed: checks every 5 minutes; log: $SVC/standby.log"
