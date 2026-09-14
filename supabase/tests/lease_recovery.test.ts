/**
 * A lapsed lease is a recovery, not a failed attempt.
 *
 * Production buried three jobs in a day as `retry_exhausted` with no error code
 * ever recorded against any of them, while the run history held three rows, all
 * successful, all from the day before. Nothing had failed; the work was slower
 * than its sixty-second lease, and every re-claim was counted as an attempt.
 *
 * The first test here is the one that matters, and it is about the shape of the
 * old code rather than its tuning: because `worker_finish` makes a failed job
 * terminal and `claim_job` only ever selects queued or lapsed work, the attempt
 * ceiling was unreachable except through lease lapses. A guard named for a
 * retry policy was counting thefts.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000001";
let db: PGlite;

const job = async (status = "queued") => {
  await db.exec("reset role");
  await db.query(
    "update jobs set status='succeeded' where workspace_id=$1 and status in ('queued','running')",
    [W],
  );
  const r = await db.query<{ id: string }>(
    `insert into jobs(workspace_id,channel_id,type,dedupe_key,status)
     values ($1,$1,'collect',$2,$3) returning id`,
    [W, `k-${Math.random()}`, status],
  );
  return r.rows[0].id;
};
const row = async (id: string) =>
  (
    await db.query<{
      status: string;
      attempt: number;
      reclaims: number;
      error_code: string | null;
    }>("select status,attempt,reclaims,error_code from jobs where id=$1", [id])
  ).rows[0];
const claim = () => db.query("select * from private.claim_job($1)", [W]);
/**
 * Make the current lease look abandoned, as a crashed worker would leave it,
 * and wind `not_before` back to now.
 *
 * Re-claiming backs a job off once it is being handed round, so without the
 * winding a test that drives `reclaims` upward is really testing the backoff
 * and stalling on it. Production gets the same effect by waiting; a test
 * should not. The backoff is asserted on its own below, where nothing winds.
 */
const abandon = (id: string) =>
  db.query(
    "update jobs set lease_expires_at=now()-interval '1 second', not_before=now() where id=$1",
    [id],
  );
/** Lapse the lease and leave the clock alone. */
const lapse = (id: string) =>
  db.query(
    "update jobs set lease_expires_at=now()-interval '1 second' where id=$1",
    [id],
  );

describe("a lapsed lease is a recovery", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const f of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await db.exec("reset role");
    await db.query("insert into auth.users(id) values ($1)", [OWNER]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'w',$2)",
      [W, OWNER],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'c')",
      [W],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,status) values ($1,$1,$1,$2,'connected')",
      [W, `UC${"a".repeat(22)}`],
    );
  });

  it("does not spend an attempt when it takes over an abandoned lease", async () => {
    const id = await job();
    await claim();
    expect(await row(id)).toMatchObject({ attempt: 1, reclaims: 0 });

    // The worker is alive and working; it simply has not reached its next
    // heartbeat. Under the old rule this was indistinguishable from a failure.
    for (let i = 1; i <= 5; i++) {
      await abandon(id);
      await claim();
      expect((await row(id)).reclaims).toBe(i);
    }
    const after = await row(id);
    expect(after.attempt).toBe(1);
    expect(after.status).toBe("running");
    expect(after.error_code).toBeNull();
  });

  it("gives a lease long enough to outlive a batch", async () => {
    const id = await job();
    await claim();
    const { rows } = await db.query<{ seconds: number }>(
      "select extract(epoch from (lease_expires_at - now()))::int seconds from jobs where id=$1",
      [id],
    );
    // The heartbeat fires once per batch, and a batch is a channel survey, a
    // network fetch and a transformer pass on one thread. Sixty seconds was a
    // bet on all three finishing inside a minute.
    expect(rows[0].seconds).toBeGreaterThan(120);
  });

  it("names thrashing as thrashing, and keeps the cause where there is one", async () => {
    const id = await job();
    await claim();
    for (let i = 0; i < 20; i++) {
      await abandon(id);
      await claim();
    }
    await abandon(id);
    await claim();
    const dead = await row(id);
    expect(dead.status).toBe("failed");
    // Not "retry_exhausted": nothing retried anything. The count is carried so
    // the reader can tell a slow job from one nothing can hold.
    expect(dead.error_code).toMatch(/^lease_thrashing:\d+$/);
  });

  it("says plainly when no worker ever reported a reason", async () => {
    const id = await job();
    await db.query(
      "update jobs set attempt=3, lease_expires_at=now()-interval '1 second' where id=$1",
      [id],
    );
    await claim();
    // The single line that would have identified this bug in a minute.
    expect((await row(id)).error_code).toBe(
      "retry_exhausted:no_error_recorded",
    );
  });

  it("the old ceiling was unreachable except by lease lapse", async () => {
    // `worker_finish` makes a failure terminal and `claim_job` selects only
    // queued or lapsed work, so a failed job is never re-claimed. That is why
    // the code named for a retry policy could only ever count thefts.
    const id = await job();
    await db.query(
      "update jobs set status='failed', error_code='source_unavailable' where id=$1",
      [id],
    );
    await claim();
    const after = await row(id);
    expect(after.status).toBe("failed");
    expect(after.attempt).toBe(0);
    expect(after.error_code).toBe("source_unavailable");
  });
});

describe("a run that never committed still ran", () => {
  const runOf = async (jobId: string) =>
    (
      await db.query<{ status: string; ended_at: string | null }>(
        "select status, ended_at from sync_runs where job_id=$1",
        [jobId],
      )
    ).rows[0];

  it("opens the run when the work is claimed, not when it first succeeds", async () => {
    const id = await job();
    expect(await runOf(id)).toBeUndefined();
    await claim();
    // The panel could previously see nothing at all until a batch landed, so a
    // job that died before committing showed the *previous* run as the last
    // one — true of that run, and misleading about today.
    expect(await runOf(id)).toMatchObject({
      status: "running",
      ended_at: null,
    });
  });

  it("shows an abandoned job as a run still open, which is what it is", async () => {
    const id = await job();
    await claim();
    await abandon(id);
    // Lease lapsed, nothing finished it. This is what a worker that died, hung
    // or was taken from mid-batch looks like, and it had no representation at
    // all before: the run row simply did not exist.
    const run = await runOf(id);
    expect(run.status).toBe("running");
    expect(run.ended_at).toBeNull();
    const { rows } = await db.query<{ stale: boolean }>(
      "select (lease_expires_at <= now()) stale from jobs where id=$1",
      [id],
    );
    expect(rows[0].stale).toBe(true);
  });

  it("keeps one run per job when a lease is taken over", async () => {
    const id = await job();
    await claim();
    await abandon(id);
    await claim();
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int n from sync_runs where job_id=$1",
      [id],
    );
    // A takeover continues the run it interrupted rather than starting a
    // second one for the same piece of work.
    expect(rows[0].n).toBe(1);
  });

  it("slows a job down only once it is being handed round", async () => {
    const id = await job();
    await claim();
    const at = async () =>
      (
        await db.query<{ ahead: number }>(
          "select extract(epoch from (not_before - now()))::int ahead from jobs where id=$1",
          [id],
        )
      ).rows[0].ahead;
    // First recovery is immediate: a worker that died should be taken over at
    // once, not punished for dying.
    await lapse(id);
    await claim();
    expect(await at()).toBeLessThanOrEqual(0);
    // The second is not. A job being handed round is a different situation
    // from a worker that crashed once. Nothing winds the clock here — that is
    // the whole point of this test.
    await lapse(id);
    await claim();
    expect(await at()).toBeGreaterThan(30);
  });
});
