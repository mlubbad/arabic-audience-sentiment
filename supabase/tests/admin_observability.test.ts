/**
 * Phase one of the admin roadmap: the four read-only RPCs. Only the row in
 * `private.platform_admins` may call them, the same gate every hand lever
 * already passes, and each answers exactly what it says it answers — no
 * tenant's data reaching another tenant's reader, no hidden write.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const ADMIN = "10000000-0000-4000-8000-00000000000a";
const OWNER = "10000000-0000-4000-8000-00000000000b";
const OTHER = "10000000-0000-4000-8000-00000000000c";
const W = "20000000-0000-4000-8000-000000000001";
const C = "30000000-0000-4000-8000-000000000001";
let db: PGlite;
const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};
const bootstrap = async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
  // 20260919130000 drops three __pgrst_probe functions that exist only on
  // the live database (operator's debugging leftovers), never in any
  // migration — a fresh database fails on that drop. The probes are
  // recreated here so the bootstrap matches what the live database had;
  // the migration itself deserves a `drop function if exists` fix, which
  // is the migrations lane's call, not this test's.
  await db.exec(
    `create function public.__pgrst_probe() returns int language sql as 'select 42';
     create function public.__pgrst_probe2(text) returns int language sql as 'select 42';
     create function public.__pgrst_probe2(text, text[]) returns int language sql as 'select 42';`,
  );
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec("reset role");
  await db.query(
    "insert into auth.users(id,email) values ($1,$4),($2,$5),($3,$6)",
    [ADMIN, OWNER, OTHER, "admin@x.io", "owner@x.io", "other@x.io"],
  );
  await db.query("insert into private.platform_admins(user_id) values ($1)", [
    ADMIN,
  ]);
  await db.query("insert into workspaces(id,name,created_by) values ($1,'أ', $2)", [W, OWNER]);
  await db.query("insert into memberships values ($1,$2,'workspace_owner')", [W, OWNER]);
  await db.query("insert into clients(id,workspace_id,name) values ($1,$1,'أ')", [W]);
  await db.query(
    "insert into channels(id,workspace_id,client_id,external_channel_id,handle,title,status) values ($1,$2,$2,'UC_x','@x','قناة أ','connected')",
    [C, W],
  );
  await db.query(
    "insert into videos(id,workspace_id,channel_id,external_video_id,title) values ('40000000-0000-4000-8000-000000000001',$1,$2,'v','t')",
    [W, C],
  );
  await db.query(
    `insert into comments(id,workspace_id,video_id,external_comment_id,text_raw,text_plain,content_hash,timestamp_precision,source,first_seen_at)
     values ('50000000-0000-4000-8000-000000000001',$1,'40000000-0000-4000-8000-000000000001','c','ن','ن','h','second','x',now())`,
    [W],
  );
  await db.query(
    `insert into sync_runs(workspace_id,channel_id,mode,source,status,ended_at,error_code)
     values ($1,$2,'collect','youtube_data_api_public','failed',now(),'quota_exceeded')`,
    [W, C],
  );
  await db.query(
    "insert into jobs(workspace_id,channel_id,type,dedupe_key,status) values ($1,$2,'discover','k','queued')",
    [W, C],
  );
  await db.query("insert into worker_seen(workspace_id,last_seen_at) values ($1,now())", [W]);
  await db.query(
    `insert into audit_events(workspace_id,actor_id,action,target_type,target_id)
     values ($1,$2,'plan_set','plan','pilot')`,
    [W, ADMIN],
  );
};

describe("admin observability reads", () => {
  beforeAll(bootstrap);

  it("a non-admin is refused by all four; the admin is not", async () => {
    await as(OWNER);
    for (const call of [
      "select admin_users()",
      "select admin_channels()",
      "select admin_ops()",
      "select admin_audit(100)",
    ])
      await expect(db.query(call)).rejects.toThrow(/forbidden/);
    await as(ADMIN);
    for (const call of [
      "select admin_users()",
      "select admin_channels()",
      "select admin_ops()",
      "select admin_audit(100)",
    ])
      await db.query(call); // must not throw
  });

  it("admin_users: every user, with their workspace and owner counts", async () => {
    await as(ADMIN);
    const rows = (
      await db.query<{
        id: string;
        email: string | null;
        workspace_count: number;
        owner_count: number;
      }>("select (admin_users() ->> 'id')::uuid as id, admin_users() ->> 'email' as email, (admin_users() ->> 'workspace_count')::int as workspace_count, (admin_users() ->> 'owner_count')::int as owner_count")
    ).rows;
    // One row per auth.users row, even the admin who owns no workspace.
    expect(rows).toHaveLength(3);
    // The on_auth_user_created trigger gives every user a personal
    // workspace, so the owner stands in two (personal + W) and the admin
    // in one.
    const owner = rows.find((r) => r.id === OWNER)!;
    expect(owner.workspace_count).toBe(2);
    expect(owner.owner_count).toBe(2);
    const admin = rows.find((r) => r.id === ADMIN)!;
    expect(admin.workspace_count).toBe(1);
  });

  it("admin_channels: the channel with its counts and its failed run", async () => {
    await as(ADMIN);
    const r = (
      await db.query<Record<string, unknown>>("select admin_channels() as c")
    ).rows[0].c as Record<string, unknown>;
    expect(r["workspace_name"]).toBe("أ");
    expect(r["title"]).toBe("قناة أ");
    expect(r["status"]).toBe("connected");
    expect(r["video_count"]).toBe(1);
    expect(r["comment_count"]).toBe(1);
    expect(r["last_sync_status"]).toBe("failed");
    expect(r["last_sync_error"]).toBe("quota_exceeded");
  });

  it("admin_ops: the overview numbers and the failed run, in one object", async () => {
    await as(ADMIN);
    const ops = (
      await db.query<Record<string, unknown>>("select admin_ops() as o")
    ).rows[0].o as Record<string, unknown>;
    // Three personal workspaces from the bootstrap trigger, plus the named one.
    expect(ops["workspaces"]).toBe(4);
    expect(ops["channels"]).toBe(1);
    expect(ops["comments_7d"]).toBe(1);
    expect(ops["worker_fresh"]).toBe(true);
    expect(ops["jobs_open"]).toBe(1);
    expect(ops["sync_runs_7d"]).toBe(1);
    expect(ops["sync_failed_7d"]).toBe(1);
    const failed = ops["failed_runs"] as Record<string, unknown>[];
    expect(failed).toHaveLength(1);
    expect(failed[0]["workspace_name"]).toBe("أ");
    expect(failed[0]["error_code"]).toBe("quota_exceeded");
  });

  it("admin_audit: the trail with names attached, bounded at both ends", async () => {
    await as(ADMIN);
    const rows = (
      await db.query<{
        action: string;
        actor_email: string | null;
        workspace_name: string;
      }>(
        "select (admin_audit(100) ->> 'action') as action, (admin_audit(100) ->> 'actor_email') as actor_email, (admin_audit(100) ->> 'workspace_name') as workspace_name",
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("plan_set");
    expect(rows[0].actor_email).toContain("@");
    expect(rows[0].workspace_name).toBe("أ");
    await expect(db.query("select admin_audit(0)")).rejects.toThrow(/invalid_limit/);
    await expect(db.query("select admin_audit(501)")).rejects.toThrow(/invalid_limit/);
  });

  it("the reads stay reads: no function may write what it refuses to change", async () => {
    // A paranoid close: call all four as admin again, then count — nothing
    // doubled, nothing moved. Counted as the superuser: as `authenticated`
    // the RLS on audit_events would hide the rows from a reader who is not
    // a member of the workspace — which the admin is, by design, only
    // through the RPC.
    await as(ADMIN);
    await db.query("select admin_users()");
    await db.query("select admin_channels()");
    await db.query("select admin_ops()");
    await db.query("select admin_audit(100)");
    await db.exec("reset role");
    const n = (
      await db.query<{ n: number }>("select count(*)::int as n from audit_events")
    ).rows[0].n;
    expect(n).toBe(1);
  });
});
