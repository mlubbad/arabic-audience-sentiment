/**
 * Selection is a table the tenant reads and never writes directly; what the
 * worker collects is computed from it on the server.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

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
    const cut = files.indexOf(
      "20260915130000_video_catalogue_and_selections.sql",
    );
    for (const f of files.slice(0, cut))
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await db.exec("reset role");
    for (const [w, owner, external] of [
      [W, OWNER, `UC${"a".repeat(22)}`],
      [OTHER, OUTSIDER, `UC${"b".repeat(22)}`],
    ]) {
      await db.query("insert into auth.users(id) values ($1)", [owner]);
      await db.query(
        "insert into workspaces(id,name,created_by) values ($1,'w',$2)",
        [w, owner],
      );
      await db.query(
        "insert into memberships values ($1,$2,'workspace_owner')",
        [w, owner],
      );
      await db.query(
        "insert into clients(id,workspace_id,name) values ($1,$1,'c')",
        [w],
      );
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
    await db.exec(
      readFileSync(
        "supabase/migrations/20260915130000_video_catalogue_and_selections.sql",
        "utf8",
      ),
    );
    for (const f of files.slice(cut + 1))
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  });
  it("backfills a live selection for every video that already has comments", async () => {
    await db.exec("reset role");
    const rows = await db.query<{
      video_id: string;
      last_outcome: string | null;
    }>(
      "select video_id, last_outcome from video_selections where workspace_id=$1 order by video_id",
      [W],
    );
    expect(rows.rows.map((r) => r.video_id)).toEqual([V1]);
    const state = await db.query<{ comments_state: string }>(
      "select comments_state from videos where id=$1",
      [V1],
    );
    expect(state.rows[0].comments_state).toBe("open");
    const fresh = await db.query<{
      comments_state: string;
      reported_comment_count: number | null;
    }>(
      "select comments_state, reported_comment_count from videos where id=$1",
      [V2],
    );
    expect(fresh.rows[0]).toEqual({
      comments_state: "unknown",
      reported_comment_count: null,
    });
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
    // The pilot plan's rate limit is 30 minutes since
    // 20260915140000: the tick's backoff assumed a non-zero value.
    const gap = await db.query<{ v: number }>(
      "select private.plan_limit($1,'sync_interval') as v",
      [W],
    );
    expect(gap.rows[0].v).toBe(30);
  });

  it("lists due videos oldest-due first and leaves out disabled ones", async () => {
    await db.exec("reset role");
    await db.query(
      `insert into video_selections(workspace_id,channel_id,video_id,next_check_at)
       values ($1,$1,$2,now()-interval '2 hours')`,
      [W, V2],
    );
    await db.query(
      "update video_selections set next_check_at=now()-interval '1 hour' where video_id=$1",
      [V1],
    );
    const due = await db.query<{ d: { video_id: string }[] }>(
      "select private.due_videos($1,$1) as d",
      [W],
    );
    expect(due.rows[0].d.map((v) => v.video_id)).toEqual([V2, V1]);
    await db.query("update videos set comments_state='disabled' where id=$1", [
      V2,
    ]);
    const again = await db.query<{ d: { video_id: string }[] }>(
      "select private.due_videos($1,$1) as d",
      [W],
    );
    expect(again.rows[0].d.map((v) => v.video_id)).toEqual([V1]);
    await db.query(
      "update video_selections set next_check_at=now()+interval '1 day' where video_id=$1",
      [V1],
    );
    const none = await db.query<{ d: unknown[] }>(
      "select private.due_videos($1,$1) as d",
      [W],
    );
    expect(none.rows[0].d).toEqual([]);
    // restore for later tasks
    await db.query("update videos set comments_state='unknown' where id=$1", [
      V2,
    ]);
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
    await db.query("update videos set comments_state='disabled' where id=$1", [
      V2,
    ]);
    await expect(call(OWNER, [V2])).rejects.toThrow(/comments_disabled/);
    await db.exec("reset role");
    await db.query(
      "update videos set comments_state='open', reported_comment_count=40 where id=$1",
      [V2],
    );
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
      (await db.query("select 1 from video_selections where video_id=$1", [V2]))
        .rows,
    ).toHaveLength(0);
  });

  it("does not count comments already stored against the estimate", async () => {
    await db.exec("reset role");
    // V1 reports 25 and already holds 1 comment: 24 to collect. Deselect it
    // first so it is an addition again.
    await db.query("delete from video_selections where video_id=$1", [V1]);
    await db.query("update videos set reported_comment_count=25 where id=$1", [
      V1,
    ]);
    const r = await call(OWNER, [V1]);
    expect(r.rows[0].r.estimate).toBe(24);
    expect(r.rows[0].r.remaining_after).toBe(6);
    expect(r.rows[0].r.unknown_count).toBe(0);
  });

  it("reports unknown counts apart rather than as zero", async () => {
    await db.exec("reset role");
    await db.query(
      "update videos set reported_comment_count=null where id=$1",
      [V2],
    );
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
    expect(
      (await db.query("select 1 from video_selections where video_id=$1", [V1]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select 1 from comments where video_id=$1", [V1])).rows,
    ).toHaveLength(1);
  });

  it("swallows the rate limit and says the work is deferred", async () => {
    await db.exec("reset role");
    await db.query(
      "update jobs set status='succeeded' where workspace_id=$1 and status in ('queued','running')",
      [W],
    );
    await db.query(
      "update plans set min_sync_interval_minutes=60 where key='pilot'",
    );
    const r = await call(OWNER, [V1]);
    expect(r.rows[0].r.queued).toBe(false);
    expect(r.rows[0].r.deferred).toBe(true);
    await db.exec("reset role");
    await db.query(
      "update plans set min_sync_interval_minutes=30 where key='pilot'",
    );
  });

  it("refuses when the workspace has no active plan", async () => {
    await db.exec("reset role");
    await db.query(
      "update subscriptions set status='paused' where workspace_id=$1",
      [W],
    );
    await expect(call(OWNER, [V2], [])).rejects.toThrow(/no_active_plan/);
    await db.exec("reset role");
    await db.query(
      "update subscriptions set status='active' where workspace_id=$1",
      [W],
    );
  });

  it("request_discovery queues one discover per channel", async () => {
    // d1 from the schema tests is within the pilot's 30-minute rate limit;
    // this test is about dedupe, not the limit.
    await db.exec("reset role");
    await db.query(
      "update jobs set created_at=now()-interval '2 hours' where workspace_id=$1 and type='discover'",
      [W],
    );
    await as(OWNER);
    const a = await db.query<{ j: string }>(
      "select request_discovery($1,$1) as j",
      [W],
    );
    const b = await db.query<{ j: string }>(
      "select request_discovery($1,$1) as j",
      [W],
    );
    expect(a.rows[0].j).toBe(b.rows[0].j);
    await as(OUTSIDER);
    await expect(
      db.query("select request_discovery($1,$1)", [W]),
    ).rejects.toThrow(/forbidden/);
  });
});

describe("select_videos accounts for what is already chosen", () => {
  const V4 = "20000000-0000-4000-8000-000000000004";
  const V5 = "20000000-0000-4000-8000-000000000005";
  const V6 = "20000000-0000-4000-8000-000000000006";
  const call = (user: string, add: string[], remove: string[] = []) =>
    as(user).then(() =>
      db.query<{ r: Record<string, unknown> }>(
        "select select_videos($1,$1,$2::uuid[],$3::uuid[]) as r",
        [W, add, remove],
      ),
    );

  beforeAll(async () => {
    await db.exec("reset role");
    await db.query("delete from video_selections where workspace_id=$1", [W]);
    await db.query("delete from usage_events where workspace_id=$1", [W]);
    // Every earlier job finished and aged past the pilot's 30-minute rate
    // limit, so the first selection below queues a collection.
    await db.query(
      "update jobs set status='succeeded' where workspace_id=$1 and status in ('queued','running')",
      [W],
    );
    await db.query(
      "update jobs set created_at=now()-interval '2 hours' where workspace_id=$1",
      [W],
    );
    // pilot: 5000 analysis units. Two videos that fit alone and not together,
    // and a small one.
    await db.query(
      `insert into videos(id,workspace_id,channel_id,external_video_id,title,comments_state,reported_comment_count)
       values ($1,$4,$4,'ddddddddddd','٤','open',4000),($2,$4,$4,'eeeeeeeeeee','٥','open',4000),
              ($3,$4,$4,'fffffffffff','٦','open',900)`,
      [V4, V5, V6, W],
    );
  });

  it("refuses a second selection that fits alone but not with the first", async () => {
    // The first 4000 is accepted and nothing is outstanding before it.
    const first = await call(OWNER, [V4]);
    expect(first.rows[0].r).toMatchObject({
      estimate: 4000,
      outstanding: 0,
      remaining_after: 1000,
    });
    // The second 4000 fits 5000 on its own; it does not fit beside the first,
    // which is chosen and not yet stored. Before the fix both were accepted
    // and both reported remaining_after: 1000.
    await expect(call(OWNER, [V5])).rejects.toThrow(/quota_exceeded/);
    await db.exec("reset role");
    expect(
      (await db.query("select 1 from video_selections where video_id=$1", [V5]))
        .rows,
    ).toHaveLength(0);
    // 900 fits behind the 4000 still outstanding.
    const third = await call(OWNER, [V6]);
    expect(third.rows[0].r).toMatchObject({
      estimate: 900,
      outstanding: 4000,
      remaining_after: 100,
    });
  });

  it("does not count a selection being removed in the same call", async () => {
    // Swap the first 4000 for the second: outstanding is the 900 alone.
    const r = await call(OWNER, [V5], [V4]);
    expect(r.rows[0].r).toMatchObject({
      estimate: 4000,
      outstanding: 900,
      remaining_after: 100,
    });
  });

  it("says a running collection will not include the new video", async () => {
    await db.exec("reset role");
    // The collection the selections above queued has been claimed.
    const job = await db.query<{ id: string }>(
      `update jobs set status='running', lease_token=gen_random_uuid(),
              lease_expires_at=now()+interval '5 minutes'
        where workspace_id=$1 and type='collect' and status='queued' returning id`,
      [W],
    );
    expect(job.rows).toHaveLength(1);
    // V2 has no known count, so it costs nothing against the 4900 outstanding.
    const r = await call(OWNER, [V2]);
    expect(r.rows[0].r).toMatchObject({
      queued: false,
      deferred: false,
      already_running: true,
      job_id: job.rows[0].id,
    });
  });

  it("a removal alone requests no collection and needs no plan", async () => {
    await db.exec("reset role");
    await db.query(
      "update subscriptions set status='paused' where workspace_id=$1",
      [W],
    );
    // A paused plan must still let the tenant deselect.
    const r = await call(OWNER, [], [V4]);
    expect(r.rows[0].r).toMatchObject({
      queued: false,
      deferred: false,
      already_running: false,
      estimate: 0,
    });
    await db.exec("reset role");
    expect(
      (await db.query("select 1 from video_selections where video_id=$1", [V4]))
        .rows,
    ).toHaveLength(0);
    await db.query(
      "update subscriptions set status='active' where workspace_id=$1",
      [W],
    );
  });
});
