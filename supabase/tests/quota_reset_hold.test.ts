import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A quota block waits for the right reset, and nothing retries it sooner.
// Production, 2026-10-14 → 16: every YouTube quota block was sent to the
// billing period end (2026-11-05), nothing honoured that, and a fresh job was
// queued for each channel every hour; the reset at midnight Pacific went to
// re-reading catalogues because discovers were claimed before collects.

const THIS = "20261031000000_a_source_quota_waits_for_its_reset.sql";
const OWNER = "10000000-0000-4000-8000-000000000001";
const W = "00000000-0000-4000-8000-000000000001"; // owner plan: unlimited units
const SPENT = "00000000-0000-4000-8000-000000000002"; // creator plan, no units left
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const CLIENT_SPENT = "00000000-0000-4000-8000-0000000000c2";
const CATALOGUED = "00000000-0000-4000-8000-0000000000a1";
const UNCATALOGUED = "00000000-0000-4000-8000-0000000000a2";
const SPENT_CH = "00000000-0000-4000-8000-0000000000a3";
const TOKEN = "f".repeat(64); // platform credential: every workspace
const OLD_BLOCK = "00000000-0000-4000-8000-0000000000b1";

let db: PGlite;

const resetAt = async () =>
  (
    await db.query<{ r: Date }>("select private.source_quota_resets_at() as r")
  ).rows[0].r.toISOString();

const notBefore = async (job: string) =>
  (
    await db.query<{ not_before: Date | null }>(
      "select not_before from jobs where id = $1",
      [job],
    )
  ).rows[0].not_before?.toISOString() ?? null;

let leaseN = 0;
async function leased(w: string, ch: string, type: string) {
  leaseN += 1;
  const job = `00000000-0000-4000-9000-${String(leaseN).padStart(12, "0")}`;
  const lease = `00000000-0000-4000-a000-${String(leaseN).padStart(12, "0")}`;
  await db.query(
    `insert into jobs(id, workspace_id, channel_id, type, dedupe_key, status,
                      lease_token, lease_expires_at, attempt)
     values ($1, $2, $3, $4, $5, 'running', $6, now() + interval '5 minutes', 1)`,
    [job, w, ch, type, `lease-${leaseN}`, lease],
  );
  return { job, lease };
}

// As if the job ended `ago`: its creation and its run's end both moved back.
async function age(job: string, ago: string) {
  await db.query(
    "update jobs set created_at = now() - $2::interval where id = $1",
    [job, ago],
  );
  await db.query(
    "update sync_runs set ended_at = now() - $2::interval where job_id = $1",
    [job, ago],
  );
}

const finishBlocked = async (job: string, lease: string, reason: string) =>
  db.query("select private.worker_finish($1, $2, $3, 'blocked', $4)", [
    TOKEN,
    job,
    lease,
    reason,
  ]);

describe("a quota block waits for its reset", () => {
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
    const files = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files).toContain(THIS);
    // Everything before this file, then a block written under the old rule,
    // then this file: the repair is part of what it does.
    for (const f of files.filter((f) => f < THIS))
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));

    await db.query("insert into auth.users(id) values ($1)", [OWNER]);
    await db.query(
      `insert into workspaces(id, name, created_by)
       values ($1, 'Unlimited', $3), ($2, 'Spent', $3)`,
      [W, SPENT, OWNER],
    );
    await db.query(
      `insert into subscriptions(workspace_id, plan_key, status, period_start, period_end)
       values ($1, 'owner', 'active', now() - interval '1 day', now() + interval '20 days'),
              ($2, 'creator', 'active', now() - interval '1 day', now() + interval '20 days')`,
      [W, SPENT],
    );
    await db.query("update plans set analysis_units = 0 where key = 'creator'");
    await db.query(
      `insert into private.worker_credentials(token_hash, label, workspace_id)
       values ($1, 'platform', null)`,
      [TOKEN],
    );
    await db.query(
      `insert into clients(id, workspace_id, name) values ($1, $2, 'c'), ($3, $4, 'c')`,
      [CLIENT, W, CLIENT_SPENT, SPENT],
    );
    await db.query(
      `insert into channels(id, workspace_id, client_id, external_channel_id, platform, catalogued_at)
       values ($1, $4, $5, 'UC_catalogued', 'youtube', now() - interval '2 days'),
              ($2, $4, $5, 'UC_uncatalogued', 'youtube', null),
              ($3, $6, $7, 'UC_spent', 'youtube', now() - interval '2 days')`,
      [CATALOGUED, UNCATALOGUED, SPENT_CH, W, CLIENT, SPENT, CLIENT_SPENT],
    );
    await db.query(
      `insert into jobs(id, workspace_id, channel_id, type, dedupe_key, status, not_before, error_code)
       values ($1, $2, $3, 'discover', 'old-block', 'blocked', now() + interval '20 days', 'quota_exceeded')`,
      [OLD_BLOCK, W, CATALOGUED],
    );

    await db.exec(readFileSync(`supabase/migrations/${THIS}`, "utf8"));
    await db.exec("set role service_role");
  });

  afterAll(async () => {
    await db.close();
  });

  it("resets at the next midnight Pacific, daylight saving included", async () => {
    const at = async (t: string) =>
      (
        await db.query<{ r: Date }>(
          `select (date_trunc('day', $1::timestamptz at time zone 'America/Los_Angeles') + interval '1 day')
                  at time zone 'America/Los_Angeles' as r`,
          [t],
        )
      ).rows[0].r.toISOString();
    // The function and the expression it is: checked against now() once,
    // and the expression against known instants.
    const now = (await db.query<{ n: Date }>("select now() as n")).rows[0].n;
    expect(await resetAt()).toBe(await at(now.toISOString()));
    expect(await at("2026-10-17T06:59:00Z")).toBe("2026-10-17T07:00:00.000Z");
    expect(await at("2026-10-17T07:00:00Z")).toBe("2026-10-18T07:00:00.000Z");
    expect(await at("2026-11-01T12:00:00Z")).toBe("2026-11-02T08:00:00.000Z");
  });

  it("a source quota block waits for midnight Pacific, not the billing period end", async () => {
    const { job, lease } = await leased(W, CATALOGUED, "collect");
    await finishBlocked(job, lease, "quota_exceeded");
    expect(await notBefore(job)).toBe(await resetAt());
  });

  it("a quota block on a plan whose units are spent waits for the period end", async () => {
    const { job, lease } = await leased(SPENT, SPENT_CH, "collect");
    await finishBlocked(job, lease, "quota_exceeded");
    const periodEnd = (
      await db.query<{ period_end: Date }>(
        "select period_end from subscriptions where workspace_id = $1",
        [SPENT],
      )
    ).rows[0].period_end.toISOString();
    expect(await notBefore(job)).toBe(periodEnd);
  });

  it("a rate limit waits an hour, and a non-time block waits for nobody's clock", async () => {
    const limited = await leased(W, UNCATALOGUED, "collect");
    await finishBlocked(limited.job, limited.lease, "rate_limited");
    const hours =
      (Date.parse((await notBefore(limited.job))!) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(0.9);
    expect(hours).toBeLessThan(1.1);

    const denied = await leased(W, UNCATALOGUED, "discover");
    await finishBlocked(denied.job, denied.lease, "source_access_denied");
    expect(await notBefore(denied.job)).toBeNull();
  });

  it("repairs the blocks written under the old rule", async () => {
    expect(await notBefore(OLD_BLOCK)).toBe(await resetAt());
  });

  describe("the scheduler", () => {
    const enqueue = async (ch: string, kind: string) =>
      (
        await db.query<{ j: string | null }>(
          "select private.enqueue_scheduled($1, $2, $3) as j",
          [W, ch, kind],
        )
      ).rows[0].j;

    it("queues nothing for a kind whose latest job is blocked until a reset", async () => {
      await db.exec("delete from sync_runs; delete from jobs");
      const { job, lease } = await leased(W, CATALOGUED, "collect");
      await finishBlocked(job, lease, "quota_exceeded");
      // An hour and more after the block: the old backoff had run out here
      // and a fresh job went out to hear the same refusal.
      await age(job, "3 hours");
      expect(await enqueue(CATALOGUED, "collect")).toBeNull();
      expect(
        (await db.query("select 1 from jobs where type = 'collect'")).rows,
      ).toHaveLength(1);
    });

    it("lets unblock_due_jobs requeue that same job once the reset passes", async () => {
      const blocked = (
        await db.query<{ id: string }>(
          "select id from jobs where type = 'collect' and status = 'blocked'",
        )
      ).rows[0].id;
      await db.query(
        "update jobs set not_before = now() - interval '1 minute' where id = $1",
        [blocked],
      );
      await db.query("select private.unblock_due_jobs()");
      const rows = (
        await db.query<{ id: string; status: string }>(
          "select id, status from jobs where type = 'collect'",
        )
      ).rows;
      expect(rows).toEqual([{ id: blocked, status: "queued" }]);
    });

    it("still retries a block with no reset after the hour's backoff", async () => {
      await db.exec("delete from sync_runs; delete from jobs");
      const { job, lease } = await leased(W, CATALOGUED, "discover");
      await finishBlocked(job, lease, "channel_not_connected");
      expect(await enqueue(CATALOGUED, "discover")).toBeNull();
      await age(job, "2 hours");
      expect(await enqueue(CATALOGUED, "discover")).not.toBeNull();
    });
  });

  it("claims collects before refresh discovers, and a first discover before both", async () => {
    await db.exec("delete from sync_runs; delete from jobs");
    // The refresh discover is the oldest: under the old order, discover
    // first and then by age, it was handed out first.
    await db.query(
      `insert into jobs(workspace_id, channel_id, type, dedupe_key, not_before)
       values ($1, $2, 'discover', 'refresh', now() - interval '3 minutes'),
              ($1, $2, 'collect',  'collect', now() - interval '2 minutes'),
              ($1, $3, 'discover', 'first',   now() - interval '1 minute')`,
      [W, CATALOGUED, UNCATALOGUED],
    );
    const order: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await db.query<{ dedupe_key: string }>(
        "select dedupe_key from private.claim_job(null, null)",
      );
      order.push(r.rows[0].dedupe_key);
    }
    expect(order).toEqual(["first", "collect", "refresh"]);
  });
});
