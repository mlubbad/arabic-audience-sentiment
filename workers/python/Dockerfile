# syntax=docker/dockerfile:1
# ------------------------------------------------------------------------------
# Production Cloud Worker for Arabic Audience Sentiment Analysis
# Non-root, self-contained container for continuous 24/7 collection & analysis.
# ------------------------------------------------------------------------------
FROM python:3.14-slim@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d

WORKDIR /app

# Install uv by pinned digest for fast, reproducible dependency syncing
COPY --from=ghcr.io/astral-sh/uv:0.5.21@sha256:87d729f94c87d0aade077260d07d899848f027b7ef37e734dca711c7ceffd3cf /uv /bin/uv

# Security: Create non-root system group and user
RUN groupadd -r worker && useradd -r -g worker -d /app -s /sbin/nologin worker && chown -R worker:worker /app

# Copy dependency specifications and application source
COPY --chown=worker:worker pyproject.toml uv.lock ./
COPY --chown=worker:worker src/ /app/src/

USER worker

# Configure production environment
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    SENTIMENT_MODEL=none \
    TOPIC_MODEL=gemini \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Sync production dependencies (httpx, telethon for MTProto ingestion)
RUN uv sync --frozen --no-dev

# Execute the continuous background worker loop
CMD ["/app/.venv/bin/python", "-m", "server.loop"]
