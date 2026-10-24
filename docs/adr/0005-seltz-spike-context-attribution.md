# 0005. Seltz AI multi-key pool for sentiment spike context attribution
Status: accepted
Date: 2026-10-24

## Context
When an Arabic channel or video shows a sharp shift in audience sentiment (Positive, Negative, or
Mixed) within a specific time window, the dashboard and analyst reports need grounded external
context explaining which public news event or announcement coincided with that window.

Live browser scraping during spike analysis is slow (5 to 15 seconds per query) and rate-limited.
Seltz AI (`https://api.seltz.ai`) serves pre-crawled, date-indexed `news` and `web` documents and
structured `json_schema` RAG answers (`/v1/answer`, `/v1/search`) in under a second per search, with
date range filtering (`from_date`, `to_date`) and 50 requests/second per key.

## Decision
Add `enrichment.seltz_context` (`SeltzSpikeContextAttributor`) in the Python worker:

1. **Multi-key round-robin & failover:** Accept a pool of Seltz API keys (`SELTZ_API_KEYS` or
   `SELTZ_API_KEY` on the worker only, never in `VITE_*`), rotating round-robin across keys and
   failing over automatically on HTTP `402`, `429`, or `5xx`.
2. **Privacy boundary:** Send only the public topic/channel query and UTC date window
   (`from_date`, `to_date`) to Seltz. Never send comment author identities, workspace IDs, or
   tenant metadata.
3. **Failure vs. empty invariant:** An upstream error or invalid JSON schema returns
   `status="failed"` with a stable `error_code` (`seltz_auth_failed`, `seltz_quota_exhausted`,
   `seltz_upstream_error`, `seltz_invalid_json`), never an empty `"succeeded"` attribution.
4. **Mixed as first-class:** `SpikeWindow.dominant_sentiment` accepts `"mixed"` alongside
   `"positive"`, `"negative"`, and `"neutral"`.
5. **Database persistence & UI wiring (`20261121000000_scalability_claim_cache_and_spike_attributions.sql`):**
   - `public.sentiment_spike_attributions` stores dated attributions per `(workspace_id, channel_id, from_date, to_date, dominant_sentiment)` with RLS (`private.has_role(workspace_id)`) and strict CHECK constraints.
   - `SeltzSpikeContextAttributor.attribute_and_persist()` upserts results; `public.list_spike_attributions(p_channel, p_limit)` serves them to `loadSpikeAttributions()` in `apps/web/src/data.ts` (`SpikeAttributionSchema` in `packages/contracts/src/spikeAttributions.ts`) and renders them inside `apps/web/src/dashboard/Timing.tsx`.

## Consequences
- Analysts get citation-backed Arabic explanations for sentiment spikes constrained to the exact
  publication window of the video or comment surge.
- The adapter uses the existing pinned `httpx` dependency and requires no new third-party packages.
