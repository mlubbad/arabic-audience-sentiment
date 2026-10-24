# 0006. Two-tier contextual Gemini sentiment engine, dual-write corrections, and DB scalability hardening

Status: accepted
Date: 2026-10-24

## Context

1. **Context-free live sentiment limitation:** Single-sentence classification (`CAMeLBERT-DA` or bare-string `predict(texts)`) misclassifies Arabic comments that depend on channel domain (`news_media`, `religion_preaching`, `entertainment_comedy_kids`, `education_tech`), video title/transcript, or parent comment context in reply threads (e.g., empathetic `لا حول ولا قوة إلا بالله` on news tragedies or playful slang on entertainment channels).
2. **Database scalability & lock contention under multi-worker load:**
   - `private.touch_worker_seen(token_hash)` updated every row in `public.worker_seen` unconditionally at the start of `worker_commit_batch` and `worker_heartbeat`, holding row locks across all workspaces until transaction end.
   - `private.claim_job(w, job_types)` ran correlated subqueries per candidate row in `ORDER BY`.
   - `private.drain_dashboard_aggregates` defaulted to `max_rows = 2` per minute without a partial index on pending rows.

## Decision

1. **Two-tier contextual Gemini sentiment (`workers/python/src/sentiment/gemini_batch.py`):**
   - **Live Worker Stream (`GeminiContextualSentimentAdapter.predict_contextual`):** `runner.py` and `analysis.py` pass `video` and `channel` metadata alongside `RawComment` batches. `predict_contextual` reconstructs parent and sibling reply context (`parent_text`, `sibling_texts`), infers the channel domain, and executes Tier-1 `gemini-3.8-flash` (`thinking_level="low"`, `service_tier="flex"`) with automatic inline escalation (`confidence < 0.75`) to Tier-2 `gemini-4-argon` (`thinking_level="high"`).
   - **Batch Reclassification & Dual-Write (`GeminiBatchReclassifier` / `scripts/run_gemini_batch_reclassify.py`):** Runs asynchronous `:batchGenerateContent` (50% cost discount) with full video transcripts and `apply_dual_write()` into both `public.sentiment_predictions` and `public.comment_reviews` (with Arabic explanation `reason_ar` whenever a prior label is corrected).
2. **Database scalability hardening (`supabase/migrations/20261125000000_scalability_claim_cache_and_spike_attributions.sql`):**
   - `private.touch_worker_seen` and `private.claim_job` insert new workspaces with `ON CONFLICT DO NOTHING` and only update `public.worker_seen` rows older than `30 seconds` using `FOR UPDATE SKIP LOCKED`.
   - `private.claim_job` replaces correlated `ORDER BY` subqueries with a single `running_by_ws` CTE and `LEFT JOIN public.channels`, backed by partial index `jobs_running_workspace_lease_idx`.
   - `private.drain_dashboard_aggregates` raises default `max_rows` from `2` to `10` per minute, backed by partial index `dashboard_aggregates_cache_pending_idx`.

## Consequences

- Both live worker collection (`--model gemini`) and batch reclassification share the same domain-aware, thread-aware 4-class methodology (`positive`, `negative`, `neutral`, `mixed`).
- Concurrent workers (Oracle Cloud primary + Mac standby) never block each other on `public.worker_seen` locks, and dashboard filter cache drain capacity increases 5x.
