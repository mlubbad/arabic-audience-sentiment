#!/bin/sh
# Keeps one worker alive. Started by cron every five minutes; flock makes that
# a no-op while one is already running, so cron is a restarter and never a
# second worker competing for the same queue.
#
# The loop exits by itself after a stretch of empty cycles. Long-lived Python
# on a shared host accumulates memory, and a scheduled clean start is simpler
# than diagnosing that months from now.
set -eu
cd "$HOME/sentiment-worker"
set -a
. ./.env
set +a
# torch sizes its thread pool from the host's core count, which exceeds what a
# shared account may create. One thread; it does not change the output.
export OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
export TOKENIZERS_PARALLELISM=false
export PYTHONPATH=src
# Keep the log readable rather than unbounded.
if [ -f worker.log ] && [ "$(wc -c < worker.log)" -gt 5242880 ]; then
  tail -c 1048576 worker.log > worker.log.tmp && mv worker.log.tmp worker.log
fi
exec flock -n "$HOME/sentiment-worker/worker.lock" \
  "$HOME/sentiment-venv/bin/python" -m server.loop \
  --model camelbert-da --videos 50 --idle-seconds 60 --max-idle 15 \
  >> "$HOME/sentiment-worker/worker.log" 2>&1
