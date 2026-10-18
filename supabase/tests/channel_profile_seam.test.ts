/** A profile built by Python crosses the TypeScript contract into the real SQL. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ChannelProfileCommit } from "../../packages/contracts/src/index";

const WORKSPACE = "00000000-0000-4000-8000-000000000021";
const USER = "10000000-0000-4000-8000-000000000021";
const TOKEN_HASH = "2".repeat(64);
const profile = JSON.parse(
  readFileSync("workers/python/tests/fixtures/golden_channel.json", "utf8"),
) as Record<string, unknown>;
let db: PGlite;
let job: { id: string; lease_token: string };

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
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.exec("reset role");
  await db.query("insert into auth.users(id) values ($1)", [USER]);
  await db.query(
    "insert into workspaces(id,name,created_by) values ($1,'workspace',$2)",
    [WORKSPACE, USER],
  );
  await db.query(
    "insert into memberships(workspace_id,user_id,role) values ($1,$2,'workspace_owner')",
    [WORKSPACE, USER],
  );
  await db.query(
    "insert into clients(id,workspace_id,name) values ($1,$1,'client')",
    [WORKSPACE],
  );
  await db.query(
    `insert into channels(id,workspace_id,client_id,external_channel_id,status,platform)
     values ($1,$1,$1,$2,'connected','youtube')`,
    [WORKSPACE, profile.external_channel_id],
  );
  await db.query(
    "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'worker',$2)",
    [TOKEN_HASH, WORKSPACE],
  );
  const result = await db.query<{ id: string; lease_token: string }>(
    `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
     values ($1,$1,'discover','channel-profile-seam','running',gen_random_uuid(),now()+interval '5 minutes')
     returning id,lease_token`,
    [WORKSPACE],
  );
  job = result.rows[0]!;
});

afterAll(async () => {
  await db.close();
});

it("stores the Python-built profile and one daily statistics row", async () => {
  const envelope = ChannelProfileCommit.parse({
    job_id: job.id,
    lease_token: job.lease_token,
    profile,
  });
  await db.query("select svc_worker_commit_channel($1,$2,$3,$4)", [
    TOKEN_HASH,
    envelope.job_id,
    envelope.lease_token,
    JSON.stringify(envelope.profile),
  ]);
  const channel = await db.query<{
    description: string;
    country: string;
    default_language: string;
    channel_published_at: string;
    keywords: string[];
    topic_categories: string[];
    subscriber_count: number;
    subscriber_count_hidden: boolean;
    total_view_count: number;
    video_count: number;
  }>(
    `select description,country,default_language,channel_published_at,keywords,
            topic_categories,subscriber_count,subscriber_count_hidden,
            total_view_count,video_count from channels where id=$1`,
    [WORKSPACE],
  );
  expect(channel.rows[0]).toMatchObject({
    description: "قناة للوصفات",
    country: "TR",
    default_language: "ar",
    keywords: ["طبخ", "حلويات شرقية", "وصفات"],
    subscriber_count: 1200,
    subscriber_count_hidden: false,
    total_view_count: 34000,
    video_count: 56,
  });
  expect(new Date(channel.rows[0]!.channel_published_at).toISOString()).toBe(
    "2020-01-02T03:04:05.000Z",
  );
  expect(channel.rows[0]!.topic_categories).toEqual([
    "https://en.wikipedia.org/wiki/Food",
    "https://en.wikipedia.org/wiki/Lifestyle_(sociology)",
  ]);
  const stats = await db.query<{
    count: number;
    subscriber_count: number;
    view_count: number;
    video_count: number;
  }>(
    `select count(*)::int count,max(subscriber_count)::int subscriber_count,
            max(view_count)::int view_count,max(video_count)::int video_count
       from channel_stats_daily where workspace_id=$1 and channel_id=$1`,
    [WORKSPACE],
  );
  expect(stats.rows[0]).toEqual({
    count: 1,
    subscriber_count: 1200,
    view_count: 34000,
    video_count: 56,
  });
});
