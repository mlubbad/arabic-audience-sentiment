import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
const A = "00000000-0000-4000-8000-000000000001",
  B = "00000000-0000-4000-8000-000000000002";
const ownerA = "10000000-0000-4000-8000-000000000001",
  ownerB = "10000000-0000-4000-8000-000000000002",
  viewer = "10000000-0000-4000-8000-000000000003";
let db: PGlite;
async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function admin() {
  await db.exec("reset role");
}
describe("foundation SQL in embedded PostgreSQL (not live Supabase)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
   create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
   grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const file of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.query("insert into auth.users(id) values ($1),($2),($3)", [
      ownerA,
      ownerB,
      viewer,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'A',$3),($2,'B',$4)",
      [A, B, ownerA, ownerB],
    );
    await db.query(
      "insert into memberships values ($1,$2,'workspace_owner'),($3,$4,'workspace_owner'),($1,$5,'viewer')",
      [A, ownerA, B, ownerB, viewer],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'A client'),($2,$2,'B client')",
      [A, B],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id) values ($1,$1,$1,'UC_A'),($2,$2,$2,'UC_B')",
      [A, B],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values ('exports',$1),('exports',$2)",
      [`${A}/report.csv`, `${B}/report.csv`],
    );
    await db.query(
      "insert into videos(id,workspace_id,channel_id,external_video_id,title) values ($1,$1,$1,'vidA','A video'),($2,$2,$2,'vidB','B video')",
      [A, B],
    );
    await db.query(
      `insert into comments(id,workspace_id,video_id,external_comment_id,text_raw,text_plain,content_hash,timestamp_precision,source)
       values ($1,$1,$1,'cA','نص أ','نص أ','hash-a','second','sanitized_fixture'),
              ($2,$2,$2,'cB','نص ب','نص ب','hash-b','second','sanitized_fixture')`,
      [A, B],
    );
    // A deliberately tiny plan, so allowance behaviour is visible in a few calls.
    await db.query(
      "insert into plans(key,analysis_units,backfill_units,channels_limit) values ('test-small',5,2,10)",
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'test-small','active',now()-interval '1 day',now()+interval '29 days'),
              ($2,'test-small','active',now()-interval '1 day',now()+interval '29 days')`,
      [A, B],
    );
  });
  afterAll(async () => {
    await db?.close();
  });
  it("allows own reads and denies foreign reads, updates, and exports", async () => {
    await user(ownerA);
    expect((await db.query("select id from clients")).rows).toEqual([
      { id: A },
    ]);
    expect(
      (
        await db.query(
          "update clients set name=$1 where workspace_id=$2 returning id",
          ["attack", B],
        )
      ).rows,
    ).toEqual([]);
    expect((await db.query("select name from storage.objects")).rows).toEqual([
      { name: `${A}/report.csv` },
    ]);
  });
  it("cannot self-promote, reassign workspace, or claim a channel", async () => {
    await user(viewer);
    await expect(
      db.query(
        "update memberships set role='workspace_owner' where user_id=$1",
        [viewer],
      ),
    ).rejects.toThrow();
    await expect(
      db.query("insert into clients(workspace_id,name) values ($1,'attack')", [
        A,
      ]),
    ).rejects.toThrow();
    await user(ownerA);
    await expect(
      db.query("update clients set workspace_id=$1 where id=$2", [B, A]),
    ).rejects.toThrow();
    await expect(
      db.query("update channels set status='connected' where id=$1", [A]),
    ).rejects.toThrow();
  });
  it("composite foreign keys reject cross-workspace assignments even by privileged inserts", async () => {
    await admin();
    await expect(
      db.query(
        "insert into videos(workspace_id,channel_id,external_video_id,title) values ($1,$2,'v','bad')",
        [A, B],
      ),
    ).rejects.toThrow();
  });
  it("rejects anonymous reads and private token access", async () => {
    await admin();
    await db.exec("set role anon");
    await expect(db.query("select * from comments")).rejects.toThrow();
    await user(ownerA);
    await expect(
      db.query("select * from private.oauth_connections"),
    ).rejects.toThrow();
  });
  it("creates workspace with caller membership and rejects unauthenticated RPC", async () => {
    await user(ownerA);
    const r = await db.query<{ id: string }>(
      "select public.create_workspace('new space') as id",
    );
    expect(r.rows[0].id).toBeTruthy();
    const m = await db.query(
      "select role from memberships where workspace_id=$1",
      [r.rows[0].id],
    );
    expect(m.rows[0]).toEqual({ role: "workspace_owner" });
    await admin();
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.exec("set role authenticated");
    await expect(db.query("select create_workspace('bad')")).rejects.toThrow();
  });
  it("sync request checks role, tenant and idempotency", async () => {
    await user(viewer);
    await expect(
      db.query("select enqueue_sync($1,$2,$3)", [A, A, "same"]),
    ).rejects.toThrow();
    await user(ownerA);
    await expect(
      db.query("select enqueue_sync($1,$2,$3)", [B, B, "same"]),
    ).rejects.toThrow();
    const first = await db.query("select enqueue_sync($1,$2,$3) as id", [
      A,
      A,
      "same",
    ]);
    const second = await db.query("select enqueue_sync($1,$2,$3) as id", [
      A,
      A,
      "same",
    ]);
    expect(first.rows).toEqual(second.rows);
  });
  it("bootstraps a personal workspace for each Auth user and controls channel registration", async () => {
    await user(viewer);
    expect(
      (
        await db.query("select id from workspaces where created_by=$1", [
          viewer,
        ])
      ).rows,
    ).toHaveLength(1);
    await expect(
      db.query("select register_channel($1,$2,$3)", [
        A,
        A,
        "UC" + "x".repeat(22),
      ]),
    ).rejects.toThrow();
    await user(ownerA);
    await expect(
      db.query("select register_channel($1,$2,$3)", [
        A,
        B,
        "UC" + "x".repeat(22),
      ]),
    ).rejects.toThrow();
    const channel = await db.query<{ id: string }>(
      "select register_channel($1,$2,$3) as id",
      [A, A, "UC" + "x".repeat(22)],
    );
    expect(
      (
        await db.query("select status from channels where id=$1", [
          channel.rows[0].id,
        ])
      ).rows[0],
    ).toEqual({ status: "public_unverified" });
  });
  it("takes human corrections only through the role-checked RPC and appends them", async () => {
    await user(viewer);
    await expect(
      db.query("select submit_comment_review($1,$2,$3,$4,$5)", [
        A,
        A,
        "hash-a",
        "negative",
        "سبب",
      ]),
    ).rejects.toThrow();

    await user(ownerA);
    // Another tenant's comment is not reviewable even with a valid role here.
    await expect(
      db.query("select submit_comment_review($1,$2,$3,$4,$5)", [
        B,
        B,
        "hash-b",
        "negative",
        "سبب",
      ]),
    ).rejects.toThrow();
    // An empty reason is not a correction.
    await expect(
      db.query("select submit_comment_review($1,$2,$3,$4,$5)", [
        A,
        A,
        "hash-a",
        "negative",
        "   ",
      ]),
    ).rejects.toThrow();
    // Optimistic concurrency: a verdict on text that has since changed is a
    // conflict, not a silent write against the new text.
    await expect(
      db.query("select submit_comment_review($1,$2,$3,$4,$5)", [
        A,
        A,
        "hash-from-older-text",
        "negative",
        "سبب",
      ]),
    ).rejects.toThrow(/stale_comment_text/);

    const first = await db.query<{ id: string }>(
      "select submit_comment_review($1,$2,$3,$4,$5) as id",
      [A, A, "hash-a", "negative", "تصنيف خاطئ"],
    );
    expect(first.rows[0].id).toBeTruthy();
    // A change of mind appends; it never rewrites the earlier verdict.
    await db.query("select submit_comment_review($1,$2,$3,$4,$5)", [
      A,
      A,
      "hash-a",
      "mixed",
      "إعادة نظر",
    ]);
    const log = await db.query<{
      label: string;
      reviewer_id: string;
      origin: string;
      content_hash: string;
    }>(
      "select label,reviewer_id,origin,content_hash from comment_reviews where comment_id=$1 order by created_at",
      [A],
    );
    expect(log.rows.map((r) => r.label)).toEqual(["negative", "mixed"]);
    // The reviewer and provenance come from the session, never from the caller.
    expect(
      log.rows.every(
        (r) =>
          r.reviewer_id === ownerA &&
          r.origin === "human" &&
          r.content_hash === "hash-a",
      ),
    ).toBe(true);
  });
  it("keeps the review log append-only and unforgeable", async () => {
    await user(ownerA);
    // No direct insert, so reviewer_id cannot be forged and a tenant cannot
    // claim the weaker "legacy_unverified" provenance for its own verdict.
    await expect(
      db.query(
        "insert into comment_reviews(workspace_id,comment_id,content_hash,label,reviewer_id,reason,origin) values ($1,$1,'hash-a','positive',$2,'x','legacy_unverified')",
        [A, viewer],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        "update comment_reviews set label='positive' where workspace_id=$1",
        [A],
      ),
    ).rejects.toThrow();
    await expect(
      db.query("delete from comment_reviews where workspace_id=$1", [A]),
    ).rejects.toThrow();
    // The tenant still reads its own log, and only its own.
    const mine = await db.query<{ n: number }>(
      "select count(*)::int as n from comment_reviews",
    );
    expect(mine.rows[0].n).toBe(2);
    // History is immutable even for a role that bypasses RLS.
    await admin();
    await expect(
      db.query("update comment_reviews set label='positive'"),
    ).rejects.toThrow(/append_only/);
    await expect(db.query("delete from comment_reviews")).rejects.toThrow(
      /append_only/,
    );
  });
  it("fences leases and commits batch/checkpoint idempotently", async () => {
    await admin();
    const claim = await db.query<{ id: string; lease_token: string }>(
      "select * from private.claim_job($1)",
      [A],
    );
    expect(claim.rows).toHaveLength(1);
    const job = claim.rows[0];
    expect(
      (await db.query("select * from private.claim_job($1)", [A])).rows,
    ).toHaveLength(0);
    await expect(
      db.query("select private.commit_checkpoint($1,$2,$3,$4)", [
        job.id,
        B,
        "{}",
        "batch-1",
      ]),
    ).rejects.toThrow();
    await db.query("select private.commit_checkpoint($1,$2,$3,$4)", [
      job.id,
      job.lease_token,
      '{"page":1}',
      "batch-1",
    ]);
    await db.query("select private.commit_checkpoint($1,$2,$3,$4)", [
      job.id,
      job.lease_token,
      '{"page":1}',
      "batch-1",
    ]);
    expect(
      (await db.query("select count(*)::int as n from private.job_batches"))
        .rows[0],
    ).toEqual({ n: 1 });
    await db.query(
      "update jobs set lease_expires_at=now()-interval '1 second' where id=$1",
      [job.id],
    );
    await expect(
      db.query("select private.commit_checkpoint($1,$2,$3,$4)", [
        job.id,
        job.lease_token,
        "{}",
        "batch-2",
      ]),
    ).rejects.toThrow();
  });
  it("meters the first analysis of a comment and never charges it twice", async () => {
    await admin();
    const reserve = (keys: string[], kind = "comment_analysis") =>
      db.query<{ covered: string[] }>(
        "select private.reserve_usage($1,$2,$3) as covered",
        [B, kind, keys],
      );
    expect((await reserve(["b-c1", "b-c2"])).rows[0].covered.sort()).toEqual([
      "b-c1",
      "b-c2",
    ]);
    // A retry of the same batch is covered again but costs nothing more.
    expect((await reserve(["b-c1", "b-c2"])).rows[0].covered.sort()).toEqual([
      "b-c1",
      "b-c2",
    ]);
    const used = await db.query<{ n: number }>(
      "select coalesce(sum(units),0)::int as n from usage_events where workspace_id=$1 and event_type='comment_analysis'",
      [B],
    );
    expect(used.rows[0].n).toBe(2);
  });
  it("grants only what the allowance still holds, and never past it", async () => {
    await admin();
    const reserve = (keys: string[], kind = "comment_analysis") =>
      db.query<{ covered: string[] }>(
        "select private.reserve_usage($1,$2,$3) as covered",
        [B, kind, keys],
      );
    // Five requested, three left: a partial grant rather than an overspend.
    expect(
      (await reserve(["b-c3", "b-c4", "b-c5", "b-c6", "b-c7"])).rows[0].covered,
    ).toHaveLength(3);
    expect((await reserve(["b-c8"])).rows[0].covered).toEqual([]);
    const used = await db.query<{ n: number }>(
      "select coalesce(sum(units),0)::int as n from usage_events where workspace_id=$1 and event_type='comment_analysis'",
      [B],
    );
    expect(used.rows[0].n).toBe(5);
    // Backfill draws on its own budget, so an exhausted analysis quota does not
    // block it and it cannot borrow from analysis either.
    expect(
      (await reserve(["b-h1", "b-h2"], "historical_backfill")).rows[0].covered,
    ).toHaveLength(2);
    expect(
      (await reserve(["b-h3"], "historical_backfill")).rows[0].covered,
    ).toEqual([]);
  });
  it("refuses to meter without an active plan inside its period", async () => {
    await admin();
    await expect(
      db.query("select private.reserve_usage($1,'comment_analysis',$2)", [
        A,
        ["x"],
      ]),
    ).resolves.toBeTruthy();
    await db.query(
      "update subscriptions set status='paused' where workspace_id=$1",
      [A],
    );
    await expect(
      db.query("select private.reserve_usage($1,'comment_analysis',$2)", [
        A,
        ["y"],
      ]),
    ).rejects.toThrow(/plan_inactive/);
    await db.query(
      "update subscriptions set status='active', period_end=now()-interval '1 hour' where workspace_id=$1",
      [A],
    );
    await expect(
      db.query("select private.reserve_usage($1,'comment_analysis',$2)", [
        A,
        ["y"],
      ]),
    ).rejects.toThrow(/plan_inactive/);
    await db.query(
      "update subscriptions set period_end=now()+interval '29 days' where workspace_id=$1",
      [A],
    );
    await db.query("delete from usage_events where workspace_id=$1", [A]);
  });
  it("commits rows, checkpoint and usage in one transaction or not at all", async () => {
    await admin();
    const job = "20000000-0000-4000-8000-000000000001";
    const token = "30000000-0000-4000-8000-000000000001";
    await db.query(
      `insert into jobs(id,workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
       values ($1,$2,$2,'analyse','usage-batch','running',$3,now()+interval '5 minutes')`,
      [job, A, token],
    );
    await db.query("select private.commit_checkpoint($1,$2,$3,$4,$5)", [
      job,
      token,
      '{"page":1}',
      "batch-usage-1",
      ["a-c1", "a-c2", "a-c3"],
    ]);
    const afterFirst = await db.query<{ n: number }>(
      "select count(*)::int as n from usage_events where workspace_id=$1",
      [A],
    );
    expect(afterFirst.rows[0].n).toBe(3);

    // Replaying the batch must not charge a second time.
    await db.query("select private.commit_checkpoint($1,$2,$3,$4,$5)", [
      job,
      token,
      '{"page":1}',
      "batch-usage-1",
      ["a-c1", "a-c2", "a-c3"],
    ]);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from usage_events where workspace_id=$1",
          [A],
        )
      ).rows[0].n,
    ).toBe(3);

    // Two units left, four requested: the whole batch is refused rather than
    // half-committed, so rows, checkpoint and meter stay consistent.
    await expect(
      db.query("select private.commit_checkpoint($1,$2,$3,$4,$5)", [
        job,
        token,
        '{"page":2}',
        "batch-usage-2",
        ["a-c4", "a-c5", "a-c6", "a-c7"],
      ]),
    ).rejects.toThrow(/quota_exceeded/);
    const after = await db.query<{
      n: number;
      checkpoint: string;
      batches: number;
    }>(
      `select (select count(*) from usage_events where workspace_id=$1)::int as n,
              (select checkpoint::text from jobs where id=$2) as checkpoint,
              (select count(*) from private.job_batches where job_id=$2)::int as batches`,
      [A, job],
    );
    expect(after.rows[0].n).toBe(3);
    expect(JSON.parse(after.rows[0].checkpoint)).toEqual({ page: 1 });
    expect(after.rows[0].batches).toBe(1);
  });
  it("releases only what was never confirmed", async () => {
    await admin();
    expect(
      (
        await db.query<{ n: number }>(
          "select private.confirm_usage($1,$2) as n",
          [A, ["a-c1"]],
        )
      ).rows[0].n,
    ).toBe(1);
    // A confirmed charge is history; only the unused reservation is given back.
    expect(
      (
        await db.query<{ n: number }>(
          "select private.release_usage($1,$2) as n",
          [A, ["a-c1", "a-c2"]],
        )
      ).rows[0].n,
    ).toBe(1);
    const left = await db.query<{ event_key: string; state: string }>(
      "select event_key,state from usage_events where workspace_id=$1 order by event_key",
      [A],
    );
    expect(left.rows).toEqual([
      { event_key: "a-c1", state: "charged" },
      { event_key: "a-c3", state: "reserved" },
    ]);
  });
  it("keeps the meter readable by its tenant and writable by no tenant", async () => {
    await user(ownerA);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from usage_events",
        )
      ).rows[0].n,
    ).toBe(2);
    await expect(
      db.query(
        "insert into usage_events(workspace_id,period_start,event_key,event_type) values ($1,now(),'free','comment_analysis')",
        [A],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        "update usage_events set state='reserved' where workspace_id=$1",
        [A],
      ),
    ).rejects.toThrow();
    await expect(
      db.query("delete from usage_events where workspace_id=$1", [A]),
    ).rejects.toThrow();
    // Metering is a server primitive; a tenant cannot call it at all.
    await expect(
      db.query("select private.reserve_usage($1,'comment_analysis',$2)", [
        A,
        ["forged"],
      ]),
    ).rejects.toThrow();
    // A plan is operator-managed, so a tenant cannot raise its own limits.
    await expect(
      db.query("update plans set analysis_units=999 where key='test-small'"),
    ).rejects.toThrow();
  });
  it("reports the meter to every member of its own workspace only", async () => {
    // A viewer may see the plan state; it is a read, not a control.
    await user(viewer);
    const mine = await db.query<{ summary: Record<string, unknown> }>(
      "select public.usage_summary($1) as summary",
      [A],
    );
    expect(mine.rows[0].summary).toMatchObject({
      plan_key: "test-small",
      status: "active",
    });
    const budgets = (
      mine.rows[0].summary as {
        budgets: {
          event_type: string;
          used: number;
          allowance: number;
          remaining: number;
        }[];
      }
    ).budgets;
    expect(budgets).toEqual([
      {
        event_type: "comment_analysis",
        used: 2,
        allowance: 5,
        remaining: 3,
      },
      {
        event_type: "historical_backfill",
        used: 0,
        allowance: 2,
        remaining: 2,
      },
    ]);

    // Another tenant's plan is not readable, and neither is an anonymous one.
    await user(ownerB);
    await expect(
      db.query("select public.usage_summary($1)", [A]),
    ).rejects.toThrow();
    await admin();
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.exec("set role authenticated");
    await expect(
      db.query("select public.usage_summary($1)", [A]),
    ).rejects.toThrow();
  });
  it("says plainly when no plan has been activated", async () => {
    await user(ownerA);
    const fresh = await db.query<{ id: string }>(
      "select public.create_workspace('بلا خطة') as id",
    );
    const summary = await db.query<{ summary: unknown }>(
      "select public.usage_summary($1) as summary",
      [fresh.rows[0].id],
    );
    // Null means "the operator has not activated a plan", not "no allowance left".
    expect(summary.rows[0].summary).toBeNull();
  });
});
