# Audience Interaction Metrics & Storytelling with Data Design Spec

**Date**: 2026-09-24  
**Status**: Approved  
**Author**: Antigravity  
**Reviewer**: User (Authorizer)  

---

## 1. Executive Summary & The Big Idea

The goal of this architectural expansion is to elevate the platform from a purely text-based sentiment classifier into an end-to-end **Audience Intelligence & Engagement Storytelling Dashboard**, matching the user's reference visual mockup and Cole Nussbaumer Knaflic's *Storytelling with Data* 6-step framework.

By extracting full interaction signals already reachable within YouTube Data API v3 scopes (without increasing API quota consumption), storing them directly in PostgreSQL with multi-tenant RLS, and computing enriched metrics via server-side aggregation, the dashboard empowers creators and decision-makers to answer the fundamental question:
> **"ماذا يشاهد الجمهور وماذا يقول؟ وما هو المحرك الحقيقي لتفاعلهم وما هي الخطوة التالية؟"**

---

## 2. Ingestion & Collector Pipeline (`workers/python`)

### A. Data Fields Extracted
1. **Video Level (`videos.list` & `catalogue`)**:
   - `viewCount` -> `view_count` (`bigint`)
   - `likeCount` -> `like_count` (`bigint`)
   - `favoriteCount` -> `favorite_count` (`bigint`)
   - `tags` -> `tags` (`text[]`)
   - `description` -> `description` (`text`)
   - `categoryId` -> `category_id` (`text`)
2. **Comment Level (`commentThreads.list` & `comments.list`)**:
   - `snippet.authorProfileImageUrl` -> `author_profile_image_url` (`text`)
   - `snippet.authorChannelUrl` -> `author_channel_url` (`text`)
   - `snippet.totalReplyCount` -> `reply_count` (`integer`)
   - `snippet.updatedAt` -> `updated_at` (`timestamptz`)
3. **Channel Level (`channels.list`)**:
   - `statistics.subscriberCount` -> `subscriber_count` (`bigint`)
   - `statistics.viewCount` -> `total_view_count` (`bigint`)
   - `statistics.videoCount` -> `video_count` (`integer`)
   - `snippet.thumbnails.default.url` -> `avatar_url` (`text`)

### B. Quota Efficiency
- YouTube API quota cost remains **0 extra quota units**:
  - `videos.list` already requests `part="snippet,statistics,contentDetails"`.
  - `commentThreads.list` already requests `part="snippet"`.
  - Fields are extracted from the existing HTTP response objects.

---

## 3. Database Schema & Server Aggregation

### A. New Migration (`20260924000000_interaction_metrics_and_storytelling.sql`)
1. Add columns to `public.videos`: `view_count`, `like_count`, `favorite_count`, `tags`, `description`, `category_id`.
2. Add columns to `public.comments`: `author_profile_image_url`, `author_channel_url`, `reply_count`, `updated_at`.
3. Add columns to `public.channels`: `subscriber_count`, `total_view_count`, `video_count`, `avatar_url`.
4. Index: `videos_views_idx` on `public.videos(workspace_id, view_count desc nulls last)`.

### B. Updated Server Aggregates (`private.dashboard_aggregates_impl`)
- **`kpis` Object**:
  - `total_views`: Sum of `view_count` across videos in the workspace/filter.
  - `total_likes`: Sum of `like_count`.
  - `total_comments`: Total comments count.
  - `engagement_rate`: $\frac{\text{total\_likes} + \text{total\_comments}}{\text{total\_views}} \times 100$.
  - `net_sentiment`: $\frac{\text{positive} - \text{negative}}{\text{positive} + \text{negative}} \times 100$.
- **Enriched `videos`**:
  - Include `view_count`, `like_count`, `reported_comment_count`, `thumbnail_url`, `engagement_rate`, and sentiment distribution (`positive`, `negative`, `neutral`, `mixed`).
- **Enriched `people`**:
  - Include `avatar_url` (`author_profile_image_url`), `channel_url`.
- **Enriched `dashboard_comments_impl`**:
  - Return `author_profile_image_url`, `reply_count`, `author_channel_url`.

---

## 4. Dashboard UI & Storytelling with Data

### A. The 6-Step Storytelling Mapping
1. **Context & The Big Idea**: Hero header framing the core insight.
2. **KPI Strip**: 5 cards (المشاهدات، التعليقات، الإعجابات، صافي الرضا، معدل التفاعل).
3. **3-Act Narrative Cards**:
   - النبض العام (The Pulse).
   - المحرك الأساسي (The Driver).
   - التوصية الإجرائية (Actionable Recommendation).
4. **Videos Performance & Sentiment Bar**:
   - Each video card displays thumbnail, duration, view count, like count, comment count, and an embedded horizontal sentiment distribution bar.
   - Sorting options: الأكثر تفاعلاً، الأكثر مشاهدة، الأكثر تعليقات.
5. **Audience Voice & Activity Timing**:
   - Topics ranking, Sentiment Donut, Activity peak hours/days with 10% preattentive highlighting.
6. **Top Commenters & Comments Grid**:
   - Commenters list with real YouTube avatars and influence metrics.
   - Comments grid with avatars, sentiment badges, and like counters.
7. **Actionable Next Steps (خطوات مقترحة)**:
   - 3-4 structured recommendation cards derived from channel performance.

---

## 5. Security, Multi-Tenancy & Testing
- Strict RLS enforcement: all access bounded by `workspace_id` and verified via `private.has_role(w)`.
- All localized strings mirrored in `strings/ar.ts` and `strings/en.ts`.
- Full verification through `npm run check` (Lint, Unit, DB, Worker, Build, Types).
