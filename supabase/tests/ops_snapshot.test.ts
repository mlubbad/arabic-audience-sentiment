/**
 * Tests for the lightweight workspace_ops_snapshot RPC:
 * ensures worker health, plan usage, and stored comments per video are reported
 * quickly and accurately with strict tenant isolation.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpsSnapshotSchema } from "../../packages/contracts/src/index";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const ownerA = "10000000-0000-4000-8000-000000000001";
const ownerB = "10000000-0000-4000-8000-000000000002";
let db: PGlite;

const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};

const readOps = async (w: string) => {
  const r = await db.query<{ workspace_ops_snapshot: unknown }>(
    "select public.workspace_ops_snapshot($1)",
    [w],
  );
  return r.rows[0].workspace_ops_snapshot;
};

describe("workspace_ops_snapshot RPC", () => {
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

    for (const [w, owner, external] of [
      [A, ownerA, `UC${"a".repeat(22)}`],
      [B, ownerB, `UC${"b".repeat(22)}`],
    ]) {
      await db.query("insert into auth.users(id) values ($1)", [owner]);
      await db.query(
        "insert into workspaces(id,name,created_by) values ($1,'w',$2)",
        [w, owner],
      );
      await db.query(
        "insert into memberships(workspace_id,user_id,role) values ($1,$2,'workspace_owner')",
        [w, owner],
      );
      await db.query(
        "insert into clients(id,workspace_id,name) values ($1,$1,'c')",
        [w],
      );
      await db.query(
        "insert into channels(id,workspace_id,client_id,platform,external_channel_id,title,status) values (gen_random_uuid(),$1,$1,'youtube',$2,'ch','connected')",
        [w, external],
      );
    }
  });

  afterAll(async () => {
    await db?.close();
  });

  it("refuses access to an unrelated user", async () => {
    await as(ownerB);
    await expect(readOps(A)).rejects.toThrow(/forbidden/);
  });

  it("returns a valid OpsSnapshot for workspace owner", async () => {
    await as(ownerA);
    const data = await readOps(A);
    const parsed = OpsSnapshotSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.sync).toBeDefined();
    expect(parsed.data.plan).toBeDefined();
    expect(parsed.data.video_counts).toEqual([]);
  });

  it("reports accurate comment counts per video", async () => {
    await db.exec("reset role");
    const videoId = "00000000-0000-4000-8000-000000000010";
    const channelId = (
      await db.query<{ id: string }>(
        "select id from channels where workspace_id = $1",
        [A],
      )
    ).rows[0].id;

    await db.query(
      "insert into videos(id,workspace_id,channel_id,platform,external_video_id,title) values ($1,$2,$3,'youtube','v1','Video 1')",
      [videoId, A, channelId],
    );

    await db.query(
      `insert into comments(id,workspace_id,video_id,platform,external_comment_id,text_raw,content_hash,timestamp_precision,source,first_seen_at,last_seen_at)
       values
       (gen_random_uuid(), $1, $2, 'youtube', 'c1', 'comment 1', 'h1', 'second', 'youtube_data_api_public', now(), now()),
       (gen_random_uuid(), $1, $2, 'youtube', 'c2', 'comment 2', 'h2', 'second', 'youtube_data_api_public', now(), now())`,
      [A, videoId],
    );

    await as(ownerA);
    const data = await readOps(A);
    const parsed = OpsSnapshotSchema.parse(data);
    expect(parsed.video_counts).toEqual([{ id: videoId, total: 2 }]);
  });
});
