#!/bin/sh
# The collection worker as a service: what launchd runs, and restarts.
#
# Reads the same .env.local the deploy script reads (gitignored; the two
# scoped worker credentials live only there and in the database as hashes).
# The loop exits on its own after `--max-idle` empty rounds "for a clean
# restart" — that is the design, not a crash — and launchd's KeepAlive starts
# it again after ThrottleInterval. A real failure looks the same to launchd and
# gets the same answer; the log says which it was.
#
# Runs from its own detached checkout under ~/Library/Application Support:
# macOS keeps launchd agents out of ~/Documents (TCC), so a service cannot
# live in the working checkout. `scripts/worker-service-update.sh` moves that
# checkout to the current main and restarts the agent.
#
# HF_HUB_OFFLINE: on this Mac the pinned CAMeL checkpoint is loaded from
# safetensors re-saved into the local cache (torch 2.2.2 is the last x86_64
# build and transformers refuses torch.load below 2.6; see verification.md,
# 2026-09-15). Harmless anywhere the cache is complete; remove it on a machine
# that should fetch the model.
set -eu
cd "$(dirname "$0")/.."
. ./.env.local
: "${WORKER_API_BASE_URL:?set WORKER_API_BASE_URL in .env.local}"
: "${WORKER_CREDENTIAL:?set WORKER_CREDENTIAL in .env.local}"

credentials="$WORKER_CREDENTIAL${WORKER_CREDENTIAL_WS2:+,$WORKER_CREDENTIAL_WS2}"
export PYTHONPATH=src HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}" WORKER_API_BASE_URL

exec "${UV_BIN:-$HOME/.local/bin/uv}" --directory workers/python --cache-dir "${UV_CACHE_DIR:-../../.cache/uv}" \
  run --frozen python -m server.loop \
  --credential "$credentials" \
  --model "${SENTIMENT_MODEL:-camelbert-da}" \
  --idle-seconds "${WORKER_IDLE_SECONDS:-60}" \
  --max-idle "${WORKER_MAX_IDLE:-30}"
