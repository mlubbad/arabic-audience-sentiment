#!/bin/sh
# The restarter that actually restarts.
#
# `run-worker.sh` starts the worker under `flock -n`. Cron runs it every five
# minutes, and the comment in that file calls cron "a restarter". It is not:
# `flock -n` exits immediately when the lock is held, so while a worker is
# *alive* nothing happens — which is correct — and while a worker is *stuck*
# nothing happens either, which is not. A hung process holds the lock for as
# long as it hangs, and the five-minute tick becomes a five-minute no-op.
#
# That is what happened on 2026-09-14. A worker held its lease, stopped
# heartbeating, and sat there. Twenty-five minutes later the job's lease had
# been dead for twenty-four of them and no replacement had started, because the
# replacement could not get the lock.
#
# This script is the missing half. Run it from cron *alongside* run-worker.sh:
#
#   */5 * * * * $HOME/sentiment-worker/run-worker.sh
#   */2 * * * * $HOME/sentiment-worker/watchdog.sh
#
# It never starts a worker. It only ends one that has stopped working, and
# leaves the next tick of run-worker.sh to start a clean replacement — which it
# can, because the lock is then free.
set -eu

DIR="$HOME/sentiment-worker"
LOG="$DIR/worker.log"
OWN_LOG="$DIR/watchdog.log"
# Longer than the lease (5 minutes) plus the slowest plausible batch. A worker
# that has said nothing for this long is not slow; it is gone.
SILENT_SECONDS=${SILENT_SECONDS:-600}

say() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$OWN_LOG"; }

# Nothing to police if nothing is running. Matching on the module path rather
# than on "python" avoids taking down an unrelated interpreter.
PIDS=$(pgrep -f "python -m server.loop" 2>/dev/null || true)
[ -z "$PIDS" ] && exit 0

# The log is the liveness signal, because it is the one thing a working worker
# touches continuously and a hung one does not. Using the process's own CPU
# time would miss a worker spinning in a retry loop; using the job lease would
# require database credentials this script deliberately does not have.
[ -f "$LOG" ] || exit 0

NOW=$(date +%s)
# BSD and GNU stat disagree on flags; try both rather than assume the host.
MTIME=$(stat -f %m "$LOG" 2>/dev/null || stat -c %Y "$LOG" 2>/dev/null || echo "$NOW")
SILENT=$((NOW - MTIME))

[ "$SILENT" -lt "$SILENT_SECONDS" ] && exit 0

say "worker silent for ${SILENT}s (limit ${SILENT_SECONDS}s); pids: ${PIDS}"

# TERM first, so a worker in the middle of a commit can finish it — the loop
# installs a handler that finishes the job in hand and then leaves. Only a
# process that ignores that gets KILL.
for p in $PIDS; do kill -TERM "$p" 2>/dev/null || true; done
sleep 20

STILL=$(pgrep -f "python -m server.loop" 2>/dev/null || true)
if [ -n "$STILL" ]; then
  say "did not stop on TERM; sending KILL to ${STILL}"
  for p in $STILL; do kill -KILL "$p" 2>/dev/null || true; done
fi

# Deliberately not starting one here. run-worker.sh owns starting, the lock is
# free now, and its next tick is at most five minutes away. Two things that can
# both start a worker is how you end up with two workers.
say "lock released; run-worker.sh will start a replacement on its next tick"
