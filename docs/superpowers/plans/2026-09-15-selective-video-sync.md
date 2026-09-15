# Selective Video Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner sees a catalogue of the channel's videos with YouTube's comment counts on the operations page, selects which to collect against the plan's remaining analysis units, and the selected videos stay live.

**Architecture:** Selection is a table (`video_selections`); jobs stay per-channel; the gateway hands the worker its *due* list at claim time from `private.due_videos`. A `discover` job (type already in the schema, implemented nowhere) builds the catalogue into `videos`. A per-video `worker_video_finished` route records completion and schedules the next check; `schedule_due_work` enqueues discover/collect under the existing one-outstanding rule.

**Tech Stack:** Postgres (Supabase migrations, PGlite tests via vitest), Deno Edge handler (`supabase/functions/_shared/worker-gateway.ts`), Python 3.12 worker (httpx, pytest via uv), React 19 + TanStack Query + Zod (`apps/web`, `packages/contracts`), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-selective-video-sync-design.md`

## Global Constraints

- Every shell: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"` (Node is pinned; `engine-strict`).
- Gates: `npm run check` (lint, format, types, functions, unit, db, worker, build, secrets) and `npm run test:e2e` separately. Redirect e2e to a file and read `$?` — never `| tail`. Stop any stray `vite`/preview on 4173 first.
- **Migrations are immutable.** Three new timestamped files, never an edit to a shipped one. `create or replace` on a function is a whole-body rewrite: copy the function's *current* body (the file named in each task), change only what the task says.
- **No commit of `commit_batch`.** It has been rewritten seven times; this work does not touch it.
- No tenant write grant on any new table; writes go through `security definer` `private.*_impl` with a `security invoker` public wrapper, revoked from `public, anon`, granted to `authenticated` (pattern: `enqueue_sync`).
- Nothing crossing a trust boundary accepts a workspace it does not also verify with `private.has_role` / the hashed worker credential.
- `reported_comment_count` null means unknown. Never write 0 for unknown. A missing `statistics.commentCount` means comments are off (`comments_state='disabled'`), a `"0"` means on and empty.
- Every new UI sentence goes in `apps/web/src/strings/ar.ts` **and** `strings/en.ts` (typed against `ar`; `tsc` fails otherwise). No raw colour in CSS (`layers.test.ts`); no `letter-spacing` on Arabic.
- Commit after every green step. There is no git remote; an uncommitted change is the only kind that can vanish.
- Log what was run in `docs/verification.md` at the end; a test that cannot fail is not coverage — mutate once, see red, restore.

---

## File map

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260915130000_video_catalogue_and_selections.sql` | Columns on `videos`/`channels`/`plans`, `video_selections`, `plan_limit` rebuild, backfill, `due_videos`, discover index |
| `supabase/migrations/20260915131000_select_videos.sql` | `analysis_remaining`, `select_videos`, `request_discovery` |
| `supabase/migrations/20260915132000_worker_catalogue_and_due_lists.sql` | `claim_job` rebuild (mode from type), `worker_due_videos`, `worker_commit_catalogue`, `worker_video_finished`, `schedule_due_work`, `worker_tick`, `svc_*` wrappers, `oauth_attach_channel_for` rebuild (enqueues discover) |
| `supabase/tests/selection.test.ts` | Tenant-side SQL tests (Tasks 1–2) |
| `supabase/tests/worker_catalogue.test.ts` | Worker-side SQL tests (Task 3) |
| `packages/contracts/src/selection.ts` (+ `.test.ts`) | `selectionEstimate`, `CatalogueVideoSchema`, filter/sort/fit — pure |
| `supabase/functions/_shared/worker-gateway.ts`, `supabase/functions/worker/index.ts` | Claim payload `type`+`videos`; routes `commit-catalogue`, `video-finished`, `tick` |
| `workers/python/src/collectors/youtube_api.py` | `catalogue()` |
| `workers/python/src/server/gateway.py`, `runner.py`, `loop.py`, `manual_run.py` | `commit_catalogue`, `video_finished`, `tick`; `run_job` dispatch; `run_discover`; `run_backfill` from the lease |
| `apps/web/src/catalogue.ts` (+ `.test.ts`) | `loadCatalogue`, `mergeCatalogue` — the one read in both modes |
| `apps/web/public/fixtures/catalogue.json` | Demo catalogue |
| `apps/web/src/OperationsPanels.tsx` | Health / plan / attempts, moved out of `Sync.tsx` unchanged |
| `apps/web/src/Catalogue.tsx` | The new section |
| `apps/web/src/Sync.tsx` | Page shell composing the two |
| `apps/web/src/strings/ar.ts`, `en.ts`, `setup.ts`, `WorkspaceCard.tsx` | Sentences; step 3 becomes a link |
| `tests/e2e/dashboard.spec.ts` | Append-only browser tests on `/sync?demo=1` |

---

### Task 1: Schema — catalogue columns, `video_selections`, plan intervals, backfill, `due_videos`

**Files:**
- Create: `supabase/migrations/20260915130000_video_catalogue_and_selections.sql`
- Create: `supabase/tests/selection.test.ts`

**Interfaces:**
- Produces: `public.videos.{reported_comment_count int|null, thumbnail_url text|null, comments_state 'unknown'|'open'|'disabled', catalogued_at timestamptz|null}`; `public.channels.catalogued_at`; `public.video_selections(workspace_id, channel_id, video_id, selected_by, selected_at, next_check_at, last_collected_at, last_outcome)`; `private.plan_limit(w,'live_interval'|'catalogue_interval') int`; `private.due_videos(w uuid, c uuid) returns jsonb` — `[{video_id, external_video_id, title}]` ordered by `next_check_at, id`; partial unique index `jobs_one_outstanding_discover`.

- [ ] **Step 1: Write the failing tests**

`supabase/tests/selection.test.ts`:

```ts
/**
 * Selection is a table the tenant reads and never writes directly; what the
 * worker collects is computed from it on the server.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const OWNER = "10000000-0000-4000-8000-000000000001";
const OUTSIDER = "10000000-0000-4000-8000-000000000002";
const V1 = "20000000-0000-4000-8000-000000000001";
const V2 = "20000000-0000-4000-8000-000000000002";
const V3 = "20000000-0000-4000-8000-000000000003";
let db: PGlite;

const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};
const scalar = async <T,>(sql: string, params: unknown[] = []) =>
  (await db.query<Record<string, T>>(sql, params)).rows[0]?.[
    Object.keys((await db.query<Record<string, T>>(sql, params)).rows[0] ?? {})[0]
  ];

describe("video selections", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    // Everything up to (not including) this task's migration, so the backfill
    // it carries runs over rows that exist before it.
    const files = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const cut = files.indexOf("20260915130000_video_catalogue_and_selections.sql");
    for (const f of files.slice(0, cut))
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await db.exec("reset role");
    for (const [w, owner, external] of [
      [W, OWNER, `UC${"a".repeat(22)}`],
      [OTHER, OUTSIDER, `UC${"b".repeat(22)}`],
    ]) {
      await db.query("insert into auth.users(id) values ($1)", [owner]);
      await db.query("insert into workspaces(id,name,created_by) values ($1,'w',$2)", [w, owner]);
      await db.query("insert into memberships values ($1,$2,'workspace_owner')", [w, owner]);
      await db.query("insert into clients(id,workspace_id,name) values ($1,$1,'c')", [w]);
      await db.query(
        `insert into channels(id,workspace_id,client_id,external_channel_id,status)
         values ($1,$1,$1,$2,'connected')`,
        [w, external],
      );
      await db.query(
        `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
         values ($1,'pilot','active',now()-interval '1 day',now()+interval '29 days')`,
        [w],
      );
    }
    // A video that already has a comment (collected before this work), one
    // that does not, and one in the other tenant.
    await db.query(
      `insert into videos(id,workspace_id,channel_id,external_video_id,title)
       values ($1,$4,$4,'aaaaaaaaaaa','قديم'),($2,$4,$4,'bbbbbbbbbbb','جديد'),($3,$5,$5,'ccccccccccc','غريب')`,
      [V1, V2, V3, W, OTHER],
    );
    await db.query(
      `insert into comments(workspace_id,video_id,external_comment_id,text_raw,text_plain,content_hash,timestamp_precision,source)
       values ($1,$2,'c1','نص','نص','h1','second','test')`,
      [W, V1],
    );
    await db.exec(readFileSync("supabase/migrations/20260915130000_video_catalogue_and_selections.sql", "utf8"));
    for (const f of files.slice(cut + 1))
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  });
  afterAll(async () => {
    await db?.close();
  });

  it("backfills a live selection for every video that already has comments", async () => {
    await db.exec("reset role");
    const rows = await db.query<{ video_id: string; last_outcome: string | null }>(
      "select video_id, last_outcome from video_selections where workspace_id=$1 order by video_id",
      [W],
    );
    expect(rows.rows.map((r) => r.video_id)).toEqual([V1]);
    const state = await db.query<{ comments_state: string }>(
      "select comments_state from videos where id=$1",
      [V1],
    );
    expect(state.rows[0].comments_state).toBe("open");
    const fresh = await db.query<{ comments_state: string; reported_comment_count: number | null }>(
      "select comments_state, reported_comment_count from videos where id=$1",
      [V2],
    );
    expect(fresh.rows[0]).toEqual({ comments_state: "unknown", reported_comment_count: null });
  });

  it("lets a member read their selections and nobody else's", async () => {
    await as(OWNER);
    const mine = await db.query("select video_id from video_selections");
    expect(mine.rows).toHaveLength(1);
    await as(OUTSIDER);
    const theirs = await db.query("select video_id from video_selections");
    expect(theirs.rows).toHaveLength(0);
  });

  it("refuses a direct tenant write", async () => {
    await as(OWNER);
    await expect(
      db.query(
        "insert into video_selections(workspace_id,channel_id,video_id) values ($1,$1,$2)",
        [W, V2],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("answers the new plan intervals and keeps the old ones", async () => {
    await db.exec("reset role");
    const live = await db.query<{ v: number }>(
      "select private.plan_limit($1,'live_interval') as v",
      [W],
    );
    expect(live.rows[0].v).toBe(1440);
    const gap = await db.query<{ v: number }>(
      "select private.plan_limit($1,'sync_interval') as v",
      [W],
    );
    expect(gap.rows[0].v).toBe(0);
  });

  it("lists due videos oldest-due first and leaves out disabled ones", async () => {
    await db.exec("reset role");
    await db.query(
      `insert into video_selections(workspace_id,channel_id,video_id,next_check_at)
       values ($1,$1,$2,now()-interval '2 hours')`,
      [W, V2],
    );
    await db.query("update video_selections set next_check_at=now()-interval '1 hour' where video_id=$1", [V1]);
    const due = await db.query<{ d: { video_id: string }[] }>(
      "select private.due_videos($1,$1) as d",
      [W],
    );
    expect(due.rows[0].d.map((v) => v.video_id)).toEqual([V2, V1]);
    await db.query("update videos set comments_state='disabled' where id=$1", [V2]);
    const again = await db.query<{ d: { video_id: string }[] }>(
      "select private.due_videos($1,$1) as d",
      [W],
    );
    expect(again.rows[0].d.map((v) => v.video_id)).toEqual([V1]);
    await db.query("update video_selections set next_check_at=now()+interval '1 day' where video_id=$1", [V1]);
    const none = await db.query<{ d: unknown[] }>("select private.due_videos($1,$1) as d", [W]);
    expect(none.rows[0].d).toEqual([]);
    // restore for later tasks
    await db.query("update videos set comments_state='unknown' where id=$1", [V2]);
    await db.query("delete from video_selections where video_id=$1", [V2]);
  });

  it("admits one outstanding discover per channel", async () => {
    await db.exec("reset role");
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'discover','d1')",
      [W],
    );
    await expect(
      db.query(
        "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'discover','d2')",
        [W],
      ),
    ).rejects.toThrow(/jobs_one_outstanding_discover/);
    await db.query("update jobs set status='succeeded' where dedupe_key='d1'");
  });
});
```

Remove the unused `scalar` helper before committing (it is shown only to be deleted; the tests above do not use it).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run supabase/tests/selection.test.ts`
Expected: FAIL — `ENOENT` reading `20260915130000_video_catalogue_and_selections.sql` (the `cut` index is -1, so the migration is not found).

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260915130000_video_catalogue_and_selections.sql`:

```sql
-- Selection becomes a table. Collection has been whole-channel: one job walks
-- every upload, and the owner never sees what exists, what it will cost, or
-- which videos are worth the quota. The catalogue (this file) is what the
-- source says exists; the selection is what the tenant asked for. Different
-- writers, different tables.

alter table public.videos
  add column reported_comment_count integer check (reported_comment_count >= 0),
  add column thumbnail_url text,
  -- Learned from the source: statistics.commentCount is absent when comments
  -- are switched off, "0" when they are on and nobody has written one.
  add column comments_state text not null default 'unknown'
    check (comments_state in ('unknown','open','disabled')),
  add column catalogued_at timestamptz;

alter table public.channels add column catalogued_at timestamptz;

-- The view the browser reads channels through, rebuilt from 20260915080000
-- with the new column appended (a replace may add trailing columns).
create or replace view public.connection_status
  with (security_invoker = true) as
  select c.workspace_id, c.id as channel_id, c.external_channel_id, c.handle,
         c.status, c.active_analysis_key, c.title, c.catalogued_at
  from public.channels c;

create table public.video_selections (
  workspace_id uuid not null,
  channel_id uuid not null,
  video_id uuid not null,
  selected_by uuid references auth.users(id),
  selected_at timestamptz not null default now(),
  -- Due when <= now(). A fresh selection is due at once.
  next_check_at timestamptz not null default now(),
  last_collected_at timestamptz,
  last_outcome text check (last_outcome is null or length(last_outcome) between 1 and 80),
  primary key (workspace_id, video_id),
  foreign key (workspace_id, video_id) references public.videos(workspace_id, id),
  foreign key (workspace_id, channel_id) references public.channels(workspace_id, id)
);
create index video_selections_due
  on public.video_selections(workspace_id, channel_id, next_check_at);

alter table public.video_selections enable row level security;
revoke all on public.video_selections from anon, authenticated;
grant select on public.video_selections to authenticated;
create policy tenant_read on public.video_selections for select to authenticated
  using (private.has_role(workspace_id));
grant all on public.video_selections to service_role;

-- How often a live video is re-read, and how often the catalogue is rebuilt.
alter table public.plans
  add column live_interval_minutes integer not null default 1440
    check (live_interval_minutes >= 0),
  add column catalogue_interval_minutes integer not null default 1440
    check (catalogue_interval_minutes >= 0);

-- plan_limit, rebuilt from 20260913160000 (20260913190000 only changed its
-- grants) with the two new names added.
create or replace function private.plan_limit(w uuid, which text) returns integer
language sql stable security definer set search_path='' as $$
  select case which
           when 'channels' then p.channels_limit
           when 'members' then p.members_limit
           when 'sync_interval' then p.min_sync_interval_minutes
           when 'live_interval' then p.live_interval_minutes
           when 'catalogue_interval' then p.catalogue_interval_minutes
         end
  from public.subscriptions s join public.plans p on p.key = s.plan_key
  where s.workspace_id = w and s.status = 'active';
$$;
revoke all on function private.plan_limit(uuid,text) from public, anon, authenticated;

-- Every video that already has comments was collected under the old rule and
-- stays live under the new one, so the pilot channel's behaviour continues.
insert into public.video_selections(workspace_id, channel_id, video_id, selected_by, last_collected_at, last_outcome)
select v.workspace_id, v.channel_id, v.id, w.created_by, max(c.last_seen_at), 'exhausted'
  from public.videos v
  join public.workspaces w on w.id = v.workspace_id
  join public.comments c on c.workspace_id = v.workspace_id and c.video_id = v.id
 group by v.workspace_id, v.channel_id, v.id, w.created_by
on conflict do nothing;

update public.videos v set comments_state = 'open'
 where exists (select 1 from public.comments c
                where c.workspace_id = v.workspace_id and c.video_id = v.id);

-- What a collect job should read: selected, not switched off, due. The server
-- decides; the worker is handed the list and cannot widen it.
create function private.due_videos(w uuid, c uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('video_id', v.id, 'external_video_id', v.external_video_id,
                              'title', v.title)
           order by s.next_check_at, v.id), '[]'::jsonb)
    from public.video_selections s
    join public.videos v on v.workspace_id = s.workspace_id and v.id = s.video_id
   where s.workspace_id = w and s.channel_id = c
     and s.next_check_at <= now()
     and v.comments_state <> 'disabled';
$$;
revoke all on function private.due_videos(uuid,uuid) from public, anon, authenticated;
grant execute on function private.due_videos(uuid,uuid) to service_role;

-- The twin of jobs_one_outstanding_collect.
create unique index jobs_one_outstanding_discover
    on public.jobs (workspace_id, channel_id)
 where type = 'discover' and status in ('queued', 'running');
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/tests/selection.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Run the whole db suite — the migration replays under every other test**

Run: `npm run test:db`
Expected: all green (142 + 6). If `catalogue.test.ts` or `dashboard_read.test.ts` breaks on `videos` inserts, the new columns have defaults and should not; investigate before changing any test.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260915130000_video_catalogue_and_selections.sql supabase/tests/selection.test.ts
git commit -m "Selection is a table; the catalogue is columns on videos

video_selections holds what the tenant asked for, due_videos computes what
a run should read, and every video that already has comments stays live."
```

---

### Task 2: `select_videos` and `request_discovery` RPCs

**Files:**
- Create: `supabase/migrations/20260915131000_select_videos.sql`
- Modify: `supabase/tests/selection.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: Task 1 tables; `private.enqueue_sync_impl(w,c,k)`; `private.used_units(w,kind,since)`.
- Produces: `public.select_videos(w uuid, c uuid, add uuid[], remove uuid[]) returns jsonb` → `{job_id uuid|null, queued bool, deferred bool, estimate int, unknown_count int, remaining_after int}`; refusals `forbidden` 42501, `invalid_channel`/`invalid_video` 23503, `comments_disabled` 22023, `quota_exceeded` 53400, `no_active_plan` 53400. `public.request_discovery(w uuid, c uuid) returns uuid`; `private.analysis_remaining(w) int`.

- [ ] **Step 1: Append the failing tests**

Append to `supabase/tests/selection.test.ts` inside the same file (a second `describe` sharing `db`):

```ts
describe("select_videos", () => {
  const call = (user: string, add: string[], remove: string[] = [], w = W) =>
    as(user).then(() =>
      db.query<{ r: Record<string, unknown> }>(
        "select select_videos($1,$1,$2::uuid[],$3::uuid[]) as r",
        [w, add, remove],
      ),
    );

  it("refuses another tenant, and a video outside the channel", async () => {
    await expect(call(OUTSIDER, [V2])).rejects.toThrow(/forbidden/);
    await expect(call(OWNER, [V3])).rejects.toThrow(/invalid_video/);
  });

  it("refuses a video whose comments are switched off", async () => {
    await db.exec("reset role");
    await db.query("update videos set comments_state='disabled' where id=$1", [V2]);
    await expect(call(OWNER, [V2])).rejects.toThrow(/comments_disabled/);
    await db.query("update videos set comments_state='open', reported_comment_count=40 where id=$1", [V2]);
  });

  it("refuses a selection the remaining analysis units cannot cover, and writes nothing", async () => {
    await db.exec("reset role");
    // pilot: 5000 analysis units. Spend all but 30.
    await db.query(
      `insert into usage_events(workspace_id,period_start,event_key,event_type,units,state)
       select $1, s.period_start, 'spent', 'comment_analysis', 4970, 'charged'
         from subscriptions s where s.workspace_id=$1`,
      [W],
    );
    await expect(call(OWNER, [V2])).rejects.toThrow(/quota_exceeded/);
    await db.exec("reset role");
    expect(
      (await db.query("select 1 from video_selections where video_id=$1", [V2])).rows,
    ).toHaveLength(0);
  });

  it("does not count comments already stored against the estimate", async () => {
    await db.exec("reset role");
    // V1 reports 25 and already holds 1 comment: 24 to collect. Deselect it
    // first so it is an addition again.
    await db.query("delete from video_selections where video_id=$1", [V1]);
    await db.query("update videos set reported_comment_count=25 where id=$1", [V1]);
    const r = await call(OWNER, [V1]);
    expect(r.rows[0].r.estimate).toBe(24);
    expect(r.rows[0].r.remaining_after).toBe(6);
    expect(r.rows[0].r.unknown_count).toBe(0);
  });

  it("reports unknown counts apart rather than as zero", async () => {
    await db.exec("reset role");
    await db.query("update videos set reported_comment_count=null where id=$1", [V2]);
    await db.query("delete from usage_events where workspace_id=$1", [W]);
    const r = await call(OWNER, [V2]);
    expect(r.rows[0].r.estimate).toBe(0);
    expect(r.rows[0].r.unknown_count).toBe(1);
  });

  it("queues one collection for the channel and answers a repeat with the same job", async () => {
    await db.exec("reset role");
    const first = await db.query<{ id: string }>(
      "select id from jobs where workspace_id=$1 and type='collect' and status in ('queued','running')",
      [W],
    );
    expect(first.rows).toHaveLength(1);
    const again = await call(OWNER, [V1], []);
    expect(again.rows[0].r.job_id).toBe(first.rows[0].id);
    expect(again.rows[0].r.queued).toBe(true);
  });

  it("removes a selection and keeps the comments", async () => {
    const r = await call(OWNER, [], [V1]);
    expect(r.rows[0].r.queued).toBe(false);
    await db.exec("reset role");
    expect((await db.query("select 1 from video_selections where video_id=$1", [V1])).rows).toHaveLength(0);
    expect((await db.query("select 1 from comments where video_id=$1", [V1])).rows).toHaveLength(1);
  });

  it("swallows the rate limit and says the work is deferred", async () => {
    await db.exec("reset role");
    await db.query("update jobs set status='succeeded' where workspace_id=$1 and status in ('queued','running')", [W]);
    await db.query("update plans set min_sync_interval_minutes=60 where key='pilot'");
    const r = await call(OWNER, [V1]);
    expect(r.rows[0].r.queued).toBe(false);
    expect(r.rows[0].r.deferred).toBe(true);
    await db.exec("reset role");
    await db.query("update plans set min_sync_interval_minutes=0 where key='pilot'");
  });

  it("refuses when the workspace has no active plan", async () => {
    await db.exec("reset role");
    await db.query("update subscriptions set status='paused' where workspace_id=$1", [W]);
    await expect(call(OWNER, [V2], [])).rejects.toThrow(/no_active_plan/);
    await db.exec("reset role");
    await db.query("update subscriptions set status='active' where workspace_id=$1", [W]);
  });

  it("request_discovery queues one discover per channel", async () => {
    await as(OWNER);
    const a = await db.query<{ j: string }>("select request_discovery($1,$1) as j", [W]);
    const b = await db.query<{ j: string }>("select request_discovery($1,$1) as j", [W]);
    expect(a.rows[0].j).toBe(b.rows[0].j);
    await as(OUTSIDER);
    await expect(db.query("select request_discovery($1,$1)", [W])).rejects.toThrow(/forbidden/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run supabase/tests/selection.test.ts`
Expected: the new `describe` fails with `function select_videos(uuid, uuid, uuid[], uuid[]) does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260915131000_select_videos.sql`:

```sql
-- The tenant chooses videos; the plan's remaining analysis units say how many.
-- This is the earlier layer. reserve_usage inside commit_batch stays the one
-- that spends, so a rule that meters is still enforced where the metering is.

create function private.analysis_remaining(w uuid) returns integer
language plpgsql stable security definer set search_path='' as $$
declare sub record; begin
  select s.period_start, pl.analysis_units into sub
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = w and s.status = 'active';
  if not found then raise exception 'no_active_plan' using errcode='53400'; end if;
  return greatest(0, sub.analysis_units
                     - private.used_units(w, 'comment_analysis', sub.period_start));
end $$;
revoke all on function private.analysis_remaining(uuid) from public, anon, authenticated;

create function private.select_videos_impl(w uuid, c uuid, add uuid[], remove uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare estimate int := 0; unknowns int := 0; remaining int; j uuid;
        queued boolean := false; deferred boolean := false; begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.channels where workspace_id=w and id=c) then
    raise exception 'invalid_channel' using errcode='23503'; end if;
  add := coalesce(add, '{}'::uuid[]); remove := coalesce(remove, '{}'::uuid[]);
  if exists(select 1 from unnest(add || remove) x(id)
             where not exists(select 1 from public.videos v
                               where v.workspace_id=w and v.channel_id=c and v.id=x.id)) then
    raise exception 'invalid_video' using errcode='23503'; end if;
  if exists(select 1 from public.videos v
             where v.workspace_id=w and v.id = any(add) and v.comments_state='disabled') then
    raise exception 'comments_disabled' using errcode='22023'; end if;

  -- Comments already in the database were already metered. A null count adds
  -- nothing to the sum and is reported apart, never as zero.
  select coalesce(sum(greatest(0, v.reported_comment_count
           - (select count(*) from public.comments cm
               where cm.workspace_id=w and cm.video_id=v.id))), 0)::int,
         count(*) filter (where v.reported_comment_count is null)::int
    into estimate, unknowns
    from public.videos v
   where v.workspace_id=w and v.id = any(add)
     and not exists(select 1 from public.video_selections s
                     where s.workspace_id=w and s.video_id=v.id);
  remaining := private.analysis_remaining(w);
  if estimate > remaining then
    raise exception 'quota_exceeded' using errcode='53400'; end if;

  delete from public.video_selections where workspace_id=w and video_id = any(remove);
  insert into public.video_selections(workspace_id, channel_id, video_id, selected_by)
  select w, c, x.id, (select auth.uid()) from unnest(add) x(id)
  on conflict (workspace_id, video_id) do nothing;

  if cardinality(add) > 0 then
    begin
      j := private.enqueue_sync_impl(w, c, 'selection-' || gen_random_uuid()::text);
      queued := true;
    exception when sqlstate '53400' then
      -- sync_too_soon. The selection is written; the tick picks it up.
      deferred := true;
    end;
  end if;
  return jsonb_build_object('job_id', j, 'queued', queued, 'deferred', deferred,
                            'estimate', estimate, 'unknown_count', unknowns,
                            'remaining_after', remaining - estimate);
end $$;
create function public.select_videos(w uuid, c uuid, add uuid[], remove uuid[]) returns jsonb
language sql security invoker set search_path='' as $$
  select private.select_videos_impl(w, c, add, remove) $$;

create function private.request_discovery_impl(w uuid, c uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j uuid; gap int; begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.channels where workspace_id=w and id=c) then
    raise exception 'invalid_channel' using errcode='23503'; end if;
  select id into j from public.jobs
   where workspace_id=w and channel_id=c and type='discover'
     and status in ('queued','running') order by created_at limit 1;
  if j is not null then return j; end if;
  gap := private.plan_limit(w, 'sync_interval');
  if gap is not null and gap > 0 and exists(
       select 1 from public.jobs where workspace_id=w and channel_id=c and type='discover'
         and created_at > now() - make_interval(mins => gap)) then
    raise exception 'sync_too_soon' using errcode='53400'; end if;
  begin
    insert into public.jobs(workspace_id, channel_id, type, dedupe_key)
    values (w, c, 'discover', 'discover-' || gen_random_uuid()::text) returning id into j;
  exception when unique_violation then
    select id into j from public.jobs
     where workspace_id=w and channel_id=c and type='discover'
       and status in ('queued','running') order by created_at limit 1;
  end;
  return j;
end $$;
create function public.request_discovery(w uuid, c uuid) returns uuid
language sql security invoker set search_path='' as $$
  select private.request_discovery_impl(w, c) $$;

revoke all on function private.select_videos_impl(uuid,uuid,uuid[],uuid[]),
  private.request_discovery_impl(uuid,uuid) from public;
grant execute on function private.select_videos_impl(uuid,uuid,uuid[],uuid[]),
  private.request_discovery_impl(uuid,uuid) to authenticated;
revoke all on function public.select_videos(uuid,uuid,uuid[],uuid[]),
  public.request_discovery(uuid,uuid) from public, anon;
grant execute on function public.select_videos(uuid,uuid,uuid[],uuid[]),
  public.request_discovery(uuid,uuid) to authenticated;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run supabase/tests/selection.test.ts`
Expected: 16 passed.

- [ ] **Step 5: Mutation check — delete the `if estimate > remaining` line, run, expect the quota test red, restore.**

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260915131000_select_videos.sql supabase/tests/selection.test.ts
git commit -m "select_videos: the tenant chooses, the remaining analysis units refuse

Already-stored comments cost nothing again; unknown counts are reported
apart; a rate-limited enqueue is deferred, not failed."
```

---

### Task 3: Worker-side SQL — claim mode, due lists, catalogue commit, per-video completion, the tick

**Files:**
- Create: `supabase/migrations/20260915132000_worker_catalogue_and_due_lists.sql`
- Create: `supabase/tests/worker_catalogue.test.ts`

**Interfaces:**
- Consumes: `private.worker_workspace(token_hash)`, `private.worker_job(token_hash,j,t)` (returns w), `private.claim_job` current body in `20260914200000`, `private.oauth_attach_channel_for` current body in `20260915110000`.
- Produces: `public.svc_worker_due_videos(credential_hash text, j uuid, t uuid) returns jsonb`; `public.svc_worker_commit_catalogue(credential_hash, j, t, payload jsonb) returns jsonb` → `{videos int}`; `public.svc_worker_video_finished(credential_hash, j, t, v uuid, outcome text, error_code text) returns void`; `public.svc_worker_tick(credential_hash) returns jsonb` → `{discover int, collect int}`; `private.schedule_due_work(w uuid) returns jsonb`. Refusals: `invalid_catalogue` 22023, `invalid_video` 23503, `invalid_outcome` 22023.

- [ ] **Step 1: Write the failing tests**

`supabase/tests/worker_catalogue.test.ts`:

```ts
/**
 * The worker is handed what to read and reports what it found, per video.
 * The workspace comes from the credential; the list from the selection table.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const OWNER_A = "10000000-0000-4000-8000-00000000000a";
const OWNER_B = "10000000-0000-4000-8000-00000000000b";
const CRED_A = "a".repeat(64);
const CRED_B = "b".repeat(64);
let db: PGlite;

const claim = async (cred: string) =>
  (
    await db.query<{ id: string; lease_token: string; type: string; channel_id: string }>(
      "select id, lease_token, type, channel_id from svc_worker_claim($1)",
      [cred],
    )
  ).rows[0];
const one = async <T,>(sql: string, params: unknown[]) =>
  (await db.query<T>(sql, params)).rows[0];

describe("worker catalogue and due lists", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const f of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort())
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await db.exec("reset role");
    for (const [w, owner, external, cred] of [
      [A, OWNER_A, `UC${"a".repeat(22)}`, CRED_A],
      [B, OWNER_B, `UC${"b".repeat(22)}`, CRED_B],
    ]) {
      await db.query("insert into auth.users(id) values ($1)", [owner]);
      await db.query("insert into workspaces(id,name,created_by) values ($1,'w',$2)", [w, owner]);
      await db.query("insert into memberships values ($1,$2,'workspace_owner')", [w, owner]);
      await db.query("insert into clients(id,workspace_id,name) values ($1,$1,'c')", [w]);
      await db.query(
        `insert into channels(id,workspace_id,client_id,external_channel_id,status)
         values ($1,$1,$1,$2,'connected')`,
        [w, external],
      );
      await db.query(
        `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
         values ($1,'pilot','active',now()-interval '1 day',now()+interval '29 days')`,
        [w],
      );
      await db.query(
        "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'x',$2)",
        [cred, w],
      );
    }
  });
  afterAll(async () => {
    await db?.close();
  });

  it("a claimed discover job opens a run in discover mode", async () => {
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'discover','d1')",
      [A],
    );
    const lease = await claim(CRED_A);
    expect(lease.type).toBe("discover");
    const run = await one<{ mode: string }>("select mode from sync_runs where job_id=$1", [lease.id]);
    expect(run.mode).toBe("discover");
  });

  it("commits a catalogue as videos and refuses a malformed one whole", async () => {
    const lease = await one<{ id: string; lease_token: string }>(
      "select id, lease_token from jobs where workspace_id=$1 and type='discover' and status='running'",
      [A],
    );
    await expect(
      db.query("select svc_worker_commit_catalogue($1,$2,$3,$4)", [
        CRED_A, lease.id, lease.lease_token,
        JSON.stringify([{ external_video_id: "ok_id_11chr", title: "x" }, { external_video_id: "too-short" }]),
      ]),
    ).rejects.toThrow(/invalid_catalogue/);
    expect((await db.query("select 1 from videos where workspace_id=$1", [A])).rows).toHaveLength(0);

    const r = await one<{ r: { videos: number } }>(
      "select svc_worker_commit_catalogue($1,$2,$3,$4) as r",
      [
        CRED_A, lease.id, lease.lease_token,
        JSON.stringify([
          { external_video_id: "aaaaaaaaaaa", title: "أول", kind: "video", published_at: "2026-01-01T00:00:00Z",
            thumbnail_url: "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg", reported_comment_count: 12,
            field_provenance: { source: "youtube_oauth", discovered_in_tabs: ["video"] } },
          { external_video_id: "bbbbbbbbbbb", title: "معطّل", kind: "short", reported_comment_count: null },
        ]),
      ],
    );
    expect(r.r.videos).toBe(2);
    const rows = await db.query<{ external_video_id: string; comments_state: string; reported_comment_count: number | null; kind: string }>(
      "select external_video_id, comments_state, reported_comment_count, kind from videos where workspace_id=$1 order by external_video_id",
      [A],
    );
    expect(rows.rows).toEqual([
      { external_video_id: "aaaaaaaaaaa", comments_state: "open", reported_comment_count: 12, kind: "video" },
      { external_video_id: "bbbbbbbbbbb", comments_state: "disabled", reported_comment_count: null, kind: "short" },
    ]);
    const ch = await one<{ catalogued_at: string | null }>("select catalogued_at from channels where id=$1", [A]);
    expect(ch.catalogued_at).not.toBeNull();
    const run = await one<{ coverage_summary: { videos_found: number } }>(
      "select coverage_summary from sync_runs where job_id=$1", [lease.id]);
    expect(run.coverage_summary.videos_found).toBe(2);
  });

  it("re-cataloguing keeps a real title over a bare id and updates the count", async () => {
    const lease = await one<{ id: string; lease_token: string }>(
      "select id, lease_token from jobs where workspace_id=$1 and type='discover' and status='running'", [A]);
    await db.query("select svc_worker_commit_catalogue($1,$2,$3,$4)", [
      CRED_A, lease.id, lease.lease_token,
      JSON.stringify([{ external_video_id: "aaaaaaaaaaa", title: "aaaaaaaaaaa", reported_comment_count: 15 }]),
    ]);
    const v = await one<{ title: string; reported_comment_count: number }>(
      "select title, reported_comment_count from videos where external_video_id='aaaaaaaaaaa'", []);
    expect(v).toEqual({ title: "أول", reported_comment_count: 15 });
    await db.query("select svc_worker_finish($1,$2,$3,'succeeded',null)", [CRED_A, lease.id, lease.lease_token]);
  });

  it("another credential cannot commit into this job", async () => {
    await db.query("insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'discover','d2')", [A]);
    const lease = await claim(CRED_A);
    await expect(
      db.query("select svc_worker_commit_catalogue($1,$2,$3,'[]')", [CRED_B, lease.id, lease.lease_token]),
    ).rejects.toThrow(/forbidden|lease_lost/);
    await db.query("select svc_worker_finish($1,$2,$3,'succeeded',null)", [CRED_A, lease.id, lease.lease_token]);
  });

  it("hands a collect claim its due list and nothing beyond the selection", async () => {
    await db.exec("reset role");
    const a = await one<{ id: string }>("select id from videos where external_video_id='aaaaaaaaaaa'", []);
    const b = await one<{ id: string }>("select id from videos where external_video_id='bbbbbbbbbbb'", []);
    await db.query(
      "insert into video_selections(workspace_id,channel_id,video_id) values ($1,$1,$2),($1,$1,$3)",
      [A, a.id, b.id],
    );
    await db.query("insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'collect','c1')", [A]);
    const lease = await claim(CRED_A);
    expect(lease.type).toBe("collect");
    const due = await one<{ d: { video_id: string; external_video_id: string }[] }>(
      "select svc_worker_due_videos($1,$2,$3) as d", [CRED_A, lease.id, lease.lease_token]);
    // b is disabled: selected, but not read.
    expect(due.d.map((v) => v.external_video_id)).toEqual(["aaaaaaaaaaa"]);

    await db.query("select svc_worker_video_finished($1,$2,$3,$4,'exhausted',null)",
      [CRED_A, lease.id, lease.lease_token, a.id]);
    const sel = await one<{ last_outcome: string; later: boolean }>(
      "select last_outcome, next_check_at > now() + interval '23 hours' as later from video_selections where video_id=$1",
      [a.id]);
    expect(sel).toEqual({ last_outcome: "exhausted", later: true });
    const again = await one<{ d: unknown[] }>(
      "select svc_worker_due_videos($1,$2,$3) as d", [CRED_A, lease.id, lease.lease_token]);
    expect(again.d).toEqual([]);

    await expect(
      db.query("select svc_worker_video_finished($1,$2,$3,$4,'sideways',null)",
        [CRED_A, lease.id, lease.lease_token, a.id]),
    ).rejects.toThrow(/invalid_outcome/);
    await db.query("select svc_worker_finish($1,$2,$3,'succeeded',null)", [CRED_A, lease.id, lease.lease_token]);
  });

  it("a video that refused comments is marked disabled by the collection", async () => {
    await db.exec("reset role");
    const a = await one<{ id: string }>("select id from videos where external_video_id='aaaaaaaaaaa'", []);
    await db.query("update video_selections set next_check_at=now() where video_id=$1", [a.id]);
    await db.query("insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'collect','c2')", [A]);
    const lease = await claim(CRED_A);
    await db.query("select svc_worker_video_finished($1,$2,$3,$4,'blocked','comments_disabled')",
      [CRED_A, lease.id, lease.lease_token, a.id]);
    const v = await one<{ comments_state: string }>("select comments_state from videos where id=$1", [a.id]);
    expect(v.comments_state).toBe("disabled");
    await db.query("update videos set comments_state='open' where id=$1", [a.id]);
    await db.query("select svc_worker_finish($1,$2,$3,'succeeded',null)", [CRED_A, lease.id, lease.lease_token]);
  });

  it("the tick enqueues a discover for an uncatalogued channel and a collect for due videos, once", async () => {
    await db.exec("reset role");
    // B: never catalogued, nothing selected.
    const first = await one<{ r: { discover: number; collect: number } }>(
      "select svc_worker_tick($1) as r", [CRED_B]);
    expect(first.r).toEqual({ discover: 1, collect: 0 });
    const second = await one<{ r: { discover: number; collect: number } }>(
      "select svc_worker_tick($1) as r", [CRED_B]);
    expect(second.r).toEqual({ discover: 0, collect: 0 });
    // A: catalogued today, one video due.
    const a = await one<{ id: string }>("select id from videos where external_video_id='aaaaaaaaaaa'", []);
    await db.query("update video_selections set next_check_at=now()-interval '1 minute' where video_id=$1", [a.id]);
    const third = await one<{ r: { discover: number; collect: number } }>(
      "select svc_worker_tick($1) as r", [CRED_A]);
    expect(third.r).toEqual({ discover: 0, collect: 1 });
  });

  it("connecting a channel queues its first discovery", async () => {
    await db.exec("reset role");
    await db.query("update jobs set status='succeeded' where workspace_id=$1 and status in ('queued','running')", [B]);
    await db.query(
      "select private.oauth_attach_channel_for($1,$2,$2,$3,'\\x00'::bytea,'k1',array['s'])",
      [OWNER_B, B, `UC${"b".repeat(22)}`],
    );
    const n = await one<{ n: number }>(
      "select count(*)::int as n from jobs where workspace_id=$1 and type='discover' and status='queued'", [B]);
    expect(n.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run supabase/tests/worker_catalogue.test.ts`
Expected: FAIL — `sync_runs` mode is `collect` for the discover claim (first test), and the `svc_worker_*` functions do not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260915132000_worker_catalogue_and_due_lists.sql`:

```sql
-- claim_job, rebuilt byte-for-byte from 20260914200000 with one change: the
-- run it opens takes its mode from the job's type instead of the literal
-- 'collect'. Everything else is what production runs.
create or replace function private.claim_job(w uuid) returns setof public.jobs
language plpgsql security invoker set search_path='' as $$
declare claimed public.jobs;
begin
  insert into public.worker_seen(workspace_id, last_seen_at)
  values (w, now())
  on conflict (workspace_id) do update set last_seen_at = now();

  update public.jobs set
      status = 'failed',
      error_code = case
        when reclaims >= 20
          then 'lease_thrashing:' || reclaims::text
        else 'retry_exhausted:' || coalesce(last_error, 'no_error_recorded')
      end,
      lease_token = null,
      lease_expires_at = null
   where workspace_id = w
     and status in ('queued', 'running')
     and (attempt >= 3 or reclaims >= 20)
     and (lease_expires_at is null or lease_expires_at <= now());

  update public.jobs j set
      status = 'running',
      attempt = j.attempt + case when j.status = 'queued' then 1 else 0 end,
      reclaims = j.reclaims + case when j.status = 'running' then 1 else 0 end,
      not_before = case
        when j.status = 'running' and j.reclaims >= 1
          then now() + least(interval '30 seconds' * (2 ^ least(j.reclaims, 5)),
                             interval '10 minutes')
        else j.not_before end,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '5 minutes'
   where j.id = (
     select q.id from public.jobs q
      where q.workspace_id = w
        and q.attempt < 3
        and q.reclaims < 20
        and q.not_before <= now()
        and (q.status = 'queued'
             or (q.status = 'running' and q.lease_expires_at <= now()))
      order by q.not_before, q.id
      for update skip locked limit 1)
  returning j.* into claimed;

  if claimed.id is null then return; end if;

  insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source,
                               status)
  values (claimed.workspace_id, claimed.channel_id, claimed.id,
          case when claimed.type in ('discover','collect','analyse','import')
               then claimed.type else 'collect' end,
          'unknown', 'running')
  on conflict (workspace_id, job_id) do update
    set status = 'running', ended_at = null, error_code = null;

  return next claimed;
end $$;
grant execute on function private.claim_job(uuid) to service_role;

-- What this claimed collect job should read.
create function private.worker_due_videos(token_hash text, j uuid, t uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid; c uuid; begin
  w := private.worker_job(token_hash, j, t);
  select channel_id into c from public.jobs where id = j;
  return private.due_videos(w, c);
end $$;

-- A catalogue batch: every item must be well-formed or none is written.
create function private.worker_commit_catalogue(token_hash text, j uuid, t uuid, payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w uuid; c uuid; n int; begin
  w := private.worker_job(token_hash, j, t);
  select channel_id into c from public.jobs where id = j;
  if payload is null or jsonb_typeof(payload) <> 'array' then
    raise exception 'invalid_catalogue' using errcode='22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(payload) i
     where jsonb_typeof(i) <> 'object'
        or coalesce(i->>'external_video_id','') !~ '^[A-Za-z0-9_-]{11}$'
        or (i ? 'kind' and i->>'kind' not in ('video','short','stream'))
        or (i ? 'reported_comment_count'
            and jsonb_typeof(i->'reported_comment_count') not in ('number','null'))
        or (i ? 'published_at' and jsonb_typeof(i->'published_at') not in ('string','null'))
        or (i ? 'field_provenance' and jsonb_typeof(i->'field_provenance') <> 'object')) then
    raise exception 'invalid_catalogue' using errcode='22023'; end if;

  insert into public.videos(workspace_id, channel_id, external_video_id, title, kind,
    published_at, duration_sec, thumbnail_url, reported_comment_count, comments_state,
    catalogued_at, last_observed_at, field_provenance)
  select w, c, i->>'external_video_id',
         coalesce(nullif(i->>'title',''), i->>'external_video_id'),
         coalesce(i->>'kind', 'video'),
         (i->>'published_at')::timestamptz,
         (i->>'duration_sec')::int,
         i->>'thumbnail_url',
         (i->>'reported_comment_count')::int,
         -- Absent or null count: comments are switched off on the source.
         case when jsonb_typeof(i->'reported_comment_count') = 'number'
              then 'open' else 'disabled' end,
         now(), now(), coalesce(i->'field_provenance', '{}'::jsonb)
    from jsonb_array_elements(payload) i
  on conflict (workspace_id, platform, external_video_id) do update set
    -- The best name known, as 20260914060000 decided for commits.
    title = case when excluded.title <> excluded.external_video_id
                 then excluded.title else public.videos.title end,
    kind = excluded.kind,
    published_at = coalesce(excluded.published_at, public.videos.published_at),
    duration_sec = coalesce(excluded.duration_sec, public.videos.duration_sec),
    thumbnail_url = coalesce(excluded.thumbnail_url, public.videos.thumbnail_url),
    reported_comment_count = excluded.reported_comment_count,
    comments_state = excluded.comments_state,
    catalogued_at = now(), last_observed_at = now(),
    field_provenance = public.videos.field_provenance || excluded.field_provenance;
  get diagnostics n = row_count;

  update public.channels set catalogued_at = now() where workspace_id = w and id = c;
  update public.sync_runs set coverage_summary = jsonb_build_object(
      'videos_found', (select count(*) from jsonb_array_elements(payload)),
      'by_kind', (select coalesce(jsonb_object_agg(k, cnt), '{}'::jsonb)
                    from (select coalesce(i->>'kind','video') k, count(*) cnt
                            from jsonb_array_elements(payload) i group by 1) x))
   where workspace_id = w and job_id = j;
  return jsonb_build_object('videos', n);
end $$;

-- One video's end. exhausted schedules the next check; comments_disabled is
-- learned back into the catalogue; anything else stays due so the next run
-- tries again.
create function private.worker_video_finished(
  token_hash text, j uuid, t uuid, v uuid, outcome text, reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare w uuid; iv int; begin
  w := private.worker_job(token_hash, j, t);
  if outcome not in ('exhausted','partial','blocked','failed') then
    raise exception 'invalid_outcome' using errcode='22023'; end if;
  if not exists(select 1 from public.videos where workspace_id = w and id = v) then
    raise exception 'invalid_video' using errcode='23503'; end if;
  iv := coalesce(private.plan_limit(w, 'live_interval'), 1440);
  if outcome = 'exhausted' then
    update public.video_selections
       set last_collected_at = now(), last_outcome = 'exhausted',
           next_check_at = now() + make_interval(mins => iv)
     where workspace_id = w and video_id = v;
    update public.videos set comments_state = 'open' where workspace_id = w and id = v;
  elsif reason = 'comments_disabled' then
    update public.videos set comments_state = 'disabled' where workspace_id = w and id = v;
    update public.video_selections set last_outcome = 'comments_disabled'
     where workspace_id = w and video_id = v;
  else
    update public.video_selections set last_outcome = coalesce(reason, outcome)
     where workspace_id = w and video_id = v;
  end if;
end $$;

-- Enqueue under the one-outstanding rule and the plan's rate limit, silently:
-- the tick is called on a schedule and has nobody to tell.
create function private.enqueue_scheduled(w uuid, c uuid, kind text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare j uuid; gap int; begin
  if exists(select 1 from public.jobs where workspace_id=w and channel_id=c and type=kind
             and status in ('queued','running')) then return null; end if;
  gap := private.plan_limit(w, 'sync_interval');
  if gap is not null and gap > 0 and exists(
       select 1 from public.jobs where workspace_id=w and channel_id=c and type=kind
         and created_at > now() - make_interval(mins => gap)) then return null; end if;
  begin
    insert into public.jobs(workspace_id, channel_id, type, dedupe_key)
    values (w, c, kind, kind || '-' || gen_random_uuid()::text) returning id into j;
  exception when unique_violation then return null;
  end;
  return j;
end $$;

create function private.schedule_due_work(w uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ch record; d int := 0; k int := 0; cat int; begin
  cat := coalesce(private.plan_limit(w, 'catalogue_interval'), 1440);
  for ch in select id, catalogued_at from public.channels
             where workspace_id = w and status = 'connected' loop
    if ch.catalogued_at is null
       or ch.catalogued_at < now() - make_interval(mins => cat) then
      if private.enqueue_scheduled(w, ch.id, 'discover') is not null then d := d + 1; end if;
    end if;
    if jsonb_array_length(private.due_videos(w, ch.id)) > 0 then
      if private.enqueue_scheduled(w, ch.id, 'collect') is not null then k := k + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('discover', d, 'collect', k);
end $$;

create function private.worker_tick(token_hash text) returns jsonb
language sql security invoker set search_path='' as $$
  select private.schedule_due_work(private.worker_workspace(token_hash))
$$;

-- For pg_cron, when the operator enables it on the project:
--   select cron.schedule('sentiment-tick', '17 * * * *', $$select private.schedule_all()$$);
create function private.schedule_all() returns void
language plpgsql security definer set search_path='' as $$
declare w uuid; begin
  for w in select workspace_id from public.subscriptions where status = 'active' loop
    perform private.schedule_due_work(w);
  end loop;
end $$;

create function public.svc_worker_due_videos(credential_hash text, j uuid, t uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.worker_due_videos(credential_hash, j, t) $$;
create function public.svc_worker_commit_catalogue(credential_hash text, j uuid, t uuid, payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.worker_commit_catalogue(credential_hash, j, t, payload) $$;
create function public.svc_worker_video_finished(
  credential_hash text, j uuid, t uuid, v uuid, outcome text, error_code text)
returns void language sql security invoker set search_path='' as $$
  select private.worker_video_finished(credential_hash, j, t, v, outcome, error_code) $$;
create function public.svc_worker_tick(credential_hash text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.worker_tick(credential_hash) $$;

revoke all on function
  private.worker_due_videos(text,uuid,uuid), private.worker_commit_catalogue(text,uuid,uuid,jsonb),
  private.worker_video_finished(text,uuid,uuid,uuid,text,text), private.enqueue_scheduled(uuid,uuid,text),
  private.schedule_due_work(uuid), private.worker_tick(text), private.schedule_all(),
  public.svc_worker_due_videos(text,uuid,uuid), public.svc_worker_commit_catalogue(text,uuid,uuid,jsonb),
  public.svc_worker_video_finished(text,uuid,uuid,uuid,text,text), public.svc_worker_tick(text)
  from public, anon, authenticated;
grant execute on function
  private.worker_due_videos(text,uuid,uuid), private.worker_commit_catalogue(text,uuid,uuid,jsonb),
  private.worker_video_finished(text,uuid,uuid,uuid,text,text), private.enqueue_scheduled(uuid,uuid,text),
  private.schedule_due_work(uuid), private.worker_tick(text), private.schedule_all(),
  public.svc_worker_due_videos(text,uuid,uuid), public.svc_worker_commit_catalogue(text,uuid,uuid,jsonb),
  public.svc_worker_video_finished(text,uuid,uuid,uuid,text,text), public.svc_worker_tick(text)
  to service_role;

-- oauth_attach_channel_for, rebuilt from 20260915110000 with one addition at
-- the end: a fresh connection queues its first discovery.
create or replace function private.oauth_attach_channel_for(
  u uuid, w uuid, c uuid, external_channel text, tokens bytea,
  key_version text, scopes text[],
  channel_handle text default null, channel_title text default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare ch uuid; begin
  if external_channel !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise exception 'invalid_channel_id' using errcode='22023'; end if;
  if exists(select 1 from public.channels
            where platform='youtube' and external_channel_id=external_channel
              and status='connected' and workspace_id <> w) then
    raise exception 'channel_already_connected' using errcode='23505'; end if;

  -- A name Google did not send this time does not erase one it sent before:
  -- a reconnect after a lapsed grant should not cost the reader the label.
  update public.channels set status='connected', client_id=c,
    handle=coalesce(channel_handle, handle),
    title=coalesce(channel_title, title)
  where workspace_id=w and platform='youtube'
    and external_channel_id=external_channel
  returning id into ch;
  if ch is null then
    insert into public.channels(workspace_id,client_id,external_channel_id,status,handle,title)
    values (w, c, external_channel, 'connected', channel_handle, channel_title)
    returning id into ch;
  end if;

  -- The grant being stored replaces whatever was live. Retired, not deleted:
  -- the row stays as the record that a connection existed.
  update private.oauth_connections set status='superseded'
  where channel_id=ch and status='connected';

  insert into private.oauth_connections(
    workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
  values (w, ch, u, tokens, key_version, scopes, 'connected');

  perform private.enqueue_scheduled(w, ch, 'discover');
  return ch;
end $$;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run supabase/tests/worker_catalogue.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Run the db suite and the OAuth suites in particular**

Run: `npm run test:db`
Expected: green. `oauth_callback.test.ts` calls `oauth_attach_channel_for`; the extra queued job must not break its assertions — if one counts `jobs`, read its comment and extend it to expect the discover row rather than deleting the enqueue.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260915132000_worker_catalogue_and_due_lists.sql supabase/tests/worker_catalogue.test.ts
git commit -m "The worker is handed its due list and reports each video's end

claim_job opens a run in the job's own mode; commit_catalogue writes the
source's list of videos; video_finished schedules the next check; the tick
enqueues discover and collect under the one-outstanding rule."
```

---

### Task 4: Contracts — `selectionEstimate`, catalogue schema, filter/sort/fit

**Files:**
- Create: `packages/contracts/src/selection.ts`, `packages/contracts/src/selection.test.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from "./selection";`)

**Interfaces:**
- Produces:
  ```ts
  export const CatalogueVideoSchema: z.ZodObject<...>; // one row as the UI reads it
  export type CatalogueVideo = {
    id: string; external_video_id: string; title: string;
    kind: "video" | "short" | "stream"; published_at: string | null;
    thumbnail_url: string | null; reported_comment_count: number | null;
    comments_state: "unknown" | "open" | "disabled";
    collected: number;              // comments already stored, from the snapshot
    selected: boolean; last_collected_at: string | null;
    last_outcome: string | null; next_check_at: string | null;
  };
  export function selectionEstimate(videos: CatalogueVideo[], adding: Set<string>, remaining: number | null):
    { estimate: number; unknownCount: number; remainingAfter: number | null; exceeds: boolean };
  export type CatalogueKind = "all" | CatalogueVideo["kind"];
  export type CatalogueSort = "newest" | "oldest" | "most_commented";
  export function filterCatalogue(videos: CatalogueVideo[], q: { search: string; kind: CatalogueKind; sort: CatalogueSort }): CatalogueVideo[];
  export function fitNewest(videos: CatalogueVideo[], remaining: number): string[]; // ids, newest first, while estimate fits
  ```

- [ ] **Step 1: Write the failing tests**

`packages/contracts/src/selection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CatalogueVideoSchema,
  filterCatalogue,
  fitNewest,
  selectionEstimate,
  type CatalogueVideo,
} from "./selection";

const v = (o: Partial<CatalogueVideo> & { id: string }): CatalogueVideo => ({
  external_video_id: "x".repeat(11),
  title: o.id,
  kind: "video",
  published_at: "2026-01-01T00:00:00Z",
  thumbnail_url: null,
  reported_comment_count: 10,
  comments_state: "open",
  collected: 0,
  selected: false,
  last_collected_at: null,
  last_outcome: null,
  next_check_at: null,
  ...o,
});

describe("selectionEstimate", () => {
  it("sums what is not yet stored and reports unknowns apart", () => {
    const rows = [
      v({ id: "a", reported_comment_count: 25, collected: 1 }),
      v({ id: "b", reported_comment_count: null }),
      v({ id: "c", reported_comment_count: 5, collected: 9 }),
    ];
    expect(selectionEstimate(rows, new Set(["a", "b", "c"]), 30)).toEqual({
      estimate: 24,
      unknownCount: 1,
      remainingAfter: 6,
      exceeds: false,
    });
  });
  it("ignores what is already selected and flags an overrun", () => {
    const rows = [v({ id: "a", selected: true, reported_comment_count: 100 }), v({ id: "b", reported_comment_count: 31 })];
    expect(selectionEstimate(rows, new Set(["a", "b"]), 30)).toMatchObject({ estimate: 31, exceeds: true, remainingAfter: -1 });
  });
  it("with no plan, nothing is known about the remainder", () => {
    expect(selectionEstimate([v({ id: "a" })], new Set(["a"]), null)).toMatchObject({ remainingAfter: null, exceeds: false });
  });
});

describe("filterCatalogue", () => {
  const rows = [
    v({ id: "1", title: "شرح الإحصاء", kind: "video", published_at: "2026-03-01T00:00:00Z", reported_comment_count: 3 }),
    v({ id: "2", title: "مقطع قصير", kind: "short", published_at: "2026-04-01T00:00:00Z", reported_comment_count: 9 }),
    v({ id: "3", title: "بث مباشر", kind: "stream", published_at: null, reported_comment_count: null }),
  ];
  it("searches the title, case-insensitively", () => {
    expect(filterCatalogue(rows, { search: "إحصاء", kind: "all", sort: "newest" }).map((r) => r.id)).toEqual(["1"]);
    expect(filterCatalogue(rows, { search: "  ", kind: "all", sort: "newest" })).toHaveLength(3);
  });
  it("filters by kind", () => {
    expect(filterCatalogue(rows, { search: "", kind: "short", sort: "newest" }).map((r) => r.id)).toEqual(["2"]);
  });
  it("sorts newest with unknown dates last, and most-commented with unknown counts last", () => {
    expect(filterCatalogue(rows, { search: "", kind: "all", sort: "newest" }).map((r) => r.id)).toEqual(["2", "1", "3"]);
    expect(filterCatalogue(rows, { search: "", kind: "all", sort: "oldest" }).map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(filterCatalogue(rows, { search: "", kind: "all", sort: "most_commented" }).map((r) => r.id)).toEqual(["2", "1", "3"]);
  });
});

describe("fitNewest", () => {
  it("takes the newest videos while the estimate fits, skipping disabled and selected ones", () => {
    const rows = [
      v({ id: "old", published_at: "2026-01-01T00:00:00Z", reported_comment_count: 5 }),
      v({ id: "new", published_at: "2026-05-01T00:00:00Z", reported_comment_count: 20 }),
      v({ id: "mid", published_at: "2026-03-01T00:00:00Z", reported_comment_count: 8 }),
      v({ id: "off", published_at: "2026-06-01T00:00:00Z", comments_state: "disabled" }),
      v({ id: "have", published_at: "2026-06-02T00:00:00Z", selected: true }),
    ];
    expect(fitNewest(rows, 26)).toEqual(["new", "old"]);
  });
});

describe("CatalogueVideoSchema", () => {
  it("refuses a zero standing in for unknown only where the source said null", () => {
    expect(CatalogueVideoSchema.safeParse(v({ id: "a", reported_comment_count: null })).success).toBe(true);
    expect(CatalogueVideoSchema.safeParse({ ...v({ id: "a" }), kind: "clip" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/contracts/src/selection.test.ts`
Expected: FAIL — cannot resolve `./selection`.

- [ ] **Step 3: Implement**

`packages/contracts/src/selection.ts`:

```ts
/**
 * What a video costs to select, and how the catalogue is narrowed.
 *
 * The arithmetic here is the same the database enforces in select_videos; the
 * browser shows it live, the server refuses on it. Two implementations of one
 * rule, on purpose and asserted against each other in the SQL tests: the UI's
 * number is advisory, the RPC's is the one that spends.
 */
import { z } from "zod";

export const CatalogueVideoSchema = z
  .object({
    id: z.string().min(1),
    external_video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    title: z.string(),
    kind: z.enum(["video", "short", "stream"]),
    published_at: z.string().nullable(),
    thumbnail_url: z.string().nullable(),
    // Null is unknown. Never 0 for unknown.
    reported_comment_count: z.number().int().nonnegative().nullable(),
    comments_state: z.enum(["unknown", "open", "disabled"]),
    collected: z.number().int().nonnegative(),
    selected: z.boolean(),
    last_collected_at: z.string().nullable(),
    last_outcome: z.string().nullable(),
    next_check_at: z.string().nullable(),
  })
  .strict();
export type CatalogueVideo = z.infer<typeof CatalogueVideoSchema>;

const cost = (r: CatalogueVideo) =>
  r.reported_comment_count === null
    ? null
    : Math.max(0, r.reported_comment_count - r.collected);

export function selectionEstimate(
  videos: CatalogueVideo[],
  adding: Set<string>,
  remaining: number | null,
) {
  let estimate = 0;
  let unknownCount = 0;
  for (const r of videos) {
    if (!adding.has(r.id) || r.selected) continue;
    const c = cost(r);
    if (c === null) unknownCount++;
    else estimate += c;
  }
  const remainingAfter = remaining === null ? null : remaining - estimate;
  return {
    estimate,
    unknownCount,
    remainingAfter,
    exceeds: remainingAfter !== null && remainingAfter < 0,
  };
}

export type CatalogueKind = "all" | CatalogueVideo["kind"];
export type CatalogueSort = "newest" | "oldest" | "most_commented";

const time = (r: CatalogueVideo) =>
  r.published_at ? Date.parse(r.published_at) : null;

/** Unknown sorts last whichever way the known values go. */
const byNullableDesc =
  (key: (r: CatalogueVideo) => number | null, direction: 1 | -1) =>
  (a: CatalogueVideo, b: CatalogueVideo) => {
    const x = key(a),
      y = key(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (y - x) * direction;
  };

export function filterCatalogue(
  videos: CatalogueVideo[],
  q: { search: string; kind: CatalogueKind; sort: CatalogueSort },
): CatalogueVideo[] {
  const needle = q.search.trim().toLocaleLowerCase();
  const rows = videos.filter(
    (r) =>
      (q.kind === "all" || r.kind === q.kind) &&
      (needle === "" || r.title.toLocaleLowerCase().includes(needle)),
  );
  const order =
    q.sort === "newest"
      ? byNullableDesc(time, 1)
      : q.sort === "oldest"
        ? byNullableDesc(time, -1)
        : byNullableDesc((r) => r.reported_comment_count, 1);
  return [...rows].sort(order);
}

/** Newest first, while the estimate still fits. Unknown counts are skipped:
 *  a video that cannot be priced cannot be fitted. */
export function fitNewest(videos: CatalogueVideo[], remaining: number): string[] {
  const chosen: string[] = [];
  let left = remaining;
  for (const r of filterCatalogue(videos, { search: "", kind: "all", sort: "newest" })) {
    if (r.selected || r.comments_state === "disabled") continue;
    const c = cost(r);
    if (c === null || c > left) continue;
    chosen.push(r.id);
    left -= c;
  }
  return chosen;
}
```

Add to `packages/contracts/src/index.ts`: `export * from "./selection";`

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/contracts/src/selection.test.ts`
Expected: 9 passed. Then `npm run typecheck` — 0.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/selection.ts packages/contracts/src/selection.test.ts packages/contracts/src/index.ts
git commit -m "The cost of a selection, computed once and shown live"
```

---

### Task 5: Gateway — claim carries `type` and `videos`; three new routes

**Files:**
- Modify: `supabase/functions/_shared/worker-gateway.ts`
- Modify: `supabase/functions/worker/index.ts`
- Modify: `supabase/tests/worker_gateway_handler.test.ts`

**Interfaces:**
- Consumes: Task 3 `svc_worker_due_videos`, `svc_worker_commit_catalogue`, `svc_worker_video_finished`, `svc_worker_tick`.
- Produces (wire): `POST /worker/claim` → `{job_id, lease_token, checkpoint, access_token, type, videos}` (`videos` is `[]` for anything but `collect`); `POST /worker/commit-catalogue {job_id, lease_token, payload: [...]}` → `{videos}`; `POST /worker/video-finished {job_id, lease_token, video_id, outcome, error_code}` → `{}`; `POST /worker/tick {}` → `{discover, collect}`. `WorkerDb` gains `dueVideos?`, `commitCatalogue`, `videoFinished`, `tick`.

- [ ] **Step 1: Update the failing tests**

In `supabase/tests/worker_gateway_handler.test.ts`, extend `base()`:

```ts
const base = (): WorkerDb => ({
  claim: vi.fn(async () => null),
  heartbeat: vi.fn(async () => {}),
  commitBatch: vi.fn(async () => ({})),
  finish: vi.fn(async () => {}),
  commitCatalogue: vi.fn(async () => ({ videos: 0 })),
  videoFinished: vi.fn(async () => {}),
  tick: vi.fn(async () => ({ discover: 0, collect: 0 })),
});
```

Change the first test's key assertion to:

```ts
    expect(Object.keys(body).sort()).toEqual([
      "access_token",
      "checkpoint",
      "job_id",
      "lease_token",
      "type",
      "videos",
    ]);
```

and give that test's `claim` a `type: "collect"`. Append a new `describe`:

```ts
describe("the due list and the catalogue", () => {
  const send = (db: WorkerDb, path: string, body: unknown) =>
    handleWorkerRequest(
      new Request(`https://edge.invalid${path}`, {
        method: "POST",
        headers: { authorization: "Bearer cred", "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      db,
    );

  it("hands a collect claim its due videos, and a discover claim none", async () => {
    const dueVideos = vi.fn(async () => [{ video_id: "v", external_video_id: "a".repeat(11), title: "t" }]);
    const db: WorkerDb = {
      ...base(),
      claim: async () => ({ id: "j", lease_token: "l", checkpoint: null, type: "collect" }),
      dueVideos,
    };
    const body = (await (await post(db)).json()) as { type: string; videos: unknown[] };
    expect(body.type).toBe("collect");
    expect(body.videos).toHaveLength(1);
    expect(dueVideos).toHaveBeenCalledWith(expect.any(String), "j", "l");

    const discover: WorkerDb = {
      ...base(),
      claim: async () => ({ id: "j", lease_token: "l", checkpoint: null, type: "discover" }),
      dueVideos,
    };
    const d = (await (await post(discover)).json()) as { type: string; videos: unknown[] };
    expect(d).toMatchObject({ type: "discover", videos: [] });
    expect(dueVideos).toHaveBeenCalledTimes(1);
  });

  it("commits a catalogue only as an array under a live lease", async () => {
    const db = base();
    const bad = await send(db, "/worker/commit-catalogue", { job_id: "j", lease_token: "l", payload: {} });
    expect(bad.status).toBe(400);
    const ok = await send(db, "/worker/commit-catalogue", { job_id: "j", lease_token: "l", payload: [] });
    expect(ok.status).toBe(200);
    expect(db.commitCatalogue).toHaveBeenCalledWith(expect.any(String), "j", "l", []);
  });

  it("records a video's end with its outcome and code", async () => {
    const db = base();
    const r = await send(db, "/worker/video-finished", {
      job_id: "j", lease_token: "l", video_id: "v", outcome: "blocked", error_code: "comments_disabled",
    });
    expect(r.status).toBe(200);
    expect(db.videoFinished).toHaveBeenCalledWith(expect.any(String), "j", "l", "v", "blocked", "comments_disabled");
    const missing = await send(db, "/worker/video-finished", { job_id: "j", lease_token: "l" });
    expect(missing.status).toBe(400);
  });

  it("ticks without a lease and maps a refused catalogue to 400", async () => {
    const db = base();
    const t = await send(db, "/worker/tick", {});
    expect(t.status).toBe(200);
    expect(await t.json()).toEqual({ discover: 0, collect: 0 });
    const refusing: WorkerDb = {
      ...base(),
      commitCatalogue: async () => { throw { code: "invalid_catalogue" }; },
    };
    const r = await send(refusing, "/worker/commit-catalogue", { job_id: "j", lease_token: "l", payload: [] });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ code: "invalid_catalogue" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run supabase/tests/worker_gateway_handler.test.ts`
Expected: type errors on `WorkerDb` / failing assertions.

- [ ] **Step 3: Implement the handler**

In `worker-gateway.ts`, extend the interface after `finish(...)`:

```ts
  /** The videos a collect job should read, decided by the server. */
  dueVideos?(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
  ): Promise<unknown>;
  commitCatalogue(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
    payload: unknown[],
  ): Promise<unknown>;
  videoFinished(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
    videoId: string,
    outcome: string,
    errorCode: string | null,
  ): Promise<void>;
  /** Enqueue whatever is due for this credential's workspace. No lease. */
  tick(credentialHash: string): Promise<unknown>;
```

Add to `STATUS`: `invalid_catalogue: 400, invalid_video: 400,`.

Replace the claim block's `return json(200, {...})` with:

```ts
      const type = String(claimed.type ?? "collect");
      const videos =
        type === "collect" && db.dueVideos
          ? await db.dueVideos(credential, String(claimed.id), String(claimed.lease_token))
          : [];
      return json(200, {
        job_id: claimed.id,
        lease_token: claimed.lease_token,
        checkpoint: claimed.checkpoint ?? null,
        access_token: accessToken,
        type,
        videos,
      });
```

Before the `leased` routes, add the tick:

```ts
    if (path.endsWith("/worker/tick")) return json(200, await db.tick(credential));
```

Extend `leased` with `"/worker/commit-catalogue", "/worker/video-finished"`, and add before the final 404:

```ts
    if (path.endsWith("/worker/commit-catalogue")) {
      if (!Array.isArray(body.payload)) return refuse("invalid_catalogue");
      return json(200, await db.commitCatalogue(credential, job, lease, body.payload));
    }
    if (path.endsWith("/worker/video-finished")) {
      const video = str(body, "video_id");
      const outcome = str(body, "outcome");
      if (!video || !outcome) return refuse("invalid_batch");
      await db.videoFinished(credential, job, lease, video, outcome, str(body, "error_code"));
      return json(200, {});
    }
```

In `supabase/functions/worker/index.ts`, add to the object passed to `handleWorkerRequest`:

```ts
    dueVideos: async (hash, j, t) => {
      const { data, error } = await db.rpc("svc_worker_due_videos", { credential_hash: hash, j, t });
      if (error) failed(error);
      return data ?? [];
    },
    commitCatalogue: async (hash, j, t, payload) => {
      const { data, error } = await db.rpc("svc_worker_commit_catalogue", { credential_hash: hash, j, t, payload });
      if (error) failed(error);
      return data;
    },
    videoFinished: async (hash, j, t, v, outcome, errorCode) => {
      const { error } = await db.rpc("svc_worker_video_finished", { credential_hash: hash, j, t, v, outcome, error_code: errorCode });
      if (error) failed(error);
    },
    tick: async (hash) => {
      const { data, error } = await db.rpc("svc_worker_tick", { credential_hash: hash });
      if (error) failed(error);
      return data;
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run supabase/tests/worker_gateway_handler.test.ts && npm run check:functions`
Expected: green; deno check 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/worker-gateway.ts supabase/functions/worker/index.ts supabase/tests/worker_gateway_handler.test.ts
git commit -m "The claim carries the job's type and its due list; three routes for the rest"
```

---

### Task 6: Python collector — `YouTubeAPI.catalogue()`

**Files:**
- Modify: `workers/python/src/collectors/youtube_api.py`
- Modify: `workers/python/src/collectors/protocol.py`
- Create: `workers/python/tests/test_catalogue.py`

**Interfaces:**
- Produces: `@dataclass(frozen=True) class Catalogue: videos: list[dict]; complete: bool; reason: str | None` in `protocol.py`; `YouTubeAPI.catalogue() -> Catalogue` where each video dict is `{external_video_id, title, kind, published_at, thumbnail_url, duration_sec, reported_comment_count: int|None, field_provenance: {source, adapter_revision, discovered_in_tabs: [...]}}`. `YouTubeAPI._get(resource, params, allow_404=False)` returns `None` on a 404 when allowed.

- [ ] **Step 1: Write the failing tests**

`workers/python/tests/test_catalogue.py`:

```python
"""The channel's videos, with what the source says about each."""
import httpx
import pytest

from collectors.protocol import CollectionError
from collectors.youtube_api import YouTubeAPI


def channel(uploads="UUxxxxxxxxxxxxxxxxxxxxxx"):
    return {"items": [{"contentDetails": {"relatedPlaylists": {"uploads": uploads}}}]}


def items(ids, next_page=None):
    body = {"items": [{"contentDetails": {"videoId": v}} for v in ids]}
    if next_page:
        body["nextPageToken"] = next_page
    return body


def stats(rows):
    return {"items": [
        {"id": r["id"],
         "snippet": {"title": r.get("title", r["id"]), "publishedAt": "2026-01-02T03:04:05Z",
                     "thumbnails": {"medium": {"url": f"https://i/{r['id']}.jpg"}}},
         "statistics": ({"commentCount": str(r["comments"])} if r.get("comments") is not None else {}),
         "contentDetails": {"duration": r.get("duration", "PT1M5S")}}
        for r in rows]}


def serve(tabs, videos, fail=None):
    calls = []

    def handler(request):
        p = request.url.path
        calls.append((p, dict(request.url.params)))
        if fail and p.endswith(fail):
            return httpx.Response(500, json={"error": {}})
        if p.endswith("/channels"):
            return httpx.Response(200, json=channel())
        if p.endswith("/playlistItems"):
            pl = request.url.params["playlistId"]
            page = request.url.params.get("pageToken")
            tab = tabs.get(pl)
            if tab is None:
                return httpx.Response(404, json={"error": {"errors": [{"reason": "playlistNotFound"}]}})
            pages = tab if isinstance(tab, list) else [tab]
            idx = int(page or 0)
            nxt = str(idx + 1) if idx + 1 < len(pages) else None
            return httpx.Response(200, json=items(pages[idx], nxt))
        if p.endswith("/videos"):
            wanted = request.url.params["id"].split(",")
            return httpx.Response(200, json=stats([v for v in videos if v["id"] in wanted]))
        return httpx.Response(404, json={"error": {}})

    return httpx.Client(transport=httpx.MockTransport(handler)), calls


def test_three_tabs_classify_kind_and_a_missing_count_is_disabled():
    client, calls = serve(
        {"UULFxxxxxxxxxxxxxxxxxxxxxx": ["aaaaaaaaaaa"],
         "UUSHxxxxxxxxxxxxxxxxxxxxxx": ["bbbbbbbbbbb"],
         "UULVxxxxxxxxxxxxxxxxxxxxxx": None},
        [{"id": "aaaaaaaaaaa", "title": "أول", "comments": 12},
         {"id": "bbbbbbbbbbb", "title": "قصير", "comments": None}],
    )
    cat = YouTubeAPI(None, client, access_token="tok").catalogue()
    assert cat.complete is True
    by = {v["external_video_id"]: v for v in cat.videos}
    assert by["aaaaaaaaaaa"]["kind"] == "video"
    assert by["aaaaaaaaaaa"]["reported_comment_count"] == 12
    assert by["aaaaaaaaaaa"]["duration_sec"] == 65
    assert by["aaaaaaaaaaa"]["thumbnail_url"] == "https://i/aaaaaaaaaaa.jpg"
    assert by["bbbbbbbbbbb"]["kind"] == "short"
    assert by["bbbbbbbbbbb"]["reported_comment_count"] is None
    assert by["aaaaaaaaaaa"]["field_provenance"]["discovered_in_tabs"] == ["video"]
    assert all("tok" not in str(c) for c in calls)


def test_a_video_in_two_tabs_keeps_the_first_kind_and_records_both():
    client, _ = serve(
        {"UULFxxxxxxxxxxxxxxxxxxxxxx": ["aaaaaaaaaaa"],
         "UUSHxxxxxxxxxxxxxxxxxxxxxx": ["aaaaaaaaaaa"],
         "UULVxxxxxxxxxxxxxxxxxxxxxx": None},
        [{"id": "aaaaaaaaaaa", "comments": 1}],
    )
    cat = YouTubeAPI(None, client, access_token="tok").catalogue()
    assert len(cat.videos) == 1
    assert cat.videos[0]["kind"] == "video"
    assert cat.videos[0]["field_provenance"]["discovered_in_tabs"] == ["video", "short"]


def test_pagination_and_fifty_id_chunks():
    ids = [f"v{i:010d}" for i in range(120)]
    client, calls = serve(
        {"UULFxxxxxxxxxxxxxxxxxxxxxx": [ids[:50], ids[50:100], ids[100:]],
         "UUSHxxxxxxxxxxxxxxxxxxxxxx": None, "UULVxxxxxxxxxxxxxxxxxxxxxx": None},
        [{"id": i, "comments": 0} for i in ids],
    )
    cat = YouTubeAPI(None, client, access_token="tok").catalogue()
    assert len(cat.videos) == 120
    assert sum(1 for p, _ in calls if p.endswith("/videos")) == 3
    assert sum(1 for p, _ in calls if p.endswith("/playlistItems")) == 3 + 2  # 3 pages + 2 empty tabs


def test_every_tab_missing_falls_back_to_all_uploads_unclassified():
    client, _ = serve(
        {"UUxxxxxxxxxxxxxxxxxxxxxx": ["aaaaaaaaaaa"]},
        [{"id": "aaaaaaaaaaa", "comments": 2}],
    )
    cat = YouTubeAPI(None, client, access_token="tok").catalogue()
    assert cat.complete is True
    assert cat.videos[0]["kind"] == "video"
    assert cat.videos[0]["field_provenance"]["kind_unclassified"] is True


def test_a_failing_statistics_call_is_not_a_complete_catalogue():
    client, _ = serve(
        {"UULFxxxxxxxxxxxxxxxxxxxxxx": ["aaaaaaaaaaa"], "UUSHxxxxxxxxxxxxxxxxxxxxxx": None,
         "UULVxxxxxxxxxxxxxxxxxxxxxx": None},
        [{"id": "aaaaaaaaaaa", "comments": 2}],
        fail="/videos",
    )
    with pytest.raises(CollectionError) as e:
        YouTubeAPI(None, client, access_token="tok").catalogue()
    assert e.value.code == "source_unavailable"
    assert e.value.retryable is True


def test_needs_the_owner_token():
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"items": []}))) as client:
        with pytest.raises(CollectionError, match="no_channel_for_credential"):
            YouTubeAPI("key", client).catalogue()
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run worker:test -- tests/test_catalogue.py -q`
Expected: `AttributeError: 'YouTubeAPI' object has no attribute 'catalogue'`.

- [ ] **Step 3: Implement**

In `protocol.py`, after `Batch`:

```python
@dataclass(frozen=True)
class Catalogue:
    """Every video the source listed. complete is whether every tab was read
    to its end — never a claim that every video that exists was listed."""
    videos: list[dict]
    complete: bool
    reason: str | None = None
```

In `youtube_api.py`, change `_get`'s signature and 404 handling:

```python
    def _get(self, resource, params, allow_404=False):
        ...
        if response.status_code == 404 and allow_404:
            return None
        if response.status_code >= 500:
```

(insert the 404 line just before the `>= 500` check; the rest of `_get` is unchanged). Add at the end of the class:

```python
    _TABS = (("video", "LF"), ("short", "SH"), ("stream", "LV"))
    _DURATION = re.compile(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$")

    def _playlist(self, playlist_id: str) -> list[str] | None:
        """Every video id in a playlist, or None when the playlist is absent."""
        ids: list[str] = []
        page = None
        while True:
            params = {"part": "contentDetails", "playlistId": playlist_id, "maxResults": 50}
            if page:
                params["pageToken"] = page
            data = self._get("playlistItems", params, allow_404=True)
            if data is None:
                return None if not ids else ids
            try:
                ids.extend(i["contentDetails"]["videoId"] for i in data["items"])
            except (KeyError, TypeError):
                raise CollectionError("invalid_response") from None
            nxt = data.get("nextPageToken")
            if nxt and nxt == page:
                raise CollectionError("repeated_page_token", "partial")
            page = nxt
            if not page:
                return ids

    def catalogue(self) -> Catalogue:
        """The channel's videos across its three tabs, with the source's counts.

        Cost: about two quota units per fifty videos. The tab playlists are the
        uploads id with LF/SH/LV inserted after UU; a 404 on one is an empty
        tab. If all three are absent the plain uploads list stands in and the
        kind is recorded as unclassified rather than guessed.
        """
        data = self._get("channels", {"part": "contentDetails", "mine": "true"})
        if not data["items"]:
            raise CollectionError("no_channel_for_credential", "blocked")
        try:
            uploads = data["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
        except (KeyError, TypeError):
            raise CollectionError("invalid_response") from None
        base = uploads[2:]

        found: dict[str, dict] = {}
        any_tab = False
        for kind, suffix in self._TABS:
            ids = self._playlist(f"UU{suffix}{base}")
            if ids is None:
                continue
            any_tab = True
            for vid in ids:
                if vid in found:
                    found[vid]["tabs"].append(kind)
                else:
                    found[vid] = {"kind": kind, "tabs": [kind]}
        unclassified = False
        if not any_tab:
            unclassified = True
            for vid in self._playlist(uploads) or []:
                found.setdefault(vid, {"kind": "video", "tabs": []})

        videos: list[dict] = []
        ids = list(found)
        for start in range(0, len(ids), 50):
            chunk = ids[start:start + 50]
            data = self._get("videos", {"part": "snippet,statistics,contentDetails",
                                        "id": ",".join(chunk)})
            for item in data["items"]:
                try:
                    vid = item["id"]
                    s = item.get("snippet", {})
                    raw = item.get("statistics", {}).get("commentCount")
                    provenance = {"source": self.source, "adapter_revision": self.revision,
                                  "discovered_in_tabs": found[vid]["tabs"]}
                    if unclassified:
                        provenance["kind_unclassified"] = True
                    videos.append({
                        "external_video_id": vid,
                        "title": s.get("title") or "",
                        "kind": found[vid]["kind"],
                        "published_at": s.get("publishedAt"),
                        "thumbnail_url": (s.get("thumbnails") or {}).get("medium", {}).get("url"),
                        "duration_sec": self._seconds(item.get("contentDetails", {}).get("duration")),
                        # None is the setting being off, never a count of zero.
                        "reported_comment_count": None if raw is None else int(raw),
                        "field_provenance": provenance,
                    })
                except (KeyError, TypeError, ValueError):
                    raise CollectionError("invalid_response") from None
        return Catalogue(videos=videos, complete=True)

    @classmethod
    def _seconds(cls, iso: str | None) -> int | None:
        if not iso:
            return None
        m = cls._DURATION.match(iso)
        if not m:
            return None
        h, mi, s = (int(x) if x else 0 for x in m.groups())
        return h * 3600 + mi * 60 + s
```

Add `Catalogue` to the import from `.protocol`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run worker:test -- tests/test_catalogue.py tests/test_youtube.py -q && npm run worker:lint`
Expected: all pass; ruff 0.

- [ ] **Step 5: Commit**

```bash
git add workers/python/src/collectors/youtube_api.py workers/python/src/collectors/protocol.py workers/python/tests/test_catalogue.py
git commit -m "The collector can list a channel's videos across its three tabs"
```

---

### Task 7: Python control plane, runner, loop — the worker reads what it is handed

**Files:**
- Modify: `workers/python/src/server/gateway.py`
- Modify: `workers/python/src/server/runner.py`
- Modify: `workers/python/src/server/loop.py`
- Modify: `workers/python/src/server/manual_run.py`
- Modify: `workers/python/tests/test_backfill.py`, `tests/test_loop.py`
- Create: `workers/python/tests/test_discover.py`

**Interfaces:**
- Consumes: Task 5 wire; Task 6 `catalogue()`.
- Produces: `ControlPlane.commit_catalogue(lease, videos) -> dict|None`; `ControlPlane.video_finished(lease, video_id, outcome, error_code=None) -> None`; `ControlPlane.tick() -> dict|None`; `run_backfill(control, build_collector, analyzer=None) -> bool` where `build_collector(token) -> collector` and the videos come from `lease["videos"]`; `run_discover(control, build_collector) -> bool`; `run_job(control, build_collector, analyzer=None) -> bool` dispatching on `lease["type"]`; `loop.serve(controls, build_collector, ..., run=run_job)`; `loop.build_collector(client)`.

- [ ] **Step 1: Update `test_backfill.py`'s `drive` and write `test_discover.py`**

In `test_backfill.py`, change `drive` so the claim carries the list and the collector builder returns only the collector; record `video-finished` calls:

```python
def drive(pages, videos, checkpoint=None, access_token="ya29.ok"):
    """Run a backfill against a synthetic control plane; return what it sent."""
    sent = {"commits": [], "finish": None, "error_code": None, "video_finished": []}

    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(200, json={
                "job_id": "j1", "lease_token": "t1", "type": "collect",
                "checkpoint": checkpoint, "videos": videos,
                **({"access_token": access_token} if access_token else {}),
            })
        if path == "commit-batch":
            body = json.loads(request.content)["payload"]
            sent["commits"].append(
                (body["external_video_id"], body["video_title"], body["checkpoint"])
            )
        if path == "video-finished":
            body = json.loads(request.content)
            sent["video_finished"].append((body["video_id"], body["outcome"], body["error_code"]))
        if path == "finish":
            body = json.loads(request.content)
            sent["finish"], sent["error_code"] = body["outcome"], body["error_code"]
        return httpx.Response(200, json={})

    collector = Plan(pages)
    plane = ControlPlane("https://c.invalid", "cred",
                         httpx.Client(transport=httpx.MockTransport(handler)))
    worked = run_backfill(plane, lambda token: collector)
    return worked, sent, collector
```

Every `videos` list in that file's tests gains a `"video_id"` per entry equal to its external id if it does not carry one already, e.g. `{"video_id": "v1", "external_video_id": "v1", "title": "..."}`; the runner reads `external_video_id` for the source and `video_id` for the server. Read each test; where it asserted `collector.asked` by `video_id`, that key now names the external id. The `run_backfill(plane, plan)` call at line ~145 becomes `run_backfill(plane, lambda token: collector)` with the videos moved into that test's claim response. Add two tests:

```python
def test_reports_each_exhausted_video_and_an_empty_due_list_is_a_success():
    pages = {"a": [Batch([comment("c1", "a")], None, "exhausted")]}
    worked, sent, _ = drive(pages, [{"video_id": "ua", "external_video_id": "a", "title": "أ"}])
    assert worked is True
    assert sent["video_finished"] == [("ua", "exhausted", None)]
    assert sent["finish"] == "succeeded"

    worked, sent, collector = drive({}, [])
    assert worked is True and sent["finish"] == "succeeded" and collector.asked == []


def test_a_disabled_video_is_reported_and_skipped_not_the_whole_run():
    class Refusing(Plan):
        def batches(self, video_id, checkpoint):
            if video_id == "off":
                raise CollectionError("comments_disabled", "explicitly_disabled")
            yield from super().batches(video_id, checkpoint)

    sent = {"video_finished": [], "finish": None}

    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(200, json={
                "job_id": "j", "lease_token": "t", "type": "collect", "checkpoint": None,
                "access_token": "tok",
                "videos": [{"video_id": "u-off", "external_video_id": "off", "title": None},
                           {"video_id": "u-on", "external_video_id": "on", "title": None}]})
        if path == "video-finished":
            b = json.loads(request.content)
            sent["video_finished"].append((b["video_id"], b["outcome"], b["error_code"]))
        if path == "finish":
            sent["finish"] = json.loads(request.content)["outcome"]
        return httpx.Response(200, json={})

    collector = Refusing({"on": [Batch([comment("c", "on")], None, "exhausted")]})
    plane = ControlPlane("https://c.invalid", "cred", httpx.Client(transport=httpx.MockTransport(handler)))
    assert run_backfill(plane, lambda token: collector) is True
    assert sent["video_finished"] == [("u-off", "blocked", "comments_disabled"), ("u-on", "exhausted", None)]
    assert sent["finish"] == "succeeded"
```

(add `from collectors.protocol import CollectionError` to the imports.)

`workers/python/tests/test_discover.py`:

```python
"""A discover job commits the catalogue and ends honestly."""
import json

import httpx

from collectors.protocol import Catalogue, CollectionError
from server.gateway import ControlPlane
from server.runner import run_discover, run_job


class Lister:
    def __init__(self, result):
        self.result = result

    def catalogue(self):
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def plane(sent, lease_type="discover", token="tok"):
    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(200, json={
                "job_id": "j", "lease_token": "t", "type": lease_type, "checkpoint": None,
                "videos": [], **({"access_token": token} if token else {})})
        if path == "commit-catalogue":
            sent["catalogue"] = json.loads(request.content)["payload"]
            return httpx.Response(200, json={"videos": len(sent["catalogue"])})
        if path == "finish":
            b = json.loads(request.content)
            sent["finish"], sent["error_code"] = b["outcome"], b["error_code"]
        if path == "tick":
            sent["ticked"] = True
            return httpx.Response(200, json={"discover": 0, "collect": 0})
        return httpx.Response(200, json={})
    return ControlPlane("https://c.invalid", "cred", httpx.Client(transport=httpx.MockTransport(handler)))


def test_commits_the_catalogue_and_succeeds_when_complete():
    sent = {}
    videos = [{"external_video_id": "a" * 11, "title": "x", "kind": "video", "reported_comment_count": 3}]
    assert run_discover(plane(sent), lambda tok: Lister(Catalogue(videos, True))) is True
    assert sent["catalogue"] == videos
    assert sent["finish"] == "succeeded"


def test_an_incomplete_catalogue_is_partial():
    sent = {}
    assert run_discover(plane(sent), lambda tok: Lister(Catalogue([], False, "uploads_lookup_failed"))) is True
    assert (sent["finish"], sent["error_code"]) == ("partial", "uploads_lookup_failed")


def test_a_refusal_is_blocked_with_its_code():
    sent = {}
    run_discover(plane(sent), lambda tok: Lister(CollectionError("source_access_denied:x", "blocked")))
    assert (sent["finish"], sent["error_code"]) == ("blocked", "source_access_denied:x")


def test_no_token_is_blocked_before_any_listing():
    sent = {}
    run_discover(plane(sent, token=None), lambda tok: (_ for _ in ()).throw(AssertionError("built")))
    assert (sent["finish"], sent["error_code"]) == ("blocked", "channel_not_connected")


def test_run_job_dispatches_on_the_lease_type():
    sent = {}
    assert run_job(plane(sent), lambda tok: Lister(Catalogue([], True))) is True
    assert sent["finish"] == "succeeded" and "catalogue" in sent
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run worker:test -- tests/test_backfill.py tests/test_discover.py -q`
Expected: `ImportError: cannot import name 'run_discover'` and backfill failures.

- [ ] **Step 3: Implement**

`gateway.py` — add to `ControlPlane`:

```python
    def commit_catalogue(self, lease: dict[str, Any], videos: list[dict[str, Any]]) -> dict[str, Any] | None:
        return self._post(
            "/worker/commit-catalogue",
            {"job_id": lease["job_id"], "lease_token": lease["lease_token"], "payload": videos},
        )

    def video_finished(self, lease: dict[str, Any], video_id: str, outcome: str,
                       error_code: str | None = None) -> None:
        self._post(
            "/worker/video-finished",
            {"job_id": lease["job_id"], "lease_token": lease["lease_token"],
             "video_id": video_id, "outcome": outcome, "error_code": error_code},
        )

    def tick(self) -> dict[str, Any] | None:
        """Ask the server to enqueue whatever is due for this credential's workspace."""
        return self._post("/worker/tick")
```

`runner.py` — replace `run_backfill` and add `run_discover`, `run_job`:

```python
def run_discover(control: ControlPlane, build_collector) -> bool:
    """Claim one discover job: list the channel's videos and commit the list."""
    lease = control.claim()
    if lease is None:
        return False
    token = lease.get("access_token")
    if not token:
        control.finish(lease, "blocked", "channel_not_connected")
        return True
    try:
        collector = build_collector(token)
        result = collector.catalogue()
        control.heartbeat(lease)
        control.commit_catalogue(lease, result.videos)
        # An incomplete listing is partial: the videos it did find are real,
        # the claim that this is the channel is not.
        control.finish(lease, "exhausted" if result.complete else "partial",
                       None if result.complete else result.reason)
    except LeaseLost:
        raise
    except CollectionError as exc:
        control.finish(
            lease, exc.outcome if exc.outcome in _DECLARABLE else "blocked", exc.code
        )
    return True


def run_backfill(control: ControlPlane, build_collector, analyzer=None) -> bool:
    """Claim one collect job and walk the videos the server handed it.

    The whole channel is one job, not one job per video: the queue refuses a
    second outstanding collection per channel. Which videos to read is the
    server's decision (the selection table, filtered to what is due), carried
    on the lease; the worker cannot widen it. Progress lives in the job's
    checkpoint, so an interrupted run resumes at the video it was inside.

    A video read to its end is reported finished and not read again this run.
    A video whose comments are switched off is reported and skipped; anything
    else that stops early leaves the run partial with the cursor held.
    """
    lease = control.claim()
    if lease is None:
        return False
    token = lease.get("access_token")
    if not token:
        control.finish(lease, "blocked", "channel_not_connected")
        return True
    collector = build_collector(token)
    videos = [v for v in (lease.get("videos") or []) if isinstance(v, dict)]

    done, current = _resume_progress(lease)
    cursor = _resume_cursor(lease)
    analysis_failed = False
    outcome = "exhausted"

    try:
        for video in videos:
            vid = video["external_video_id"]
            if vid in done:
                continue
            start = cursor if vid == current else None
            video_outcome = "partial"
            try:
                for batch in collector.batches(vid, start):
                    predictions: list = []
                    if analyzer is not None:
                        try:
                            predictions = analyse(analyzer, batch.comments)
                        except AnalysisError:
                            analysis_failed = True
                    control.heartbeat(lease)
                    control.commit_batch(
                        lease, vid, video.get("title"), batch, predictions,
                        progress={"video": vid, "done": sorted(done)},
                    )
                    video_outcome = (
                        batch.outcome if batch.outcome in _DECLARABLE else "failed"
                    )
                    if batch.outcome != "partial":
                        break
            except CollectionError as exc:
                if exc.code != "comments_disabled":
                    raise
                # A property of the video, not of the run. Learned back into
                # the catalogue and the next video is read.
                control.video_finished(lease, video["video_id"], "blocked", exc.code)
                done.add(vid)
                continue
            if video_outcome != "exhausted":
                control.video_finished(lease, video["video_id"], video_outcome)
                outcome = video_outcome
                break
            control.video_finished(lease, video["video_id"], "exhausted")
            done.add(vid)
        if analysis_failed and outcome == "exhausted":
            outcome = "partial"
        control.finish(lease, outcome)
    except LeaseLost:
        raise
    except CollectionError as exc:
        control.finish(
            lease, exc.outcome if exc.outcome in _DECLARABLE else "blocked", exc.code
        )
    return True


def run_job(control: ControlPlane, build_collector, analyzer=None) -> bool:
    """Claim whatever is next and run it by its type."""
    lease = control.claim()
    if lease is None:
        return False
    # The claim is consumed here; hand the lease down rather than claiming twice.
    if lease.get("type") == "discover":
        return _discover(control, lease, build_collector)
    return _backfill(control, lease, build_collector, analyzer)
```

To avoid two claims, refactor: move the bodies above into `_discover(control, lease, build_collector)` and `_backfill(control, lease, build_collector, analyzer)` (everything after `lease = control.claim(); if lease is None: return False`), and make `run_discover`/`run_backfill` thin wrappers that claim and delegate. `run_once` is untouched.

`loop.py` — replace `build_plan` and the `serve` default:

```python
from .runner import run_job


def build_collector(client: httpx.Client):
    def build(token: str):
        return YouTubeAPI(None, client, access_token=token)
    return build
```

`serve(controls, build, analyzer=None, ..., run=run_job, ...)`: rename the `plan` parameter to `build`; after an idle round (the `idle % len(queue) == 0` branch, before the `max_idle` check) ask every control to tick once:

```python
        for c in queue:
            try:
                c.tick()
            except ControlPlaneError as exc:
                _log(f"tick refused: {exc.code}")
```

and in `main`, `plan = build_plan(client, args.videos)` becomes `build = build_collector(client)`; drop the `--videos` argument (the server decides). Remove the `survey_uploads` import from `loop.py`.

`manual_run.py` — the `--backfill` branch becomes:

```python
    if args.backfill:
        worked = run_backfill(control, lambda token: YouTubeAPI(None, client, access_token=token),
                              analyzer=analyzer)
```

and its `--videos` help text is updated to say it applies to the single-video path only (it still feeds `survey_uploads` there). Update `test_loop.py` wherever it passes a `plan` or asserts on `build_plan`: the loop's `run` double receives `(control, build, analyzer=...)`; add one assertion that after an idle round `tick` was called on each control.

- [ ] **Step 4: Run to verify pass**

Run: `npm run worker:test -q && npm run worker:lint`
Expected: all green (127 + new), ruff 0. `test_run_once.py` and `test_golden_batch.py` are untouched and must still pass.

- [ ] **Step 5: Commit**

```bash
git add workers/python/src/server workers/python/tests/test_backfill.py workers/python/tests/test_discover.py workers/python/tests/test_loop.py
git commit -m "The worker reads what it is handed and reports each video's end

run_job dispatches on the lease's type; the channel-wide survey leaves the
loop; an idle round asks the server to enqueue what is due."
```

---

### Task 8: Web — `catalogue.ts`, the fixture catalogue, the strings

**Files:**
- Create: `apps/web/src/catalogue.ts`, `apps/web/src/catalogue.test.ts`
- Create: `apps/web/public/fixtures/catalogue.json`
- Modify: `apps/web/src/strings/ar.ts`, `apps/web/src/strings/en.ts`

**Interfaces:**
- Consumes: `CatalogueVideoSchema`, `VideoAggregate` (snapshot `videos`), `supabase`, `DataMode`.
- Produces:
  ```ts
  export type CatalogueRead = { channelId: string | null; cataloguedAt: string | null; videos: CatalogueVideo[] };
  export async function loadCatalogue(mode: DataMode, workspaceId: string, signal?: AbortSignal): Promise<CatalogueRead>;
  export function mergeCatalogue(raw: RawCatalogue, collected: VideoAggregate[]): CatalogueVideo[];
  export type RawCatalogue = { videos: RawVideo[]; selections: RawSelection[] };
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/src/catalogue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeCatalogue, type RawCatalogue } from "./catalogue";

const raw: RawCatalogue = {
  videos: [
    { id: "video-1", external_video_id: "a".repeat(11), title: "فيديو ١", kind: "video", published_at: "2026-01-01T00:00:00Z",
      thumbnail_url: null, reported_comment_count: 40, comments_state: "open" },
    { id: "video-9", external_video_id: "b".repeat(11), title: "جديد", kind: "short", published_at: null,
      thumbnail_url: null, reported_comment_count: null, comments_state: "unknown" },
  ],
  selections: [
    { video_id: "video-1", last_collected_at: "2026-09-01T00:00:00Z", last_outcome: "exhausted", next_check_at: "2026-09-02T00:00:00Z" },
  ],
};

describe("mergeCatalogue", () => {
  it("joins the source's list with the selection and the stored count", () => {
    const rows = mergeCatalogue(raw, [
      { id: "video-1", title: "فيديو ١", total: 5, analysed: 5, replies: 1, sentiments: { positive: 1, negative: 1, neutral: 3, mixed: 0 } },
    ]);
    expect(rows.find((r) => r.id === "video-1")).toMatchObject({ selected: true, collected: 5, last_outcome: "exhausted" });
    expect(rows.find((r) => r.id === "video-9")).toMatchObject({ selected: false, collected: 0, reported_comment_count: null });
  });
  it("refuses a row that does not fit the contract", () => {
    expect(() =>
      mergeCatalogue({ ...raw, videos: [{ ...raw.videos[0], kind: "clip" as never }] }, []),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/web/src/catalogue.test.ts`
Expected: cannot resolve `./catalogue`.

- [ ] **Step 3: Implement**

`apps/web/src/catalogue.ts`:

```ts
/**
 * The catalogue as the operations page reads it, in either mode.
 *
 * Live: two RLS-scoped table reads (`videos`, `video_selections`) — not a
 * rewrite of `dashboard_snapshot`. The stored comment count per video comes
 * from the snapshot the page already holds (its `videos` aggregate), so this
 * module never re-reads the comments. Fixture: one JSON file.
 */
import {
  CatalogueVideoSchema,
  type CatalogueVideo,
  type VideoAggregate,
} from "@sentiment/contracts";
import type { DataMode } from "./data";
import { supabase } from "./supabase";

export type RawVideo = {
  id: string;
  external_video_id: string;
  title: string;
  kind: string;
  published_at: string | null;
  thumbnail_url: string | null;
  reported_comment_count: number | null;
  comments_state: string;
};
export type RawSelection = {
  video_id: string;
  last_collected_at: string | null;
  last_outcome: string | null;
  next_check_at: string | null;
};
export type RawCatalogue = { videos: RawVideo[]; selections: RawSelection[] };
export type CatalogueRead = RawCatalogue & {
  channelId: string | null;
  cataloguedAt: string | null;
};

export function mergeCatalogue(
  raw: RawCatalogue,
  collected: VideoAggregate[],
): CatalogueVideo[] {
  const stored = new Map(collected.map((v) => [v.id, v.total]));
  const chosen = new Map(raw.selections.map((s) => [s.video_id, s]));
  return raw.videos.map((v) => {
    const s = chosen.get(v.id);
    return CatalogueVideoSchema.parse({
      ...v,
      collected: stored.get(v.id) ?? 0,
      selected: !!s,
      last_collected_at: s?.last_collected_at ?? null,
      last_outcome: s?.last_outcome ?? null,
      next_check_at: s?.next_check_at ?? null,
    });
  });
}

async function readFixture(signal?: AbortSignal): Promise<CatalogueRead> {
  const r = await fetch("/fixtures/catalogue.json", { signal });
  if (!r.ok) throw new Error("catalogue_unavailable");
  return (await r.json()) as CatalogueRead;
}

async function readLive(workspaceId: string): Promise<CatalogueRead> {
  const db = supabase!;
  const [videos, selections, channel] = await Promise.all([
    db
      .from("videos")
      .select(
        "id,external_video_id,title,kind,published_at,thumbnail_url,reported_comment_count,comments_state",
      )
      .eq("workspace_id", workspaceId),
    db
      .from("video_selections")
      .select("video_id,last_collected_at,last_outcome,next_check_at")
      .eq("workspace_id", workspaceId),
    db
      .from("connection_status")
      .select("channel_id,status,catalogued_at")
      .eq("workspace_id", workspaceId),
  ]);
  if (videos.error || selections.error) throw new Error("catalogue_unavailable");
  const connected = (channel.data ?? []).find((c) => c.status === "connected");
  return {
    videos: (videos.data ?? []) as RawVideo[],
    selections: (selections.data ?? []) as RawSelection[],
    channelId: connected?.channel_id ?? null,
    cataloguedAt: connected?.catalogued_at ?? null,
  };
}

export async function loadCatalogue(
  mode: DataMode,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<CatalogueRead> {
  return mode === "live" ? readLive(workspaceId) : readFixture(signal);
}
```

`connection_status` carries `catalogued_at` since Task 1's migration. `VideoAggregate` and `UsageSummary` already reach the barrel through `export * from "./snapshot"` / `"./usage"`.

`apps/web/public/fixtures/catalogue.json`:

```json
{
  "channelId": "00000000-0000-4000-8000-000000000001",
  "cataloguedAt": "2026-09-14T06:00:00Z",
  "videos": [
    { "id": "video-1", "external_video_id": "fixture0001", "title": "فيديو اصطناعي ١", "kind": "video", "published_at": "2026-08-20T10:00:00Z", "thumbnail_url": null, "reported_comment_count": 7, "comments_state": "open" },
    { "id": "video-2", "external_video_id": "fixture0002", "title": "فيديو اصطناعي ٢", "kind": "short", "published_at": "2026-09-01T10:00:00Z", "thumbnail_url": null, "reported_comment_count": 3, "comments_state": "open" },
    { "id": "video-3", "external_video_id": "fixture0003", "title": "بث اصطناعي ٣", "kind": "stream", "published_at": "2026-09-05T18:00:00Z", "thumbnail_url": null, "reported_comment_count": 18, "comments_state": "open" },
    { "id": "video-4", "external_video_id": "fixture0004", "title": "فيديو بلا تعليقات", "kind": "video", "published_at": "2026-09-10T09:00:00Z", "thumbnail_url": null, "reported_comment_count": null, "comments_state": "disabled" },
    { "id": "video-5", "external_video_id": "fixture0005", "title": "فيديو بعدد غير معروف", "kind": "video", "published_at": null, "thumbnail_url": null, "reported_comment_count": null, "comments_state": "unknown" }
  ],
  "selections": [
    { "video_id": "video-1", "last_collected_at": "2026-09-14T06:10:00Z", "last_outcome": "exhausted", "next_check_at": "2026-09-15T06:10:00Z" },
    { "video_id": "video-2", "last_collected_at": "2026-09-14T06:12:00Z", "last_outcome": "exhausted", "next_check_at": "2026-09-15T06:12:00Z" }
  ]
}
```

(The fixture plan has 26 remaining, so selecting video-3 (18) fits and adding video-5 reports one unknown; the browser tests below rely on these numbers.)

Strings — add to `ar.ts` (and the typed twins to `en.ts`):

```ts
  catTitle: "الفيديوهات",
  catLead: "اختر ما يُجمع ويُحلَّل. العدد كما يعلنه يوتيوب، وليس وعدًا بما يمكن جلبه.",
  catRefresh: "تحديث القائمة",
  catRefreshed: (when: string) => `القائمة كما كانت في ${when}`,
  catNeverRefreshed: "لم تُبنَ القائمة بعد.",
  catRequested: "طُلب بناء القائمة؛ تظهر النتيجة عند اكتمالها.",
  catRequestFailed: "تعذّر طلب بناء القائمة.",
  catSearch: "ابحث في العناوين",
  catKindAll: "الكل",
  catKindVideo: "فيديو",
  catKindShort: "شورت",
  catKindStream: "بث",
  catSortNewest: "الأحدث",
  catSortOldest: "الأقدم",
  catSortMost: "الأكثر تعليقًا",
  catSelectView: "اختر المعروض",
  catClear: "إلغاء الاختيار",
  catFit: "اختر الأحدث بما يناسب الحصة",
  catSelected: (videos: number, upTo: number) => `المحدد: ${videos} فيديو · حتى ${upTo} تعليقًا`,
  catUnknownCount: (n: number) => `و${n} بعدد غير معروف`,
  catRemainingAfter: (n: number) => `يتبقى بعدها ${n}`,
  catExceeds: "الاختيار يتجاوز ما تبقى من الحصة؛ ألغِ بعضه أولًا.",
  catNoPlan: "لا خطة مفعّلة، فلا حصة تُقاس عليها.",
  catSave: "احفظ الاختيار",
  catSaving: "يُحفظ…",
  catSaved: "حُفظ الاختيار وطُلب الجمع.",
  catSavedDeferred: "حُفظ الاختيار؛ الجمع في الدورة القادمة.",
  catSaveFailed: "تعذّر حفظ الاختيار.",
  catSaveQuota: "رُفض الاختيار: يتجاوز ما تبقى من الحصة.",
  catCountUnknown: "—",
  catLiveNote: "الفيديو المحدد يبقى حيًّا: تُجمع تعليقاته الجديدة دوريًا وتستهلك من الحصة عند وصولها.",
  catStateUnselected: "غير محدد",
  catStateWaiting: "بانتظار الجمع",
  catStateCollecting: "يُجمع الآن",
  catStateCollected: (n: number, when: string) => `جُمع ${n} في ${when}`,
  catStateDisabled: "تعليقات معطّلة",
  catStatePartial: "جزئي",
  catEmpty: "لا فيديوهات في القائمة بعد.",
  catNoMatch: "لا نتائج لهذا البحث.",
  catReadFailed: "تعذّرت قراءة القائمة.",
  chooseVideos: "اختر الفيديوهات",
```

Reword `stepCollect` to `"اختر الفيديوهات التي تُجمع، ثم تابع حالتها في صفحة التشغيل."` (and its English twin). English twins are the implementer's to write; the shape (functions with the same arity) is enforced by `tsc`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run apps/web/src/catalogue.test.ts apps/web/src/locale.test.ts apps/web/src/setup.test.ts && npm run typecheck`
Expected: green; `locale.test.ts`'s key-parity check passes only when `en.ts` carries every new key.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/catalogue.ts apps/web/src/catalogue.test.ts apps/web/public/fixtures/catalogue.json apps/web/src/strings/ar.ts apps/web/src/strings/en.ts packages/contracts/src/index.ts
git commit -m "One read of the catalogue in both modes, and the sentences it needs"
```

---

### Task 9: Web — split `Sync.tsx`, add `Catalogue.tsx`, rewire the entry points, browser tests

**Files:**
- Create: `apps/web/src/OperationsPanels.tsx` (health, plan, attempts — moved from `Sync.tsx` lines ~285–504, no behaviour change)
- Create: `apps/web/src/Catalogue.tsx`
- Modify: `apps/web/src/Sync.tsx` (compose), `apps/web/src/WorkspaceCard.tsx` (button → link), `apps/web/src/Account.tsx` (drop `onSync`), `apps/web/src/app.css` (catalogue rules, tokens only)
- Modify: `tests/e2e/dashboard.spec.ts` (append)

**Interfaces:**
- Consumes: Task 4 pure functions; Task 8 `loadCatalogue`, `mergeCatalogue`; `supabase.rpc("select_videos" | "request_discovery")`; `budgetState`; `describeJob`, `explainCode`; `displayDate`.
- Produces: `<Catalogue mode workspaceId channelId plan snapshotVideos jobs onChanged />` rendered first inside `SyncBody`; `data-testid`s: `catalogue`, `cat-search`, `cat-kind-<all|video|short|stream>`, `cat-sort`, `cat-row-<id>`, `cat-check-<id>`, `cat-select-view`, `cat-clear`, `cat-fit`, `cat-estimate`, `cat-save`, `cat-feedback`, `cat-refresh`, `cat-state-<id>`.

- [ ] **Step 1: Move the panels, unchanged**

Cut the JSX from `<div className="sync-grid">` through the end of the attempts `<section>` in `Sync.tsx` into `OperationsPanels.tsx` as `export function OperationsPanels(props)` taking exactly the values it reads (`s`, `health`, `run`, `mode`, `jobs`, `jobsFailed`, `entries`, `acting`, `actionMessage`, `act`, `refresh`, `lang`, `S`). Remove the `channelId ? <button …sync-request> : <p …sync-no-channel>` block: the request button is gone (the catalogue is the entry point); keep the `sync-no-channel` paragraph as-is for the no-channel case. Run: `npm run test:e2e -- --grep "plan limit|spent state|no activated plan" > /tmp/e2e.log; echo $?` — expected 0 (the ten `/sync?demo=1` tests must not notice the move; `dashboard.spec.ts` asserts `sync-request` nowhere — verify with `grep -n "sync-request" tests/e2e/*.ts`; if it does, that block moves to the catalogue's save button semantics and the test is updated with a comment saying why).

Commit: `git commit -am "The operations panels leave Sync.tsx as they are"`.

- [ ] **Step 2: Write the browser tests (append-only)**

Append to `tests/e2e/dashboard.spec.ts`:

```ts
test("the catalogue narrows by search and kind, and prices a selection live", async ({ page }) => {
  await page.goto("/sync?demo=1");
  const cat = page.getByTestId("catalogue");
  await expect(cat.getByTestId(/^cat-row-/)).toHaveCount(5);
  await page.getByTestId("cat-search").fill("بث");
  await expect(cat.getByTestId(/^cat-row-/)).toHaveCount(1);
  await page.getByTestId("cat-search").fill("");
  await page.getByTestId("cat-kind-short").click();
  await expect(cat.getByTestId(/^cat-row-/)).toHaveCount(1);
  await page.getByTestId("cat-kind-all").click();
  // 26 units remain in the fixture plan; video-3 reports 18 and holds none.
  await page.getByTestId("cat-check-video-3").check();
  await expect(page.getByTestId("cat-estimate")).toContainText("حتى 18 تعليقًا");
  await expect(page.getByTestId("cat-estimate")).toContainText("يتبقى بعدها 8");
  await page.getByTestId("cat-check-video-5").check();
  await expect(page.getByTestId("cat-estimate")).toContainText("و1 بعدد غير معروف");
  await expect(page.getByTestId("cat-save")).toBeEnabled();
});

test("the catalogue stops at the quota and says why", async ({ page }) => {
  await page.route("**/fixtures/dashboard.json", async (route) => {
    const fixture = await (await route.fetch()).json();
    fixture.plan.budgets[0] = { event_type: "comment_analysis", used: 90, allowance: 100, remaining: 10 };
    await route.fulfill({ json: fixture });
  });
  await page.goto("/sync?demo=1");
  await page.getByTestId("cat-check-video-3").check();
  await expect(page.getByTestId("cat-save")).toBeDisabled();
  await expect(page.getByTestId("cat-estimate")).toContainText("يتجاوز ما تبقى");
  await page.getByTestId("cat-fit").click();
  // Nothing fits 10 units (video-3 is 18, the rest are selected, off, or unknown).
  await expect(page.getByTestId("cat-check-video-3")).not.toBeChecked();
});

test("a disabled video cannot be selected and says so", async ({ page }) => {
  await page.goto("/sync?demo=1");
  await expect(page.getByTestId("cat-check-video-4")).toBeDisabled();
  await expect(page.getByTestId("cat-state-video-4")).toHaveText("تعليقات معطّلة");
  await expect(page.getByTestId("cat-state-video-1")).toContainText("جُمع 5");
});

test("at phone width the selection bar stays reachable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/sync?demo=1");
  await page.getByTestId("cat-check-video-3").check();
  const bar = page.getByTestId("cat-estimate");
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(700);
  const spacing = await page.getByTestId("catalogue").evaluate((el) =>
    [...el.querySelectorAll("*")].map((n) => getComputedStyle(n).letterSpacing).filter((v) => v !== "normal" && v !== "0px"),
  );
  expect(spacing).toEqual([]);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test:e2e -- --grep "catalogue|disabled video|selection bar" > /tmp/e2e.log; echo $?; tail -20 /tmp/e2e.log`
Expected: non-zero; `catalogue` test id not found.

- [ ] **Step 4: Implement `Catalogue.tsx`**

```tsx
/**
 * The catalogue: what the channel has, what it costs, what is chosen.
 *
 * Sits first on the operations page because it is the action; the health and
 * plan panels below it are the diagnosis. The estimate is `selectionEstimate`
 * from the contract — the same arithmetic `select_videos` refuses on — shown
 * against the plan's remaining analysis units, which this page already reads.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  filterCatalogue,
  fitNewest,
  selectionEstimate,
  type CatalogueKind,
  type CatalogueSort,
  type CatalogueVideo,
  type UsageSummary,
  type VideoAggregate,
} from "@sentiment/contracts";
import { loadCatalogue, mergeCatalogue } from "./catalogue";
import { supabase } from "./supabase";
import { displayDate } from "./i18n";
import { useLocale } from "./locale";
import { useStrings } from "./strings";
import { explainCode, type JobRow } from "./jobFeed";

export function Catalogue({
  mode,
  workspaceId,
  plan,
  snapshotVideos,
  jobs,
  onChanged,
}: {
  mode: "live" | "sanitized_fixture";
  workspaceId: string;
  plan: UsageSummary | null;
  snapshotVideos: VideoAggregate[];
  jobs: JobRow[] | null;
  onChanged: () => void;
}) {
  const S = useStrings();
  const lang = useLocale();
  const read = useQuery({
    queryKey: ["catalogue", mode, workspaceId],
    queryFn: ({ signal }) => loadCatalogue(mode, workspaceId, signal),
  });
  const rows = useMemo(
    () => (read.data ? mergeCatalogue(read.data, snapshotVideos) : []),
    [read.data, snapshotVideos],
  );
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<CatalogueKind>("all");
  const [sort, setSort] = useState<CatalogueSort>("newest");
  // Ticked boxes: what the reader wants selected, before saving.
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    setTicked(new Set(rows.filter((r) => r.selected).map((r) => r.id)));
  }, [rows]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const remaining =
    plan?.budgets.find((b) => b.event_type === "comment_analysis")?.remaining ?? null;
  const shown = filterCatalogue(rows, { search, kind, sort });
  const adding = new Set([...ticked].filter((id) => !rows.find((r) => r.id === id)?.selected));
  const removing = rows.filter((r) => r.selected && !ticked.has(r.id)).map((r) => r.id);
  const est = selectionEstimate(rows, adding, remaining);
  const collecting = (jobs ?? []).some((j) => j.status === "running");
  const dirty = adding.size > 0 || removing.length > 0;

  const toggle = (id: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const save = () => {
    if (!supabase || !read.data?.channelId) return;
    setBusy(true);
    setFeedback(null);
    void supabase
      .rpc("select_videos", {
        w: workspaceId,
        c: read.data.channelId,
        add: [...adding],
        remove: removing,
      })
      .then(({ data, error }) => {
        setBusy(false);
        if (error) {
          setFeedback(/quota_exceeded/.test(error.message) ? S.catSaveQuota : S.catSaveFailed);
          return;
        }
        const r = data as { queued: boolean; deferred: boolean };
        setFeedback(r.queued ? S.catSaved : S.catSavedDeferred);
        void read.refetch();
        onChanged();
      });
  };
  const refresh = () => {
    if (!supabase || !read.data?.channelId) return;
    setBusy(true);
    setFeedback(null);
    void supabase
      .rpc("request_discovery", { w: workspaceId, c: read.data.channelId })
      .then(({ error }) => {
        setBusy(false);
        setFeedback(error ? S.catRequestFailed : S.catRequested);
        onChanged();
      });
  };

  const state = (r: CatalogueVideo) => {
    if (r.comments_state === "disabled") return S.catStateDisabled;
    if (!r.selected) return S.catStateUnselected;
    if (r.last_outcome && r.last_outcome !== "exhausted")
      return `${S.catStatePartial} · ${explainCode(r.last_outcome, S) ?? r.last_outcome}`;
    if (r.last_collected_at) return S.catStateCollected(r.collected, displayDate(r.last_collected_at, lang));
    return collecting ? S.catStateCollecting : S.catStateWaiting;
  };

  return (
    <section className="rp-section catalogue" aria-labelledby="cat-heading" data-testid="catalogue">
      <header>
        <h2 id="cat-heading">{S.catTitle}</h2>
        <p className="rp-sub">{S.catLead}</p>
      </header>
      {read.isPending ? (
        <p role="status">{S.opsReading}</p>
      ) : read.isError ? (
        <div role="alert" className="notice">
          <p>{S.catReadFailed}</p>
          <button type="button" onClick={() => void read.refetch()}>{S.retry}</button>
        </div>
      ) : (
        <>
          <div className="cat-toolbar">
            <input
              type="search"
              aria-label={S.catSearch}
              placeholder={S.catSearch}
              data-testid="cat-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="cat-kinds" role="tablist">
              {(["all", "video", "short", "stream"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={kind === k}
                  data-testid={`cat-kind-${k}`}
                  onClick={() => setKind(k)}
                >
                  {k === "all" ? S.catKindAll : k === "video" ? S.catKindVideo : k === "short" ? S.catKindShort : S.catKindStream}
                  {" "}({k === "all" ? rows.length : rows.filter((r) => r.kind === k).length})
                </button>
              ))}
            </div>
            <select aria-label={S.catSortNewest} data-testid="cat-sort" value={sort} onChange={(e) => setSort(e.target.value as CatalogueSort)}>
              <option value="newest">{S.catSortNewest}</option>
              <option value="oldest">{S.catSortOldest}</option>
              <option value="most_commented">{S.catSortMost}</option>
            </select>
            <button type="button" data-testid="cat-select-view" onClick={() => shown.forEach((r) => r.comments_state !== "disabled" && toggle(r.id, true))}>
              {S.catSelectView}
            </button>
            <button type="button" data-testid="cat-clear" onClick={() => setTicked(new Set())}>{S.catClear}</button>
            <button
              type="button"
              data-testid="cat-fit"
              disabled={remaining === null}
              onClick={() => setTicked(new Set([...rows.filter((r) => r.selected).map((r) => r.id), ...fitNewest(rows, remaining ?? 0)]))}
            >
              {S.catFit}
            </button>
            <button type="button" data-testid="cat-refresh" disabled={busy || mode !== "live"} onClick={refresh}>
              {S.catRefresh}
            </button>
            <small>{read.data?.cataloguedAt ? S.catRefreshed(displayDate(read.data.cataloguedAt, lang)) : S.catNeverRefreshed}</small>
          </div>

          {rows.length === 0 ? (
            <p className="rp-missing"><strong>{S.catEmpty}</strong></p>
          ) : shown.length === 0 ? (
            <p className="rp-missing"><strong>{S.catNoMatch}</strong></p>
          ) : (
            <ul className="cat-list">
              {shown.map((r) => (
                <li key={r.id} data-testid={`cat-row-${r.id}`} data-kind={r.kind}>
                  <input
                    type="checkbox"
                    aria-label={r.title}
                    data-testid={`cat-check-${r.id}`}
                    checked={ticked.has(r.id)}
                    disabled={r.comments_state === "disabled" || busy}
                    onChange={(e) => toggle(r.id, e.target.checked)}
                  />
                  {r.thumbnail_url ? <img src={r.thumbnail_url} alt="" loading="lazy" /> : <span className="cat-thumb" aria-hidden="true" />}
                  <span className="cat-title">{r.title}</span>
                  <span className="cat-kind">{r.kind === "video" ? S.catKindVideo : r.kind === "short" ? S.catKindShort : S.catKindStream}</span>
                  <span className="cat-date">{r.published_at ? displayDate(r.published_at, lang) : S.catCountUnknown}</span>
                  <span className="cat-count">{r.reported_comment_count === null ? S.catCountUnknown : r.reported_comment_count}</span>
                  <span className="cat-state" data-testid={`cat-state-${r.id}`} data-state={r.comments_state === "disabled" ? "disabled" : r.selected ? "selected" : "none"}>
                    {state(r)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="cat-bar" data-testid="cat-estimate" data-exceeds={est.exceeds}>
            <span>
              {S.catSelected(ticked.size, est.estimate)}
              {est.unknownCount > 0 ? ` · ${S.catUnknownCount(est.unknownCount)}` : ""}
              {" · "}
              {remaining === null ? S.catNoPlan : est.exceeds ? S.catExceeds : S.catRemainingAfter(est.remainingAfter ?? 0)}
            </span>
            <small>{S.catLiveNote}</small>
            <button
              type="button"
              data-testid="cat-save"
              disabled={!dirty || est.exceeds || busy || (mode === "live" && !read.data?.channelId)}
              onClick={save}
            >
              {busy ? S.catSaving : S.catSave}
            </button>
            {feedback && <p role="status" data-testid="cat-feedback">{feedback}</p>}
          </div>
        </>
      )}
    </section>
  );
}
```

`UsageSummary` and `VideoAggregate` are already exported from the contracts barrel.

In `Sync.tsx`'s `SyncBody`, render `<Catalogue mode={mode} workspaceId={workspaceId} plan={s?.plan ?? null} snapshotVideos={s?.videos ?? []} jobs={jobs} onChanged={() => { setTick((t) => t + 1); void snapshot.refetch(); }} />` before `<OperationsPanels …/>`, inside the `snapshot.isPending / isError` branches so the page still has one loading and one failed state. In fixture mode the save button is disabled by `dirty && !channelId`? No — the fixture has a `channelId`, and `supabase` is null in fixture mode, so `save()` returns at once; the button is enabled so the browser test can assert enablement. Keep it that way and let `save()` no-op without `supabase`.

`app.css` — add, using tokens only (find their names in `brand.css`/`app.css`; no hex):

```css
.catalogue .cat-toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-block: 0.75rem; }
.catalogue .cat-kinds [role="tab"][aria-selected="true"] { background: var(--ml-indigo-500); color: var(--ink-on-dark); }
.catalogue .cat-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.25rem; }
.catalogue .cat-list li { display: grid; grid-template-columns: auto 64px 1fr auto auto auto auto; gap: 0.5rem; align-items: center; padding: 0.5rem; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--plane); }
.catalogue .cat-list img, .catalogue .cat-thumb { width: 64px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 4px; background: var(--plane-2); }
.catalogue .cat-state[data-state="disabled"] { color: var(--color-warning); }
.catalogue .cat-bar { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; padding: 0.75rem; margin-top: 0.75rem; background: var(--plane); border-top: 1px solid var(--border-subtle); }
.catalogue .cat-bar[data-exceeds="true"] { border-top-color: var(--color-warning); }
@media (max-width: 767px) {
  .catalogue .cat-list li { grid-template-columns: auto 1fr; }
  .catalogue .cat-list li > :nth-child(n + 4) { grid-column: 2; }
}
```

Replace `var(--…)` names above with the ones that exist (`grep -n "^\s*--" apps/web/src/brand.css apps/web/src/app.css | head -60`); `layers.test.ts` refuses a raw colour and a repeated token value.

`WorkspaceCard.tsx`: the `onSync` button becomes `<a href={`/sync?ws=${workspace.id}`}>{S.chooseVideos}</a>` for a connected channel; remove the `onSync` prop and its handler in `Account.tsx` (`enqueue_sync` is no longer called from the browser anywhere — `grep -rn enqueue_sync apps/web/src` must return only comments, or nothing). `Account.setup.test.ts` / `Account.entry.test.ts`: update the assertion that looked for the "طلب مزامنة" button to the link.

- [ ] **Step 5: Run everything**

Run: `npm run check > /tmp/check.log; echo $?` then `npm run test:e2e > /tmp/e2e.log; echo $?`
Expected: 0 and 0. Read both logs' tails. `rail.test.ts`, `layers.test.ts`, `locale.test.ts` are the ones most likely to object (a raw colour, a missing English twin, an Arabic label with tracking).

- [ ] **Step 6: Look at it**

Start the preview (`npm run dev`, port 5173), open `/sync?demo=1` at 1280px and 375px, and — signed in — `/sync?ws=<id>` on the live project to see the real catalogue after a discover job has run (that needs the worker: `npm run worker:run-once -- --backfill` is no longer the path; run `python -m server.loop` with the credential once). Screenshot both widths into `.screenshots/` (untracked).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src tests/e2e/dashboard.spec.ts
git commit -m "The catalogue on the operations page: what exists, what it costs, what is chosen

Sync.tsx composes Catalogue and OperationsPanels; the request button is a
link from the account card; the estimate is the contract's arithmetic."
```

---

### Task 10: Records, the spec amendment, and the live-project questions

**Files:**
- Modify: `docs/superpowers/specs/2026-09-15-selective-video-sync-design.md` (§1: `comments_state` is *also* learned from discovery — a missing `commentCount` means off, per `survey_uploads`'s documented observation; §5 unchanged)
- Modify: `docs/progress.md`, `docs/verification.md`, `docs/decisions.md`, `docs/coordination/ACTIVE.md`

- [ ] **Step 1: Amend the spec** — replace the sentence "`comments_state` is learned from collection, not discovery…" with: "`comments_state` is learned twice: discovery writes `disabled` when `statistics.commentCount` is absent and `open` when present (the source omits the count when comments are off); a collection that hits `commentsDisabled` writes `disabled`, and one that exhausts a video writes `open`."

- [ ] **Step 2: `docs/decisions.md`** — one dated entry: selection is a table and jobs stay per-channel (why: the one-outstanding invariant and mid-run additions); the scheduler lives in Postgres (`schedule_all` for pg_cron, `worker_tick` as the extension-free fallback); `historical_backfill` remains unmetered by this work; the catalogue lives on the operations page.

- [ ] **Step 3: `docs/verification.md`** — the gate figures from Task 9 Step 5, the mutation checks performed (Task 2 Step 5 at least; add one for `worker_video_finished` — remove the `next_check_at` update and see the due-list test go red), what was seen in the browser, and, explicitly, what was **not** verified: a live discover job against the real channel (needs the worker running against the deployed gateway, which needs the three new `svc_*` functions applied — see Step 5), pg_cron.

- [ ] **Step 4: `docs/progress.md`** — a dated entry in the file's voice: what the reader can now do, what the worker now does, what waits.

- [ ] **Step 5: Ask the user, do not do:** (a) `supabase db push --linked` for the three migrations; (b) redeploying the `worker` Edge Function; (c) `create extension pg_cron` + `select cron.schedule('sentiment-tick', '17 * * * *', $$select private.schedule_all()$$)`. Each is a live-project change ACTIVE.md reserves for the user's say-so in that turn.

- [ ] **Step 6: `ACTIVE.md`** — note the files this work touched and that nothing of it is uncommitted; commit.

```bash
git add docs
git commit -m "Record selective video sync: what was built, what was run, what waits on the live project"
```

---

## Self-review (done while writing)

- **Spec coverage:** §1 → Task 1; §2 → Tasks 3, 6, 7 (+ OAuth enqueue in Task 3); §3 → Tasks 2, 4; §4 → Tasks 3, 5, 7; §5 → Tasks 8, 9; §6 → each task's tests. The spec's "`comments_state` learned from collection, not discovery" was wrong about the source (Task 10 amends it).
- **Types:** `CatalogueVideo` (Task 4) is what `mergeCatalogue` (Task 8) returns and `Catalogue.tsx` (Task 9) consumes; the wire `videos[]` items (`video_id, external_video_id, title`) match between Task 3 `due_videos`, Task 5 handler, and Task 7 runner (`video["external_video_id"]` for the source, `video["video_id"]` for `video_finished`); `select_videos` returns `{job_id, queued, deferred, estimate, unknown_count, remaining_after}` in Task 2 and Task 9 reads `queued`/`deferred`.
- **Placeholders:** none; where an existing identifier is uncertain (token names in CSS) the step names the grep to run.
