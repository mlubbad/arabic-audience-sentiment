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
UV_CACHE_DIR="$SVC/uv-cache" "${UV_BIN:-$HOME/.local/bin/uv}" --directory "$CO/workers/python" sync --frozen >/dev/null

cp "$CO/scripts/$LABEL.plist" "$PLIST"
# bootout is a no-op error when the agent is not loaded; the restart is the point.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "service at $(git -C "$CO" rev-parse --short HEAD); log: $SVC/service.log"
launchctl print "gui/$(id -u)/$LABEL" | grep -E "state =|pid =" || true
