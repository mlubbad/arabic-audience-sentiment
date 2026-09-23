# syntax=docker/dockerfile:1
# ------------------------------------------------------------------------------
# Production Cloud Worker for Arabic Audience Sentiment Analysis
# Multi-stage, non-root, self-contained container with pre-cached model weights.
# ------------------------------------------------------------------------------

# Stage 1: Dependency resolution and virtual environment creation
FROM python:3.12-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9 AS builder

WORKDIR /app

# Install uv by pinned digest for fast, reproducible dependency syncing
COPY --from=ghcr.io/astral-sh/uv:0.5.21@sha256:87d729f94c87d0aade077260d07d899848f027b7ef37e734dca711c7ceffd3cf /uv /bin/uv

# Copy dependency specifications
COPY pyproject.toml uv.lock ./

# Install production dependencies including CPU torch and transformers
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN uv sync --frozen --no-dev --group inference

# Copy application code into builder to pre-download model weights into cache
COPY src/ /app/src/
ENV PYTHONPATH=/app/src \
    HF_HOME=/app/hf_cache

# Pre-fetch pinned CAMeLBERT-da model so the runtime is fully offline and boots in <2 seconds
RUN /app/.venv/bin/python -c "from sentiment.transformer import load_pinned; load_pinned('camelbert-da')"

# ------------------------------------------------------------------------------
# Stage 2: Minimal runtime image
# ------------------------------------------------------------------------------
FROM python:3.12-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9 AS runner

WORKDIR /app

# Security: Create non-root system group and user
RUN groupadd -r worker && useradd -r -g worker -d /app -s /sbin/nologin worker

# Copy virtual environment and pre-cached Hugging Face models from builder
COPY --from=builder --chown=worker:worker /app/.venv /app/.venv
COPY --from=builder --chown=worker:worker /app/hf_cache /app/hf_cache
COPY --chown=worker:worker src/ /app/src/

# Configure production environment
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    HF_HOME=/app/hf_cache \
    HF_HUB_OFFLINE=1 \
    SENTIMENT_TORCH_THREADS=1 \
    SENTIMENT_MODEL=camelbert-da

USER worker

# Entrypoint executes the continuous background worker loop
ENTRYPOINT ["python", "-m", "server.loop"]
