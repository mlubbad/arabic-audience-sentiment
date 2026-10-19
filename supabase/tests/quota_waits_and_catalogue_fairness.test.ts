import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// A quota wait does not use up a job's attempts, and a refresh discover is
// overdue by its channel's catalogue age, not by the age of the job.
//
// Production, 2026-10-19 07:01 UTC, at the YouTube quota reset: 94 discovers
// and 2 collects went `failed retry_exhausted:quota_exceeded` at once. Each had
// waited for three resets: claim_job adds an attempt on every claim from
// queued, unblock_due_jobs requeued the same job, and on the fourth claim
// claim_job's first update failed it for attempt >= 3 without running it. The
// scheduler then created new discovers (07:01-07:17), which #173's rule
// (job created more than 6 hours ago) counted as young, so they waited behind
// ~110 collects again. 92 queued collects were already at attempt 2 with
// last_error quota_exceeded, one real failure away from exhaustion.

const OWNER = "10000000-0000-4000-8000-000000000001";
const W = "00000000-0000-4000-8000-000000000001";
const STALE = "00000000-0000-4000-8000-0000000000a1"; // catalogued 13 h ago
const FRESH = "00000000-0000-4000-8000-0000000000a2"; // catalogued 11 h ago
const OTHER = "00000000-0000-4000-8000-0000000000a3";
const TOKEN = "f".repeat(64); // platform credential

let db: PGlite;

async function job(
  key: string,
  channel: string,
  type: string,
  createdAgo = "1 minute",
) {
  const r = await db.query<{ id: string }>(
    `insert into jobs(workspace_id, channel_id, type, dedupe_key, created_at, not_before)
     values ($1, $2, $3, $4, now() - $5::interval, now() - interval '1 minute')
     returning id`,
    [W, channel, type, key, createdAgo],
  );
  return r.rows[0].id;
}

const claim = async () =>
  (
    await db.query<{ id: string; dedupe_key: string; lease_token: string }>(
      "select id, dedupe_key, lease_token from private.claim_job(null, null)",
    )
  ).rows[0] ?? null;

const row = async (id: string) =>
  (
    await db.query<{
      status: string;
      attempt: number;
      error_code: string | null;
    }>("select status, attempt, error_code from jobs where id = $1", [id])
  ).rows[0];

const finish = (j: string, lease: string, outcome: string, reason: string) =>
  db.query("select private.worker_finish($1, $2, $3, $4, $5)", [
    TOKEN,
    j,
    lease,
    outcome,
    reason,
  ]);

// The wait elapses (the reset, or the retry backoff), as the clock would make it.
const elapse = (j: string) =>
  db.query(
    "update jobs set not_before = now() - interval '1 minute' where id = $1",
    [j],
  );

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
     values ($1, $4, $4, 'UC_stale', 'youtube', now() - interval '13 hours'),
            ($2, $4, $4, 'UC_fresh', 'youtube', now() - interval '11 hours'),
            ($3, $4, $4, 'UC_other', 'youtube', now() - interval '1 hour')`,
    [STALE, FRESH, OTHER, W],
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

describe("a quota wait does not use up an attempt", () => {
  it("runs a job after three quota waits", async () => {
    const j = await job("waits", OTHER, "collect");
    for (let wait = 1; wait <= 3; wait++) {
      const lease = await claim();
      expect(lease?.id).toBe(j);
      await finish(j, lease!.lease_token, "blocked", "quota_exceeded");
      await elapse(j);
      await db.query("select private.unblock_due_jobs()");
      expect((await row(j)).status).toBe("queued");
    }
    // Old: claim_job failed it here (retry_exhausted:quota_exceeded) unrun.
    const lease = await claim();
    expect(lease?.id).toBe(j);
    expect(await row(j)).toMatchObject({ status: "running", attempt: 1 });
  });

  it("still exhausts a job after three real failures", async () => {
    const j = await job("fails", OTHER, "collect");
    for (let run = 1; run <= 3; run++) {
      const lease = await claim();
      expect(lease?.id).toBe(j);
      await finish(j, lease!.lease_token, "failed", "provider_error");
      await elapse(j);
    }
    expect(await row(j)).toMatchObject({
      status: "failed",
      error_code: "retry_exhausted:provider_error",
    });
    expect(await claim()).toBeNull();
  });

  it("counts the real failures around a quota wait", async () => {
    const j = await job("mixed", OTHER, "collect");
    let lease = await claim();
    await finish(j, lease!.lease_token, "failed", "provider_error");
    await elapse(j);
    lease = await claim();
    await finish(j, lease!.lease_token, "blocked", "quota_exceeded");
    await elapse(j);
    await db.query("select private.unblock_due_jobs()");
    lease = await claim();
    await finish(j, lease!.lease_token, "failed", "provider_error");
    await elapse(j);
    // Two real failures: one more run is owed.
    expect(await row(j)).toMatchObject({ status: "queued", attempt: 2 });
    lease = await claim();
    expect(lease?.id).toBe(j);
    await finish(j, lease!.lease_token, "failed", "provider_error");
    expect(await row(j)).toMatchObject({
      status: "failed",
      error_code: "retry_exhausted:provider_error",
    });
  });
});

describe("a refresh discover is overdue by its channel's catalogue age", () => {
  it("claims a just re-created discover before a collect when its channel's catalogue is stale", async () => {
    // 13 h since the catalogue, against 6 h of plan interval and 6 h of grace.
    await job("collect", OTHER, "collect", "10 hours");
    await job("recreated", STALE, "discover", "1 minute");
    expect((await claim())?.dedupe_key).toBe("recreated");
    expect((await claim())?.dedupe_key).toBe("collect");
  });

  it("keeps an old discover behind the collects while its channel's catalogue is fresh", async () => {
    await job("old-job", FRESH, "discover", "20 hours");
    await job("collect", OTHER, "collect", "1 minute");
    expect((await claim())?.dedupe_key).toBe("collect");
    expect((await claim())?.dedupe_key).toBe("old-job");
  });
});

describe("the attempts quota waits already took", () => {
  it("are given back once by the migration, and real failures are not", async () => {
    const THIS =
      "20261116000000_quota_waits_keep_attempts_and_catalogue_fairness.sql";
    const old = new PGlite();
    try {
      await old.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth; create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
        create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
        create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
        grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
      `);
      const files = readdirSync("supabase/migrations")
        .filter((f) => f.endsWith(".sql"))
        .sort();
      expect(files).toContain(THIS);
      for (const f of files.filter((f) => f < THIS))
        await old.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
      await old.query("insert into auth.users(id) values ($1)", [OWNER]);
      await old.query(
        "insert into workspaces(id, name, created_by) values ($1, 'W', $2)",
        [W, OWNER],
      );
      await old.query(
        "insert into clients(id, workspace_id, name) values ($1, $1, 'c')",
        [W],
      );
      await old.query(
        `insert into channels(id, workspace_id, client_id, external_channel_id, platform)
         values ($1, $3, $3, 'UC_a', 'youtube'), ($2, $3, $3, 'UC_b', 'youtube')`,
        [STALE, FRESH, W],
      );
      // The production shape: queued after two quota waits; and one whose
      // last run really failed.
      await old.query(
        `insert into jobs(workspace_id, channel_id, type, dedupe_key, status, attempt, last_error)
         values ($1, $2, 'collect', 'waited', 'queued', 2, 'quota_exceeded'),
                ($1, $3, 'collect', 'failed-run', 'queued', 2, 'provider_error')`,
        [W, STALE, FRESH],
      );
      await old.exec(readFileSync(`supabase/migrations/${THIS}`, "utf8"));
      const attempts = async () =>
        (
          await old.query<{ dedupe_key: string; attempt: number }>(
            "select dedupe_key, attempt from jobs order by dedupe_key",
          )
        ).rows;
      expect(await attempts()).toEqual([
        { dedupe_key: "failed-run", attempt: 2 },
        { dedupe_key: "waited", attempt: 0 },
      ]);
      // Idempotent: the whole migration a second time changes nothing.
      await old.exec(readFileSync(`supabase/migrations/${THIS}`, "utf8"));
      expect(await attempts()).toEqual([
        { dedupe_key: "failed-run", attempt: 2 },
        { dedupe_key: "waited", attempt: 0 },
      ]);
    } finally {
      await old.close();
    }
  });
});
