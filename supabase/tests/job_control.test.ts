/**
 * Stopping and retrying, from the tenant's side.
 *
 * Monitoring without control is a spectator sport: a workspace could watch a
 * collection fail with no way to try again, and a job queued by mistake blocked
 * every later request until a worker happened to consume it.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const OWNER = "10000000-0000-4000-8000-000000000001";
const OUTSIDER = "10000000-0000-4000-8000-000000000002";
let db: PGlite;

const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};
const newJob = async (key: string, status = "queued", workspace = W) => {
  await db.exec("reset role");
  // A channel admits one outstanding collection, which is the rule under test
  // elsewhere. Each case here starts from a clean queue rather than fighting it.
  await db.query(
    "update jobs set status='succeeded' where workspace_id=$1 and status in ('queued','running')",
    [workspace],
  );
  const r = await db.query<{ id: string }>(
    `insert into jobs(workspace_id,channel_id,type,dedupe_key,status)
     values ($1,$1,'collect',$2,$3) returning id`,
    [workspace, key, status],
  );
  return r.rows[0].id;
};
const statusOf = async (id: string) =>
  (
    await db.query<{ status: string; error_code: string | null }>(
      "select status, error_code from jobs where id=$1",
      [id],
    )
  ).rows[0];

describe("an operator can stop and retry", () => {
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
    }
  });
  afterAll(async () => {
    await db?.close();
  });

  it("withdraws a queued job so the channel is not blocked by a mistake", async () => {
    const id = await newJob("cancel-me");
    await as(OWNER);
    await db.query("select cancel_job($1,$2)", [W, id]);
    expect(await statusOf(id)).toEqual({
      status: "cancelled",
      error_code: "cancelled_by_operator",
    });
  });

  it("refuses to cancel a job a worker is holding", async () => {
    const id = await newJob("running-one", "running");
    await as(OWNER);
    // The lease is what makes a finished job unwritable. Cancelling underneath
    // the worker would let it commit to a job the tenant believes is stopped.
    await expect(db.query("select cancel_job($1,$2)", [W, id])).rejects.toThrow(
      /job_not_cancellable/,
    );
    expect((await statusOf(id)).status).toBe("running");
  });

  it("keeps the failed attempt and queues a fresh one", async () => {
    await db.exec("reset role");
    const id = await newJob("failed-one", "failed");
    await db.query(
      'update jobs set checkpoint=\'{"video":"v9","done":["v1"]}\' where id=$1',
      [id],
    );
    await as(OWNER);
    const r = await db.query<{ retry_job: string }>(
      "select retry_job($1,$2) as retry_job",
      [W, id],
    );
    const fresh = r.rows[0].retry_job;
    expect(fresh).not.toBe(id);
    await db.exec("reset role");
    // The attempt that failed is the evidence of what went wrong; rewinding it
    // would erase exactly what somebody investigating a retry needs.
    expect((await statusOf(id)).status).toBe("failed");
    const made = await db.query<{ status: string; checkpoint: unknown }>(
      "select status, checkpoint from jobs where id=$1",
      [fresh],
    );
    expect(made.rows[0].status).toBe("queued");
    // And it resumes rather than re-reading the channel from its first video.
    expect(made.rows[0].checkpoint).toEqual({ video: "v9", done: ["v1"] });
  });

  it("refuses to retry something that has not finished", async () => {
    const id = await newJob("still-queued");
    await as(OWNER);
    await expect(db.query("select retry_job($1,$2)", [W, id])).rejects.toThrow(
      /job_not_retryable/,
    );
  });

  it("refuses both to a member of another workspace", async () => {
    const id = await newJob("not-yours", "failed");
    await as(OUTSIDER);
    // Checked against membership in the database, not by hiding a button.
    await expect(db.query("select cancel_job($1,$2)", [W, id])).rejects.toThrow(
      /forbidden/,
    );
    await expect(db.query("select retry_job($1,$2)", [W, id])).rejects.toThrow(
      /forbidden/,
    );
  });
});
