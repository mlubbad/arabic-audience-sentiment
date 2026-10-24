# 0007. Channel indexing and comment ingestion hardening

Status: proposed
Date: 2026-10-24

## Context

A comprehensive code and live-database audit (`SKY-197` / `SKY-199`) of `workers/python/src/collectors/*`, `workers/python/src/server/runner.py`, `supabase/functions/channel-lookup/index.ts`, and `supabase/schema/current.sql` identified six concrete defects in channel discovery and comment ingestion:

1. **Incremental Sync Reply Blindness (`youtube_api.py`):** `commentThreads.list(order="time")` orders threads by `topLevelComment.publishedAt`, not by latest reply timestamp. Breaking out of the loop at the first top-level comment older than `since` silently dropped all new replies posted on older threads.
2. **`batch_too_large` Crash Risk (`youtube_api.py` + `private.commit_batch`):** A single `commentThreads.list(maxResults=100, part="snippet,replies")` page with 5 inline replies per thread yields up to 600 comments, exceeding `private.commit_batch`'s hard limit of 500 comments per batch (`RAISE EXCEPTION 'batch_too_large'`).
3. **30-Day Unchanged-Video Comment Purge Bug (`private.worker_video_counts` + `private.purge_comment_text`):** When `worker_video_counts` verified that an active selected video's `reported_comment_count` was unchanged (`last_outcome = 'unchanged'`), it deferred the video without updating `public.comments.last_seen_at`. After 30 days of stable comment counts, `purge_comment_text` falsely wiped `text_raw`/`text_plain` (e.g. purging 23,263 comments on `@asharqnews`).
4. **Fabricated `datetime.now()` Timestamps & `invalid_batch` Refusals (`apify.py`, `brightdata.py`, `telegram_collector.py`, `x_collector.py`, `tiktok_collector.py`):** Missing timestamps in X, TikTok, and Telegram collectors defaulted to `datetime.now(timezone.utc)` (violating Invariant #3: _"A missing date is null with precision unknown, never now()"_) or paired `published_at = None` with `timestamp_precision = "second"`, which `private.commit_batch` rejected as `invalid_batch`.
5. **Monolithic Catalogue Commits & Tab-Head Eviction (`runner.py` + `private.worker_known_videos`):** `run_discover` sent multi-thousand-video catalogues in a single HTTP request, and `worker_known_videos`'s flat `LIMIT 5000` could evict the head of a less-frequent tab (e.g. `stream`) when a channel had >5,000 Shorts or Videos.
6. **100-Unit Quota Spend on Handle-Shaped Queries (`channel-lookup/index.ts`) & Unused Zero-Quota YouTube Atom Feed:** `/c/ChannelName` and bare handle queries invoked `search.list` (100 quota units) without first trying `channels.list(forHandle=...)` (1 quota unit), and `YouTubeAPI` lacked support for YouTube's zero-quota Atom feed (`/feeds/videos.xml`).

## Decision

1. **Reply-Aware Delta Sync (`YouTubeAPI.batches`):** When `effective_since` is reached on a `commentThreads` page, set `cutoff_reached = True` (preventing further page fetches) while continuing to inspect the already-fetched page's older threads for inline replies newer than `effective_since` (and scheduling overflow reply fetches filtered by `effective_since`).
2. **Sub-Batching Guard (`_MAX_BATCH_COMMENTS = 500` in `YouTubeAPI.batches`):** Automatically split any page exceeding 500 total comments (top-level + inline replies) into `<= 500`-comment sub-batches with distinct checkpoint sub-batch indices before yielding to `commit_batch`.
3. **Zero-Quota YouTube Atom/RSS Feed, WebSub Push, HTML Handle Resolution & Timedtext Captions (`YouTubeAPI`):**
   - `rss_recent_videos` / `rss_video_ids` parses `https://www.youtube.com/feeds/videos.xml?channel_id=UC...` with regex + `html.unescape` (0 API quota units, no XML entity expansion surface) and supports `use_rss_precheck=True` in `catalogue()`.
   - `subscribe_websub` registers or unregisters webhook push subscriptions on `https://pubsubhubbub.appspot.com/subscribe` (0 quota units).
   - `resolve_channel_id_zero_quota` extracts `UC...` channel IDs directly from public YouTube channel HTML (`<meta itemprop="channelId">` / `"externalId"`), and `fetch_video_transcript` pulls public timedtext captions at 0 Data API quota cost.
4. **Chunked Catalogue Commits (`_MAX_CATALOGUE_COMMIT_CHUNK = 500` in `server/runner.py`) & Checkpointed Scraper Pagination (`x_collector.py`, `tiktok_collector.py`):**
   - Commit catalogues exceeding 500 videos in 500-video chunks with worker heartbeats between chunks.
   - Support `checkpoint = '{"offset": N}'` pagination across scraper comment batches in `XCollector` and `TikTokCollector`.
5. **Strict Timestamp Invariant Across All Collectors & Flex Tier Auto-Fallback (`apify.py`, `brightdata.py`, `telegram_collector.py`, `x_collector.py`, `tiktok_collector.py`, `topics/gemini.py`, `genres/gemini.py`):**
   - Never substitute `datetime.now()` for a missing date; keep `published_at = None` and set `timestamp_precision = "second" if published_at else "unknown"`.
   - `GeminiTopicClassifier` and `GeminiGenreClassifier` support `service_tier="flex"` (50% cost discount) with automatic fallback to standard tier on `400/429/503`.
6. **SQL Hardening (`supabase/migrations/20261126000000_channel_indexing_and_comment_ingestion_hardening.sql`) & `channel-lookup` Pre-Check:**
   - `private.worker_video_counts` refreshes `last_seen_at = now()` on non-purged comments of videos verified as `unchanged`.
   - `private.worker_known_videos` prioritizes the newest 200 items of each `kind` (`video`, `short`, `stream`) within its `LIMIT 5000` window.
   - `private.adopt_channel_content` replaces row-by-row per-video loops with a single set-based bulk `INSERT INTO public.comments ... SELECT ...` and bulk `UPDATE public.video_selections`, while widening the public-collection source allowlist to include Facebook and Instagram collectors.
   - `supabase/functions/channel-lookup/index.ts` tries `channels.list(forHandle=@...)` (1 unit) before `search.list` (100 units) whenever a `search` query is a valid handle token (`^[A-Za-z0-9._-]{3,30}$`).

## Consequences

- **Easier:** Zero lost replies on older threads during incremental sync; zero `batch_too_large` or Telegram `invalid_batch` failures; active monitored videos keep their comment text across 30-day windows; 99% quota reduction on `/c/` and bare-handle lookups.
- **Harder:** `worker_video_counts` touches `public.comments.last_seen_at` for deferred videos, which is indexed by `(workspace_id, video_id)`.
- **Watch:** Monitor `jobs` table for any remaining `invalid_batch` or `time_budget` occurrences.
