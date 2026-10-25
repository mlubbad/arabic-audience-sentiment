# 0008. Eleven-point competitor intelligence matrix and SWOT battlecard engine

Status: accepted
Date: 2026-10-25

## Context

Previously, the competitor page (`apps/web/src/competitors/`) only surfaced basic channel discovery suggestions (`competitor_suggestions`) and a 5-KPI numerical line chart (`competitor_benchmark`: subscribers, subscriber change, views, views per video, videos per week). It lacked qualitative and strategic content intelligence — specifically:

1. How a competitor connects platforms and which platform is primary.
2. Audience capacity diagnosis (`high_trust_high_frequency`, `volume_diluted`, `dormant_brand_opportunity`, `balanced_growth`) and a two-week anti-shock gradual publishing pacing schedule so creators do not trigger algorithmic reach drops when adjusting cadence.
3. Dominant content format (`video`, `short`, `stream`, `carousel`, `post`, `mixed`), customer-journey funnel stage (`awareness`, `consideration`, `engagement`, `decision`), and the 3-step funnel outflanking play (`Problem -> Self-serve Tip -> Product Bridge`).
4. Topic coverage vs uncovered audience topic gaps (`topic_gaps`), tone of voice (`formal`, `semi_formal`, `casual`, `irreverent`, `bilingual_friendly`, `bilingual_premium`), CTA & conversion path, and an evidence-backed SWOT battlecard (`strengths`, `weaknesses`, `opportunity_gap`, `threat_level`).

## Decision

1. **Database layer (`supabase/migrations/20261130000000_eleven_point_competitor_intelligence.sql`):**
   - Introduce `public.competitor_intelligence_profiles` (RLS-protected) to persist AI-enriched and analyst-curated qualitative attributes per candidate.
   - Add `public.upsert_competitor_intelligence_profile(p_channel, p_candidate_external_id, p_profile)` for workspace owners and analysts.
   - Add `public.competitor_intelligence_matrix(p_channel, p_days)` which joins `channels`, `channel_stats_daily`, `videos`, `sentiment_predictions`, `competitor_candidates`, `competitor_decisions`, `competitor_stats_daily`, and `competitor_intelligence_profiles` to compute a complete 11-point matrix, SWOT battlecards, and a two-week gradual pacing schedule in one query.
2. **Worker enrichment (`workers/python/src/enrichment/competitor_intel.py`):**
   - Provide `CompetitorIntelligenceAnalyzer` using Gemini 3.1 Flash Lite (`serviceTier="flex"` with automatic standard-tier retry) backed by `analyze_competitor_deterministic()` so every competitor card is populated with evidence-backed SWOT and funnel analysis even when external LLM credits are unavailable.
3. **Web UI & exports (`apps/web/src/competitors/CompetitorIntelligence.tsx`, `exports.ts`, `PrintReport.tsx`):**
   - Render the two-week gradual pacing plan, the 11-point comparison matrix (own channel vs competitors), and interactive SWOT battlecards with inline qualitative editing, plus 23-column CSV export (`intelligenceCsv`) and print/PDF report integration.

## Consequences

- Every workspace with competitor candidates immediately gets a complete 11-point content strategy teardown, SWOT battlecard, and gradual publishing cadence plan without manual data entry.
- Analysts and workspace owners can refine qualitative fields (`funnel_stage`, `tone_of_voice`, `dominant_format`, `cta_pattern`, `opportunity_gap`) in place, persisted under tenant RLS.
