#!/bin/sh
# Move the worker service to the current main and restart it.
#
# The service runs from a detached checkout outside ~/Documents (launchd
# agents are kept out of it by macOS). This script is the only way that
# checkout changes: it is never edited by hand and never has a branch.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SVC="$HOME/Library/Application Support/sentiment-worker"
CO="$SVC/checkout"
LABEL=com.skydevelop.sentiment-worker
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$SVC"
if [ -d "$CO/.git" ] || [ -f "$CO/.git" ]; then
  git -C "$REPO" worktree prune
  git -C "$CO" checkout --detach "$(git -C "$REPO" rev-parse HEAD)"
else
  git -C "$REPO" worktree add --detach "$CO" HEAD
fi
# The credentials travel by copy: a symlink into ~/Documents would be refused
# by the same rule that keeps the agent out of it.
cp "$REPO/.env.local" "$CO/.env.local"
# The model runtime is a dependency group kept out of the default install; the
# service is the one process that loads it.
UV_CACHE_DIR="$SVC/uv-cache" "${UV_BIN:-$HOME/.local/bin/uv}" --directory "$CO/workers/python" sync --frozen --group inference >/dev/null

# The repo plist hard-codes the operator's home — launchd expands no
# variables — so the install rewrites it to the account running this script.
# On the operator's own account the rewrite is a no-op; run anywhere else it
# produces a working plist instead of an EX_CONFIG crash loop (witnessed
# 2026-09-19: an install on a second account looped because every path
# pointed at a home that does not exist there).
sed "s|/Users/mlubbad|$HOME|g" "$CO/scripts/$LABEL.plist" > "$PLIST"
# bootout is a no-op error when the agent is not loaded; the restart is the point.
# It sends SIGTERM, and the loop finishes the job in hand before it exits — a
# bootstrap issued while the old run is still leaving fails with "Input/output
# error", so wait for the service to be gone first (ExitTimeOut is 600 s).
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
i=0
while launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 620 ] && { echo "the old run did not exit" >&2; exit 1; }
  sleep 1
done
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "service at $(git -C "$CO" rev-parse --short HEAD); log: $SVC/service.log"
launchctl print "gui/$(id -u)/$LABEL" | grep -E "state =|pid =" || true
