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
set -a
. ./.env.local
set +a
: "${WORKER_API_BASE_URL:?set WORKER_API_BASE_URL in .env.local}"
: "${WORKER_CREDENTIAL:?set WORKER_CREDENTIAL in .env.local}"

credentials="$WORKER_CREDENTIAL${WORKER_CREDENTIAL_WS2:+,$WORKER_CREDENTIAL_WS2}"
# The topic classifier's key. Exported only when set: without it the loop runs
# `--topics none` and reports analyse jobs blocked, which is the honest state.
# YOUTUBE_API_KEY is the same bargain for the public-channel path: without it
# a public job ends blocked public_collection_not_configured, and the loop's
# startup line says `public=no` instead of `public=yes`.
export PYTHONPATH=src HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}" WORKER_API_BASE_URL ${GEMINI_API_KEY:+GEMINI_API_KEY} ${YOUTUBE_API_KEY:+YOUTUBE_API_KEY}

exec "${UV_BIN:-$HOME/.local/bin/uv}" --directory workers/python --cache-dir "${UV_CACHE_DIR:-../../.cache/uv}" \
  run --frozen python -m server.loop \
  --credential "$credentials" \
  --model "${SENTIMENT_MODEL:-camelbert-da}" \
  --idle-seconds "${WORKER_IDLE_SECONDS:-60}" \
  --max-idle "${WORKER_MAX_IDLE:-30}"
