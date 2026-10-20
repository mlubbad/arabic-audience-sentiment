import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// A collect that stands down at its time budget is a yield, not a failure.
//
// Production, 2026-10-19/20 (read-only): the single Oracle worker sat in one
// collect from 22:39 to 01:54 UTC. 94 refresh discovers, overdue from
// 01:16-01:24, waited 31-44 minutes behind it, because claim_job can put an
// overdue discover first only when the worker next claims. The worker now
// finishes a collect `partial` with `time_budget` after 30 minutes. Under the
// old worker_finish that run counted an attempt (the third yield ended the
// job retry_exhausted:time_budget) and waited a 60-120 s backoff.

const OWNER = "10000000-0000-4000-8000-000000000001";
const W = "00000000-0000-4000-8000-000000000001";
const STALE = "00000000-0000-4000-8000-0000000000a1"; // catalogued 13 h ago
const OTHER = "00000000-0000-4000-8000-0000000000a3";
const TOKEN = "f".repeat(64); // platform credential
const CHECKPOINT = { video: "v1", done: ["v0"], cursor: "page-3" };

let db: PGlite;

async function job(key: string, channel: string, type: string) {
  const r = await db.query<{ id: string }>(
    `insert into jobs(workspace_id, channel_id, type, dedupe_key, not_before)
     values ($1, $2, $3, $4, now() - interval '1 minute')
     returning id`,
    [W, channel, type, key],
  );
  return r.rows[0].id;
}

const claim = async () =>
  (
    await db.query<{
      id: string;
      dedupe_key: string;
      lease_token: string;
      checkpoint: unknown;
    }>(
      "select id, dedupe_key, lease_token, checkpoint from private.claim_job(null, null)",
    )
  ).rows[0] ?? null;

const row = async (id: string) =>
  (
    await db.query<{
      status: string;
      attempt: number;
      error_code: string | null;
      last_error: string | null;
      waiting: boolean;
      checkpoint: unknown;
    }>(
      `select status, attempt, error_code, last_error,
              not_before > now() as waiting, checkpoint
         from jobs where id = $1`,
      [id],
    )
  ).rows[0];

const run = async (id: string) =>
  (
    await db.query<{ status: string; error_code: string | null }>(
      "select status, error_code from sync_runs where job_id = $1",
      [id],
    )
  ).rows[0];

// What a committed batch leaves on the job: its checkpoint, and the heartbeat
// the worker sends before every commit.
async function commit(j: string, lease: string) {
  await db.query("update jobs set checkpoint = $2 where id = $1", [
    j,
    JSON.stringify(CHECKPOINT),
  ]);
  await db.query("select private.worker_heartbeat($1, $2, $3)", [
    TOKEN,
    j,
    lease,
  ]);
}

const finish = (j: string, lease: string, outcome: string, reason: string) =>
  db.query("select private.worker_finish($1, $2, $3, $4, $5)", [
    TOKEN,
    j,
    lease,
    outcome,
    reason,
  ]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
  `);
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.query("insert into auth.users(id) values ($1)", [OWNER]);
  await db.query(
    "insert into workspaces(id, name, created_by) values ($1, 'W', $2)",
    [W, OWNER],
  );
  // The catalogue interval most of production has (113 of 121 subscriptions).
  await db.query(
    "update plans set catalogue_interval_minutes = 360 where key = 'owner'",
  );
  await db.query(
    `insert into subscriptions(workspace_id, plan_key, status, period_start, period_end)
     values ($1, 'owner', 'active', now() - interval '1 day', now() + interval '20 days')`,
    [W],
  );
  await db.query(
    "insert into clients(id, workspace_id, name) values ($1, $1, 'c')",
    [W],
  );
  await db.query(
    `insert into channels(id, workspace_id, client_id, external_channel_id, platform, catalogued_at)
     values ($1, $3, $3, 'UC_stale', 'youtube', now() - interval '13 hours'),
            ($2, $3, $3, 'UC_other', 'youtube', now() - interval '1 hour')`,
    [STALE, OTHER, W],
  );
  await db.query(
    `insert into private.worker_credentials(token_hash, label, workspace_id)
     values ($1, 'platform', null)`,
    [TOKEN],
  );
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("delete from sync_runs; delete from jobs");
});

describe("a collect that yields at its time budget", () => {
  it("is queued again at once with its checkpoint and its attempt back", async () => {
    const j = await job("collect", OTHER, "collect");
    const lease = await claim();
    expect(lease?.id).toBe(j);
    await commit(j, lease!.lease_token);
    await finish(j, lease!.lease_token, "partial", "time_budget");

    expect(await row(j)).toEqual({
      status: "queued",
      attempt: 0,
      error_code: "time_budget",
      // A yield is not an error: the last real one is kept as it was.
      last_error: null,
      waiting: false,
      checkpoint: CHECKPOINT,
    });
    // Never a success: the run is recorded partial, with its reason.
    expect(await run(j)).toEqual({
      status: "partial",
      error_code: "time_budget",
    });
    // Claimable at once, and it resumes from the checkpoint.
    const again = await claim();
    expect(again?.id).toBe(j);
    expect(again?.checkpoint).toEqual(CHECKPOINT);
  });

  it("yields as often as the collect needs without exhausting the job", async () => {
    const j = await job("long", OTHER, "collect");
    for (let slice = 1; slice <= 5; slice++) {
      const lease = await claim();
      expect(lease?.id).toBe(j);
      await commit(j, lease!.lease_token);
      await finish(j, lease!.lease_token, "partial", "time_budget");
    }
    // Old: the third yield ended it partial, retry_exhausted:time_budget.
    expect(await row(j)).toMatchObject({ status: "queued", attempt: 0 });
    const lease = await claim();
    expect(lease?.id).toBe(j);
    await finish(j, lease!.lease_token, "succeeded", "");
    expect((await row(j)).status).toBe("succeeded");
  });

  it("lets an overdue discover run next, then resumes", async () => {
    const collect = await job("collect", OTHER, "collect");
    const lease = await claim();
    expect(lease?.id).toBe(collect);
    // The discover became overdue while the collect held the worker.
    const discover = await job("overdue", STALE, "discover");
    await commit(collect, lease!.lease_token);
    await finish(collect, lease!.lease_token, "partial", "time_budget");

    const next = await claim();
    expect(next?.id).toBe(discover);
    await finish(discover, next!.lease_token, "succeeded", "");
    const resumed = await claim();
    expect(resumed?.id).toBe(collect);
    expect(resumed?.checkpoint).toEqual(CHECKPOINT);
  });

  it("is an ordinary partial when the run committed nothing", async () => {
    // No heartbeat since the claim, so no batch: nothing shows the run made
    // progress, and a yield that is free could repeat forever.
    const j = await job("idle", OTHER, "collect");
    const lease = await claim();
    await finish(j, lease!.lease_token, "partial", "time_budget");
    expect(await row(j)).toMatchObject({
      status: "queued",
      attempt: 1,
      waiting: true,
    });
  });

  it("is a collect's or an import's: any other job's partial counts as before", async () => {
    const j = await job("discover", OTHER, "discover");
    const lease = await claim();
    await commit(j, lease!.lease_token);
    await finish(j, lease!.lease_token, "partial", "time_budget");
    expect(await row(j)).toMatchObject({
      status: "queued",
      attempt: 1,
      waiting: true,
    });
  });
});
