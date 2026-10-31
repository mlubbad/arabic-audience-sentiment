# syntax=docker/dockerfile:1
# ------------------------------------------------------------------------------
# The analysis worker: polls the worker Edge Function, collects, classifies with
# the pinned CAMeLBERT checkpoint, and reports back. Non-root, one process.
#
# What this image was missing until 2026-10-12, and why each line below exists:
# - It ran SENTIMENT_MODEL=none and synced without the `inference` group, so a
#   deployed container collected but never classified a comment.
# - It used python:3.14 while the project requires ==3.12.*, leaving uv to fetch
#   an interpreter at build time. The base is now the same 3.12.10 CI runs.
# - uv 0.5.21 predates the lock file's format; it is now CI's 0.11.11.
#
# Built for linux/arm64 (Oracle Cloud Ampere A1) and linux/amd64. On arm64 the
# torch wheel is CPU-only by construction; on amd64 it carries CUDA libraries
# that this CPU worker never loads (a larger image, nothing more).
# `.github/workflows/worker-image.yml` builds it on an arm64 runner and runs the
# model inside it on every change to the worker.
# ------------------------------------------------------------------------------
FROM python:3.12.16-slim@sha256:8523d6abeb48ceae0b7240d30c5808fc26cb79c1a635bacdf19cf3baecfbec07

WORKDIR /app

# uv, pinned by digest to the version CI uses (setup-uv `version: 0.11.11`).
COPY --from=ghcr.io/astral-sh/uv:0.11.11@sha256:798712e57f879c5393777cbda2bb309b29fcdeb0532129d4b1c3125c5385975a /uv /bin/uv

RUN groupadd -r worker && useradd -r -g worker -d /app -s /sbin/nologin worker \
    && mkdir -p /app/.cache/huggingface \
    && chown -R worker:worker /app

COPY --chown=worker:worker pyproject.toml uv.lock ./
COPY --chown=worker:worker src/ /app/src/

USER worker

# HF_HOME is a volume in docker-compose.yml, so the ~500 MB checkpoint is
# downloaded once, not on every container restart (the loop exits after
# WORKER_MAX_IDLE empty cycles by design and the restart policy brings it back).
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    HF_HOME=/app/.cache/huggingface \
    SENTIMENT_MODEL=camelbert-da \
    TOPIC_MODEL=gemini \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

# The runtime plus the `inference` group (transformers, torch): without it the
# worker can only run with SENTIMENT_MODEL=none. --frozen: exactly uv.lock.
RUN uv sync --frozen --no-dev --group inference

CMD ["/app/.venv/bin/python", "-m", "server.loop"]
