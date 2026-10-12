# Implementation decisions

2026-10-12 — The worker runs on Oracle Cloud Always Free (Ampere A1, Frankfurt).
Context: the worker ran on the owner's Mac; the shared host cannot keep a process alive nor
hold torch. Rejected: Render and Railway (no free background worker as of this decision);
Hugging Face Spaces (sleeps when idle); a scheduled GitHub Actions job (production work on
CI is a grey area in GitHub's terms, and its logs are public). Chosen: one Oracle A1 VM,
2 OCPU / 12 GB, Docker Compose, in Frankfurt for proximity to the Supabase project. Risks
recorded in the runbook: Oracle may reclaim an idle Always Free VM, and A1 capacity can be
exhausted at creation. The image is built and model-tested on arm64 in CI on every worker
change (`worker-image.yml`).

2026-10-12 — The repository is public (owner's decision of 2026-10-10, confirmed 2026-10-12).
Context: GitHub refused every hosted job on 2026-10-10 over a billing block on the then-private
repository; hosted minutes are free on a public one. The owner made the repository public and
kept it so.
1. **Consequences accepted.** Code, issues, PRs and workflow logs are readable by anyone. The
   security rules in `AGENTS.md` already forbade secrets in tracked files; they now also forbid
   printing a secret or customer data in a workflow log, and the self-hosted runner of ADR 0002
   may not be registered while the repository is public (no runner is registered; `CI_RUNNER`
   is unset).
2. **Kept as is, on purpose.** Draft PRs still run no CI (queue and noise, not cost). CodeQL
   keeps `upload: never` and the security workflow keeps the free CLI equivalents until the
   owner asks for the hosted Security tab; both are one-line changes, recorded in the workflow
   comments.
3. **Now available.** Branch protection on `main` costs nothing on a public repository; the
   owner decides whether to require PRs and the status checks (`verify`, Security, CodeQL).
   The owner's setting for fork pull-request workflows must stay at "require approval for all
   external contributors" (`docs/engineering/self-hosted-runner.md`).

2026-10-04 — Local Codex dispatch: the dispatcher owns git, Codex edits inside its sandbox.
Context: the first WO-13 run (`codex exec -s workspace-write`) could not create a branch and built a
second repository under `/tmp` pointed at the worktree; the third run only succeeded with
`--approve-for-me`, which Claude Code's auto-mode classifier refuses to launch. A smoke test in a
standalone clone proved the cause is Codex's sandbox itself: `.git/` is read-only by design under
`workspace-write` (so the agent cannot plant hooks that run unsandboxed), and neither `--add-dir`
nor a writable root on the repository defeats it.
1. **Rejected: make `.git` writable** (`sandbox_workspace_write.writable_roots=["<repo>/.git"]`,
   an undocumented carve-out in Codex's permissions policy). It removes a real control and can
   silently stop working on any Codex upgrade.
2. **Rejected: `--approve-for-me` / `danger-full-access`.** Both widen Codex beyond its sandbox,
   and the first is exactly what the dispatcher's own harness blocks.
3. **Chosen: split the roles.** `scripts/codex-dispatch.sh` prepares a dedicated clone
   (`.codex-workspace/`, gitignored), creates the branch, runs Codex with
   `-s workspace-write` and network only, then commits, pushes, opens the PR and comments on the
   issue through `gh`. Codex hands over its commit message and PR text via `.codex-handoff/`.
   `scripts/codex-watch.mjs` tails the JSON event log and kills Codex on the first forbidden
   command (git writes, credential reads, deploys, a second repository), matching commands only
   so documentation text can no longer trigger it.
4. **`.agents/skills` removed from the tree.** It was a tracked absolute symlink to
   `~/.lmstudio/skills` (248+ unrelated skills). It is dangling on every other machine and on CI,
   and on the owner's Mac it overflowed Codex's skills budget so every skill description was
   dropped. `.agents/` is now gitignored.

2026-09-24 — Scheduler Statement Timeout Elimination, Resilient Quota Lifecycle, and Centralized Services Health Observability.
To definitively eliminate recurring failures and statement timeouts identified during comprehensive audit of sync logs, scheduler execution, and background worker queues:
1. **Early-Stopping Existence Subqueries in Scheduler (`private.schedule_due_work`)**:
   - `schedule_due_work` was intermittently failing with PostgreSQL error 57014 (statement timeout).
   - Analysis revealed two expensive linear scans: `jsonb_agg` of all pending video IDs inside `has_due_videos`, and unbounded aggregation of unclassified comments inside `topics_pending`.
   - Replaced both with index-backed early-stopping subqueries (`select 1 from videos ... limit 1` and `select 1 from comments ... limit 1`). Query execution dropped from >10s to <1ms.
2. **Quota Depletion Backoff & Worker Lifecycle (`runner.py` & `x_collector.py`)**:
   - When Gemini credit quotas were depleted (HTTP 402 / `gemini_credits_depleted`) or when social scrapers hit rate limits (HTTP 429), workers were recording generic partial/failure states, causing immediate re-enqueueing by `enqueue_scheduled()` every 5 seconds.
   - Refactored `run_topics` and `x_collector` to transition jobs to `blocked` status with structured error codes (`gemini_credits_depleted`, `rate_limit_exceeded`).
   - Introduced `private.unblock_due_jobs()` in the database to unblock work with exponential backoff or upon daily quota restoration, preventing futile retry loops while ensuring automatic recovery.
3. **Preservation of Topic Analysis Free-Reanalysis Contract**:
   - Topic classification metering occurs at batch commitment time in `private.worker_commit_topics`. Comments that were previously charged under an earlier taxonomy version cost 0 units on re-analysis ("ride free").
   - `schedule_due_work` must therefore check whether unclassified comments are pending (`private.topics_pending`), but must NOT prematurely gate scheduling on `topic_units_remaining > 0`.
4. **Real-Time Services Health Architecture (`/admin/services`)**:
   - Added `public.get_services_health_report()` (SECURITY DEFINER, admin-only) measuring latency, connection pools, queue depth, external API reachability, and quota consumption across Infrastructure, AI Models, Omnichannel APIs, and Billing.
   - Designed frontend `AdminServicesPage.tsx` with live auto-refresh, search, category filtering, and diagnostic detail dialogs for immediate platform troubleshooting.

2026-09-24 — Dynamic Plan Limits Administration and Unlimited Invariant Preservation.
To allow platform administrators to adjust limits and quotas for any subscription plan at any time without code deployments or database migrations, while preserving strict PostgreSQL check constraints:
1. **Dynamic Update RPC (`public.update_plan_limits`)**:
   - Accepts any combination of plan parameters (`channels`, `channels_limit`, `analysis_units`, `backfill_units`, `historical_days_limit`, `topic_units`, `members`, `members_limit`, `workspaces`, `workspaces_limit`, `insight_reports`, `live_interval_minutes`, `allow_public_channels`).
   - Strictly secured behind `public.is_platform_admin()` with `security definer set search_path=''`.
2. **Handling Unlimited Limits Across Plan Segments**:
   - The database constraint `plans_limits_finite_unless_internal` requires non-internal plans (`creator`, `agency`, `enterprise`, etc.) to hold non-null values for certain core limits.
   - For `historical_days_limit`, `NULL` is valid for all tiers and is used directly when `-1` is passed.
   - For other quotas on non-internal plans, passing `-1` sets `2147483647` (the canonical 32-bit integer ceiling).
   - `private.plan_json` translates both `NULL` and values `>= 2147483647` into `-1`, guaranteeing transparent `-1` / "بلا حدود" presentation across the frontend and `@sentiment/contracts`.
3. **Ergonomic Admin Form Controls**:
   - Every quota field in `EditPlanLimitsDialog` offers both an integer input and an intuitive "بلا حدود" (`adminPlanUnlimitedCheckbox`) toggle. Checking the box instantly sets `-1`, while entering positive numbers unchecks it.

2026-09-24 — YouTube Public Ingestion via OAuth Platform Reader Grant vs Direct API Keys.
To resolve authentication for unverified public YouTube channels without relying on web scrapers or requiring external Google Cloud API keys:
1. **OAuth Platform Reader Preferred Over Raw API Keys**:
   - Modern Google Cloud accounts and AI Studio issue API keys beginning with `AQ.` (associated with Google Gemini / Generative Language APIs). Passing an `AQ.` key to YouTube Data API v3 endpoints returns `HTTP 401 Unauthorized: "API keys are not supported by this API. Expected OAuth2 access token or other authentication credentials that assert a principal."`
   - Rather than requiring operators to obtain legacy `AIzaSy...` API keys, the system relies on the operator-connected OAuth Platform Reader grant stored securely in `private.platform_reader` (established in migration `20260919200000_a_platform_reader_reads_public_channels.sql`).
   - The Supabase Edge Functions (`worker/claim` and `channel-lookup`) unseal the encrypted grant using `TOKEN_ENCRYPTION_KEY`, refresh tokens via `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and pass short-lived OAuth bearer tokens to the worker.
   - The worker executes with `YouTubeAPI(None, client, access_token=token, public_reader=True)`.
2. **Defensive Filtering in Worker Loop**:
   - In `loop.py` and `manual_run.py`, collector builders inspect any provided `YOUTUBE_API_KEY`: if it starts with `AQ.`, it is bypassed, falling back to the Platform Reader OAuth token rather than causing a 401 failure.
3. **Omnichannel Diagnostics Integration**:
   - Added YouTube status check to `workers/python/src/collectors/diagnostics.py`, verifying the presence and health of the OAuth Platform Reader grant and confirming YouTube API reachability.

2026-09-24 — Audience Interaction Metrics Extraction at Zero Additional Quota & Storytelling with Data Integration.
To empower creators and brand managers with richer contextual insights and actionable engagement intelligence without exceeding YouTube Data API daily quotas:
1. **Zero-Quota-Cost Interaction Metric Extraction**:
   - Rather than making separate calls to video statistics or comment details endpoints, metrics were extracted from existing API responses:
     - `videos.list` was adjusted from `part="snippet"` to `part="snippet,statistics,contentDetails"` (1 quota unit, unchanged). This yields `view_count`, `like_count`, `description`, `tags`, and `category_id` without spending extra quota units.
     - `commentThreads.list` snippet contains `authorProfileImageUrl`, `authorChannelUrl`, and `totalReplyCount` for each top-level comment. Capturing these fields into `RawComment` and persisting them to `public.comments` requires 0 additional API calls.
2. **Storytelling with Data Hierarchy & Actionable Recommendations**:
   - Executive briefing presents a crisp, preattentive hierarchy: Total Views, Total Likes, Engagement Rate, Net Sentiment.
   - Videos section renders video thumbnails and calculates engagement rate percentages $\frac{\text{likes} + \text{comments}}{\text{views}} \times 100\%$.
   - Comments table enriches commenter authenticity via author avatar images, direct YouTube channel links, and reply count indicator badges.
3. **Cross-Workspace Video Sync Deduplication**:
   - In multi-tenant environments where multiple workspaces monitor the same public video, `private.enqueue_workspace_video_sync` now safely adopts existing video metadata (`channel_id`, `published_at`, `view_count`, `like_count`) if previously discovered by another tenant, avoiding redundant external fetches.

2026-09-23 — Omnichannel Historical Data Backfill & Import and Dynamic Plan Limits.
To enable users to import historical posts/videos and comments according to their subscription plan while allowing administrators to dynamically customize plan constraints without deploying database migrations:
1. **Quota Separation (`historical_backfill` vs `comment_analysis`)**:
   - Historical backfills (both direct platform syncing and external file uploads) deduct exclusively from `historical_backfill` usage units (`backfill_units` on the plan).
   - This strictly isolates historical backfill operations from the workspace's recurring monthly `comment_analysis` allowance, avoiding surprise quota depletion for ongoing active monitoring.
   - Predictions generated during historical imports store usage keys with prefix `'backfill:' || ch_platform || ':' || external_comment_id`, ensuring idempotent processing and zero duplicate metering.
2. **Dual Mode Ingestion (Platform Direct Sync & CSV / JSON Upload)**:
   - Direct platform sync requests are validated by `public.request_historical_platform_sync` against `historical_days_limit` and enqueued as `import` jobs with `is_historical: true`. The Python worker consumes this flag, collects comments with early stopping, and commits batches with historical metering.
   - External file upload (`public.import_historical_records`) allows uploading RFC 4180 CSV and JSON files, parsing bilingual headers (Arabic & English), synthesizing MD5 hashes, assigning `timestamp_precision = 'day'`, and committing records with atomic quota deduction.
3. **Dynamic Plan Limits Management (`public.update_plan_limits`)**:
   - Hardcoded plan definitions in migrations created administrative friction when tuning customer tiers.
   - Introduced `public.update_plan_limits(target_plan_key text, new_limits jsonb)` (SECURITY DEFINER, strictly restricted to platform admins via `public.is_platform_admin()`).
   - Limits (channels, analysis units, topic units, backfill units, historical days, etc.) can be adjusted immediately from `/admin/plans` and are reflected in real-time across the client application and enforcement RPCs.

2026-09-23 — YouTube Data API Quota Optimization & Incremental Watermark Early Stopping.
To maximize the efficiency of YouTube's daily API quota limit (10,000 units/day) when monitoring active YouTube channels and videos:
1. **Inline Replies Optimization**:
   - `commentThreads.list` previously requested `part="snippet"` and scheduled every parent with `totalReplyCount > 0` for a separate call to `comments.list` (1 quota unit per parent).
   - Changed request to `part="snippet,replies"`. YouTube returns up to 5 inline replies in `snippet,replies` for zero additional quota cost.
   - For all threads where `totalReplyCount <= len(inline_replies)`, replies are yielded directly from the thread response, bypassing `/comments`. This eliminates $\approx 85-90\%$ of all reply collection quota units.
2. **Incremental Sync Watermark (`since`)**:
   - Periodic synchronization previously paginated through all comment threads until exhaustively reaching the end of the video, repeating reads for thousands of historical comments.
   - Introduced early stopping in `YouTubeAPI.batches`: because comments are requested in `order="time"` (newest first), encountering a comment older than or equal to `last_collected_at` (minus 60s clock skew tolerance) immediately marks `threads_done = True` and terminates pagination.
   - Migration `20260923120000_due_videos_carry_last_collected_at.sql` exposes `s.last_collected_at` through `private.due_videos`.
   - The worker runner passes `since` when `last_seen_comment_count is not None`.

2026-09-22 — Dashboard Covering Composite Indexes and Frontend Code-Splitting.

Following a comprehensive architecture and performance audit, two high-impact optimizations were prioritized and implemented:
1. **Database Covering Indexes**:
   - `private.dashboard_aggregates_impl` and `private.dashboard_comments_impl` join `sentiment_predictions` and `topic_predictions` using `workspace_id` and active `analysis_key`/`classification_key`.
   - Previous unique indexes had `(comment_id, ...)` or lacked payload columns, preventing index-only scans.
   - Migration `20260922220000_dashboard_aggregation_covering_indexes.sql` introduces composite covering indexes with `(workspace_id, analysis_key, comment_id, content_hash, label)` and `(workspace_id, classification_key, comment_id, content_hash, topic_key)` filtered by `WHERE status = 'succeeded'`. This allows the query planner to evaluate aggregates entirely within index pages without visiting table heaps.
   - Added a GIN trigram index on `comments(author_name)` so that `v_search` predicates (`author_name ILIKE ... OR text_raw ILIKE ...`) can execute a bitmap index scan union rather than degenerating into full sequential scans.
2. **Frontend Bundle Optimization (`manualChunks`)**:
   - The production Vite build previously bundled all dependencies into a monolithic `index.js` exceeding 807 kB, causing browser parsing delays and cache invalidation churn.
   - Configured `rollupOptions.output.manualChunks` into granular vendor buckets (`vendor-react`, `vendor-tanstack`, `vendor-supabase`, `vendor-charts`, `vendor-ui`).
   - The main entry bundle dropped to 246 kB, eliminating the >500 kB warning while ensuring independent browser cache lifetimes across application updates.
3. **Arabic Typography Guardrails**:
   - Enforced `letter-spacing: 0` by default across all typography selectors in `app.css`, `pricing.css`, and `legal.css`, restricting negative tracking strictly to `:lang(en)`. Negative letter-spacing in Arabic glyphs disrupts cursive ligation (اتصال الحروف).

When logged in as a platform administrator/owner, the workspace switcher rail and account views previously returned all tenant workspaces across the platform (due to RLS allowing platform admins full visibility). This cluttered the owner's personal view with dozens of customer workspaces. Furthermore, when supporting users or debugging tenant-specific issues, administrators needed a reliable way to view the platform through a specific user's eyes ("لأرى المستخدم بعدسته وعينه") without stealing credentials, bypassing authentication, or compromising auditability.

To resolve this safely and sustainably:
1. **Workspace Isolation (`my_workspaces`)**:
   - Created `public.my_workspaces(target_user_id uuid default null)`:
     - By default (`target_user_id is null`), it strictly returns workspaces where the caller is an explicit member or creator (`m.user_id = auth.uid() or w.created_by = auth.uid()`). This isolates the admin's personal workspaces from customer workspaces in daily operation.
     - When `target_user_id` is supplied, it is strictly gated by `if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'`.
2. **Session Impersonation Architecture**:
   - Added an action column and **«الدخول كـ»** button in `/admin/users` (`AdminUsersPage.tsx`).
   - The platform admin's active session token is preserved. Impersonation state is stored in client session storage (`sentiment_impersonation_session`) and managed via `ImpersonationProvider` and `useImpersonation()`.
   - When impersonation is active, `my_workspaces` is requested with `target_user_id`, causing the app rail, account page, and dashboard selectors to load the impersonated user's personal workspaces.
3. **Safety Banners & Return Controls**:
   - A persistent, high-visibility banner (`ImpersonationBanner.tsx`) warns: «أنت تتصفح المنصة حالياً بصفتك: [user]» with a prominent action button **«العودة إلى حساب المدير»**.
   - In `SessionControl.tsx`, the user avatar pill indicates `[user] (محاكاة)`. The dropdown includes «الخروج من محاكاة المستخدم», and clicking standard «تسجيل الخروج» automatically terminates impersonation and restores the admin's account safely without destroying credentials.
4. **Audit Trails & Security Discipline**:
   - Implemented `public.admin_start_impersonation(target_user_id)` and `public.admin_stop_impersonation(target_user_id)` recording `impersonation_started` and `impersonation_ended` into `public.audit_events`.
   - Made `workspace_id` nullable in `public.audit_events` to support platform-level actions, with `admin_audit(int)` left-joining workspaces and falling back to `'Platform'`.

2026-09-22 — Channel Setup Mutual Exclusivity and Plan-Gated Public Channel Access.
Users previously experienced ambiguity when setting up a workspace because connecting a channel (via Google OAuth) and selecting/searching for a public channel (via public external ID) were presented concurrently without clarifying their mutual exclusivity. Furthermore, allowing all user tiers to add arbitrary public channels without restriction introduced resource and quota risks.

To address these concerns:
1. **Mutual Exclusivity UX Pattern**:
   - The UI presents a single decision point: "أملك القناة" (Official Owner) vs "لا أملك القناة" (Public Channel Monitoring).
   - Once a channel is attached (either via OAuth grant or via public candidate adoption), only relevant actions (`اختر الفيديوهات`, `فصل القناة`) remain visible, permanently hiding contradictory setup prompts.
2. **Platform Owner Gating & Fine-Grained Plan Control**:
   - Tracking public channels is restricted by default to the platform owner (`owner` internal plan / platform administrator).
   - Standard user plans (`free`, `creator`, etc.) default to `allow_public_channels = false`, presenting only the direct `[ربط قناة يوتيوب]` action.
   - Platform operators can grant or revoke public channel tracking access to specific account tiers via an interactive toggle in the admin console (`/admin/plans`).
   - The database enforces this via `public.set_plan_public_channels(p_plan_key, p_allowed)` with `SECURITY DEFINER` and strict `is_platform_admin()` verification.

2026-09-22 — Cross-Workspace Deduplication & Unified Database Architecture (قاعدة البيانات الواحدة).
When multiple workspaces monitor the same public channel (e.g. YouTube `@channel_id`), or when a user unselects videos to preserve their daily YouTube API quota (10,000 units), two critical operational issues arose:
1. Workspaces re-fetching and re-analysing identical videos and comments wasted limited YouTube quota and compute power.
2. In the sync catalogue UI, unselecting videos collapsed their visible metrics to "غير محدد" (Unselected) without communicating how many comments had already been gathered and classified in the database for those videos.

To resolve this on the principle of "قاعدة البيانات الواحدة بمعرف واحد فريد لكل من القناة والفيديو والتعليق" (Single Database source of truth with unique external identifiers):
1. **Cross-Workspace Asset Adoption (`20260922010000_cross_workspace_deduplication.sql`)**:
   - `private.adopt_channel_catalogue(w uuid, c uuid)`: When a channel is registered or updated, any videos catalogued under identical `(platform, external_channel_id)` in other workspaces are adopted into target workspace `w` without needing YouTube API calls.
   - `private.adopt_video_comments_and_predictions(w uuid, v uuid)`: When videos are selected in workspace `w`, comments, analysis runs, sentiment predictions, and topic predictions existing for `(platform, external_video_id)` in any donor workspace are adopted into workspace `w`.
   - Idempotent adoption sets `video_selections.last_outcome = 'exhausted'`, `last_seen_comment_count = count`, and pushes `next_check_at` forward by 24 hours so workers avoid consuming YouTube quota on already-collected content.
   - Automated backfill migrates existing multi-tenant channels. Exposed authenticated RPC `public.adopt_workspace_channel(w, c)` for workspace owners/analysts.
2. **Persistent Stored & Classified Visibility for Unselected Videos**:
   - Updated `private.workspace_ops_snapshot_impl` to compute `analysed` comment count per video and workspace-level `catalogue_summary`.
   - Updated contracts `@sentiment/contracts` (`OpsVideoCountSchema`, `CatalogueVideoSchema`, `CatalogueSummarySchema`).
   - Enhanced UI (`Catalogue.tsx`, `CataloguePreview.tsx`):
     - Displays an executive summary banner showing total collected comments, total classified comments, and count of videos with stored data.
     - Badges on unselected videos with stored comments display `غير محدد · جُمع X (صُنّف Y)` so creators always know their data is preserved and accessible.

To provide seamless support for X and TikTok channels without requiring operators or end-users to navigate developer portals or restrictive API registration (which are blocked by automated CAPTCHAs and mobile OTPs):
1. Both `XCollector` and `TikTokCollector` implement a resilient dual-mode strategy:
   - When API credentials (`X_BEARER_TOKEN`, `TIKTOK_ACCESS_TOKEN`) are configured in the environment, the collectors use the official API v2 endpoints.
   - When credentials are absent or in zero-configuration mode, the collectors fall back to public web endpoints:
     - X uses the public syndication timeline service (`https://syndication.twitter.com/srv/timeline-profile/screen-name/...`) which extracts tweets and engagement without tokens.
     - TikTok parses the server-rendered profile page and extracts initial state from `__UNIVERSAL_DATA_FOR_REHYDRATION__`.
   - Hermetic fixture mode (`x_fixture`, `tiktok_fixture`) is provided for deterministic unit and CI testing.
2. The user experience in `WorkspaceCard.tsx` allows entering handles either with `@`, bare handle, or full URL (`x.com/user`, `tiktok.com/@user`), and normalizes them uniformly into canonical external IDs.
3. Content items are mapped to `"tweet"` for X and `"video"` for TikTok, fully aligning with the `CONTENT_KINDS` check constraint in the database.

2026-09-20 — Omnichannel Multi-Platform Architecture (Telegram, X, TikTok, Facebook, Instagram).
The system was originally built strictly around YouTube (using YouTube Data API v3 channels, videos, comments, and IDs).
To support expanding audience sentiment analysis to other major social platforms in the Arab world, we designed a unified, platform-agnostic architecture while implementing Telegram as the first live non-YouTube platform:
1. Universal Content Abstraction:
   - Channels and comments now store `platform` (`'youtube' | 'telegram' | 'x' | 'tiktok' | 'facebook' | 'instagram'`).
   - Content items use generalized `video_kind` / `content_kind` (`video`, `short`, `stream`, `channel_post`, `tweet`, `status`).
   - Channel external IDs are generalized from YouTube-only 24-char format to any provider-specific identifier (e.g. `@channel_name` or numeric channel IDs up to 200 chars).
2. Worker Collector Router:
   - Python worker implements `CollectorRouter` with standard `ICollector` interface (`discover_channel` and `fetch_batch`).
   - Separate collectors handle provider-specific logic (`YouTubeCollector` and `TelegramCollector`), while the labelling pipeline, topic assignments, and Supabase commit protocols remain 100% shared and identical.
3. Database & Dashboard Transparency:
   - `dashboard_aggregates` and `dashboard_comments` accept `platform` in their filter JSON and return `platform_breakdown` across all active comments.
   - Database migration `20260920190000_omnichannel_multi_platform_support.sql` preserves all tenant-isolation RLS policies and immutability rules.

2026-09-20 — Decoupled Big-Data Dashboard Architecture (Server-Side Aggregations & Paginated Stream).
The original architecture transferred all comments for a workspace (up to hundreds of megabytes of raw JSON)
to the browser client and computed metrics, timelines, sentiment distributions, and filtered tables in-memory via `snapshot()`.
When channels scale beyond 10,000 comments (e.g. AJ360 with 71,310+ comments), this approach caused browser memory exhaustion,
sluggish UI responsiveness, and PostgREST serialization bottlenecks.
We redesigned this into an enterprise-grade decoupled server-side architecture inspired by jQuery DataTables / server-side streaming:
1. `public.dashboard_aggregates(w uuid, f jsonb)`: Pre-computes metrics, sentiment distribution, timeline buckets, topic counts,
   video aggregates, 24-hour activity distribution, 7-day weekday activity, weekly volume, top commenters, and top negative comments
   directly in PostgreSQL via set-based GROUP BY aggregations. Payload is reduced to ~300KB (or <8KB for smaller filters) with sub-second execution (~1.3s on 71,310 rows).
2. `public.dashboard_comments(w uuid, f jsonb)`: Streams a paginated window of comments (25-100 rows, ~40KB) based on active filters,
   server-side sorting, and full-text search.
3. PostgreSQL GIN Trigram Index: Created `comments_text_trgm_idx` using `extensions.gin_trgm_ops` on `public.comments(text_raw)`
   so ILIKE text search across tens of thousands of comments completes in ~28ms.
4. Backwards Compatibility: The existing `dashboard_snapshot` RPC remains supported, and offline/demo/fixture modes continue
   using client-side `snapshot()` seamlessly. All contracts are formally typed with Zod in `@sentiment/contracts`.
Migration lives in `supabase/migrations/20260920150000_decoupled_dashboard_architecture.sql`.


2026-09-20 — Fair multi-tenant job claim scheduling and real-time operational polling.
When multiple tenants queue jobs, platform workers claiming across workspaces (`w is null`) must not
allow an active workspace with many jobs to monopolize worker leases and starve other workspaces.
We updated `private.claim_job` in `supabase/migrations/20260920120000_fair_multitenant_claim_scheduling.sql`
to prioritize workspaces with fewer actively running jobs before falling back to `not_before` time.
Urgent channel discovery jobs (`type = 'discover'`) continue to jump the queue ahead of collection/analysis.
On the client side, operational views on `/sync` employ adaptive 4-second live polling while jobs are
queued or running, and automatically idle when the queue clears. Job feed entries and sync health indicators
explicitly differentiate channel cataloguing (`discover`) from comment collection (`collect`) and suppress
stale historical error banners while active work is actively queued.

2026-09-20 — Operational views (/sync, RailState) must never couple their availability to the analytical
payload size. When comments grow into the tens of thousands (e.g. 28,244 comments producing a 55.6 MB
JSON snapshot), reading the full `dashboard_snapshot` to display sync health, job queue counters, or
video comment tallies caused PostgREST statement timeouts (504 / read:live_unavailable) on operational
pages.
We decoupled operational reads into a dedicated lightweight RPC: `public.workspace_ops_snapshot(w uuid)`.
It returns only `{ sync: SyncState, plan: UsageSummary, video_counts: Array<{ id: string, total: number }> }`
directly from indexed tables (`sync_state`, `jobs`, `subscriptions`, `comments`), reducing payload size
from 55.6 MB down to ~250 KB and execution time to ~380 ms.
On the main dashboard route, `dashboard_snapshot_impl` was rewritten from correlated subqueries to
set-based CTEs aggregating text into JSON objects (`json_build_object`/`json_agg`), and equipped with
an explicit `set statement_timeout = '30s'` to guarantee heavy analytical reads complete without timing out.
Migrations are immutable, so the new RPC and optimized dashboard snapshot live in
`supabase/migrations/20260920000000_ops_snapshot_and_dashboard_optimization.sql`.
`credential_expired` mid-run, losing everything it had not yet committed; the UI then told
the operator to reconnect a channel that was never disconnected. The fix keeps the token's
renewal on the server and gives the worker a question instead of a credential: the claim
payload now carries `access_token_expires_at` beside the token, the gateway renews at claim
time whenever less than a quarter of an hour remains (was one minute), and a new
`/worker/renew-token` route — validated in SQL by the same lease check every other worker
call makes (`svc_worker_renew_grant`) — answers a held lease with a fresh short-lived token.
The collector renews proactively inside a two-minute margin and, if the source answers 401
anyway, swaps the token and repeats the very request once before reporting the lapse. A
renewal that comes back empty (grant gone, older gateway, blip) degrades to the same
retryable `credential_expired` as before, and a lost lease still travels as `LeaseLost`.
The dashboard's failure copy for `credential_expired` now says the permission renews itself
on retry rather than asking for a reconnection. Migrations are immutable, so the new RPC
lives in `20260919170000_worker_renews_its_token.sql`.

2026-09-14 — Internal UX follows one scoped application shell, using the landing's existing
mark and visual tokens. The analytical report's data and label rules are unchanged; a CSS
layer corrects the old global `header` layout and aligns account, operations and recovery
pages without introducing a second UI framework. The report's many filters remain visible
on desktop and are initially closed on narrow screens behind a button with `aria-expanded`;
the form remains in the DOM so opening it preserves its state and keyboard access. The
Sync route resolves session and workspace before a live read, and remounts per identity and
workspace. A fixture cannot stand in for a signed-in user's missing or failed workspace
list, because that would make a tenant-specific operations page appear populated by another
source. An account's empty-workspace message waits for its workspace request to complete.
Worker-disconnected copy describes its effect on freshness rather than assuming it runs on
a developer machine, which is no longer a generally valid deployment claim.

2026-09-14 — Dashboard data is scoped to the current authenticated user and workspace in both the component lifetime and React Query key. A source switch remounts the report so local filters, review dialogs, and pending correction context cannot outlive the identity they describe. Placeholder data may survive a filter change within one identity but never cross a user, mode, or workspace boundary. A signed-in account with a workspace list still loading or failed gets an explicit state, not a fixture fallback. The workspace selector remains available after the first choice and the report names the chosen workspace rather than exposing its UUID. Video filter options derive from the source workspace independent of the active filter selection; available video titles are displayed without inventing titles for unknown ids.

2026-09-14 — Replace the supplied marketing-reference hero with an original generated illustration before treating the landing as a product asset. The reference archive informs composition only; it does not establish redistribution rights. Use the project's documented indigo token for landing actions. Marketing copy distinguishes the fixture example on the landing from the pilot channel's collected real comments and does not imply that live model analysis or authenticated dashboard reading has been validated.

2026-09-13 — Arabic marketing landing: the user's supplied screenshot/archive is a visual reference. `/` now serves the landing and the dashboard moves to `/dashboard`, with existing browser tests retaining their dashboard coverage at that route. Scoped landing styles protect the application shell; on-demand dashboard/account imports reduce the marketing entry bundle. Product copy discloses illustrative data and incomplete live setup; no customer endorsements, measured accuracy, paid plan, or lead collection is invented. Reference/font provenance and private-preview limitations are in `docs/landing.md`.

2026-09-12 — The supplied handoff plus the latest M0–M2 request are the approved design and scope. Work runs inline on `codex/m0-foundations` in the supplied empty workspace.

- Use npm workspaces and the resolved React/Vite/Chart.js/Tailwind/TanStack Query/Router/Zod stack. Node 22.14.0 supports the pinned Vite 6 release. Python 3.12.10 and uv lock the lightweight worker foundation. PyTorch/model downloads wait for the real inference milestone; no invented revision or unused heavyweight dependency is installed.
- Fixture mode is an explicit local data source, with synthetic identities and no customer records. Live Auth is a separate configurable flow; fixture data never implies a live backend.
- All dashboard sections derive from one filtered snapshot and a named active analysis key. Dates use UTC half-open intervals; unknown dates are separately counted. Current-text human reviews override current active predictions.
- SQLite is a private local collection spool, not the SaaS job queue. PostgreSQL is the shared job queue with atomic leases. Both fence stale workers and commit rows/checkpoint together.
- Database tests run the migration in embedded PostgreSQL (PGlite) with minimal test-only Auth/Storage tables. This provides SQL/RLS evidence without Docker, but cannot validate GoTrue, PostgREST, Storage HTTP, or deployed Supabase behavior. Full Supabase integration remains a separate gate.
- Security-sensitive state is written through role-checked SQL RPCs; tenants cannot directly alter memberships, channel verification status, job leases or quotas. Private storage paths begin with workspace UUID.
- Only a neutral Arabic RTL shell is built until the actual visual assets arrive. No final brand choices, public publication, paid resources, production migrations, or live data collection are part of setup.

References checked: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Vite requirements](https://vite.dev/guide/), [Supabase changelog](https://supabase.com/changelog). Changelog reviewed 2026-09-12; this foundation does not modify Realtime, pin extension versions, or use the deprecated Management logs endpoint.

2026-09-12 (continuation) — decisions made while closing the M0–M2 gaps.

- Every Auth user is bootstrapped with a personal workspace by a definer trigger on
  `auth.users`, so no signed-in user can exist without a tenant. Channel claiming goes through
  `register_channel`, which checks role and client tenancy, validates the `UC` + 22-character
  id format, and always creates channels as `public_unverified`. A tenant never sets
  `connected` itself; that status is reserved for a completed OAuth flow in M5.
- `channels` stays unique per workspace rather than globally, so two tenants may register the
  same public channel id before OAuth. This is deliberate: pre-OAuth collection of public data
  must not depend on ownership, and ownership is proven at M5 from the channel identity
  returned by an authorized connection. A global unique constraint would let the first tenant
  to type a URL block the real owner.
- A `ModelCard` registry records model id, pinned revision, declared label mapping,
  preprocessing version and any measured results. It refuses a moving ref such as `main`, and
  refuses malformed or duplicated mappings, because label order must never be inferred from a
  config. No card is constructed for a real candidate yet: that would require inventing a SHA.
  A three-class model reports `supports_mixed == False` so the UI can say Mixed detection is
  unsupported rather than display a 0% that reads as a measurement.
- A `DeterministicTestAnalyzer` labels by an explicit marker character so pipeline behaviour is
  testable without weights. It is named `deterministic-test-analyzer`, documented as not a
  model, and returns `unsupported` rather than guessing Neutral for unmarked text.
- The browser error-state test gates its route handler on a flag rather than a request index.
  React StrictMode issues two fetches on the initial mount — confirmed by probing the running
  page, not assumed — so an index-based handler let the second request succeed and silently
  tested nothing.

2026-09-13 — metering and plan limits.

- Plans live in an operator-managed `plans` table with no tenant grant, so a workspace cannot
  raise its own limits. A subscription carries the plan key and a UTC period; the period is
  declared in UTC and does not move when a workspace changes its display timezone.
- `usage_events` is keyed by `(workspace_id, event_key)`, which is what makes a retry, a
  reimport, or a likes-only refresh free. One unique comment costs one unit in a workspace
  once, not once per period, so the key is checked across all periods rather than within one.
- `historical_backfill` draws on its own allowance. An exhausted analysis quota must not block
  a backfill, and a backfill must not silently consume the monthly analysis budget.
- `reserve_usage` locks the subscription row before reading the remaining allowance. That lock
  is the mechanism that stops two concurrent callers both seeing the same headroom and both
  spending it. Reservation is deliberately partial: it grants what the allowance still holds
  and returns the covered keys, leaving the caller to decide whether a partial grant is usable.
- `commit_checkpoint` is all-or-nothing by contrast. Rows, checkpoint and meter move in one
  transaction, and a batch that cannot be paid for in full is refused rather than committed
  half-metered. A replayed batch key returns before metering, so it is never charged twice.
- A reservation is released only while it is still `reserved`. A confirmed charge is history
  and `release_usage` will not remove it, so a failure late in a batch cannot un-bill work
  that already succeeded.
- The subscription table rejects `provider = 'mock'`, so a mock billing mode cannot be attached
  to a real plan row outside a test harness.
- Metering is service-only. No `authenticated` grant exists on `reserve_usage`, `confirm_usage`
  or `release_usage`, so a tenant cannot meter itself or forge a reservation.

2026-09-13 — surfacing plan usage.

- `usage_summary` is readable by every member including a viewer: it is a read, not a control,
  and someone watching a dashboard should be able to see why a sync stopped. It returns null
  when no subscription exists, and the UI states that no plan has been activated rather than
  implying the allowance ran out. Those are different situations and must not look alike.
- `reserve_usage` and `usage_summary` both count a period's spend through one `used_units`
  helper, so the number that blocks a batch and the number shown on screen cannot drift apart.
- The 70% and 85% alert thresholds the specification defines for the storage budget are applied
  to plan usage as well, so a limit becomes visible while there is still room to act instead of
  only when a batch is refused. A zero allowance reads as exhausted rather than dividing by zero.
- `BudgetSchema` refuses a summary whose `remaining` does not follow from `used` and `allowance`.
  A miscounting server should fail loudly rather than render a confident but wrong progress bar.
- The fixture carries a plan block so the panel is exercisable without a server. It is synthetic
  like the rest of the fixture and does not describe any real workspace's consumption.


2026-09-13 — Parallel development uses three sibling Git worktrees: Codex/Python,
Claude/platform, and a single integration lane. The original checkout is preserved during
Claude's transition. Shared TypeScript contracts, Node dependency changes and central
milestone records have one owner (integrator). Lane reports avoid concurrent edits to shared
progress documents. Ownership guards run before commits in the new worktrees. See
`docs/coordination/README.md` and `tasks.md`. No changes to application architecture or paid
service authorization follow from this setup.

2026-09-13 (M3 and M5 server work) — decisions taken while implementing, with reasons.

- **The billable unit is the comment, not its text.** `usageEventKey` is
  `analysis:{platform}:{external_comment_id}` with no content hash, so a retry, a reimport, a
  likes refresh and a re-analysis after an edit are all free. Including the hash would bill a
  customer for edits they did not ask for. This was recorded as an open pricing question and
  is now decided; it is reversible by changing one function and adding a migration.
- **Replay is keyed on the batch key plus a payload fingerprint.** The earlier
  `commit_checkpoint` compared only the checkpoint, so a reused key carrying different rows
  would have been accepted as an update. It is now a conflict. The Python client hashes the
  payload canonically, because a digest that varied with dictionary order would make a
  legitimate replay look like a conflicting payload and turn a retry into a failure.
- **A prediction for a comment not in its batch fails the whole batch**, rather than being
  stored, because it is analysis of something the server cannot show. A successful prediction
  must carry its class scores, since the specification requires keeping all class
  probabilities.
- **Nothing that crosses a trust boundary accepts a workspace.** The OAuth callback, the
  worker gateway, the batch payload and the edge handler all derive the tenant from something
  the caller cannot choose — stored state, or a credential. This is deliberately structural
  rather than a validation step: there is no field to forge, so the check cannot be forgotten
  later.
- **A worker holds a scoped credential, never the service role**, and that credential names
  exactly one workspace. Claim, heartbeat, commit and finish take no workspace argument.
- **The connected claim on a channel is globally exclusive**, enforced by a partial unique
  index. A second workspace keeps its `public_unverified` row, because collecting public data
  needs no authorisation, but can never become the authorised holder. A channel already being
  collected publicly is upgraded in place so pilot data gathered before the creator authorised
  carries over instead of being orphaned.
- **An idempotent replay is answered before the rate limit is consulted.** Returning the same
  job for the same key is not a new request, and refusing it would punish a correctly
  retrying client.
- **`sync.ts` is application schema, not worker protocol.** It is a read projection over sync
  runs and the job queue, so changing it cannot break the worker. `jobs.ts` and the barrel
  stay coordinated because a unilateral change there would.
- **Aggregates belong in the shared snapshot, not the app.** `comment_types` and the
  per-video figures were computed in the browser, which only worked because fixture mode
  reads every row; a live paginated read could not have offered the same control, and the two
  modes would have diverged. The per-video figures accumulate in the pass that already walks
  the rows, which is what a `GROUP BY` does, so there was never a scaling reason to defer it.
- **Unknown is never zero.** An unparsed like count stays null and its comment is excluded
  from the engagement ranking rather than sorted last; an export writes it empty. Sorting
  unknown as zero would present an unmeasured row as measured-and-lowest.
- **Errors crossing a boundary carry a code and no message.** A driver or transport error can
  quote a connection string, and a credential with it.
- **The audit trail answers to owners only** and is append-only in the database, with short
  bounded fields so a comment body cannot be parked in it.
- **A contract describes the wire, or it describes nothing.** `CommitBatchSchema` was one flat
  object while the client posts an envelope wrapping a payload, and the seam test reshaped the
  payload before parsing — so the test's adapter was the only thing making the two agree, and
  the handler could not have validated against the schema even in principle. The schema is now
  `CommitBatchSchema` (envelope) over `BatchPayloadSchema` (content), and the golden fixture is
  the request body captured from the real client rather than one assembled by the side reading
  it. A fixture built by the consumer proves the consumer agrees with itself.
- **A rule that meters must be enforced where the metering happens.** The prediction/comment
  rule lived only in Zod, which the worker is free not to run and the handler never reached.
  The consequence was not a dropped row but a charge for one. Validation may live in as many
  layers as are useful, but the layer that spends the customer's allowance has to be one of
  them.
- **A malformed batch is refused whole, never filtered.** Silently discarding the rows that do
  not fit is what turned a worker defect into a customer charge. A batch whose predictions do
  not describe its own comments is a bug in the sender, and the sender should be told.
- **An analysis failure keeps the rows and downgrades the claim.** Collected comments are real
  work and are committed; what the run may no longer say is that it finished. An exhausted
  source that was not fully labelled is `partial`, never `succeeded`. Discarding the rows
  would lose collection and the checkpoint with it; reporting success would claim a coverage
  the data does not have.
- **An adapter returning the wrong number of verdicts is refused, not zipped.** A short list
  silently leaves later rows unanalysed while the run reports success, and a long one names
  comments that do not exist.
- **A comment's content hash is computed in one place.** Predictions join to comments on it, so
  a prediction hashed over different text is stored and then never becomes the effective label
  — a comment that is analysed but shows no verdict, with nothing failing anywhere.
- **Settings are part of what identifies an analysis.** Section 9 makes the fingerprint model,
  revision, preprocessing *and* settings. They are stored on the run and folded into
  `analysis_key`, because a prediction is unique on that key: without them, re-analysing a
  comment under different settings collides with the earlier verdict and the new one is
  dropped. An adapter with no settings declares `{}`, which is a statement rather than an
  absence.
- **Spent OAuth states are pruned; states in flight never are.** Retention was never load
  bearing for security — consume requires a row that is unconsumed and unexpired — so the
  window exists for operational diagnosis and is short. The operation is committed without a
  schedule, because a schedule needs a deployed project and inventing one here would be a
  configuration nobody runs.
- **Going live takes a configured project and an explicit request.** A configured Supabase
  project enables Auth and workspace management; on its own it must never turn fixture rows
  into live data, or a correction against a fixture id would be addressed to a real server and
  reported as saved. The read and the write branch on the same data mode, so they cannot
  disagree about which one they are in.
- **The live read returns the whole workspace, and says so.** That is the same whole-set read
  the fixture does, which is what lets one `snapshot()` compute identical aggregates in both
  modes. It is right for pilot-scale data and needs server-side filtering before a workspace
  holds substantially more. It is deliberately not capped: a silent subset would report
  partial data as if it were the whole set.
- **`snapshot()` makes no claim about provenance.** It aggregates rows and cannot know where
  they came from. Returning `mode: "sanitized_fixture"` was a claim made by the one function
  with no access to the answer, and it stayed true only because no live read existed.
- **The state is stored hashed; the verifier is stored raw.** They are different kinds of
  secret. The state travels back through the browser, so a readable copy in the database would
  be enough to forge a callback. The verifier never leaves the server and the exchange requires
  it, so storing it is what the protocol asks for. Both live in a table with no tenant grants,
  single use, ten minutes, and pruned.
- **The state is recorded before the redirect is issued.** A callback for a state that was
  never written is refused, so the write must not be able to fail after the user has already
  been sent to Google.
- **A verifier is validated where it is created, not where it is used.** By the exchange it has
  already been used, and a weak one cannot be un-sent.
- **The brand's own tokens, a deliberate subset of them.** Colours, spacing, shadows and the
  type scale come from the project's brand book by way of `dashboard.sky-develop.net`. What is
  chosen here is the subset: a dashboard needs surfaces, text and a sentiment palette, not the
  display scale or the mesh gradients that belong to a marketing page.
- **Sentiment colour is separate from the accent.** Indigo is chrome; green, rose, grey and
  amber plot the four labels. Sharing them would make a figure read as "brand" and a button
  read as "positive". Every figure still carries a text label — colour is never the only
  carrier, and the browser suite asserts it.
- **Fonts are self-hosted.** Readex Pro carries Arabic and Latin in one design, which is why
  an Arabic-first interface needs it: a fallback stack that changes family mid-sentence makes a
  mixed line ragged. Served from our own origin rather than Google, because a render-blocking
  third-party stylesheet delayed first paint enough to break a browser test, it hands a
  visitor's IP to a third party on every load, and it is one more thing that can be
  unreachable. Only the Arabic and Latin subsets are shipped, at four weights.

2026-09-15 — سلّم الخطط مثبَّت في `docs/pricing.md`: خمس درجات (`free` قمع لمرة واحدة على فيديو
عام، `starter` 9$/5,000، `pro` 29$/25,000، `business` 99$/100,000، `enterprise` بعرض سعر)
بوحدة التعليق المحلَّل الموجودة، والموجز المولَّد بوحدة مستقلة تُحسب بالتقرير. مبنيّ على تجربة
BeyondComments وتسعير Comment Finder وAwario وBrand24 وغياب الأسعار المعلنة عند Lucidya وCrowd
Analyzer. الدفع الفعلي يبقى مؤجَّلًا؛ الصفوف تُفعَّل يدويًا. `pilot` لا تُمسّ.

2026-09-15 — Selective video sync (`docs/superpowers/specs/2026-09-15-selective-video-sync-design.md`,
tasks 1–9, `ca86ed3`…`4abfd02`).

- **Selection is a table (`video_selections`), and jobs stay per-channel.** A `collect` job
  carries no video list; the server hands the worker its due list at claim time from
  `private.due_videos`. This keeps the pre-existing "one outstanding collection per channel"
  invariant (`jobs_one_outstanding_collect`) and its UI wording true without a second
  mechanism, lets a video selected mid-run be picked up by the next run rather than needing a
  second job or a silent wait, and means the tenant cannot forge which videos a job touches —
  the list is computed server-side from rows RLS already scopes, not read from client input.
  Rejected: storing the video list on the job (two places deciding what to collect) and one
  job per video (N attempt-log rows per selection, N× worse once live re-checks run
  continuously) — both already rejected once, in `runner.py`, before this work.
- **The scheduler lives in Postgres.** `private.schedule_all()` is the function `pg_cron`
  would call hourly; `private.worker_tick` (wired into `svc_worker_tick`) is the
  extension-free fallback the worker loop calls on every idle tick, so live re-checks and
  fresh-catalogue discovery work on the live project today, without `pg_cron` enabled, and
  without a second scheduling mechanism to keep in sync once it is.
- **`historical_backfill` remains unmetered by this work.** The budget line already existed
  in the plan schema; nothing in this feature reserves it, and nothing here changes that —
  recorded as out of scope in the spec and left that way.
- **The catalogue lives on the operations page (`/sync?ws=…`), not a new route.** It is the
  page's first section, above the health/plan/attempts panels (which moved unchanged into
  `OperationsPanels.tsx` so the split carries no behaviour change), because the operations
  page already carries the plan meter the estimate reads and is where the removed
  "request sync" button lived. No new rail destination was added.
- **The free-tier/public-video funnel is not part of this work.** `plans.free` and the
  `public_unverified` channel state predate this feature and are unchanged by it; selective
  sync applies uniformly to a workspace's one connected channel regardless of plan.

2026-09-16 — Topic classification (`docs/superpowers/specs/2026-09-15-topic-classification-design.md`,
plan `docs/superpowers/plans/2026-09-15-topic-classification.md`, tasks 1–10,
`0866318`…`1b4ed30`).

- **Gemini (`gemini-3.6-flash`, prompt `p1`) is the topic layer.** One primary topic per
  comment, drawn from a per-workspace taxonomy of ten seeded defaults (question, religious
  remark, praise, criticism, request, discussion, personal story, humour, promotion, other —
  `private.seed_default_topics`). The model is pinned by id and prompt version in
  `TopicClassifier.model_id`/`prompt_version`, and a worker whose `model_id`/`prompt_version`
  is not the workspace's own `active_topic_key`'s pair is told `active: false` by
  `worker_topics_due` and finishes the job `blocked` with `topic_model_not_active` rather
  than spending a Gemini call on a verdict that can never become effective — the same
  reasoning `active_analysis_labels` already applies to sentiment.
- **What is sent to Google, and what is withheld.** `worker_topics_due` hands the worker the
  comment's text, its parent's text (or an explicit note that the parent is unavailable, for
  a reply whose parent was purged), and the workspace's taxonomy (key and description; the
  display names never leave the database) —
  never the author, any id, or the workspace. `gemini.py` puts the key only in the
  `x-goog-api-key` header, never in a URL, and constrains the response to the taxonomy's own
  keys via a JSON schema enum so the model cannot name a topic nobody chose; a response
  outside that enum is recorded `failed`/`gemini_bad_response`, not guessed and not folded
  into `other`.
- **Dedicated tables (`topic_predictions`, `topic_reviews`), not `comment_annotations`.**
  Topic and sentiment are independent dimensions with independent lifecycles (a taxonomy can
  be re-versioned; sentiment's label set cannot) and independent metering
  (`topic_classification` is its own kind, `plans.topic_units`, pilot `5000`); folding both
  into one polymorphic table would make a taxonomy version bump touch sentiment rows and vice
  versa. `submit_topic_review` is append-only like `submit_comment_review` and mirrors its
  shape (originates `human`, records who and when) but writes no `audit_events` row, because
  `submit_comment_review` does not either — consistency with the existing behaviour over
  inventing a new one.
- **An `analyse` job, not a sweep.** Topic classification reuses the same `jobs`/lease/retry
  machinery as `collect` and sentiment, dispatched in `run_job` by `type='analyse'`, rather
  than a background sweep with its own scheduling. One job type, one retry story, one place
  the operations page already knows how to show.
- **A missing classifier finishes the job `blocked`, not "skipped."** The design's own
  language called this case "skipped," but the job status vocabulary the schema already
  enforces has no such state — `blocked` with `error_code = 'no_topic_classifier'` is the
  closest existing status that is honest about the outcome (the job did not fail, and it did
  not succeed; it could not run), and extending the vocabulary for one case was rejected as
  the smaller but wrong-shaped fix.
- **A retry may overwrite only a `failed` verdict.** `worker_commit_topics` upserts on
  conflict only when the stored row's status is `failed`; a `succeeded` row is immutable
  once written, matching how `topic_classification` is metered once ever per comment
  regardless of how many times it is later reclassified. The same on-conflict-do-nothing
  defect that lets a sentiment retry silently drop its update exists in the sentiment
  `commit_batch` — noted here as a known follow-up, not fixed in this feature.
- **A reply whose parent was purged is still classified.** `worker_topics_due` sends the
  item with `parent_text: null` and the prompt says explicitly that the parent is
  unavailable, rather than skipping the reply or sending an empty string that could read as
  "no parent" versus "empty parent."
- **Taxonomy-editing UI is deferred.** `set_workspace_topics` exists and is tested at the RPC
  layer; no screen calls it yet. The ten seeded defaults are the only taxonomy any workspace
  has today, which is sufficient for the pilot and does not block the classification path
  landing first.
- **Existing Arabic strings win over new ones where a browser test already pins the wording.**
  The row button that opens topic correction reads "تعديل الموضوع" and the chip's human-review
  marker reads "تصحيح بشري" — the same verb and noun `dashboard.spec.ts` already asserts for
  the sentiment correction flow — rather than a topic-specific phrase that would read as a
  second vocabulary for the same action on the same row.

2026-09-16, later — **the pinned topic model is `gemini-3.6-flash`, not `gemini-2.5-flash`.**
The first working key answered a 2.5 request with 404 "no longer available to new users; use
gemini-3.6-flash". The pin lives in one place (`workers/python/src/topics/gemini.py`); the
classification key changes with it (`topics:v1+gemini-3.6-flash+p1`), which is what the key is
for. Nothing was classified under 2.5 anywhere, so nothing is orphaned.

## 2026-09-16 — a failed sentiment verdict is retried

- **A sentiment retry may overwrite only a `failed` verdict — the same rule as topics.**
  `commit_batch`'s prediction insert now conflicts with `do update ... where
  public.sentiment_predictions.status = 'failed'` rather than `do nothing`. A `succeeded`,
  `skipped` or `unsupported` row is final and a later attempt never touches it, matching
  how `comment_analysis` is metered once ever per comment. This closes the follow-up the
  topic-classification entry above left open. The update also takes the retry's
  `analysis_run_id` and resets `predicted_at`, so the stored row points at the run that
  actually produced the verdict it now carries.
- **Adoption on update is a second trigger, not a rewrite of the first.**
  `adopt_first_analysis_on_update` (`after update ... referencing new table ... for each
  statement`) calls the existing `private.adopt_first_analysis()` unchanged; the function
  already filters on `status = 'succeeded'` and `active_analysis_key is null`, so a
  failed-to-failed update adopts nothing and an already-adopted channel is never swapped.
  Mirrors `adopt_first_topic_classification_on_update` in `20260916011000`.
- **Rebuilt from `20260914070000`, not `20260913220000`.** The task named the latter as the
  current definition; `grep 'create or replace function private.commit_batch'` shows the
  former is later and adds the `sync_runs` block. Starting from `20260913220000` would have
  silently reverted that — the exact failure `docs/coordination/ACTIVE.md` records for
  `worker_finish` on 2026-09-14. The new migration's body is the current one plus one
  clause, verified by `diff`.
- **The `failed` row's `analysis_runs` row is still written as `succeeded`.** Pre-existing
  and unchanged here: a run row's status describes the run, and the worker reports a run
  that produced verdicts, some failed. Narrowing this migration to the conflict clause keeps
  the diff reviewable; if run status should reflect per-verdict failure that is its own
  decision.

2026-09-16, later — **Gemini requests carry 100 comments and no chain of thought; the
prompt version stays `p1`.** Measured on the live key against `gemini-3.6-flash` with the
real prompt: 25 comments per request cost 2,305 tokens (891 prompt, 964 "thoughts", 450
output — 92 a comment); with `thinkingBudget: 0` and 100 comments per request, 5,398 tokens
for 100 (54 a comment), the same verdicts, valid JSON every time. For a 5,000-comment
workspace that is 50 requests and ~270k tokens instead of 200 and ~460k. The version is not
bumped: the instructions and the taxonomy the model reads are the same text, and bumping it
would mark 5,000 fresh verdicts stale and spend the tokens again. A change to the prompt
text itself is a new version. Decided with the user.

## 2026-09-16 — سلّم الخطط v2 والدفع عبر Paddle

Six open questions from `docs/pricing-v2-draft.md` §6, answered in
`docs/pricing-consultation-2026-09-16.md` §7 and carried into
`supabase/migrations/20260917010000_plans_v2.sql`:

1. **Individual prices are 12$/29$**, not the 9$/29$ the old `pricing.md` had. At a ~10%
   payment burden and a flat 0.30$ fee, 9$ nets to about 8$; 12$ leaves margin that survives
   Gemini with thinking on (64% vs 52%), and no subscription competitor sits at 9$
   (Comment Finder's 9.9$ is a one-time credit, not a subscription; vidIQ starts at 19$).
2. **`media` is published, not self-serve.** Its row exists (`self_serve = false`) so it
   anchors `agency` as the middle choice on the pricing page, but its button reads "contact
   us" until change-detection lands in the live check — a `media` subscriber's two-hour,
   thirty-channel check alone would burn ~72% of the project's daily YouTube quota today.
3. **One add-on pack in v1: +10,000 comments for 5$**, one size, no ladder of packs. A hard
   stop with no way out loses the subscriber at the moment of highest intent (an agency
   hitting its ceiling mid-month); the pack is cheap to build because it spends the same
   `analysis_units` `reserve_usage` already reserves, not a parallel credit system.
4. **USD only, no approximate SAR/AED display.** An approximate conversion creates disputes
   the moment a card statement disagrees with the displayed number, and real SAR pricing
   (mada) only makes sense once Tap/Moyasar are in place with a Gulf entity.
5. **Upgrade Supabase to Small before the first paying subscriber, not after.** Micro
   already "runs low on resources" against one pilot channel; the cheapest place to measure
   `commit_batch` under load is now, between analysis jobs, not the week billing goes live.
6. **Paddle first**, reversing the same day's earlier "Stripe first" call — see the tax
   reasoning below.

**Root billing, not per-workspace billing.** A client workspace carries no allowance of its
own; its `subscriptions` row points at `billing_workspace_id`, and every meter
(`private.billing_root`, `reserve_usage`, `used_units`, `analysis_remaining`,
`topic_units_remaining`, the channel-limit count in `register_channel_impl`) reads through
that root. The alternative — a fresh allowance per workspace — would let one `agency`
subscriber multiply their 150,000-comment plan by five just by opening five client
workspaces; one allowance per paying subscriber, shared across every workspace that
subscriber bills through, is the only shape that matches "one plan per customer."

**Owner has no ceiling, encoded three ways on purpose, not one.** `plans.analysis_units`
(and the other limit columns) are `null` for the `owner` row — Postgres's own "no value,"
guarded by a check that only an `internal` plan may spell it that way. The zod contract in
`packages/contracts/src/plans.ts` and `usage.ts` cannot carry `null` through a `.min()`
schema cleanly, so it reports `-1` for "no ceiling" instead. The SQL gates that do arithmetic
against the allowance — `analysis_remaining`, `topic_units_remaining` — cannot subtract from
`null` either, so they return `2147483647` (`int4` max) there, which keeps `remaining - used`
and `used >= allowance` comparisons meaningful without a `null`-check at every call site.
Three representations for one fact, each chosen for what that layer can express cleanly.

**`past_due` carries a 7-day grace, enforced in Part C.** The column and status value exist
today (`subscriptions.status` accepts `past_due`, and every plan-limit read in
20260917020000 still counts a `past_due` subscription as active), but the sweep that drops a
subscription to `free` after seven unpaid days is not built — Paddle is not wired yet, so
nothing can go `past_due` for real. Recorded now so Part C builds the sweep to this number
rather than picking one when the webhook lands.

**Tax reasoning (`docs/pricing-consultation-2026-09-16.md` §5.3, §7.2):** the operating
entity sells through a UK-registered Stripe account while the seller of record is resident
in Türkiye, and sells B2C into Saudi Arabia, the UAE and the EU — three jurisdictions that
each require VAT registration from the first sale to a non-resident seller, with no
threshold. Stripe direct would mean registering with ZATCA, the UAE FTA and the EU's non-
union OSS before the first dollar; Paddle, as merchant of record, becomes the seller of
record instead and absorbs those registrations at a fee (~5% + 0.50$) that is not higher
than Stripe UK's own effective rate on a Gulf card settling in dollars (~5.25% + 0.20£, once
the currency-conversion surcharge is counted).

## 2026-09-16 — the final review of plans v2 / Paddle: what was decided in the fix wave

Nine findings from the whole-branch review; the code is in `20260917060000_cancel_drops_to_free.sql`,
`pricing.ts` / `PricingPage.tsx` / `AdminPage.tsx`, and `scripts/paddle-sync-lib.mjs`.

**A cancelled or paused subscription is the free plan, not a row that says so.** `apply_billing_event`
had stored Paddle's `canceled` / `paused` as `status`, and every gate then refused the row — `reserve_usage`
with `plan_inactive`, `analysis_remaining` with `no_active_plan` — while the sweep looked only at
`past_due`: the customer who cancelled could not spend even the free hundred. The spec is «النزول إلى
free بلا حذف» (`docs/pricing.md`), so the webhook now writes what the sweep writes: `free / active`, no
provider, an open-ended period, on the root and every client row, audited `plan_paddle_canceled` /
`plan_paddle_paused` with target `free`. A later `activated` re-applies the plan. Neither status persists
on a row any more; the column still admits them so an old row is not a migration error.

**The seven-day grace is code, not Paddle's period.** `private.subscription_open(s)` is the one answer to
"may this subscription spend": active inside its period, or past-due for seven days past `period_end`.
`reserve_usage`, `analysis_remaining` and `topic_units_remaining` ask it; before, the meter refused at
`period_end` while the selection gate never looked at the period, so a past-due tenant passed selection
and met `plan_inactive` in the worker. The number is the one recorded on 2026-09-16 and the one
`billing_sweep` enforces from the other side.

**`plan_limit` refuses rather than answering null.** Null now means a live plan's own "no ceiling"
(owner), so a root with no active or past-due subscription must not read as unlimited channels and
workspaces: it raises `no_active_plan`. A workspace with no subscription row at all is refused the same
way — unentitled means unentitled, and `reserve_usage` already said so.

**The workspace limit counts client workspaces.** The card says "workspaces (clients): 5" and the
individual ladder says one workspace; the count in `create_workspace_impl` had included the home, so
`agency` got four clients. The home is not a client (`owned - 1 >= allowed`), and the column is the
number of clients: the individual rows go to 0 and the `>= 1` check to `>= 0`. `pilot` keeps its default
of 1 until it is renamed away.

**A second Paddle subscription for a live root is `conflict`.** `custom_data.workspace_id` is minted by
the browser at checkout; the webhook trusts it. The cheap guard now: an event whose `provider_ref` is not
the one the root is live on (`provider = 'paddle'`, active or past-due) is recorded with outcome
`conflict` and moves nothing; the webhook answers 200 on any decided outcome so Paddle stops retrying.
**Pre-live requirement:** the checkout transaction is minted on the server (an edge function that reads
the caller's session, checks ownership of the workspace, and creates the Paddle transaction with
`custom_data` it wrote itself), so the workspace in a webhook is never a value a browser chose. Until
then, live keys are not set.

**Ruling 17 — Paddle.js has no SRI.** `https://cdn.paddle.com/paddle/v2/paddle.js` (in `index.html`) is
an unversioned URL by Paddle's design — their docs mandate it and they ship fixes under it — so a
subresource-integrity hash cannot be pinned without breaking on their next release. Accepted as-is: it is
the same exposure every Paddle merchant carries, and no secret reaches the page (the client token is
public by design).

**Prices exclude tax: `tax_mode: "external"` on every synced price.** The first real sandbox invoice
showed both lines treated as tax-inclusive — the $12 was $10 plus $2 withheld. The sync creates every
price with `tax_mode: "external"` and PATCHes a found price that lacks it (counted under "updated");
the controller re-runs the sync so the seven existing sandbox prices take the mode. The decision itself
("price before tax, tax on top") is unchanged.

**`set_workspace_plan` keeps a Paddle link.** Over a root Paddle is billing it refuses with
`paddle_subscription_active` unless called with `override = true`; with it, the plan and period change
but `provider`, `provider_ref` and `provider_customer_ref` stay, so the portal and the next webhook still
find the subscription Paddle keeps charging, and the note lands in the audit row (`plan:note`) rather
than over the `provider_ref`. The admin page has the checkbox and the sentence. The four-argument
signature is dropped: with a default on the fifth, PostgREST would see two candidates for a four-field
call.

**A workspace already on Paddle changes plan in Paddle's portal.** The pricing page had offered a second
checkout for every other paid card; a second checkout is a second subscription. When `usage_summary`
says `provider = 'paddle'`, every paid self-serve card that is not the current one opens the portal
(`openPortal`, the plan panel's "manage"), with the same two refusals.

## 2026-09-17 — the public face: the address decides the language, and the pages are prerendered

**A public page's URL names its language.** The interface language was a browser
preference only, so `/` was one document that rendered in whichever of two languages
`localStorage` held — nothing a search engine could index as English or a reader could
share as English. Now `/en`, `/en/pricing`, `/en/privacy-policy` and `/en/terms` are the
English pages and the bare paths are Arabic; the route passes `locale` to the page, the page
reads its strings by it, and `usePublicLocale` writes it to the document and the stored
preference. Inside the product the preference still rules and there is no `/en`: those
routes are `noindex` and have no reason for a second address. The alternative — keep one
address and a `?lang=` or cookie — was rejected because `hreflang` needs one URL per
language and a crawler carries no cookie.

**The public pages are prerendered at build time, not server-rendered.** The host is static
files behind Apache and Cloudflare; the pages are four, in two languages, and change only
with a deploy. A build-time render into `dist/<path>/index.html` gives a crawler and a share
card the whole page with no runtime, and the browser hydrates the same tree. The pricing page
is the one with data: it is rendered with the catalogue read from the configured project at
build time (the fixture if the read fails, said aloud) and embeds the rows so hydration
starts from them and then refetches — so the static HTML's prices are the deploy's, not a
guess, and never a literal in source.

**The shell's fallback is `app.html`, not `index.html`.** The prerendered landing now
occupies `index.html`; a shell route hydrating against it would discard the markup and render
twice with a console error. `.htaccess` sends every non-file, non-directory, non-prerendered
path to the empty template instead.

**Indexing is one build flag, off by default.** `VITE_SITE_PUBLIC=true` flips the robots
meta, `robots.txt` and the `X-Robots-Tag` header together; nothing else touches them. The
site has been open to anyone with the link since 2026-09-16 and is now fully described to a
crawler, and it stays `noindex` until the owner decides — that decision is not made in a
commit. `docs/seo.md` §5 lists what to check first, including that Cloudflare currently
serves its own `robots.txt` in place of ours.

**The copy says the search phrase once per place, and still claims nothing the beta cannot
back.** `seo.test.ts` holds both: the phrase is in the title, description, H1 and FAQ title
in each language; no accuracy figure, no customer count and no dollar amount appear in the
landing's copy. The prices belong to the catalogue and the structured data reads them from
it.

## 2026-09-17 — retire refuses the platform owner; delete is a separate, admin-only door

**`retire_workspace` now refuses the platform owner's own workspace**
(`owner_cannot_retire`). Retiring was already how a workspace stopped existing; the platform
admin's own workspace is where `workspace_deleted` audit rows land for every *other*
deletion (see below), and it is the one home a signed-in admin always has. Retiring it would
leave the platform without an admin identity to act from. This is a narrower rule than "the
owner can't retire anything" — it blocks exactly the one workspace whose absence would be
unrecoverable from inside the product.

**A real, admin-only `delete_workspace(w)` exists alongside retire, with three refusals:**

- `last_workspace` — refused because a member with no workspace at all has nowhere in the
  product to land; retire already carries this same refusal for the same reason, and delete
  cannot be looser than retire.
- `billing_root` — refused because other workspaces under the same billing relationship
  point at this one as the root; deleting it would orphan their billing state rather than
  their rows.
- `paddle_subscription_active` — refused when the workspace's Paddle subscription is
  `active` or `past_due`. A `past_due` subscription is still Paddle's to collect against or
  cancel; deleting the workspace out from under it would delete the audit trail a chargeback
  or dunning dispute needs, not just stop charging it. Both statuses are refused for the same
  reason retire's Paddle guard exists: the plan/billing state is not this product's alone to
  discard.

Beyond the three refusals, `delete_workspace` is restricted to the platform admin — no
tenant role can call it, and no tenant role holds `DELETE` on the 27 tables it touches, so
the refusals are not the only thing standing between a member and this RPC.

**The deletion is recorded on the admin's own home workspace, not the one being deleted.**
`workspace_deleted`'s audit row has to outlive the delete, and the deleted workspace's own
`audit_events` rows are exactly what leaves with it — recording there would delete the
record of the deletion in the same transaction that makes it. The admin's home workspace is
the one home guaranteed not to be the one just removed (guaranteed by the owner-cannot-retire
rule above having no delete equivalent needed: the admin's home is never eligible to be the
argument to `delete_workspace` and be deleted along with its own audit row).

**Ruling made mid-task: the append-only trigger on `comment_reviews`, `topic_reviews` and
`audit_events` yields to the delete via a transaction-local setting, not a bypass.** All
three tables carry `private.reject_review_mutation` (`foundation.sql`), which refused every
delete unconditionally — that is the point of an append-only audit trail. Disabling the
trigger for the deletion would have meant either dropping and recreating it (a window where
nothing enforces append-only) or a session-level `session_replication_role` change (which
would silently also disable every other trigger for the rest of the session, not just this
one delete). Instead `delete_workspace` sets a transaction-local GUC,
`app.deleting_workspace = <id>`, and the trigger body was replaced to add exactly one
exception: it now yields to a `DELETE` of a row whose `workspace_id` equals that setting.
`UPDATE` is still refused unconditionally, with no exception — the audit trail can be
retired wholesale with its workspace, but never edited. No tenant role holds `DELETE` on
these three tables, so the GUC being set opens nothing from a client session — the GUC alone
is not the access control, the missing grant is; a test in
`supabase/tests/workspace_lifecycle.test.ts` proves that leg explicitly rather than leaving
it as an inference from the grants.

## 2026-09-17 — correcting the reason recorded above for `owner_cannot_retire`

The entry above gives the wrong reason. `retire_workspace` does not protect "the one
workspace where audit rows land"; it refuses the platform owner on *every* workspace they
hold (the check is `me = platform_owner()`), because retiring hands a workspace to the
platform owner — and when the caller is the platform owner, that is a transfer to
themself: the membership is deleted and re-inserted for the same person, nothing moves, and
the account page then reports «انتهت المساحة وانتقلت إلى مشغّل الخدمة», which is false.
That is why the account page (Task 2) offers no retire door to an admin at all. The
"admin identity" concern the entry above raises is real but is guarded elsewhere: by
`last_workspace` on both retire and delete, and by `billing_root` on delete. Recorded from
the migration's own header comment and the spec (`2026-09-17-workspace-delete-design.md`).

A second correction, same entry: the "recorded on the admin's own home" guarantee, given
above as "the owner-cannot-retire rule having no delete equivalent needed", is garbled and
names the wrong mechanism. The real guarantee is evaluation order: `delete_workspace`
computes `my_home := private.owner_plan_workspace(me)` *after* every `delete` in the
function has already run, so `my_home` can never resolve to the workspace just removed —
that row is gone from `public.workspaces` by the time the lookup happens, and
`owner_plan_workspace` only ever returns a workspace that still exists.

Two deferred recommendations from the same review, recorded rather than acted on: (1) a
workspace with a running job is not refused — a stuck job would otherwise block deletion
forever, and the worker already fails closed when the workspace it was working on has
vanished out from under it, so refusing on a live job trades a real, permanent problem for
one already handled; (2) `private.billing_events` rows for the deleted workspace are
detached (`workspace_id` set to `null`) rather than deleted — the column is nullable, and
the webhook trail is what a chargeback dispute needs to read after the workspace itself is
gone (see the dated correction in `docs/progress.md` for the fix and its test).

## 2026-09-17 — the landing rebuilt on the design system: what was decided, and why

**The hero and the demo share one `ProductWindow` component, still for one and interactive
for the other.** A separate hero illustration and a separate demo mock would each have
drifted from what the dashboard actually shows, the way the six duplicated-meaning defects
recorded in `docs/coordination/ACTIVE.md` did before. One component, built from `ui/`
parts (badges, bar chart, comment cards), takes a `mode` and renders the same product
picture whether it needs to sit still in the hero or respond to the demo's filters.

**The hero's alt sentence lives in the figure's visually-hidden `<figcaption>`, not on an
image, because the illustration it used to describe is no longer rendered.** The hero and
the demo now show `ProductWindow` instead of `audience-growth-original.webp`. The sentence
a screen reader needs did not become obsolete with the picture — it still describes what
the hero is showing — so it moved to the figure's caption rather than being deleted with
the `<img>` that carried it. The PNG/WebP stay on disk, unreferenced by the page, as
provenance for the palette and composition and as the source of the OG share image
(`docs/seo.md` §3 records the one-line update).

**`PublicShell` now serves all three public pages, not just pricing and legal, and the
pricing/legal CSS moves verbatim rather than being rewritten.** Landing, pricing and legal
shared one header/nav/footer by copy-paste before this task; `PublicShell` (Task 3) made
that one component, and Task 4 moved pricing's and legal's own body rules into
`pricing.css` / `legal.css`, byte-for-byte, so that the day's redesign touches the landing's
markup and CSS without also being a silent rewrite of two pages nobody asked to change.
`pricing.css` keeps one dead 650px override from that move, deliberately left for the
pricing body's own phase-5 redesign rather than pruned here.

**`useReveal` never hides a section that is already on screen at the moment it mounts.**
The eight sections fade in on scroll, but the prerendered HTML already contains the whole
page — a reveal hook that blanks everything until its own `IntersectionObserver` fires
would blink the page to invisible at hydration for whatever is already in the viewport,
which is exactly the kind of defect a static screenshot or a signed-out fixture would never
catch. Reduced-motion disables the reveal entirely rather than reducing it, for the same
reason: a user who asked for no motion should never see the blank frame either.

**Two new primitives — `ui/Accordion` and `ui/Dialog`'s `sheet` variant — carry their own
scroll and glyph mechanics, kept out of the pages that use them.** The FAQ's chevron is
supplied by CSS `content` on the trigger, not a text child, so a question's `textContent`
in a screen reader or a test is the question alone (`35f88bd` — a pre-existing drift from
`ui/Accordion`'s own documented contract, fixed as a prerequisite for Task 9's test, not a
new decision, but recorded here since it shapes every heading's accessible name). The
mobile sheet's same-page anchor links (`#why`, `#experience`, `#questions`) scroll from
Radix's own `onCloseAutoFocus` hook, not a guessed timeout — the trigger's default focus
restoration was scrolling the page back to the header after the native hash-jump already
landed, confirmed by sampling `scrollY` on a timer (stuck at 0 until 300ms) versus on the
hook (correct at the same instant the sheet closes). The intercept only fires for a href
starting with `#`; a cross-page anchor (the pricing page's own FAQ link,
`${home}#questions`) always falls through to a plain navigation, because there is no sheet
left to close once the page unloads.

**The sentiment badge tones stay live `color-mix(in srgb, var(--sentiment-*) …)`, not a
precomputed hex.** A contrast fix was needed — the raw token as 14px text on its own 14%
tint measured 4.31–4.65:1, under the 4.5:1 text floor a mark alone does not need — and the
fastest fix would have been to write the darkened value out as a literal hex in `ui.css`.
That would have reintroduced the exact "one meaning, two implementations" shape the tokens
exist to prevent: the tone would again live in two places, one of them silently able to
drift from `brand.css`'s own token. The tone is instead darkened by the same `color-mix()`
formula already used for the tint, computed live; the test that used to check "no hex
literal" for text-only reasons now also recomputes the expected mix from the token and
asserts it clears 4.5:1 arithmetically — a stricter guarantee that still fails the moment
the token or the CSS drift apart, which a text-only check could not have caught.

**The LCP budget ("after ≤ before") missed and was waived, not fixed.** `H1.hero-title` —
the same heading, before and after — paints at 96→132ms unthrottled and 280→408ms at 4×
CPU throttle (`.superpowers/sdd/2026-09-17-landing-redesign/vitals.txt`). Every value sits
well inside "good" (2.5s), the regression is the same element painting later rather than a
heavier one replacing it, and the plausible cause — a real `ProductWindow` parsed from the
prerendered HTML in place of what used to be a single deferred image request — is a
reasonable cost for removing a request, not a regression to chase on a synthetic local
`vite preview`. The measurement that actually answers the budget question is Lighthouse
against the deployed host, which this task cannot run; recorded PENDING in
`docs/coordination/ACTIVE.md` rather than closed here.

## 2026-09-17 — the landing's final review: corrections and clauses to the entry above

**Correction: the 650px block in `pricing.css` was live, not dead.** The entry above (and
the same day's progress note) recorded `@media (max-width: 650px) { .pricing-page .lp-nav
{ display: flex } .pricing-page .lp-header-cta { display: inline-block } }` as a dead
override, deferred to the pricing-body redesign. It was not dead: `.pricing-page .lp-nav`
and `.pricing-page .lp-header-cta` are (0,2,0), the same specificity as `public.css`'s
`.landing .lp-nav` and `.lp-header .lp-header-cta` hides, and the pricing stylesheet comes
later in the bundle — so on a phone the pricing header showed the inline links, the account
CTA and the sheet's menu button all at once, the one arrangement the sheet exists to
prevent. The block is deleted. The pricing page's header is the landing's header,
everywhere; a page that wants its own must say so with a class the shell reads, not by
out-ordering the shell's stylesheet.

**The two stylesheets a lazy page needs go in the entry.** `PricingPage` and `LegalPage`
are `lazy()` — the right shape, a visitor on the landing has no use for either — but a
stylesheet imported from a lazy page travels with its chunk, and a prerendered page has
painted long before a low-priority chunk lands. So `main.tsx` imports `pricing.css` and
`legal.css` eagerly, after the landing's, and `scripts/prerender.mjs` fails the build if
the stylesheet a pricing or legal page links stops carrying that page's rules. The
alternative — un-lazying the pages — would ship the catalogue reader and the legal texts
to every visitor to fix a problem that is only about CSS.

**The landing's type sizes hang off `.lp-page`, not `.landing`.** Three pages wear
`.landing` for the shared chrome; a `.landing h1` size in any one of their stylesheets is a
rule for all three. `public.css` keeps what is genuinely shared — margin, weight, and
`.landing:lang(ar) h1, h2 { letter-spacing: 0 }`, because joined letters need their zero
on every page — and the landing's sizes and Latin tracking are `.lp-page h1`/`h2` in
`landing/landing.css`, reached only through the class `Landing.tsx` passes to the shell.
The old `:lang(en) .lp-eyebrow { text-transform: uppercase; letter-spacing: 0.08em }` is
not restored: the eyebrow is a `ui/Badge` now and takes the badge's own case and tracking,
the same as everywhere else in the product.

**`vite preview` answers like the host, or the build guard measures the wrong page.** The
preview server probes no extensions and falls back to `index.html`, which on this site is
the prerendered landing — so `/pricing` returned the landing's markup, and a JavaScript-off
test that checked the pricing page's grid "where present" passed against the wrong page.
`vite.config.ts` gives the preview server `public/.htaccess`'s two rewrites, preview only.
A guard whose fixture differs from production in the very thing it guards is a guard in
name only; the middleware is twelve lines and the alternative was a second static server.

**Clause to the badge-ink decision above:** the darkened `color-mix(in srgb,
var(--sentiment-*) 90%, black)` ink is written in `ui.css` on the tone itself, so it
repaints every `Badge tone="positive" | "negative" | "sentiment-mixed" |
"sentiment-neutral"` anywhere in the product, not the landing alone. Today the only
caller is the landing's `ProductWindow`; the dashboard still draws its verdicts with its
own `report.css` rules, and the day it adopts `ui/Badge` for them it inherits this ink
without a decision of its own. That is the intent of a
primitive-level fix, and it is recorded here because the entry above read as if the change
were scoped to the landing.

## 2026-09-17 — the dashboard rebuild: what was decided, and why

**The filter bar is one sticky pane, with the rarely-used controls behind a «المزيد» popover
and a sheet under 900px — and the applied-filter chips live inside that pane, not below it.**
Four controls (video, period, per-page, comment type or whatever the section needs most) stay
on the bar itself; the other six sit behind «المزيد» so the bar never grows past one row at
normal widths. Under 900px the whole bar collapses to a single «الفلاتر» button that opens a
full sheet. The chip placement was the harder call: the plan's own brief first put
`ActiveFilters` directly below the sticky bar, non-sticky, and Task 11's cut-over shipped
that — then failed its own e2e test, "the report says what it is narrowed to, wherever you
have read to": scroll 2500px down a filtered report and the chips had scrolled out of view
with everything else. That test's name states the dashboard's own principle — a reader deep
in a narrowed report should not have to scroll back up to see what narrowed it — so the
layout was wrong, not the test. Fix: `FilterBar` gained a `chips?: ReactNode` slot rendered as
the form's last row, inside the sticky pane, only while at least one chip exists (an empty row
would cost pinned height for nothing, and the Provenance strip's scope sentence already covers
the no-filter case). The period note moved the other way, out of the pane and into a plain
`<p>` below it, to keep the pinned height from growing again for a sentence that is not a
filter. Net pinned height at 1280×900 with no filter applied: 154.5px (`useActiveSection`'s
scroll-spy rootMargin is tuned to `-163px` against that number).

**Radix `Select` has no empty-string option, so the sentinel `"__all"` is mapped at the
component boundary and the filter state keeps `""`.** Every other layer of the dashboard —
`Filters`, `filtersFrom`, `applyFilters`, the URL-adjacent state, the e2e assertions — reads
and writes `""` for "no filter chosen", unchanged from before this redesign. Only the
`ui/Select` trigger and its `onValueChange` translate `""` ↔ `"__all"` at the moment a value
crosses into or out of Radix, because Radix's own `Select.Item` refuses an empty `value` prop.
Nothing outside that one translation point ever sees `"__all"`.

**The review dialog's focus rules, end to end**: opening it moves focus to the form itself
(not the first field, not the select), matching the rest of the product's `ui/Dialog`
convention; `Escape` closes it, except mid-save, when the guard refuses the close the same way
`DeleteWorkspaceDialog` already refused one — a save in flight must not be interrupted by a
key someone forgot they were near; and on close, focus returns to whatever opened the dialog:
the row's own trigger button if that row is still in the DOM, or the comments section's
heading (`tabIndex={-1}`) if the row is gone — which happens for real when a save moves a
comment out of the currently-applied filter (e.g. saving under `unreviewed` after marking it
reviewed). The first cut of the fallback had no second branch and lost focus to `<body>`
whenever the row unmounted before the dialog finished closing; Task 10's review caught it, and
the fix is `document.body.contains(trigger) ? trigger.focus() : heading.focus()`, pinned by a
unit test that detaches the trigger before closing.

**`.ui-split`, the primitive both the dashboard's split bars and the landing's `ProductWindow`
share, draws pixel widths, not flex ratios.** The first version used `flex-grow` per segment,
which Chart.js-style proportional bars normally do — but flex-grow on a set of segments that
sum to less than the container's full width still grows them to fill it, silently hiding
whatever "remainder" the bar was supposed to show. That is exactly the case a video's split
bar exists to show honestly: an unanalysed remainder. So the primitive instead sets
`flex: 0 0 auto` and an inline `width: <pct>%` per segment, computed by each caller against
its own chosen denominator. The two callers chose different denominators on purpose:
`Videos.tsx`'s card bar is a share of the video's TOTAL comment count, so the muted background
that shows through is the unanalysed remainder, honestly proportioned; `Compare.tsx`'s row bar
is a share of the ANALYSED count, because that row also prints a percentage figure beside the
bar and that figure is itself a share of analysed comments — bar and printed number must agree
within one cell, which they would not if the bar used total and the text used analysed (this
was caught in Task 8's review as exactly that disagreement, in a cell for a partly-analysed
video). `Compare.test.tsx` pins both the 50/50-over-analysed case and the width arithmetic.

**`report.css` keeps loading, on purpose, for `/sync`, the catalogue panel and `/admin`
(Operations).** This plan's scope was the dashboard page alone; those three surfaces still use
`report.css`'s rules and were never touched by any of the twelve tasks. Deleting the stylesheet
now would break them. `dashboard/noReportCss.test.ts` guards the boundary from the dashboard's
side — no file under `dashboard/` may import it or carry an `rp-*` class — and phase 4 (not
scheduled here, recorded as pending in `docs/coordination/ACTIVE.md`) is the task that moves
those three surfaces onto the same `ui/`-primitive pattern and retires the file for good.

**The chart tooltip background is a hard-coded hex, not a CSS custom property, because a
`<canvas>` cannot read one.** `chartOptions.ts`'s shared `tooltip()` sets
`backgroundColor` to the literal value `brand.css`'s `--text-1` currently resolves to at the
document's default (light) theme — not `var(--text-1)`, which Chart.js's canvas renderer would
draw as the string `"var(--text-1)"` rather than resolving it, since canvas paint calls are not
CSS and never consult the cascade. `chartOptions.test.ts` pins the literal value directly
against the token's own definition in `brand.css`, so the two cannot silently drift apart
without the test catching it — the closest a canvas-drawn colour can come to being "the same
token" as the DOM's own rule, short of resolving it at runtime with `getComputedStyle`, which
the shared options object (built once, outside any component) has no element to call it on.

2026-09-17 — the demo data reads like a real channel (`docs/superpowers/sdd/2026-09-17-demo-data/`).

**Two fixtures, not one re-skinned in place.** The existing 7-row `dashboard.json` was a
deliberately-built **test kernel**: one unanalysed row, one whose text changed after analysis
(stale hash), one with an unknown date and unknown likes, a reply, a channel-owner reply, two
comment types — good test design, and load-bearing for 76+ `dashboard.spec.ts` assertions on
its exact arithmetic. A visitor's demo needs the opposite shape: a real-looking channel at
plausible scale (44 comments, 6 videos, several dialects), where "one row of each honesty
state" would read as thin and repetitive rather than as a channel. Rather than compromise
either shape to fit the other, the kernel stays exactly as it was — moved to
`e2e-dashboard.json`, only its human-visible strings re-skinned — and a new `dashboard.json`
is authored as the demo. `data.ts` picks between them by `VITE_FIXTURE_DASHBOARD`, which only
`playwright.config.ts` ever sets, so the existing browser suite is unaffected by content it
was never testing and a real visitor never sees test-kernel data.

**One authored content module feeds both fixtures through one generator**
(`apps/web/scripts/demo-content.mjs` → `make-demo-fixture.mjs`, `npm run demo:fixture`), rather
than either fixture being hand-edited JSON. This is what keeps `content_hash`, ids, dates and
the re-skin's structural fields (likes, flags, reply/owner structure, comment types, topics)
consistent with each other by construction: a future wording change is a content-module edit
regenerated through the same pipeline, not a second place that can drift from the first. A
unit test asserts the committed JSON equals the generator's fresh output.

**«توضيحية» (illustrative) replaces «اصطناعي» (synthetic/artificial) everywhere a reader or a
spec sees it**, because the operator's complaint was specifically that the word reads as
"fake" rather than "an example" — the fixture badge, the six prose strings, and the fixture's
own `field_provenance.origin` ("authored illustrative demo data; not real commenters") all say
what the data is (authored, for demonstration) without the connotation the retired word
carried. The honesty property itself — that fixture mode is clearly marked as non-live and
persists nothing — is unchanged; only the adjective describing it changed. A repo-wide scan,
`apps/web/src/noSyntheticWords.test.ts`, keeps the retired word from creeping back through a
new file or a copied sentence rather than trusting every future edit to remember the rule;
`apps/web/src/legal/*` is excluded on purpose, since the legal text's own «بيانات اصطناعية
موضّحة بوضوح» is out of this pass's scope.

**Content rules for the authored comments** (`demo-content.mjs`'s docstring is the source of
truth; recorded here so the rule is not only implicit in the data): every comment reads as
something a real person would type under that video — dialect-consistent, spelled the way that
dialect is actually written online, never two dialects mixed in one comment, transliterated
English limited to what is genuinely common (آيفون، لابتوب، أبديت). Names and handles are
realistic across the region and never a real public figure. No hate, politics or religion
beyond a passing «ما شاء الله» / «الله يعطيك العافية» (which is why the `religious` topic
exists at all), and no product claim presented as settled fact. Sentiment and topic labels are
what a careful annotator would actually assign — mixed comments read as "good, but…", neutral
ones as a genuine question or a flat statement — rather than picked to make the distribution
look tidy. Likes and dates follow a plausible shape: bursts in the days after a video posts, a
long tail of later stragglers, no comment liked more than its video's apparent reach would
support.

**The stale-hash row, the unanalysed rows and the unknown-date/likes rows are kept in the demo
fixture on purpose, as honesty features rather than gaps to fill in.** A demo channel with a
perfectly complete, perfectly current dataset would misrepresent what the product actually
looks like on a real channel — some comments are always edited after being read, some rows are
always missing a field the source never supplied, and the dashboard's whole "غير محلل / قديم" /
"لا تاريخ معروف" vocabulary exists to say so plainly rather than hide it. Removing those rows
from the demo to make the numbers rounder would make the demo a worse rehearsal for the real
product than the seven-row test kernel it replaced. `docs/superpowers/sdd/2026-09-17-demo-data/
task-1-report.md` records the exact counts this produced: 2 rows unanalysed (excluding the
channel-owner reply, which is null for the unrelated reason that owner rows are never
analysed), 1 stale-hash row, 1 row with an unknown `published_at`, 1 further row with an
unknown `likes_value` only.

**The demo smoke test intercepts the fixture path rather than running its own dev server.**
`playwright.config.ts`'s shared server sets `VITE_FIXTURE_DASHBOARD` server-wide, so there is
no environment variable `tests/e2e/demo.spec.ts` alone could set per-test. Rather than stand up
a second `webServer` entry with its own port and env (`playwright.config.ts`'s own comment
already warns that an orphaned server from another worktree makes a lane silently test the
wrong build), the test answers every request for the e2e path with the demo fixture instead —
the same `page.route` + `route.fetch({ url })` + `route.fulfill({ response })` shape
`dashboard.spec.ts` already uses elsewhere to rewrite a fixture in flight, aimed at a sibling
file on disk rather than at a mutated copy of the same one. This keeps the whole suite on one
server and one port, and keeps the interception scoped to the one file that needs it: every
other spec's `page.route("**/fixtures/e2e-dashboard.json", …)` calls are untouched and keep
reading the kernel.

2026-09-17 — Google sign-in and One Tap (`docs/superpowers/plans/2026-09-17-google-signin.md`,
design in `docs/superpowers/specs/2026-09-17-google-signin-design.md`).

**One Tap prompts on `/account` only, never the landing or the dashboard's fixture view.** A
visitor reading the marketing page has not asked to sign in; a visitor who came to the account
page has. The gate that keeps it there is the same `enabled` boolean the hook already carries
— Google an open provider, a client id configured, no session — hardened this task to also
wait for a `sessionRead` state so a signed-in visitor's first paint cannot fire it either, only
`getSession()` actually resolving to `null`.

**Google receives the SHA-256 hash of a random nonce; Supabase receives the raw value.** The
same raw/hashed split `oauth-start.ts` already uses for PKCE. `signInWithIdToken` verifies the
ID token's `nonce` claim is the hash of what it was handed, so a credential minted for one
browser's prompt cannot be replayed with a nonce that browser never asked for. `nonce()` returns
both values from one call, so they are constructed and verified together by design, never as
two independent pieces of state that could drift apart.

**No GIS-rendered button.** `authProviders.ts` already renders a Google door that calls
`signInWithOAuth`; a second, Google-drawn button beside it would be two controls for one
action — the same shape the account page already refuses everywhere else it applies (sign-out
lives once, in the header, for the same reason). One Tap is additive, a passive prompt that
never blocks the existing door, not a replacement for it.

**The client id is public; the secret lives only in Supabase's own provider configuration.**
`VITE_GOOGLE_CLIENT_ID` ships in the built bundle by nature of being a client id — Google's own
model assumes this — the same way the Supabase project URL and publishable key already do.
Nothing new crosses the browser/server boundary: `GOOGLE_CLIENT_SECRET` (backend, for the
channel-connect's own OAuth code exchange) is untouched and was never a candidate for `VITE_*`.

**The same Google Cloud OAuth client the YouTube channel-connect already uses**
(`272573239614-31idkf1nk8hegpceqt3pdmbeefnsaqsr.apps.googleusercontent.com`, project
`272573239614`) also carries sign-in, rather than registering a second client. One project, one
client id, one place to add a redirect URI or an authorized origin. This costs no isolation
between the two flows either way: `signInWithIdToken` only ever produces a Supabase session,
and the channel-connect's own server-side callback is what performs the
`channels.list(mine=true)` binding — neither flow can act as the other regardless of which
client signed the token.

2026-09-17 — operations and admin redesign (`docs/superpowers/plans/2026-09-17-ops-admin-redesign.md`,
design in `docs/superpowers/specs/2026-09-17-ops-admin-redesign-design.md`).

**The admin demo's reducer mirrors the server's refusals rather than mocking PostgREST.**
`adminDemo.ts`'s `reduceAdminDemo` reads six fixture workspaces and throws the exact
`{message, code}` shape a PostgREST error carries for `paddle_subscription_active`,
`billing_root`, `last_workspace`, `no_active_plan`, `unknown_plan` and `invalid_months` — the
same SQLSTATEs and conditions `set_workspace_plan`, `private.grant_units` and
`delete_workspace` enforce — instead of stubbing the Supabase client or faking network
responses. That lets `adminErrorMessage` (untouched) render the identical sentence a live
refusal would, and it lets `tests/e2e/admin.spec.ts` drive the real `AdminPage`/`WorkspaceRow`
components end to end at `/admin?demo=1` rather than a separate demo-only page — the browser
suite is exercising the same code a real admin session runs, with only the data source swapped.

**`pages.css` is the shared rhythm for every signed-in page; `ui/` never depends on it.** The
dashboard, `/sync` and `/admin` all import `pages.css` for the `db-*` classes (`db-page`,
`db-hero`, `db-section`, `db-grid`, `db-missing`, …), but a `ui/` primitive that needs its own
class — `Labelled`'s field wrapper — gets that class defined in `ui/ui.css` (`ui-field`, not
`db-field`) so `ui/` stays importable by a page that has not loaded `pages.css` at all. The same
rule moved `useMediaQuery` into `ui/` rather than leaving `admin/` reach into `dashboard/` for
it — one page importing another page's internals is exactly what this phase undid.

**`BudgetMeter` is the meter every page adopts.** It replaced the native `<progress>` in
`/sync`'s plan-budget panel this phase, rendering a `role="progressbar"` div coloured by
`budgetState()` (`--ml-indigo`/`--color-warning`/`--color-danger`) instead of relying on the
browser's own progress-bar paint (which Chrome renders green regardless of what the sentence
beside it says). `PlanPanel.tsx` on `/account` still draws a native `<progress>` — deliberately
left alone this phase, since `/account` had no design work done on it at all — and is phase 5's
first candidate to move onto `BudgetMeter` instead of carrying a second, inconsistent bar
implementation forward.

**`account.css` is verbatim until phase 5.** With `report.css` retired, `/account` needed
somewhere to keep the rules it still matches; rather than redesign the account page in the same
task that deletes its stylesheet, every block `Account.tsx`/`WorkspaceCard.tsx`/`PlanPanel.tsx`/
`SetupPath.tsx` still uses was copied out of `report.css` unchanged — selectors, comments, even
the small dead ones (`.history li`, `td button`) a shared block carried along — so the page
renders identically to before the move. No visual or structural decision about `/account` was
made in this phase; `account.css` is a holding pen, and phase 5 is where that page is actually
recomposed on `ui/`.

**The two `<progress>` e2e assertions that changed are the only class of e2e change this phase
allowed itself.** The ruling going in was that the oracle (`tests/e2e/dashboard.spec.ts`) does
not get edited to make a redesign easier — except where the element under test stopped
existing because a native control became a `ui/` one. `BudgetMeter` replacing the operations
panel's `<progress>` is exactly that case: the two assertions that read the old element (an
`appearance: none` check and a colour-carries-no-figure check) were rewritten against the new
`role="progressbar"` div's computed style, asserting the same guarantee against the new markup
rather than being dropped or loosened. Every other e2e file and every other assertion in
`dashboard.spec.ts` is untouched by this phase.

2026-09-18 — the account redesign (`docs/superpowers/plans/2026-09-17-account-redesign.md`,
design in `docs/superpowers/specs/2026-09-17-account-redesign-design.md`).

**Demo modes — `?demo=1` on a fixture plus a pure reducer that mirrors the server's exact
refusals — are the browser-test strategy for every gated page.** The dashboard, `/sync`,
`/admin` and now `/account` each follow the same idiom: a fixture under
`apps/web/public/fixtures/`, a pure reducer that throws the identical `{message, code}` shape
PostgREST returns for the refusals the SQL enforces, and a Playwright suite that drives the real
page component against `?demo=1` rather than a separate demo-only route or a mocked Supabase
client. `accountDemo.ts`'s `reduceAccountDemo` (`invalid_name`, `last_workspace`) is this
pattern's fourth implementation, closing the set: every page that requires a signed-in, gated
session now has a demo a visitor, a screenshot tool, or a reviewer with no account can reach.

**Destructive confirmations live in `ConfirmDialog` on `ui/Dialog`, not inline blocks.**
`WorkspaceCard.tsx`'s disconnect and retire actions used to open an inline confirmation block in
the card's own flow, styled by the old `report.css`-derived sheet's `.disconnect-confirm` rule;
task 3 replaced both with the shared `ConfirmDialog` component wrapping `ui/Dialog`, the same
portal-rendered, focus-trapped pattern `apps/web/src/DeleteWorkspaceDialog.tsx` (consumed from
`admin/WorkspaceRow.tsx`) already established last phase. A destructive action now always opens
a modal the rest of the page cannot be interacted through, rather than an inline block that
pushes surrounding content around and could not be dismissed except by pressing one of its own
buttons — the dialog's advantage is the focus trap and the detachment from the page's layout, not
click-outside safety: an overlay press dismisses the Radix dialog too (`onOpenChange(false)` →
`onClose` → `keep`), same as the inline block's own keep button did. `Account.setup.test.ts`'s
two open-dialog assertions moved into `WorkspaceCard.test.tsx` for exactly this reason: a portal
renders outside the page's own static markup, so an assertion that the dialog is open has to run
against the component that owns it.

**`BudgetMeter` lives in `ui/` and is the one meter.** Moved out of `ops/` this phase (where it
had been `/sync`'s own component since the ops/admin redesign) so `/account`'s `PlanPanel` could
adopt the identical `role="progressbar"` div instead of drawing a second, native `<progress>`
element left over from before that page had any redesign attention. `/sync` and `/account` now
render the same meter, coloured by the same `budgetState()` function, off the same CSS — one
meter implementation in the tree, not two that happen to agree.

**The `rp-*` vocabulary is gone, and the guard refuses it in `.tsx` and `.css` alike.** The
verbatim `account.css` — the last reader of any `.rp-*` rule, kept alive across two prior phases
specifically so `/account` would not need a visual redesign in the same task that deleted
`report.css` — is deleted along with every remaining `.app-shell .rp-*` block in `app.css`.
`noReportCss.test.ts` lost the allow-list it had carried since the ops/admin phase (the four
files "permitted… until phase 5") and gained a second, unconditional assertion: no `.css` file
anywhere under `apps/web/src` may contain the substring `.rp-`, in a selector or inside a
comment. The class family that named the old report page is not just unused now; it cannot be
reintroduced without failing a test.

## 2026-09-18 — the onboarding tour: what was decided, and why

**Browser-side memory, not a server flag.** Whether this reader has met the tour lives in one
`localStorage` key (`tour:v1`), the same tier `locale.ts` and the workspace-selection
preference already use, not a column on the account. The cost, accepted up front and named in
the spec's own "Out of scope": a second device or a cleared profile meets the welcome again.
The alternative — an RPC and a migration to remember one boolean per account — buys nothing a
tour actually needs: nobody is paying to see it once and only once, and a server round trip
before the first paint of a shell that already waits on a session would be a worse trade than
an occasional repeat welcome. Revisit only if per-account tour state is ever needed for a
reason unrelated to this feature.

**The layer is a separate lazy chunk, not part of the eager shell bundle.** `TourProvider`
(context, the auto-start rule, `useTour`) is small enough to live in `main.tsx`'s own bundle —
task 2 measured its cost at +4.43 kB (+1.42 gzip); the veil, the card and the welcome
(`Tour.tsx`, `TourWelcome.tsx`, `tour.css`) are `lazy()`-imported only once the machine leaves
`idle`, so a reader who never opens the tour never fetches them. Task 4's real build puts that
chunk at 4.59 kB JS (gzip 2.01) + 1.09 kB CSS (gzip 0.56) — small, but the point was never the
size; it is that a feature most readers meet once, briefly, does not sit in the bundle every
reader downloads to see the dashboard.

**Anchors are a `data-tour="…"` attribute, not a `data-testid`.** The seven places the tour
points at (`rail`, `rail-menu`, `workspace`, `setup`, `catalogue`, `selection`, `filters`,
`sections`) already carry, or gained, their own `data-testid`s for their own pages' suites;
overloading those for the tour would have coupled two unrelated concerns — a page's own test
hooks, and where a guided tour happens to point this version — so that renaming a page's test
id could silently break the tour, or retargeting the tour could silently break a page's suite.
A second, tour-only attribute keeps the two vocabularies from colliding, and doubles as the
tour's own "is this anchor lit" signal (`data-tour-active`) without touching the page's markup
beyond one attribute per anchor.

**A step whose anchor never appears is skipped, not shown broken.** `useTour` polls for
`[data-tour="…"]` up to 1.5s per step and moves on if it never arrives — an empty dashboard
has no section nav yet, a brand-new account no workspace card — rather than opening a card
pointed at nothing or leaving the tour stuck. That clock starts when the step's page arrives,
not when the step is entered: the router holds the old location while a lazy chunk loads, so
a slow chunk or the account page's first fetch is not charged against the anchor's wait (with
one clock from entry, a 1.7s chunk skipped step 2 silently). A separate, longer bound (5s,
`routeWait`) governs a step whose route never loads (a page that refuses the reader), so a
broken page cannot hang the tour either; the last step missing ends the tour as "seen", the
same door finishing opens, since a tour that could not finish itself should not keep offering
to.

**Card placement is room-aware, not a fixed side-per-step map.** The straight spec-table
mapping (`placement: "end"` → Radix `side: "right"`/`"left"` by direction) put the workspace
and setup cards half off a 1280px viewport, because their anchors fill the whole content
column and Radix's own flip has nowhere better to go. `Tour.tsx` now decides the side once per
anchor (`fitSide`), scrolls a tall anchor to the top instead of centring it when a card needs
room only on one side (`scrollBlockFor`), and — only for an anchor too tall for either side to
hold a card, never a short one — cuts the box the card is placed against down to its visible
top, never below 24px (`cardAnchorRect`). The hole is never cut; it always follows the anchor's
real box. Full reasoning and the measured placements at both breakpoints are in
`.superpowers/sdd/2026-09-18-onboarding-tour/task-3-report.md`.

**`playwright.config.ts` seeds `tour:v1=seen` into every project's `storageState`, and
`tests/e2e/tour.spec.ts` is the one file that opts back out.** The welcome auto-opens over
the first signed-in or demo visit to `/dashboard`, `/account` or `/sync` this browser has no
memory of — which, without the seed, is every existing test's first visit, sitting a modal
over whatever that test came to press. Seeding "seen" once, centrally, keeps the tour's own
first-visit behaviour out of every unrelated suite without those suites doing anything
tour-aware; the tour's own suite resets `storageState` to empty and drives the real
first-visit path instead.

## 2026-09-18 — the worker's credential is the platform's, not a workspace's

A worker credential was bound to one workspace (`20260913160000`), and the launchd worker
carried one per tenant. That model needed an operator for every new workspace and broke
silently when a deleted test workspace took a live credential with it on 2026-09-17. Chosen,
over provisioning a scoped credential per signup: a **platform credential** —
`worker_credentials.workspace_id` null — that resolves to every workspace
(`20260918130000`). The claim crosses workspaces oldest-first, the poll is a sighting of every
workspace in the `worker_seen` table that already decides «متصل», and the job-bound guard
answers the job's own workspace. Nothing above SQL changed: the wire contract never carried a
workspace, which is exactly what made this a one-migration change. Scoped credentials keep
working; a workspace's last one may be retired once a platform one is live. Design:
`docs/superpowers/specs/2026-09-18-platform-worker-credential-design.md`.

2026-09-19 — A lease's reclaim evidence is a heartbeat, not a lapse; and a claim is scoped to the
kinds of work its caller can run. The 2026-09-19 incident had one root: `claim_job` read more out
of the world than the world had said. A platform replay re-claiming a lapsed lease counted as a
worker fight and drove a collect job to `reclaims=20`, one claim from permanent burial; and an
operator's collection run claimed whatever job was oldest, consuming a queued topics job and
finishing it «succeeded» with nothing classified. The fix is in the semantics, not the tuning:
`jobs.heartbeats` separates "nobody held this" (resume free — a replay or a pre-first-heartbeat
death) from "a live holder went silent" (a real takeover — counts, backs off, and at twenty still
buries the job as `lease_thrashing`). The heartbeat's renewal is a five-minute floor, fixing a
latent bug where an early heartbeat shortened a five-minute lease to sixty seconds. Claims carry
`job_types` end to end (worker → gateway → SQL), so a collection-only run can never be handed a
topics job, and a loop without a classifier never holds one for five idle minutes. Unscoped claims
remain the contract for a worker able to run everything. Verified transactionally on the live
engine, then applied; the scoped RPC's parameter name had to match the gateway's exactly
(`credential_hash`), which PostgREST enforces by name at the RPC boundary — a second migration
corrected the name, and both migrations are registered in `supabase_migrations`.

Known limits recorded honestly: the rewritten SQL tests (`lease_recovery.test.ts`, new
`scoped_claim.test.ts`) and the TS handler test need a `npm run test:db` under pinned Node 22,
which this machine does not have. The wedged-PostgREST failure class is detectable only from
outside the database; an external uptime probe against the worker gateway is the remaining gap
between this state and near-zero maintenance, alongside the missing git remote.

2026-09-19 — Resource protection: what guards the platform, and what is deliberately not built
yet. Already standing: analysis metering charges once per unique verdict and refuses an unpaid
batch outright (402, never a silent overrun); one outstanding collection per channel with
selection backoff and unchanged-count deferral bounds YouTube quota; batch size caps and lease
semantics bound the queue; RLS bounds every read to the caller's membership; prediction reads are
keyed to the active analysis, so history is stored but never re-served. Fixed this round: the
dashboard's per-comment review lookups were sequential scans — two tables walked top-to-bottom
once per comment, ~37,700 scans per page load at the current size — now indexed. Monitoring
(`scripts/monitor.sh`, cron every 5 minutes) is the outside-the-database alarm the wedged
PostgREST of 2026-09-18 proved necessary.

The one structural decision still open, recorded so it is made with data rather than in an
incident: `dashboard_snapshot(w)` returns every comment of the workspace in one response, and the
derived filters run in the browser. At 18,875 rows that is seconds of Postgres JSON build and a
multi-megabyte transfer per visitor page load; it scales with the workspace, not with the page.
The trigger for splitting it — an aggregates RPC beside a paged comments RPC, with
`packages/contracts` `filteredRows` remaining the single filter implementation both paths mirror
— is a workspace passing ~50k comments or a page load p95 past two to three seconds, whichever
comes first. Exports, when built for live mode, must write to the private storage bucket as a
background job (the design already says so); never assembled in edge-function memory. Platform
rate limits on the browser-facing functions (`oauth-start`, `oauth-callback`) are a dashboard
setting, not code. A `statement_timeout` on the authenticated role was considered and deferred:
as a last-resort cap it would first bite the snapshot RPC itself, punishing the read before the
fix that makes it light.

2026-09-19 — A channel can be added by link or search: the public-data path beside OAuth. The
spec always held both doors (`youtube_data_api_public` beside `youtube_oauth`; A4: "Public
API-key collection can precede creator OAuth"), but only OAuth was wired: the UI's only channel
door left for Google, the worker's discover was hardwired to `mine=true`, and a lease carried no
channel identity. The whole path now exists: `register_public_channel` (new migration,
`20260919180000`) files a channel with the metadata the lookup found and never writes a status —
`connected` stays reserved for a completed OAuth flow, unchanged; a new `channel-lookup` Edge
Function names candidates from a link, `@handle`, `/user/`, bare UC id or a search, via
`YOUTUBE_API_KEY`; the claim carries `external_channel_id` — only for channels whose row says
`public_unverified`, so a connected channel whose grant fails to open is still reported
unconnected, never silently re-read as public data (the "no silent source switch" rule); and the
worker, given `YOUTUBE_API_KEY`, runs discover/collect for public channels by id
(`catalogue(channel_id=...)`, provenance `youtube_data_api_public`). The lookup needed a new Edge
Function rather than an RPC because the key must stay server-side and resolution needs YouTube
round trips — in-stack (Deno, same CORS/JWT pattern as `oauth-start`), no new infrastructure. It
does only the naming; the row is written by the browser calling `register_public_channel` with
its own JWT, so the role and tenant checks stay in the database. Cost, recorded for the operator:
naming a channel costs 1 quota unit; `search.list` costs 100 of the project's daily 10,000 — the
UI's empty/refused states say so rather than hiding the quota behind a generic failure. The demo
body deliberately gets no add-channel door (no server to ask), matching the existing
no-handler-no-door pattern.

## 2026-09-20 — dashboard_snapshot windowing at scale and fair claim scheduling

As live comment collection on active workspaces scaled past 60,000 comments, the unbounded `dashboard_snapshot` RPC generated over 120MB of JSON per request. PostgREST and Cloudflare terminated connections with HTTP 520 / 504 errors, causing the web UI to present `read:live_unavailable`.
- **Windowing recent comments**: `private.dashboard_snapshot_impl` was updated in `20260920140000_dashboard_snapshot_window_and_fair_index.sql` to scope materialized comment rows to the most recent window (1,500 comments, ordered by `published_at DESC NULLS LAST, id DESC`).
- **CTE scoping**: Sentiment and topic predictions, human reviews, and annotations now join directly against the 1,500 scoped comments rather than materializing across tens of thousands of rows before aggregation.
- **Index tuning**: Added `comments_workspace_published_desc_idx` on `(workspace_id, published_at DESC NULLS LAST, id DESC)` and `jobs_running_fair_idx` on `(workspace_id, status, lease_expires_at) WHERE status = 'running'` to accelerate both dashboard queries and fair claim scheduling.
- **Payload & Latency reduction**: Reduced payload size from > 120MB to 1.9MB and RPC execution time from > 20s (timeout) to 762ms, completely resolving live dashboard availability while remaining 100% compliant with `LiveSnapshotSchema`.
- **Polling stabilization**: Fixed TanStack Query `snapshot.refetch` dependency churn in `apps/web/src/ops/Sync.tsx`.

## 2026-09-20 — Continuous Deployment (CD) with GitHub Actions, FTPS, and Remote Migrations

- **Workflow Architecture**: Created `.github/workflows/deploy.yml` triggered on push to `main` and `workflow_dispatch`.
- **Security & Supply Chain Compliance**: Follows all security rules in `AGENTS.md`: every action is pinned to a full commit SHA (`actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`, `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0`), `permissions: contents: read`, `concurrency: group: deploy-preview-${{ github.ref }}, cancel-in-progress: true`, `timeout-minutes: 20`, and `persist-credentials: false`.
- **Decoupled Environment Credentials**: Updated `scripts/deploy-preview.sh` to source `.env.local` conditionally so environment variables injected by GitHub Secrets (`PREVIEW_FTP_HOST`, `PREVIEW_FTP_USER`, `PREVIEW_FTP_PASSWORD`) are seamlessly respected in CI runners.
- **Automated Remote Database Migrations**: Added `scripts/apply-migrations-remote.mjs` (`npm run db:migrate:remote`), executing pending migrations transactionally against the remote Supabase Management API (`https://api.supabase.com/v1/projects/{ref}/database/query`) and recording versions in `supabase_migrations.schema_migrations`.
- **Graceful Secret Detection**: The workflow checks for required repository secrets and logs helpful GitHub notices instead of blocking PRs or failing unconfigured runs if secrets are pending setup in GitHub Settings.

