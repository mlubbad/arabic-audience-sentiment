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
});
