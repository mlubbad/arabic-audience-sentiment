# Selective video sync — design

2026-09-15. Approved in conversation; this is the written form.

## What changes and why

Collection today is whole-channel and all-or-nothing: `enqueue_sync(w, c, k)` queues one
`collect` job, and `run_backfill` walks every upload the channel has. The owner never sees
which videos exist, how many comments each carries, or what a run will cost against the
plan before it runs. The `runner.py` comment that rejected per-video granularity did so
because nothing needed it; this is the need.

After this work the owner opens a catalogue of the channel's videos with YouTube's comment
counts, searches and filters it, chooses which videos to collect and analyse, sees the
estimated cost against the plan's remaining `comment_analysis` units before committing, and
the chosen videos stay live — re-checked for new comments on a cadence — until deselected.
The backend catalogues every video regardless of selection; selection governs only which
videos' comments are collected.

Decisions taken with the user:

- **Unify.** The catalogue page is the only way to start a collection. "Select all" is the
  parity path for someone who wants everything; the old whole-channel button goes.
- **Cached catalogue, refreshed daily, plus a manual refresh.**
- **Bulk controls in v1**: title search, select all / none (within the current view), kind
  tabs (videos / shorts / streams), sort by recency and by comment count, and "select the
  newest that fit the remaining quota".
- **Hard stop** when a selection's estimate exceeds the remaining quota.
- **Selected videos stay live**: re-checked for new comments on a plan-defined interval.
- **One channel per workspace**, as the account page shows today. Multiple channels per
  workspace is separate, later work.

## Approach

Selection is a table; jobs stay per-channel; the server hands the worker its due list at
claim time. A `collect` job carries no video list. This keeps the "one outstanding
collection per channel" invariant (`jobs_one_outstanding_collect`) and its UI wording true,
lets videos selected during a run be picked up by the next run without a second job, and
gives "live" a natural mechanism: a scheduler enqueues a job when any selected video is due.
The tenant cannot forge the list (it is computed server-side from rows RLS already scopes)
and the worker cannot widen it.

Rejected: storing the video list on the job (two places deciding what to collect; mid-run
additions need a second job or a silent wait), and one job per video (N rows per selection
in the attempt log; N× worse with live re-checks; already rejected in `runner.py`).

## 1. Data model — one additive migration

`public.videos` gains:

| column | type | meaning |
| --- | --- | --- |
| `reported_comment_count` | `integer` null | YouTube `statistics.commentCount`, which includes replies. Null is unknown; never 0 for unknown. |
| `thumbnail_url` | `text` null | |
| `comments_state` | `text` not null default `'unknown'`, check in `('unknown','open','disabled')` | Learned from collection, not discovery: `videos.list` does not say comments are off; only a `commentThreads` refusal does. |
| `catalogued_at` | `timestamptz` null | Null for a video known only from a commit. |

Provenance for the new fields goes in the existing `field_provenance`.

`public.video_selections` (new):

| column | notes |
| --- | --- |
| `workspace_id`, `channel_id`, `video_id` | composite FKs to `videos(workspace_id,id)` and `channels(workspace_id,id)` |
| `selected_by uuid`, `selected_at timestamptz` | |
| `next_check_at timestamptz not null default now()` | due when `<= now()` |
| `last_collected_at timestamptz`, `last_outcome text` | set by `worker_video_finished` |
| unique `(workspace_id, video_id)` | |

A row exists = selected and live. Deleting it stops future re-checks and keeps the comments
already collected. RLS: tenant read; no tenant write grant — writes go through the RPC.
`service_role` has all.

Plan limits: `plans` gains `live_interval_minutes` and `catalogue_interval_minutes`
(default 1440, check `>= 0`); `private.plan_limit` learns `'live_interval'` and
`'catalogue_interval'`. Rebuild `plan_limit` from its *current* body (`20260913160000` as
amended by `20260913190000`), per the whole-body-rewrite rule in `ACTIVE.md`.

A partial unique index `jobs_one_outstanding_discover` on `(workspace_id, channel_id)` where
`type='discover' and status in ('queued','running')` — the twin of the collect one.

Backfill in the same migration: every `(workspace_id, video_id)` with at least one comment
row gets a selection (`selected_by` = the workspace's `created_by`, `next_check_at = now()`),
so the pilot channel's collected videos stay live and behaviour continues uninterrupted.

## 2. Discovery — the `discover` job

`jobs.type` and `sync_runs.mode` already allow `'discover'`; nothing implements it.

**Collector.** `YouTubeAPI.catalogue()` in `youtube_api.py`:

1. `channels.list(mine=true, part=contentDetails)` → the uploads playlist id `UU…`.
2. The three tab playlists derived from it — `UULF…` (videos), `UUSH…` (shorts), `UULV…`
   (streams), the same three tabs the handoff's yt-dlp path visited — each walked with
   `playlistItems.list(part=contentDetails, maxResults=50)`. A 404 on one tab means the tab
   is empty, not a failure. A video id seen in two tabs keeps the first kind and records both
   in `field_provenance.discovered_in_tabs`.
3. `videos.list(part=snippet,statistics,contentDetails, id=…)` fifty ids at a time →
   title, `publishedAt`, thumbnail (the `medium` size), `commentCount` (absent → `None`),
   duration.

Cost ≈ 2 quota units per 50 videos; the pilot's 194 ≈ 8–12. Fallback if the derived
playlists are refused for a channel: walk plain `UU…`, record `kind='video'`, and note in
provenance that the kind is unclassified.

The collector yields catalogue pages; a page that ends without a `nextPageToken` on every
tab is the end. A repeated page token is `partial`, as for comments.

**Server.** Gateway route `worker_commit_catalogue(lease, videos[])` → `private.commit_catalogue`:
upserts `videos` on `(workspace_id, platform, external_video_id)` — title (through the
existing best-name rule from `20260914060000`), kind, count, thumbnail, `catalogued_at =
now()`; opens or updates the run's `sync_runs` row with `mode='discover'` and
`coverage_summary {videos_found, by_kind}`. `worker_finish` for a discover job records
`succeeded` only when every tab paginated to its end, else `partial`. A malformed catalogue
batch is refused whole.

**Worker.** `run_discover(control, build_catalogue)` beside `run_backfill`; `loop.serve`
dispatches on the lease's `type`, which today it assumes is `collect`.

**Triggers.** The OAuth attach path (`svc_oauth_attach_channel`) enqueues a `discover` job on
a fresh connection; the daily tick (§4) enqueues one when `catalogued_at` is older than
`catalogue_interval`; and `request_discovery(w, c)` (owner/analyst) for the manual button,
under the one-outstanding rule and the `sync_interval` rate limit.

## 3. Selection and the quota hard stop

RPC `select_videos(w uuid, c uuid, add uuid[], remove uuid[]) returns jsonb`, definer,
owner/analyst, via the usual `private.*_impl` + public invoker wrapper.

Refuses: a video not in `(w, c)` (`invalid_video`, `23503`); adding a video whose
`comments_state = 'disabled'` (`comments_disabled`, `22023`).

Estimate for the addition:

```
Σ over add: greatest(0, coalesce(reported_comment_count, 0) − (comments already stored for that video))
```

Comments already in the database were already metered, so keeping the pilot's collected
videos costs nothing. Unknown counts contribute nothing and are returned as `unknown_count`
so the UI shows them apart, not as zero. If estimate > remaining `comment_analysis` units
(from the same `private.used_units` the summary uses) → `quota_exceeded`, errcode `53400`,
nothing written. `reserve_usage` in `commit_batch` remains the enforcement where the metering
happens; this is the earlier layer, not a replacement.

On success, in one transaction: delete `remove`, insert `add` with `next_check_at = now()`,
then call `private.enqueue_sync_impl(w, c, 'selection-' || gen_random_uuid())`. A
`sync_too_soon` refusal is caught and reported, not raised — the tick picks the work up.
Returns `{job_id | null, queued: bool, estimate, unknown_count, remaining_after}`.

`packages/contracts/src/selection.ts`: `selectionEstimate(videos, selectedIds, remaining)` →
`{estimate, unknownCount, remainingAfter, exceeds}` — the same arithmetic, so the UI can show
it live; the RPC is the one that refuses.

Copy commitments: the estimate covers comments that exist now; live videos spend quota as
new comments arrive; YouTube's count is not a promise of what is retrievable.

## 4. Worker, gateway, scheduling

- **Claim payload** gains `videos: [{video_id, external_video_id, title}]` from
  `private.due_videos(w, c)`: selected, `comments_state <> 'disabled'`, `next_check_at <=
  now()`, ordered oldest-due first. `run_backfill` walks it with its existing
  `done` / `video` / `cursor` checkpointing. `loop.build_plan`, which discovers uploads
  itself, is removed. An empty due list finishes `succeeded` with zero coverage.
- **`worker_video_finished(lease, video_id, outcome, code)`** — a new gateway route and
  `private.worker_video_finished`, called once per video by `run_backfill`. `exhausted` →
  `last_collected_at = now()`, `next_check_at = now() + live_interval`, `last_outcome =
  'exhausted'`; code `comments_disabled` → `videos.comments_state = 'disabled'` and the
  outcome recorded; any other outcome → `last_outcome` recorded, `next_check_at` left as it
  was, so the next run retries. Lease-checked like every worker route. Kept separate from
  `commit_batch` on purpose: that function has been rewritten seven times and the trap in
  `ACTIVE.md` is real.
- **`private.schedule_due_work()`**: for each channel with `status='connected'`, enqueue
  `discover` if `catalogued_at` is null or older than `catalogue_interval`, and `collect`
  if `due_videos` is non-empty — both through the one-outstanding functions, so calling it
  twice is safe. Wired to `pg_cron` hourly (Supabase ships the extension; enabling it on
  the live project is asked for at implementation time, not assumed) and called by the
  worker loop on each idle tick as the fallback that needs no extension.
- Caveat, recorded: live re-checks happen only while a worker process runs. That is the
  standing hosting blocker, unchanged by this work.

## 5. UI — the operations page (`/sync?ws=…`)

The catalogue is the first section of the existing operations page, `Sync.tsx`, above the
health and plan panels — the page whose "طلب مزامنة" button it replaces, and the page that
already carries the plan meter. No new route and no new rail destination. The account card's
third step becomes a link to `/sync?ws=<id>`, "اختر الفيديوهات"; `setup.ts` step 3 is
reworded to match. The page heading keeps agreeing with the rail's "التشغيل" (a browser test
holds that). Every new sentence lives in `strings/ar.ts` with its `en.ts` twin.

Page order after the head: **catalogue** (this work) → **health** and **plan** side by side
(as today, minus the request button) → **attempts** (as today). The operations page grows
long; the catalogue is the action and comes first, the diagnosis follows it.

Reads: `videos` and `video_selections` for the workspace (RLS), `connection_status`, the
standing `collect` / `discover` jobs (the attempt log already reads `jobs`), and the
snapshot's `plan`, which the page already has — the estimate line reads the same
`budgets` entry the plan panel draws, one source.

- **Selection bar**: the live selection line — "المحدد: 12 فيديو · حتى 1,240 تعليقًا · يتبقى
  بعدها 3,348", with "و3 بعدد غير معروف" when applicable — beside "احفظ الاختيار" and
  "تحديث القائمة" (which shows the catalogue's age). Sticky at the bottom below 768px.
- **Toolbar**: title search (client-side substring on the whole catalogue, one RLS read;
  server-side search is out of scope), kind tabs الكل / فيديو / شورت / بث with counts, sort
  newest / oldest / most commented, select all in view / clear, and "اختر الأحدث بما يناسب
  الحصة" — newest first until the estimate would exceed the remainder.
- **Rows**: checkbox, thumbnail, title, kind, date, reported count or "—" for unknown, and
  one state pill: غير محدد / بانتظار الجمع / يُجمع الآن / جُمع N في <date> / تعليقات معطّلة
  (unselectable, reason inline) / جزئي with the code through `explainCode`. Filter, sort and
  "fit" are pure functions in `apps/web/src/catalogue.ts`.
- **Submit**: "احفظ الاختيار" sends the diff to `select_videos`; over quota, the button is
  disabled with the reason beside it. Feedback is scoped to the bar, as on the account page.
- **States**: not connected → link to the account page, as the page does today; no catalogue
  yet → the discover job's state through `describeJob`; read failed → retry.
- **Demo**: `apps/web/public/fixtures/dashboard.json` gains a small `catalogue` array so
  `/sync?demo=1` exercises the section in the browser suite, as it exercises the rest.
- Tokens only, no raw colour (`layers.test.ts` holds it); no letter-spacing on Arabic.
- `Sync.tsx` is 510 lines and would pass 800: the catalogue section is its own component,
  `Catalogue.tsx`, and the health/plan/attempts panels move to `OperationsPanels.tsx`, so
  each file holds one thing. No behaviour change in the move.

## 6. Testing

- **SQL (PGlite)**: another tenant's direct `select_videos` → forbidden; the quota refusal,
  with a mutation removing the check going red; stored comments excluded from the estimate;
  disabled videos refused; `due_videos` order and interval; one outstanding `discover`; the
  backfill creates a selection per collected video; `worker_video_finished` transitions;
  `schedule_due_work` called twice enqueues once; a discover lease from another workspace
  cannot commit a catalogue.
- **Worker (pytest)**: catalogue pagination over synthetic responses; a 404 tab; a missing
  `commentCount` → `None`, not `0`; truncated pagination → `partial`; loop dispatch by type;
  `run_backfill` over a server-supplied list calling `video_finished` per video.
- **Contracts / web unit**: `selectionEstimate`; filter, sort, fit; ar/en key parity; the
  page rendered from forced rows for the signed-in states.
- **Browser (fixture, `/sync?demo=1`)**: search narrows rows; tabs; select all in view; the
  estimate moves; the hard stop; the sticky bar at 375px; no letter-spaced Arabic; the ten
  existing operations-page tests still pass after the split.
- Every new assertion mutation-checked and recorded in `docs/verification.md`.

## Out of scope, recorded

Multiple channels per workspace; server-side search; flagging videos that vanished from the
catalogue; persistent worker hosting; a `historical_backfill` charge (the budget line exists,
nothing reserves it today, and this work does not change that).
