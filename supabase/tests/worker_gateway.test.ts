import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const ownerA = "10000000-0000-4000-8000-000000000001";
const ownerB = "10000000-0000-4000-8000-000000000002";
// The gateway hashes the real bearer token; only the digest reaches the database.
const CRED_A = "a".repeat(64);
const CRED_B = "b".repeat(64);
const CRED_REVOKED = "c".repeat(64);
let db: PGlite;

const claim = (cred: string) =>
  db.query<{ id: string; lease_token: string; workspace_id: string }>(
    "select * from private.worker_claim($1)",
    [cred],
  );
const scalar = async (sql: string, p: unknown[] = []) =>
  (await db.query<{ n: number }>(sql, p)).rows[0].n;

describe("scoped worker gateway and plan limits", () => {
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
    await db.query("insert into auth.users(id) values ($1),($2)", [
      ownerA,
      ownerB,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'A',$3),($2,'B',$4)",
      [A, B, ownerA, ownerB],
    );
    await db.query(
      "insert into memberships values ($1,$2,'workspace_owner'),($3,$4,'workspace_owner')",
      [A, ownerA, B, ownerB],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'A'),($2,$2,'B')",
      [A, B],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id) values ($1,$1,$1,'UC_A'),($2,$2,$2,'UC_B')",
      [A, B],
    );
    // Two channels allowed, and a sync no more often than every 60 minutes.
    await db.query(
      "insert into plans(key,analysis_units,backfill_units,channels_limit) values ('t',100,0,2)",
    );
    await db.query(
      "update plans set min_sync_interval_minutes=60 where key='t'",
    );
    for (const w of [A, B])
      await db.query(
        `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
         values ($1,'t','active',now()-interval '1 day',now()+interval '29 days')`,
        [w],
      );
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'a',$2),($3,'b',$4)",
      [CRED_A, A, CRED_B, B],
    );
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id,status) values ($1,'old',$2,'revoked')",
      [CRED_REVOKED, A],
    );
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'collect','a1')",
      [A],
    );
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'collect','b1')",
      [B],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("refuses an unknown or revoked credential", async () => {
    await expect(claim("d".repeat(64))).rejects.toThrow(
      /invalid_worker_credential/,
    );
    await expect(claim(CRED_REVOKED)).rejects.toThrow(
      /invalid_worker_credential/,
    );
  });

  it("claims only within the workspace its credential is scoped to", async () => {
    const a = await claim(CRED_A);
    // The workspace comes from the credential. There is no workspace argument
    // to pass, so a worker cannot reach into another tenant's queue.
    expect(a.rows[0].workspace_id).toBe(A);
    expect(
      (
        await db.query<{ dedupe_key: string }>(
          "select dedupe_key from jobs where id=$1",
          [a.rows[0].id],
        )
      ).rows[0].dedupe_key,
    ).toBe("a1");
    // B's job is still waiting: A's worker never saw it.
    expect(
      await scalar(
        "select count(*)::int as n from jobs where workspace_id=$1 and status='queued'",
        [B],
      ),
    ).toBe(1);
  });

  it("will not heartbeat, finish or commit another workspace's job", async () => {
    const a = await db.query<{ id: string; lease_token: string }>(
      "select id, lease_token from jobs where workspace_id=$1 and status='running'",
      [A],
    );
    const { id, lease_token } = a.rows[0];
    for (const call of [
      db.query("select private.worker_heartbeat($1,$2,$3)", [
        CRED_B,
        id,
        lease_token,
      ]),
      db.query("select private.worker_finish($1,$2,$3,$4,$5)", [
        CRED_B,
        id,
        lease_token,
        "succeeded",
        null,
      ]),
      db.query("select private.worker_commit_batch($1,$2,$3,$4,$5,$6)", [
        CRED_B,
        id,
        lease_token,
        "x",
        "0".repeat(64),
        JSON.stringify({
          external_video_id: "v",
          video_title: null,
          checkpoint: {},
          outcome: "partial",
          comments: [],
          predictions: [],
        }),
      ]),
    ])
      await expect(call).rejects.toThrow(/forbidden|invalid_worker_credential/);
  });

  it("takes an explicit terminal result and never invents a success", async () => {
    const a = await db.query<{ id: string; lease_token: string }>(
      "select id, lease_token from jobs where workspace_id=$1 and status='running'",
      [A],
    );
    const { id, lease_token } = a.rows[0];
    // A worker may not declare an outcome that is not terminal.
    await expect(
      db.query("select private.worker_finish($1,$2,$3,$4,$5)", [
        CRED_A,
        id,
        lease_token,
        "running",
        null,
      ]),
    ).rejects.toThrow(/invalid_outcome/);
    await db.query("select private.worker_finish($1,$2,$3,$4,$5)", [
      CRED_A,
      id,
      lease_token,
      "blocked",
      "source_access_denied",
    ]);
    const done = await db.query<{
      status: string;
      error_code: string;
      lease_token: string | null;
    }>("select status, error_code, lease_token from jobs where id=$1", [id]);
    expect(done.rows[0]).toMatchObject({
      status: "blocked",
      error_code: "source_access_denied",
    });
    // The lease is released, so a finished job cannot be written to again.
    expect(done.rows[0].lease_token).toBeNull();
    await expect(
      db.query("select private.worker_heartbeat($1,$2,$3)", [
        CRED_A,
        id,
        lease_token,
      ]),
    ).rejects.toThrow(/lease_lost/);
  });

  it("stops a tenant from exceeding its channel allowance", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ownerA,
    ]);
    await db.exec("set role authenticated");
    // The plan allows two channels and one already exists.
    await db.query("select public.register_channel($1,$1,$2)", [
      A,
      "UC" + "x".repeat(22),
    ]);
    await expect(
      db.query("select public.register_channel($1,$1,$2)", [
        A,
        "UC" + "y".repeat(22),
      ]),
    ).rejects.toThrow(/channel_limit_reached/);
    await db.exec("reset role");
  });

  it("stops a tenant from syncing more often than its plan allows", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ownerB,
    ]);
    await db.exec("set role authenticated");
    // A collect job was seeded for the claim tests. It is older than this
    // scenario, so age it rather than let it trip the limit under test.
    await db.exec("reset role");
    await db.query(
      "update jobs set created_at = now() - interval '2 hours' where workspace_id=$1",
      [B],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ownerB,
    ]);
    await db.exec("set role authenticated");
    // Workspace B already has the collect job the claim tests seeded, and it is
    // still queued — so this request is answered with that one rather than
    // making a second. That is the rule under test, seen from the other side.
    const queued = await db.query(
      "select public.enqueue_sync($1,$1,$2) as id",
      [B, "sync-1"],
    );
    // Make that outstanding job recent, so the rate limit would also have
    // something to complain about. "Already queued" must win: refusing with
    // sync_too_soon would be a wrong answer to a reasonable question, and the
    // operator would go looking for a limit that is not the reason.
    await db.exec("reset role");
    const queuedId = (queued.rows[0] as { id: string }).id;
    await db.query("update jobs set created_at=now() where id=$1", [queuedId]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ownerB,
    ]);
    await db.exec("set role authenticated");
    // A different key, so by the key's own definition this is a new request.
    // It is still answered with the job already waiting: a channel has one
    // collection outstanding, and asking twice does not make two.
    const again = await db.query("select public.enqueue_sync($1,$1,$2) as id", [
      B,
      "sync-2",
    ]);
    expect(again.rows).toEqual(queued.rows);
    // The same key still returns the same job: idempotency is not rate limiting.
    await expect(
      db.query("select public.enqueue_sync($1,$1,$2)", [B, "sync-1"]),
    ).resolves.toBeTruthy();

    // With nothing outstanding, the rate limit is what remains, and it still
    // refuses. Finishing the job is what makes a new request possible at all.
    await db.exec("reset role");
    // Finished, and finished recently: the rate limit measures age, so a job
    // aged two hours by the setup above would not trip it and the assertion
    // below would prove nothing.
    await db.query(
      "update jobs set status='succeeded', created_at=now() where id=$1",
      [queuedId],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ownerB,
    ]);
    await db.exec("set role authenticated");
    await expect(
      db.query("select public.enqueue_sync($1,$1,$2)", [B, "sync-3"]),
    ).rejects.toThrow(/sync_too_soon/);
    await db.exec("reset role");
  });

  it("refuses a second outstanding collection even inserted directly", async () => {
    // The function returns the existing job, but a caller who reaches the
    // table without going through it must be refused too — otherwise the rule
    // lives in a code path rather than in the data.
    await db.exec("reset role");
    await db.query(
      "update jobs set status='cancelled' where workspace_id=$1 and type='collect'",
      [B],
    );
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values($1,$1,'collect','direct-1')",
      [B],
    );
    await expect(
      db.query(
        "insert into jobs(workspace_id,channel_id,type,dedupe_key) values($1,$1,'collect','direct-2')",
        [B],
      ),
    ).rejects.toThrow(/jobs_one_outstanding_collect/);
    // A finished one is not outstanding, so the next request is allowed.
    await db.query(
      "update jobs set status='succeeded' where workspace_id=$1 and dedupe_key='direct-1'",
      [B],
    );
    await expect(
      db.query(
        "insert into jobs(workspace_id,channel_id,type,dedupe_key) values($1,$1,'collect','direct-3')",
        [B],
      ),
    ).resolves.toBeTruthy();
  });

  it("records a run for a job that finished having found nothing", async () => {
    // public.sync_runs is what the operations page reads. Nothing wrote it, so
    // four successful collections still produced "no sync has run". A job that
    // ended blocked did run — it is the run that found nothing — and the panel
    // has to be able to tell that apart from never having tried.
    await db.exec("reset role");
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'collect','run-record-1')",
      [A],
    );
    const claimed = await claim(CRED_A);
    const { id, lease_token } = claimed.rows[0];
    await db.query("select private.worker_finish($1,$2,$3,$4,$5)", [
      CRED_A,
      id,
      lease_token,
      "blocked",
      "comments_disabled",
    ]);
    const run = await db.query<{
      status: string;
      error_code: string | null;
      ended_at: string | null;
      mode: string;
    }>(
      "select status, error_code, ended_at, mode from sync_runs where job_id=$1",
      [id],
    );
    expect(run.rows).toHaveLength(1);
    expect(run.rows[0].status).toBe("blocked");
    // The reason travels with the record, or the run says only that it failed.
    expect(run.rows[0].error_code).toBe("comments_disabled");
    expect(run.rows[0].ended_at).not.toBeNull();
    expect(run.rows[0].mode).toBe("collect");
  });

  it("does not leave a cancelled job's run open for ever", async () => {
    // sync_runs did not admit 'cancelled' while jobs did, so closing one was
    // impossible and the row would have stayed 'running' indefinitely — a
    // worker that looks permanently busy.
    await db.exec("reset role");
    await db.query(
      "update jobs set status='cancelled' where workspace_id=$1 and type='collect' and status in ('queued','running')",
      [A],
    );
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'collect','run-record-2')",
      [A],
    );
    const claimed = await claim(CRED_A);
    const { id, lease_token } = claimed.rows[0];
    await expect(
      db.query("select private.worker_finish($1,$2,$3,$4,$5)", [
        CRED_A,
        id,
        lease_token,
        "cancelled",
        "superseded",
      ]),
    ).resolves.toBeTruthy();
    const run = await db.query<{ status: string; ended_at: string | null }>(
      "select status, ended_at from sync_runs where job_id=$1",
      [id],
    );
    expect(run.rows[0].status).toBe("cancelled");
    expect(run.rows[0].ended_at).not.toBeNull();
  });

  it("keeps the credential table away from tenants entirely", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ownerA,
    ]);
    await db.exec("set role authenticated");
    await expect(
      db.query("select * from private.worker_credentials"),
    ).rejects.toThrow();
    await expect(claim(CRED_A)).rejects.toThrow();
    await db.exec("reset role");
  });
});
