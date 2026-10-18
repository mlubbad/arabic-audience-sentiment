import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A channel with several blocked jobs of one kind, all due at once, must not
// stop the scheduler.
//
// Production, 2026-10-17 07:17 UTC onwards: channel 7153b08f… held six blocked
// `collect` jobs, written an hour apart under the old quota rule and given one
// not_before (07:00) by 20261031's repair. unblock_due_jobs requeued all six in
// one statement, `jobs_one_outstanding_collect` refused the second, and the
// whole tick rolled back: every pg_cron sentiment-tick and every worker tick
// failed with 23505, so none of the 207 due blocked jobs on the platform came
// back. The same shape had already stopped the cron tick 357 times in a row
// from 2026-09-24 to 2026-10-09.

const OWNER = "10000000-0000-4000-8000-000000000001";
const W = "00000000-0000-4000-8000-000000000001";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const CH = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const TOKEN = "f".repeat(64); // platform credential: every workspace

const job = (n: number) =>
  `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;

let db: PGlite;

async function blocked(
  n: number,
  ch: string,
  type: string,
  createdAgo: string,
) {
  await db.query(
    `insert into jobs(id, workspace_id, channel_id, type, dedupe_key, status,
                      error_code, attempt, created_at, not_before)
     values ($1, $2, $3, $4, $5, 'blocked', 'quota_exceeded', 1,
             now() - $6::interval, now() - interval '1 minute')`,
    [job(n), W, ch, type, `${type}-${n}`, createdAgo],
  );
}

const statuses = async (type: string) =>
  (
    await db.query<{ id: string; status: string }>(
      "select id, status from jobs where type = $1 order by created_at, id",
      [type],
    )
  ).rows;

describe("unblock_due_jobs with several due blocks on one channel", () => {
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
    for (const f of files)
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));

    await db.query("insert into auth.users(id) values ($1)", [OWNER]);
    await db.query(
      "insert into workspaces(id, name, created_by) values ($1, 'W', $2)",
      [W, OWNER],
    );
    await db.query(
      `insert into subscriptions(workspace_id, plan_key, status, period_start, period_end)
       values ($1, 'owner', 'active', now() - interval '1 day', now() + interval '20 days')`,
      [W],
    );
    await db.query(
      `insert into private.worker_credentials(token_hash, label, workspace_id)
       values ($1, 'platform', null)`,
      [TOKEN],
    );
    await db.query(
      "insert into clients(id, workspace_id, name) values ($1, $2, 'c')",
      [CLIENT, W],
    );
    await db.query(
      `insert into channels(id, workspace_id, client_id, external_channel_id, platform, catalogued_at)
       values ($1, $3, $4, 'UC_one', 'youtube', now() - interval '1 hour'),
              ($2, $3, $4, 'UC_two', 'youtube', now() - interval '1 hour')`,
      [CH, OTHER, W, CLIENT],
    );
    await db.exec("set role service_role");
  });

  afterAll(async () => {
    await db.close();
  });

  it("the worker's tick succeeds, requeues the newest block and supersedes the rest", async () => {
    // The production shape: three collects an hour apart, two discovers,
    // and on another channel a single block that must come back too.
    await blocked(1, CH, "collect", "3 hours");
    await blocked(2, CH, "collect", "2 hours");
    await blocked(3, CH, "collect", "1 hour");
    await blocked(4, CH, "discover", "2 hours");
    await blocked(5, CH, "discover", "1 hour");
    await blocked(6, OTHER, "collect", "1 hour");

    await db.query("select private.worker_tick($1)", [TOKEN]);

    expect(await statuses("collect")).toEqual([
      { id: job(1), status: "cancelled" },
      { id: job(2), status: "cancelled" },
      { id: job(3), status: "queued" },
      { id: job(6), status: "queued" },
    ]);
    expect(await statuses("discover")).toEqual([
      { id: job(4), status: "cancelled" },
      { id: job(5), status: "queued" },
    ]);
    const superseded = (
      await db.query<{ error_code: string }>(
        "select distinct error_code from jobs where status = 'cancelled'",
      )
    ).rows;
    expect(superseded).toEqual([{ error_code: "superseded_by_active_job" }]);
  });

  it("the pg_cron tick succeeds on the same shape", async () => {
    await db.exec("delete from sync_runs; delete from jobs");
    await blocked(11, CH, "collect", "2 hours");
    await blocked(12, CH, "collect", "1 hour");

    await db.query("select private.schedule_all()");

    expect(await statuses("collect")).toEqual([
      { id: job(11), status: "cancelled" },
      { id: job(12), status: "queued" },
    ]);
  });

  it("leaves a block that is not yet due alone", async () => {
    await db.exec("delete from sync_runs; delete from jobs");
    await blocked(21, CH, "collect", "2 hours");
    await db.query(
      "update jobs set not_before = now() + interval '1 hour' where id = $1",
      [job(21)],
    );

    expect(
      (await db.query<{ n: number }>("select private.unblock_due_jobs() as n"))
        .rows[0].n,
    ).toBe(0);
    expect(await statuses("collect")).toEqual([
      { id: job(21), status: "blocked" },
    ]);
  });
});
