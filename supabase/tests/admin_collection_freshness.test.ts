import { PGlite } from "@electric-sql/pglite";
import { AdminChannelsSchema } from "@sentiment/contracts";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000002";
const WORKSPACE = "20000000-0000-4000-8000-000000000001";
const MIXED = "30000000-0000-4000-8000-000000000001";
const FAILED = "30000000-0000-4000-8000-000000000002";
const NEVER = "30000000-0000-4000-8000-000000000003";

let db: PGlite;

async function asAdmin() {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ADMIN,
  ]);
  await db.exec("set role authenticated");
}

describe("admin channel collection freshness", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
      create function public.__pgrst_probe() returns int language sql as 'select 42';
      create function public.__pgrst_probe2(text) returns int language sql as 'select 42';
      create function public.__pgrst_probe2(text, text[]) returns int language sql as 'select 42';`);
    for (const filename of readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      await db.exec(readFileSync(`supabase/migrations/${filename}`, "utf8"));
    }

    await db.exec("reset role");
    await db.query(
      "insert into auth.users(id,email) values ($1,'admin@example.test'),($2,'owner@example.test')",
      [ADMIN, OWNER],
    );
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      ADMIN,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'freshness workspace',$2)",
      [WORKSPACE, OWNER],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'freshness client')",
      [WORKSPACE],
    );
    await db.query(
      `insert into channels(id,workspace_id,client_id,external_channel_id,title,status)
       values ($1,$4,$4,'mixed','mixed runs','connected'),
              ($2,$4,$4,'failed','failed only','connected'),
              ($3,$4,$4,'never','no runs','connected')`,
      [MIXED, FAILED, NEVER, WORKSPACE],
    );
    await db.query(
      `insert into videos(id,workspace_id,channel_id,external_video_id,title)
       values ('40000000-0000-4000-8000-000000000001',$1,$2,'v1','one'),
              ('40000000-0000-4000-8000-000000000002',$1,$2,'v2','two')`,
      [WORKSPACE, MIXED],
    );
    await db.query(
      `insert into comments(id,workspace_id,video_id,external_comment_id,text_raw,text_plain,content_hash,timestamp_precision,source)
       values (gen_random_uuid(),$1,'40000000-0000-4000-8000-000000000001','c1','one','one','h1','second','test'),
              (gen_random_uuid(),$1,'40000000-0000-4000-8000-000000000001','c2','two','two','h2','second','test'),
              (gen_random_uuid(),$1,'40000000-0000-4000-8000-000000000002','c3','three','three','h3','second','test')`,
      [WORKSPACE],
    );
    await db.query(
      `insert into sync_runs(workspace_id,channel_id,mode,source,started_at,ended_at,status,error_code)
       values
         ($1,$2,'collect','test','2026-10-01T10:00:00Z','2026-10-01T10:05:00Z','succeeded',null),
         ($1,$2,'collect','test','2026-10-02T10:00:00Z','2026-10-02T10:10:00Z','partial','quota_exceeded'),
         ($1,$2,'collect','test','2026-10-03T10:00:00Z','2026-10-03T10:01:00Z','failed','provider_error'),
         ($1,$2,'discover','test','2026-10-04T10:00:00Z','2026-10-04T10:02:00Z','succeeded',null),
         ($1,$3,'collect','test','2026-10-05T10:00:00Z','2026-10-05T10:01:00Z','failed','provider_error')`,
      [WORKSPACE, MIXED, FAILED],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  it("keeps the latest successful or partial collection apart from the latest sync", async () => {
    await asAdmin();
    const raw = (
      await db.query<{ row: unknown }>("select admin_channels() as row")
    ).rows.map(({ row }) => row);
    const rows = AdminChannelsSchema.parse(raw);
    const mixed = rows.find((row) => row.id === MIXED)!;
    expect(Date.parse(mixed.last_collect_ok_at!)).toBe(
      Date.parse("2026-10-02T10:10:00Z"),
    );
    expect(Date.parse(mixed.last_sync_at!)).toBe(
      Date.parse("2026-10-04T10:00:00Z"),
    );
    expect(mixed.last_sync_status).toBe("succeeded");
    expect(mixed.video_count).toBe(2);
    expect(mixed.comment_count).toBe(3);
    expect(
      rows.find((row) => row.id === FAILED)!.last_collect_ok_at,
    ).toBeNull();
    expect(rows.find((row) => row.id === NEVER)!.last_collect_ok_at).toBeNull();
  });

  it("keeps the admin channel contract strict", async () => {
    await asAdmin();
    const raw = (
      await db.query<{ row: Record<string, unknown> }>(
        "select admin_channels() as row",
      )
    ).rows.map(({ row }) => row);
    expect(() => AdminChannelsSchema.parse(raw)).not.toThrow();
    expect(() =>
      AdminChannelsSchema.parse([{ ...raw[0], unexpected: true }]),
    ).toThrow();
  });
});
