import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const WS_A = "00000000-0000-4000-8000-0000000000a1";
const WS_B = "00000000-0000-4000-8000-0000000000b1";
const USER_A = "10000000-0000-4000-8000-0000000000a1";
const USER_B = "10000000-0000-4000-8000-0000000000b1";
const CHANNEL_A = `UC${"A".repeat(22)}`;
const CHANNEL_B = `UC${"B".repeat(22)}`;
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
let db: PGlite;

async function lease(workspace: string, key: string) {
  await db.query(
    "update jobs set status='cancelled' where workspace_id=$1 and type='discover' and status in ('queued','running')",
    [workspace],
  );
  const { rows } = await db.query<{ id: string; lease_token: string }>(
    `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
     values ($1,$1,'discover',$2,'running',gen_random_uuid(),now()+interval '5 minutes')
     returning id, lease_token`,
    [workspace, key],
  );
  return rows[0]!;
}

const commit = (
  token: string,
  job: { id: string; lease_token: string },
  profile: unknown,
) =>
  db.query<{ result: Record<string, unknown> }>(
    "select svc_worker_commit_channel($1,$2,$3,$4) as result",
    [token, job.id, job.lease_token, JSON.stringify(profile)],
  );

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
  await db.query("insert into auth.users(id) values ($1),($2)", [
    USER_A,
    USER_B,
  ]);
  for (const [workspace, user, external] of [
    [WS_A, USER_A, CHANNEL_A],
    [WS_B, USER_B, CHANNEL_B],
  ]) {
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'workspace',$2)",
      [workspace, user],
    );
    await db.query(
      "insert into memberships(workspace_id,user_id,role) values ($1,$2,'workspace_owner')",
      [workspace, user],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'client')",
      [workspace],
    );
    await db.query(
      `insert into channels(id,workspace_id,client_id,external_channel_id,status,platform)
       values ($1,$1,$1,$2,'connected','youtube')`,
      [workspace, external],
    );
  }
  await db.query(
    `insert into private.worker_credentials(token_hash,label,workspace_id)
     values ($1,'worker-a',$2),($3,'worker-b',$4)`,
    [TOKEN_A, WS_A, TOKEN_B, WS_B],
  );
});

afterAll(async () => {
  await db.close();
});

describe("worker channel profile commits", () => {
  it("refuses another channel, malformed values and a foreign worker without writing anything", async () => {
    const job = await lease(WS_A, "profile-refused");
    const invalid = [
      null,
      [],
      { external_channel_id: CHANNEL_A, subscriber_count: "12" },
      { external_channel_id: CHANNEL_A, keywords: ["valid", 12] },
    ];
    for (const profile of invalid)
      await expect(commit(TOKEN_A, job, profile)).rejects.toThrow(
        /invalid_channel_profile/,
      );
    await expect(
      commit(TOKEN_A, job, {
        external_channel_id: CHANNEL_B,
        description: "x",
      }),
    ).rejects.toThrow(/channel_profile_mismatch/);
    await expect(
      commit(TOKEN_B, job, {
        external_channel_id: CHANNEL_A,
        description: "x",
      }),
    ).rejects.toThrow(/forbidden/);

    const { rows } = await db.query<{
      description: string | null;
      profile_observed_at: string | null;
      stats: number;
    }>(
      `select description, profile_observed_at,
        (select count(*)::int from channel_stats_daily where workspace_id=$1) stats
       from channels where id=$1`,
      [WS_A],
    );
    expect(rows[0]).toMatchObject({
      description: null,
      profile_observed_at: null,
      stats: 0,
    });
    await db.query("update jobs set status='cancelled' where id=$1", [job.id]);
  });

  it("distinguishes absent observations from observed nulls and keeps hidden subscribers unknown", async () => {
    const job = await lease(WS_A, "profile-null");
    await db.query(
      `update channels set description='old', country='TR', subscriber_count=44,
         total_view_count=500, video_count=9 where id=$1`,
      [WS_A],
    );
    await commit(TOKEN_A, job, {
      external_channel_id: CHANNEL_A,
      description: null,
      keywords: ["news", "arabic"],
      subscriber_count: null,
      subscriber_count_hidden: true,
    });
    const { rows } = await db.query<{
      description: string | null;
      country: string | null;
      subscriber_count: number | null;
      subscriber_count_hidden: boolean | null;
      total_view_count: number | null;
      video_count: number | null;
      profile_observed_at: string | null;
      stats_observed_at: string | null;
    }>(
      `select description,country,subscriber_count,subscriber_count_hidden,
              total_view_count,video_count,profile_observed_at,stats_observed_at
         from channels where id=$1`,
      [WS_A],
    );
    expect(rows[0]).toMatchObject({
      description: null,
      country: "TR",
      subscriber_count: null,
      subscriber_count_hidden: true,
      total_view_count: 500,
      video_count: 9,
    });
    expect(rows[0]!.profile_observed_at).not.toBeNull();
    expect(rows[0]!.stats_observed_at).not.toBeNull();
    expect(rows[0]!.subscriber_count).not.toBe(0);
  });

  it("upserts today's UTC statistics with the latest values", async () => {
    const job = await lease(WS_B, "profile-daily");
    await commit(TOKEN_B, job, {
      external_channel_id: CHANNEL_B,
      subscriber_count: 10,
      view_count: 100,
      video_count: 2,
    });
    await commit(TOKEN_B, job, {
      external_channel_id: CHANNEL_B,
      subscriber_count: 12,
      view_count: 140,
      video_count: 3,
    });
    const { rows } = await db.query<{
      n: number;
      subscriber_count: number;
      view_count: number;
      video_count: number;
      today: boolean;
    }>(
      `select count(*)::int n, max(subscriber_count)::int subscriber_count,
              max(view_count)::int view_count, max(video_count)::int video_count,
              bool_and(day=(now() at time zone 'utc')::date) today
         from channel_stats_daily where workspace_id=$1 and channel_id=$1`,
      [WS_B],
    );
    expect(rows[0]).toEqual({
      n: 1,
      subscriber_count: 12,
      view_count: 140,
      video_count: 3,
      today: true,
    });
  });
});

describe("channel profile access and retention", () => {
  it("shows an authenticated member only their workspace's daily statistics", async () => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      USER_B,
    ]);
    const { rows } = await db.query<{ workspace_id: string }>(
      "select workspace_id from channel_stats_daily order by workspace_id",
    );
    await db.exec("reset role");
    expect(rows.map((row) => row.workspace_id)).toEqual([WS_B]);
  });

  it("purges expired text and daily statistics while keeping recent observations", async () => {
    await db.query(
      `update channels set description='expired',keywords=array['old'],topic_categories=array['old'],
         profile_observed_at=now()-interval '31 days' where id=$1`,
      [WS_A],
    );
    await db.query(
      `update channels set description='recent',keywords=array['new'],topic_categories=array['new'],
         profile_observed_at=now()-interval '29 days' where id=$1`,
      [WS_B],
    );
    await db.query(
      `insert into channel_stats_daily(workspace_id,channel_id,day,subscriber_count,observed_at)
       values ($1,$1,(now() at time zone 'utc')::date-31,1,now()-interval '31 days')
       on conflict (workspace_id,channel_id,day) do nothing`,
      [WS_A],
    );
    await db.query("select private.purge_channel_profile('30 days','30 days')");
    const { rows } = await db.query<{
      id: string;
      description: string | null;
      keywords: string[] | null;
      topic_categories: string[] | null;
    }>(
      `select id,description,keywords,topic_categories from channels
       where id in ($1,$2) order by id`,
      [WS_A, WS_B],
    );
    expect(rows).toEqual([
      { id: WS_A, description: null, keywords: null, topic_categories: null },
      {
        id: WS_B,
        description: "recent",
        keywords: ["new"],
        topic_categories: ["new"],
      },
    ]);
    const old = await db.query<{ n: number }>(
      "select count(*)::int n from channel_stats_daily where day < (now() at time zone 'utc')::date-30",
    );
    expect(old.rows[0]!.n).toBe(0);
  });
});
