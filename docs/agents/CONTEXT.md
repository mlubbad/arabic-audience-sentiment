# Project context for agents (read this instead of the long docs)

Kept under 200 lines on purpose. If something here is wrong, say so on your work order;
Claude fixes this file.

## 1. What the product is

Arabic-first, multi-tenant SaaS. A creator or organisation connects channels (YouTube,
Facebook pages and Instagram accounts via OAuth, or public YouTube/X/TikTok/Telegram/
Facebook/Instagram channels). A worker collects comments, classifies
sentiment (Positive, Negative, Neutral, Mixed) and topics, and a dashboard shows them with
filters, human corrections and CSV export. Plans and billing run through Paddle. The UI is RTL
Arabic first, with English.

## 2. How a comment flows

```
Python worker      workers/python/src/server/loop.py → runner.py
  collectors/*       fetch comments (official APIs incl. Meta Graph, or Apify / Bright Data scrapers, Telethon)
  sentiment/*        CAMeLBERT-DA (3-class) or Gemini 2-tier Contextual Hybrid (gemini-3.8-flash + gemini-4-argon)
  topics/*           Gemini (prompt p1) or TypeSafe
  genres/*           GeminiGenreClassifier (video & channel genre taxonomy profile)
  enrichment/*       SeltzSpikeContextAttributor (multi-key Seltz AI spike attribution → sentiment_spike_attributions)
      │  HTTPS, bearer = platform worker credential (never a workspace id)
Edge function      supabase/functions/worker → _shared/worker-gateway.ts
      │  hashes the bearer, routes claim / heartbeat / commit-batch / finish
Postgres           public.* RPC wrappers → private.*_impl (SECURITY DEFINER, search_path='')
      │  commit_batch writes comments + predictions in one transaction, meters usage idempotently
Web app            apps/web/src/data.ts → React Query → dashboard/, competitors/, account/, ops/, admin/
```

Scheduling: pg_cron `sentiment-tick` hourly enqueues due work; the worker polls `claim`. `dashboard-aggregates-drain` runs every minute (`drain_dashboard_aggregates(10)`).

## 3. Where things live

| Path                                      | What                                                                                                                                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/`                           | React 19 + Vite + Chart.js. `data.ts` decides fixture vs live data. `strings/ar.ts`, `strings/en.ts` hold all UI text                                                                                      |
| `apps/web/src/dashboard/`                 | Live dashboard (cached server-side aggregates, keyset comments, `Timing.tsx` spike attributions)                                                                                                           |
| `apps/web/src/competitors/` | Competitor discovery, candidate cards, time-series benchmarking, and CSV/PDF export (`CompetitorsPage.tsx`, `Benchmark.tsx`, `exports.ts`, `PrintReport.tsx`) |
| `apps/web/src/account/`, `ops/`, `admin/` | Workspaces and channels, sync/catalogue/import, platform admin                                                                                                                                             |
| `packages/contracts/src/`                 | Zod schemas. `jobs.ts` = worker↔DB wire contract. `snapshot.ts` = fixture-mode aggregation. `spikeAttributions.ts` = spike context schema                                                                  |
| `supabase/migrations/`                    | 150+ timestamped SQL files, applied in filename order, immutable                                                                                                                                           |
| `supabase/schema/current.sql`             | Generated live schema snapshot (`node scripts/snapshot-schema.mjs`)                                                                                                                                        |
| `supabase/functions/`                     | Deno edge functions: `worker`, `oauth-start`, `oauth-callback`, `paddle-*`, `billing-portal`, `channel-lookup`, `admin-users`. Logic lives in `_shared/`                                                   |
| `supabase/tests/`                         | Vitest + PGlite (real Postgres in-process): real migrations, real RLS                                                                                                                                      |
| `workers/python/src/`                     | `collectors/`, `sentiment/` (`transformer.py`, `gemini_batch.py`), `topics/`, `genres/`, `enrichment/` (`seltz_context.py`), `server/` (`loop.py`, `runner.py`, `analysis.py`, `gateway.py`), `labelling/` |
| `workers/python/tests/`                   | pytest; `fixtures/golden_batch.json` is produced by the Python client and consumed by the TS seam test (regenerate, never hand-edit)                                                                       |
| `tests/e2e/`                              | Playwright against the fixture shell (no live services)                                                                                                                                                    |
| `scripts/`                                | secret scan, deploy, migration apply, `run_gemini_batch_reclassify.py`, ops helpers                                                                                                                        |
| `graphify-out/`                           | Queryable knowledge graph (`GRAPH_REPORT.md`, `graph.json`, `graph.html`, `wiki/index.md`). Run `graphify query "<q>"` before broad grep, and `graphify update .` after edits                              |
| `docs/engineering/PLAYBOOK.md`            | Team rules and code standards (binding)                                                                                                                                                                    |
| `docs/adr/`                               | Architecture decisions (`0001`–`0007`)                                                                                                                                                                     |

## 4. Commands (Node 22.14+ <23, npm 10, Python 3.12 via uv)

| Command                                                             | Use                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm ci` and `uv --directory workers/python sync --frozen`          | install                                                                                                |
| `npx vitest run path/to/file.test.ts`                               | one web/contracts/DB test file (fast; use while working)                                               |
| `uv --directory workers/python run --frozen pytest tests/test_x.py` | one worker test file                                                                                   |
| `npm run lint` / `npm run typecheck` / `npm run format:check`       | static checks                                                                                          |
| `npm test`                                                          | web + contracts unit tests                                                                             |
| `npm run test:db`                                                   | all PGlite database tests (~75 s)                                                                      |
| `npm run worker:test` / `npm run worker:lint`                       | worker tests / Ruff                                                                                    |
| `npm run check`                                                     | everything except e2e (~3–5 min). Run once before asking for review                                    |
| `npm run test:e2e`                                                  | Playwright (~3 min). Starts its own dev server; refuses one already running                            |
| `git config core.hooksPath .githooks`                               | one-time: enable the pre-commit hook (prettier/eslint/ruff on staged files; bypass with `--no-verify`) |

Traps:

- `npm run dev -- --port X` is silently ignored. Playwright uses `E2E_PORT`.
- `getByLabel` is a substring match; selects carry an explicit `aria-label`.
- PGlite is single-connection, so it can't prove concurrency.

## 5. Invariants (breaking one is a defect even if tests pass)

1. **Tenant from credential, never from the request.** No endpoint trusts a workspace id it is sent without a membership check in SQL.
2. **Failure never becomes success.** A collection that fails or stops early is `partial`, `failed` or `blocked`, never `succeeded`/`exhausted` with zero rows.
3. **Unknown is never zero.** Missing likes, views, counts → `null`/`None`, shown as "—". A missing date is `null` with precision `unknown`, never now().
4. **A malformed batch is refused whole**, never filtered.
5. **Metering happens where the spend happens**, idempotently.
6. **Commit is progress, not completion.** `commit_batch` checkpoints; `worker_finish` sets the terminal status.
7. **Mixed is a first-class label.** Skipped, failed and stale predictions never become Neutral and never enter the denominator.
8. **Migrations are immutable.** Add a new file.
9. **A test that can't fail isn't coverage.** Prove each new test goes red on the old code.
10. **Test the seam, not the stand-in.** Bugs live at boundaries (TS↔SQL argument names, Python↔JS number types).

## 6. Finding the current definition of a SQL function

Until the schema snapshot (work order G-5) lands, the **last** `create or replace function` in
filename order is the live one. Many functions are redefined 5–11 times (`commit_batch`,
`claim_job`, `dashboard_*_impl`). Find the live body with:

```
git grep -niE "create (or replace )?function private\.commit_batch\(" -- supabase/migrations | tail -1
```

Case is inconsistent (some migrations use uppercase), so keep `-i`.

## 7. Environments

- There is one Supabase project, and it is production. There is no staging project yet.
- A merge to `main` deploys it all (`deploy.yml`): migrations, then every edge function older than
  main (ADR 0004, `scripts/deploy-functions.mjs`), then the web app. Nobody deploys functions by
  hand to keep up any more. Each function's `verify_jwt` is declared in `supabase/config.toml`.
- `app.sky-develop.net` is the live site.
- Tests never touch either: PGlite and Playwright fixtures only.

## 8. Known-stale documents (don't trust without checking the code)

- `docs/coordination/ACTIVE.md` and `docs/coordination/README.md`: the old multi-agent protocol.
- `docs/agent-reports/*`.
- `docs/implementation-plan.md` (M0 era).
- `docs/deployment.md`: parts predate the edge functions and the worker, and it says the site is password-protected. Its "What is not part of this pipeline" section is current.
- `docs/superpowers/plans/*`: write-once plans; the features shipped.
- `docs/ONBOARDING.md` §2 test counts (from 2026-09-14).
- `README.md` "Status" line.

## 9. Open work

The status board is GitHub issue #7. Security and correctness findings from the 2026-09-26
review are being fixed as work orders WO-1 … WO-6. Don't "fix" something that belongs to
another open work order; mention it on your issue instead.

## 10. Latest architecture & scalability updates (2026-10-24) — mandatory context for all agents

1. **Two-Tier Contextual Gemini Sentiment & Dual-Write (`ADR-0006`, `workers/python/src/sentiment/gemini_batch.py`, `server/analysis.py`, `server/runner.py`):**
   - **Live Worker Stream (`--model gemini`):** `runner.py` passes `video` and `channel` context to `analyse()`, which calls `GeminiContextualSentimentAdapter.predict_contextual()`. This reconstructs reply threads (`parent_text`, `sibling_texts`) and infers channel domain (`news_media`, `entertainment_comedy_kids`, `religion_preaching`, `education_tech`), running Tier-1 `gemini-3.8-flash` (`thinking_level="low"`, Flex tier) with inline escalation (`confidence < 0.75`) to Tier-2 `gemini-4-argon` (`thinking_level="high"`).
   - **Batch Reclassification (`scripts/run_gemini_batch_reclassify.py` → `GeminiBatchReclassifier`):** Runs asynchronous `:batchGenerateContent` (50% cost discount) with full video transcripts and `apply_dual_write()` into `public.sentiment_predictions` AND `public.comment_reviews` (with Arabic `reason_ar` when correcting prior labels).
2. **Seltz AI Spike Context Attribution (`ADR-0005`, `workers/python/src/enrichment/seltz_context.py`, `supabase/migrations/20261125000000_scalability_claim_cache_and_spike_attributions.sql`, `packages/contracts/src/spikeAttributions.ts`, `apps/web/src/dashboard/Timing.tsx`):**
   - `SeltzSpikeContextAttributor` rotates round-robin across `SELTZ_API_KEYS` with automatic failover (`401/402/429/5xx`) over `/v1/search` and `/v1/answer`.
   - Persists attributions via `attribute_and_persist()` into `public.sentiment_spike_attributions` (RLS-protected), read via RPC `public.list_spike_attributions(p_channel, p_limit)` (`loadSpikeAttributions` in `data.ts`) and rendered in `Timing.tsx`.
3. **Database Scalability & Lock-Free Worker Heartbeats (`20261125000000_scalability_claim_cache_and_spike_attributions.sql`):**
   - `private.touch_worker_seen(token_hash)` and `private.claim_job(w, job_types)` insert new workspaces with `ON CONFLICT DO NOTHING` and only update `public.worker_seen` rows older than `30 seconds` using `FOR UPDATE SKIP LOCKED` (eliminating multi-worker row-lock contention during long batches).
   - `private.claim_job` replaces per-row correlated subqueries in `ORDER BY` with `running_by_ws` CTE + `LEFT JOIN public.channels` + partial index `jobs_running_workspace_lease_idx`.
   - `private.drain_dashboard_aggregates` defaults to `max_rows = 10` (up from `2`) backed by partial index `dashboard_aggregates_cache_pending_idx`.
   - `20261127000000_worker_rpc_timeouts_and_touch_throttle.sql`: `private.worker_video_counts` only updates `comments.last_seen_at` on unchanged videos when `last_seen_at < now() - interval '7 days'`, and worker RPCs (`svc_worker_video_counts`, `svc_worker_commit_batch`, `svc_worker_commit_catalogue`, `svc_worker_due_videos`, `svc_worker_known_videos`, `svc_worker_claim`, `svc_worker_commit_topics`, `svc_worker_commit_genres`) carry explicit `25s`–`30s` `statement_timeout`.
4. **Graphify Knowledge Graph (`graphify-out/`):**
   - Before grepping raw files for architectural questions, run `graphify query "<question>"`, `graphify explain "<symbol>"`, or `graphify path "A" "B"` against `graphify-out/graph.json`. After modifying code or migrations, run `node scripts/snapshot-schema.mjs` (if SQL changed) and `graphify update .`.
5. **Channel Indexing & Comment Ingestion Hardening (`ADR-0007`, `20261126000000_channel_indexing_and_comment_ingestion_hardening.sql`):**
   - **Reply-Aware Delta Sync & 500-Comment Sub-Batching (`workers/python/src/collectors/youtube_api.py`):** `YouTubeAPI.batches()` harvests inline and overflow replies newer than `since` even on older top-level threads in the current page, filters `/comments` replies by `since`, and splits any page exceeding `500` comments into sub-batches so `private.commit_batch` never raises `batch_too_large`.
   - **Zero-Quota YouTube RSS, WebSub Push, HTML Handle Resolution & Captions (`youtube_api.py`, `server/runner.py`, `channel-lookup/index.ts`):** `YouTubeAPI` provides `rss_recent_videos()`, `subscribe_websub()`, `resolve_channel_id_zero_quota()`, and `fetch_video_transcript()` at 0 Data API quota cost; `run_discover()` commits catalogues `> 500` videos in 500-video chunks with heartbeats; `channel-lookup` tries `channels.list(forHandle=@...)` (1 unit) before `search.list` (100 units) for handle-shaped queries.
   - **Strict Timestamp Precision, Checkpointed Scrapers, Flex Auto-Fallback & Set-Based SQL Adoption (`apify.py`, `brightdata.py`, `telegram_collector.py`, `x_collector.py`, `tiktok_collector.py`, `topics/gemini.py`, `genres/gemini.py`, `20261122000000`):** Missing dates across all collectors stay `None` with `timestamp_precision="unknown"` (never `datetime.now()`), fixing Telegram `invalid_batch` refusals; `XCollector` and `TikTokCollector` support checkpointed offset pagination; `GeminiTopicClassifier` and `GeminiGenreClassifier` support `service_tier="flex"` with automatic fallback to standard tier; `private.worker_video_counts` refreshes `comments.last_seen_at` on unchanged videos; `private.worker_known_videos` retains the top 200 items of each `kind`; and `private.adopt_channel_content` performs bulk set-based comment adoption across all 6 platforms.
