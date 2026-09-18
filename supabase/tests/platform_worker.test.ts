import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Three workspaces: A and B have a channel and a job each, C has nothing at
// all — it is there to prove a platform poll is a sighting of every
// workspace, not only of the ones with work.
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const ownerA = "10000000-0000-4000-8000-00000000000a";
const ownerB = "10000000-0000-4000-8000-00000000000b";
const ownerC = "10000000-0000-4000-8000-00000000000c";
// The gateway hashes the bearer; only the digest reaches the database. The
// platform one is registered through the service-role door, so its digest
// is sha256 of the secret below rather than a literal.
const CRED_A = "a".repeat(64);
const PLATFORM_SECRET = "platform-" + "p".repeat(55);
const PLATFORM = createHash("sha256").update(PLATFORM_SECRET).digest("hex");
const PLATFORM_REVOKED = "r".repeat(64);
let platformId = "";
let db: PGlite;

const claim = (cred: string) =>
  db.query<{ id: string; lease_token: string; workspace_id: string }>(
    "select * from private.worker_claim($1)",
    [cred],
  );
const scalar = async (sql: string, p: unknown[] = []) =>
  (await db.query<{ n: number }>(sql, p)).rows[0].n;
const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};

describe("a platform worker credential", () => {
  beforeAll(async () => {
    // pgcrypto in an `extensions` schema, as Supabase installs it: the
    // registration doors hash with extensions.digest, and this suite goes
    // through those doors rather than inserting digests by hand.
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(
      "create schema extensions; create extension pgcrypto with schema extensions;",
    );
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
    await db.query("insert into auth.users(id) values ($1),($2),($3)", [
      ownerA,
      ownerB,
      ownerC,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'A',$4),($2,'B',$5),($3,'C',$6)",
      [A, B, C, ownerA, ownerB, ownerC],
    );
    await db.query(
      "insert into memberships values ($1,$2,'workspace_owner'),($3,$4,'workspace_owner'),($5,$6,'workspace_owner')",
      [A, ownerA, B, ownerB, C, ownerC],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'A'),($2,$2,'B')",
      [A, B],
    );
    // A's channel is public and unconnected; B's is connected with a grant,
    // so the grant path can be exercised against B.
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id) values ($1,$1,$1,'UC_A')",
      [A],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,status) values ($1,$1,$1,'UC_B','connected')",
      [B],
    );
    await db.query(
      `insert into private.oauth_connections(workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
       values ($1,$1,$2,'\\x00','k1','{}','connected')`,
      [B, ownerB],
    );
    await db.query(
      "insert into plans(key,analysis_units,backfill_units,channels_limit) values ('t',100,0,2)",
    );
    for (const w of [A, B, C])
      await db.query(
        `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
         values ($1,'t','active',now()-interval '1 day',now()+interval '29 days')`,
        [w],
      );
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'a',$2)",
      [CRED_A, A],
    );
    // Registered through the door the operator will use, not inserted.
    platformId = (
      await db.query<{ id: string }>(
        "select public.svc_register_platform_worker_credential($1,'platform') as id",
        [PLATFORM_SECRET],
      )
    ).rows[0].id;
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id,status) values ($1,'old-platform',null,'revoked')",
      [PLATFORM_REVOKED],
    );
    // A's job is older than B's, so oldest-first is observable.
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key,not_before) values ($1,$1,'collect','a1',now()-interval '2 minutes')",
      [A],
    );
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key,not_before) values ($1,$1,'collect','b1',now()-interval '1 minute')",
      [B],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("registers a platform credential with no workspace, and refuses a weak secret", async () => {
    const row = await db.query<{
      workspace_id: string | null;
      status: string;
    }>(
      "select workspace_id, status from private.worker_credentials where id=$1",
      [platformId],
    );
    expect(row.rows[0]).toEqual({ workspace_id: null, status: "active" });
    await expect(
      db.query(
        "select public.svc_register_platform_worker_credential($1,'short')",
        ["s".repeat(31)],
      ),
    ).rejects.toThrow(/weak_credential/);
  });

  it("retires every platform credential but the ones named, and refuses an empty or foreign keep", async () => {
    const second = (
      await db.query<{ id: string }>(
        "select public.svc_register_platform_worker_credential($1,'platform-2') as id",
        ["second-" + "q".repeat(57)],
      )
    ).rows[0].id;
    await expect(
      db.query(
        "select public.svc_retire_platform_worker_credentials($1::uuid[])",
        [[]],
      ),
    ).rejects.toThrow(/keep_at_least_one/);
    // A scoped credential's id is not a platform credential.
    const scoped = (
      await db.query<{ id: string }>(
        "select id from private.worker_credentials where token_hash=$1",
        [CRED_A],
      )
    ).rows[0].id;
    await expect(
      db.query(
        "select public.svc_retire_platform_worker_credentials($1::uuid[])",
        [[scoped]],
      ),
    ).rejects.toThrow(/unknown_credential/);
    expect(
      await scalar(
        "select public.svc_retire_platform_worker_credentials($1::uuid[]) as n",
        [[platformId]],
      ),
    ).toBe(1);
    expect(
      (
        await db.query<{ status: string }>(
          "select status from private.worker_credentials where id=$1",
          [second],
        )
      ).rows[0].status,
    ).toBe("revoked");
  });

  it("claims across workspaces, oldest due first, and each claim is the job's own workspace", async () => {
    const first = await claim(PLATFORM);
    expect(first.rows[0].workspace_id).toBe(A);
    expect(
      (
        await db.query<{ dedupe_key: string }>(
          "select dedupe_key from jobs where id=$1",
          [first.rows[0].id],
        )
      ).rows[0].dedupe_key,
    ).toBe("a1");
    const second = await claim(PLATFORM);
    expect(second.rows[0].workspace_id).toBe(B);
    // Nothing left: a third poll is an empty answer, not an error.
    expect((await claim(PLATFORM)).rows).toHaveLength(0);
  });

  it("records the poll as a sighting of every workspace, including one with no work at all", async () => {
    // Every workspace row, not only the three seeded here: the migrations
    // seed workspaces of their own, and the poll asked all of them.
    const seen = await db.query<{ workspace_id: string }>(
      "select workspace_id from worker_seen where last_seen_at > now() - interval '1 minute' order by workspace_id",
    );
    const ids = seen.rows.map((r) => r.workspace_id);
    expect(ids).toEqual(expect.arrayContaining([A, B, C]));
    expect(ids).toHaveLength(
      await scalar("select count(*)::int as n from workspaces"),
    );
  });

  it("reads as connected on a workspace that has no scoped credential of its own", async () => {
    await as(ownerB);
    try {
      const snap = (
        await db.query<{
          dashboard_snapshot: { sync: { worker: { connected: boolean } } };
        }>("select public.dashboard_snapshot($1)", [B])
      ).rows[0].dashboard_snapshot;
      expect(snap.sync.worker.connected).toBe(true);
    } finally {
      // One connection for the whole suite: a role left set by a failing
      // assertion would refuse every later call for the wrong reason.
      await db.exec("reset role");
    }
  });

  it("refuses a revoked platform credential like any other", async () => {
    await expect(claim(PLATFORM_REVOKED)).rejects.toThrow(
      /invalid_worker_credential/,
    );
  });
});
