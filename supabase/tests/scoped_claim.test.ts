/**
 * A claim names the kinds of work its caller can run.
 *
 * An operator's one-shot collection run once claimed whatever job was oldest
 * and ran it as a collection. The oldest job that day was a queued `analyse`
 * job: it was claimed, held, and finished «succeeded» with nothing classified
 * — recorded as work done that nobody had done. The claim now carries the
 * caller's kinds, and the database never hands across the boundary.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000001";
let db: PGlite;

const enqueue = async (type: string, key: string) =>
  (
    await db.query<{ id: string; type: string }>(
      `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,not_before)
       values ($1,$1,$2,$3,'queued',now()) returning id, type`,
      [W, type, key],
    )
  ).rows[0];
/** Claim as a caller able to run the named kinds; null is no preference. */
const claim = async (types: string[] | null) =>
  types === null
    ? (
        await db.query<{ id: string; type: string }>(
          "select * from private.claim_job($1)",
          [W],
        )
      ).rows
    : (
        await db.query<{ id: string; type: string }>(
          "select * from private.claim_job($1, $2)",
          [W, types],
        )
      ).rows;

describe("a claim scoped to the work its caller can run", () => {
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
      "insert into memberships(workspace_id,user_id,role) values ($1,$2,'workspace_owner') on conflict do nothing",
      [W, OWNER],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'c')",
      [W],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,status) values ($1,$1,$1,$2,'connected')",
      [W, `UC${"b".repeat(22)}`],
    );
  });
  // The one outstanding collect per channel is a real constraint, and the
  // jobs each test enqueues stay outstanding after its claim runs. Without a
  // clean slate the second collect job any later test enqueues is refused —
  // a failure about the previous test's rows, not about the claim.
  afterEach(async () => {
    await db.exec("delete from sync_runs; delete from jobs;");
  });

  it("never hands a collection run the topics job that is older", async () => {
    const analyse = await enqueue("analyse", "k-analyse-1");
    const collect = await enqueue("collect", "k-collect-1");
    const got = await claim(["collect"]);
    // The analyse job is older and due, and the claim leaves it alone: a
    // worker without a classifier would otherwise hold its lease and finish
    // it with nothing classified.
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe(collect.id);
    expect(got[0].id).not.toBe(analyse.id);
  });

  it("hands a topics worker the analyse job it asked for", async () => {
    await enqueue("collect", "k-collect-2");
    const analyse = await enqueue("analyse", "k-analyse-2");
    const got = await claim(["analyse"]);
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe(analyse.id);
  });

  it("orders what it can run by due time, not by type", async () => {
    const first = await enqueue("discover", "k-discover-1");
    // Due time decides, so the earlier job is made strictly earlier: two
    // inserts in the same microsecond would order by id, which is random.
    await db.query(
      "update jobs set not_before = now() - interval '1 minute' where id=$1",
      [first.id],
    );
    const second = await enqueue("collect", "k-collect-3");
    // One claim hands out one job — the oldest due one it can run — so the
    // order shows across two claims: the discover job was due first, and the
    // collect job must not jump it merely because the caller asked for both.
    const gotFirst = await claim(["collect", "discover"]);
    const gotSecond = await claim(["collect", "discover"]);
    expect([gotFirst[0].id, gotSecond[0].id]).toEqual([first.id, second.id]);
  });

  it("claims everything when no kind is named", async () => {
    await enqueue("analyse", "k-analyse-3");
    const got = await claim(null);
    // The unscoped call is what a worker able to run every kind still sends.
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe("analyse");
  });

  it("the two-argument RPC door exists and still derives the tenant", async () => {
    await enqueue("collect", "k-collect-4");
    // The scoped RPC resolves the workspace from the credential first: an
    // unknown credential is refused before any job is read, exactly like the
    // single-argument door beside it.
    await expect(
      db.query("select * from svc_worker_claim($1, $2)", [
        "no-such-credential-hash",
        ["collect"],
      ]),
    ).rejects.toThrow(/invalid_worker_credential/);
  });

  it("interleaves claims fairly across tenants so one workspace does not starve others", async () => {
    const W2 = "00000000-0000-4000-8000-000000000002";
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'w2',$2) on conflict do nothing",
      [W2, OWNER],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'c2') on conflict do nothing",
      [W2],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,status) values ($1,$1,$1,$2,'connected') on conflict do nothing",
      [W2, `UC${"c".repeat(22)}`],
    );

    const CH1_2 = "00000000-0000-4000-8000-000000000012";
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,status) values ($1,$2,$2,$3,'connected') on conflict do nothing",
      [CH1_2, W, `UC${"d".repeat(22)}`],
    );

    // Tenant 1 enqueues 2 collect jobs across its 2 channels
    const t1_job1 = (
      await db.query<{ id: string }>(
        `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,not_before)
         values ($1,$1,'collect','k-fair-1','queued',now() - interval '2 minutes') returning id`,
        [W],
      )
    ).rows[0];
    const t1_job2 = (
      await db.query<{ id: string }>(
        `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,not_before)
         values ($1,$2,'collect','k-fair-2','queued',now() - interval '1 minute') returning id`,
        [W, CH1_2],
      )
    ).rows[0];

    // Tenant 2 enqueues 1 collect job (slightly newer)
    const t2_job1 = (
      await db.query<{ id: string }>(
        `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,not_before)
         values ($1,$1,'collect','k-fair-3','queued',now()) returning id`,
        [W2],
      )
    ).rows[0];

    // Platform worker claims without tenant constraint (w = null)
    // Claim 1 should get t1_job1 (oldest)
    const claim1 = (
      await db.query<{ id: string }>(
        "select * from private.claim_job(null, null)",
      )
    ).rows;
    expect(claim1[0].id).toBe(t1_job1.id);

    // Now Tenant 1 has 1 job 'running' (lease active).
    // Tenant 2 has 0 running jobs.
    // Claim 2 MUST claim Tenant 2's job instead of Tenant 1's second job!
    const claim2 = (
      await db.query<{ id: string }>(
        "select * from private.claim_job(null, null)",
      )
    ).rows;
    expect(claim2[0].id).toBe(t2_job1.id);

    // Claim 3 will then claim Tenant 1's second job
    const claim3 = (
      await db.query<{ id: string }>(
        "select * from private.claim_job(null, null)",
      )
    ).rows;
    expect(claim3[0].id).toBe(t1_job2.id);
  });
});
