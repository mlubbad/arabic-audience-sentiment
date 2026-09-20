# Omnichannel Multi-Platform Social Listening Architecture (Design)

**Date:** 2026-09-20  
**Status:** Approved Design  
**Context:** Expanding the Arabic Sentiment Analysis platform from a YouTube-centric MVP into a unified Omnichannel Social Listening & Intelligence engine covering YouTube, Telegram, X (Twitter), TikTok, Facebook, and Instagram.

---

## 1. Executive Summary & Strategy

The platform currently specializes in ingesting and analyzing Arabic YouTube videos and comments. To meet broad market demand in the Arab world, the architecture must expand to capture discussions across multiple major social platforms.

### Phased Rollout Strategy:
1. **Tier 0 (Zero Cost — Launch Stage): YouTube + Telegram**
   - **YouTube:** Public comment collection via `YouTube Data API v3` (free quota of 10,000 units/day per Google Cloud project).
   - **Telegram:** MTProto client API via `Telethon` reading public broadcast channels and fetching comment threads from linked discussion supergroups. **100% Free**, zero API fees, no external scraping proxy required.
2. **Tier 1 (Economic Pay-Per-Use — Low-Cost Growth): X (Twitter) + TikTok**
   - **Architecture:** Pluggable `ScraperGatewayCollector` integrating specialized scraping endpoints (e.g. Bright Data Web Scraper API or Apify Actors).
   - **Cost Economics:** Leverages free initial quotas (5,000 free records/mo on Bright Data, \$5 trial on Apify), then scales dynamically at **\$0.50–\$1.50 per 1,000 comments/posts** without incurring X's mandatory \$200/month flat fee.
   - **Metering:** Billed to workspace unit allocations via `public.usage_events`.
3. **Tier 2 (Enterprise & Official Compliance): X Official Basic/Pro & Meta Business API**
   - Enterprise Bring-Your-Own-Key (BYOK) for corporate or government clients requiring certified official API tokens.

---

## 2. Key Architectural Decisions

- **Decision 1: In-Place Conservative Schema Extension (Approach A)**
  - Rather than executing a high-risk rename of existing tables (`channels` -> `sources`, `videos` -> `posts`), we preserve existing table names, indices, foreign keys, and RLS policies.
  - The `platform` column check constraints are widened to: `'youtube', 'telegram', 'x', 'tiktok', 'facebook', 'instagram'`.
  - The `videos.kind` check constraint is widened to: `'video', 'short', 'stream', 'channel_post', 'tweet', 'status'`.
  - In TypeScript contracts and UI, entities are presented cleanly as generic sources (`ContentItem` / `SourceChannel`), adapting labels dynamically ("فيديو" on YouTube, "منشور" on Telegram, "تغريدة" on X).
- **Decision 2: MTProto for Telegram Social Listening**
  - Telegram's Bot API is unsuited for public social listening because bots cannot read channels or discussion groups unless explicitly invited and promoted to administrator by the channel owner.
  - MTProto (`Telethon`) operates as an official Telegram client protocol using free `api_id` and `api_hash` credentials, allowing read-only streaming of public channel messages and linked discussion comments.
- **Decision 3: Idempotent & Provenance-Preserving Ingestion**
  - All platforms strictly obey the repository's core invariants:
    - Unique deduplication keys: `(workspace_id, platform, external_channel_id)`, `(workspace_id, platform, external_video_id)`, `(workspace_id, platform, external_comment_id)`.
    - Sanitized provenance: Provider tokens or proxy credentials never leak into `field_provenance` or database records.
    - Deterministic sentiment caching: Content hashes and predictions are deduplicated across retries.

---

## 3. Database Schema & Migration Specification

**Target Migration:** `supabase/migrations/20260920190000_omnichannel_multi_platform_support.sql`

### 3.1 Constraint Widening
```sql
-- 1. channels
alter table public.channels drop constraint if exists channels_platform_check;
alter table public.channels add constraint channels_platform_check 
  check (platform in ('youtube', 'telegram', 'x', 'tiktok', 'facebook', 'instagram'));

-- 2. videos (parent publication items)
alter table public.videos drop constraint if exists videos_platform_check;
alter table public.videos add constraint videos_platform_check 
  check (platform in ('youtube', 'telegram', 'x', 'tiktok', 'facebook', 'instagram'));

alter table public.videos drop constraint if exists videos_kind_check;
alter table public.videos add constraint videos_kind_check 
  check (kind in ('video', 'short', 'stream', 'channel_post', 'tweet', 'status'));

-- 3. comments (child comment / reply items)
alter table public.comments drop constraint if exists comments_platform_check;
alter table public.comments add constraint comments_platform_check 
  check (platform in ('youtube', 'telegram', 'x', 'tiktok', 'facebook', 'instagram'));
```

### 3.2 Performance Indices
```sql
create index if not exists comments_platform_workspace_idx 
  on public.comments (workspace_id, platform, published_at desc);

create index if not exists channels_platform_workspace_idx 
  on public.channels (workspace_id, platform);

create index if not exists videos_platform_workspace_idx 
  on public.videos (workspace_id, platform, published_at desc);
```

### 3.3 Dashboard Aggregates Multi-Platform Support
Update `private.dashboard_aggregates_impl` and `private.dashboard_comments_impl`:
- Support optional filter: `f->>'platform'`.
- When `f->>'platform'` is present and valid, filter comment counts, sentiments, and timelines by that platform.
- When omitted or null, aggregate all platforms together.
- In summary outputs, emit `platform_breakdown` JSON object detailing comment distribution across platforms.

---

## 4. Contracts & Shared Types (`packages/contracts`)

### 4.1 Platform Enums & Types
In `packages/contracts/src/selection.ts` (or dedicated `platform.ts`):
```typescript
export const SOURCE_PLATFORMS = [
  'youtube',
  'telegram',
  'x',
  'tiktok',
  'facebook',
  'instagram'
] as const;

export type SourcePlatform = typeof SOURCE_PLATFORMS[number];

export const CONTENT_KINDS = [
  'video',
  'short',
  'stream',
  'channel_post',
  'tweet',
  'status'
] as const;

export type ContentKind = typeof CONTENT_KINDS[number];
```

### 4.2 Dashboard Filter Schema Extension
In `packages/contracts/src/fixture.ts`:
- Extend `DashboardFilterSchema` with `platform: z.enum(SOURCE_PLATFORMS).optional()`.
- Extend `DashboardAggregatesSchema` to include optional `platform_breakdown?: Record<SourcePlatform, number>`.

---

## 5. Python Worker Pipeline (`workers/python/src/collectors`)

### 5.1 Architecture & Directory Layout
```text
workers/python/src/collectors/
├── protocol.py               # Generic Collector & RawComment protocols
├── router.py                 # Resolves platform string to Collector implementation
├── store.py                  # Idempotent batch database writer
├── youtube_api.py            # YouTube Collector (API v3 & platform reader)
├── telegram_client.py        # Telegram MTProto Collector (Telethon)
└── scraper_gateway.py        # Pluggable Scraper Gateway (X / TikTok)
```

### 5.2 Collector Interface (`protocol.py`)
The existing `Collector` protocol remains generic:
```python
class Collector(Protocol):
    source: str
    revision: str
    def batches(self, item_id: str, checkpoint: str | None) -> Iterator[Batch]: ...
```

### 5.3 Telegram MTProto Collector Implementation (`telegram_client.py`)
- **Discovery:** Given a channel handle (e.g. `@aljazeera_channel`), retrieves public messages, view counts, forward counts, and message timestamps. Maps messages to `Catalogue` items with `kind='channel_post'`.
- **Collection:** For a given message `item_id`, queries Telegram MTProto `GetRepliesRequest` to fetch threaded discussion comments.
- **Normalization:** Converts Telegram comment messages to `RawComment`:
  - `id`: Telegram message ID (`msg_reply_XXXX`).
  - `video_id`: Parent Telegram channel message ID (`msg_XXXX`).
  - `text`: Raw text formatted without HTML tags.
  - `likes_value`: Sum of emoji reactions (`reactions.results[].count`).
  - `author_name`: User first name / username or "Anonymous".
  - `published_at`: ISO8601 UTC timestamp.

### 5.4 Pluggable Scraper Gateway (`scraper_gateway.py`)
- Standard HTTP client adapter interacting with Bright Data Web Scraper API or Apify Actors.
- Decoupled from specific vendors via JSON transformer mappings.

---

## 6. Supabase Edge Functions & Discovery Gateway

### 6.1 `channel-lookup` Extension
- Accepts input query (URL or handle).
- Detects source platform automatically:
  - URLs matching `t.me/*` or `@username` -> Telegram.
  - URLs matching `youtube.com/*`, `youtu.be/*`, or `@handle` -> YouTube.
  - URLs matching `x.com/*`, `twitter.com/*` -> X.
  - URLs matching `tiktok.com/@*` -> TikTok.
- Returns normalized metadata: `{ platform, external_id, title, handle, avatar_url }`.

### 6.2 `schedule_due_work` & Job Execution
- Preserves transactional job claim and leasing (`claim_job(w)`).
- Worker inspects `channel.platform` from claimed job and instantiates the matching collector.

---

## 7. Frontend User Experience (`apps/web`)

1. **Source Registration (`/account`):**
   - Visual platform tabs/badges: YouTube, Telegram, X, TikTok.
   - Dynamic hint text per platform (e.g., "أدخل رابط القناة أو اسم المستخدم t.me/channel").
2. **Dashboard FilterBar (`FilterBar.tsx`):**
   - Platform dropdown / badge selector: "جميع المنصات" (All Platforms), YouTube, Telegram, X.
   - Triggers server-side decoupled query with `platform` parameter.
3. **Comment Card (`CommentCard.tsx`):**
   - Displays a neat platform icon (YouTube logo, Telegram paper plane, X icon) to immediately signal the origin of the comment.

---

## 8. Verification & Quality Gates

1. **Database Migration Verification:**
   - Run in isolation on PGlite test suite: `supabase/tests/omnichannel_migration.test.ts`.
   - Verify constraint enforcement: valid platforms succeed, unknown strings are rejected.
2. **Worker Unit & Integration Tests:**
   - Test `telegram_client.py` against mock MTProto responses.
   - Test `router.py` resolution across all platforms.
3. **Full CI Quality Gates:**
   - `npm run check` (Typecheck, Vitest, PGlite DB tests, Python pytest 229+ tests, Semgrep SAST, Gitleaks).
