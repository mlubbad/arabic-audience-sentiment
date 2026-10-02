import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000001";
const ADMIN = "10000000-0000-4000-8000-000000000009";
const CHANNEL = "00000000-0000-4000-8000-000000000011";
const VIDEO = "00000000-0000-4000-8000-000000000021";

let db: PGlite;

async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}

describe("WO-2 database security boundaries", () => {
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
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    }

    await db.query("insert into auth.users(id) values ($1),($2)", [
      OWNER,
      ADMIN,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'Owner',$2)",
      [W, OWNER],
    );
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
      W,
      OWNER,
    ]);
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      ADMIN,
    ]);
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'Owner')",
      [W],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id) values ($1,$2,$2,'UCTPIL6f7yNpK8yc-H3cEtFg')",
      [CHANNEL, W],
    );
    await db.query(
      "insert into videos(id,workspace_id,channel_id,external_video_id,title,reported_comment_count) values ($1,$2,$3,'video-1','Video',1)",
      [VIDEO, W, CHANNEL],
    );
    await db.query(
      "insert into subscriptions(workspace_id,plan_key,status,period_start,period_end) values ($1,'owner','active',now(),now()+interval '30 days')",
      [W],
    );
  });

  afterAll(async () => db?.close());

  it("keeps platform-admin oversight read-only outside explicit admin RPCs", async () => {
    await asUser(ADMIN);
    const read = await db.query<{ allowed: boolean }>(
      "select private.has_role($1,array['viewer']) as allowed",
      [W],
    );
    expect(read.rows[0].allowed).toBe(true);

    await expect(
      db.query("select remove_channel($1,$2)", [W, CHANNEL]),
    ).rejects.toThrow(/forbidden/);
    await expect(
      db.query(
        "select select_videos($1,$2,array[$3]::uuid[],array[]::uuid[])",
        [W, CHANNEL, VIDEO],
      ),
    ).rejects.toThrow(/forbidden/);
    await expect(
      db.query("select billing_assert_owner($1)", [W]),
    ).rejects.toThrow(/forbidden/);
  });
});
