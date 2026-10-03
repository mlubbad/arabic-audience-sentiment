import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migration = "20261004010000_reconcile_video_comment_stats.sql";
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const ownerA = "10000000-0000-4000-8000-000000000001";
const ownerB = "10000000-0000-4000-8000-000000000002";
const channelA = "20000000-0000-4000-8000-000000000001";
const channelB = "20000000-0000-4000-8000-000000000002";
const videoA1 = "30000000-0000-4000-8000-000000000001";
const videoA2 = "30000000-0000-4000-8000-000000000002";
const videoA3 = "30000000-0000-4000-8000-000000000003";
const videoB1 = "30000000-0000-4000-8000-000000000004";
const commentA1 = "40000000-0000-4000-8000-000000000001";
const commentA2 = "40000000-0000-4000-8000-000000000002";
const commentA3 = "40000000-0000-4000-8000-000000000003";
const commentA4 = "40000000-0000-4000-8000-000000000004";
const commentB1 = "40000000-0000-4000-8000-000000000005";
const runA = "50000000-0000-4000-8000-000000000001";

type ReconcileResult = {
  workspace_id: string;
  videos_checked: number;
  rows_corrected: number;
};

type ReconcileAllResult = {
  workspaces_checked: number;
  videos_checked: number;
  rows_corrected: number;
  drifted: ReconcileResult[];
};

type Stat = {
  video_id: string;
  total: number;
  analysed: number;
  xmin?: string;
};

let db: PGlite;

async function bootstrap(database: PGlite) {
  await database.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
}

async function applyMigrations(database: PGlite) {
  for (const filename of readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await database.exec(
      readFileSync(`supabase/migrations/${filename}`, "utf8"),
    );
  }
}

async function seedWorkspace(
  workspace: string,
  owner: string,
  channel: string,
  externalChannel: string,
) {
  await db.query("insert into auth.users(id) values ($1)", [owner]);
  await db.query(
    "insert into workspaces(id,name,created_by) values ($1,'workspace',$2)",
    [workspace, owner],
  );
  await db.query(
    "insert into memberships(workspace_id,user_id,role) values ($1,$2,'workspace_owner')",
    [workspace, owner],
  );
  await db.query(
    "insert into clients(id,workspace_id,name) values ($1,$1,'client')",
    [workspace],
  );
  await db.query(
    `insert into channels(id,workspace_id,client_id,platform,external_channel_id,title,status)
     values ($1,$2,$2,'youtube',$3,'channel','connected')`,
    [channel, workspace, externalChannel],
  );
}

async function insertVideo(
  workspace: string,
  channel: string,
  video: string,
  external: string,
) {
  await db.query(
    `insert into videos(id,workspace_id,channel_id,platform,external_video_id,title)
     values ($1,$2,$3,'youtube',$4,$4)`,
    [video, workspace, channel, external],
  );
}

async function insertComment(
  id: string,
  workspace: string,
  video: string,
  external: string,
) {
  await db.query(
    `insert into comments(
       id,workspace_id,video_id,platform,external_comment_id,text_raw,
       content_hash,timestamp_precision,source,first_seen_at,last_seen_at
     ) values ($1,$2,$3,'youtube',$4,$4,$4,'second',
       'youtube_data_api_public',now(),now())`,
    [id, workspace, video, external],
  );
}

async function refreshAllStats() {
  await db.exec("reset role");
  await db.query(
    `select private.refresh_video_comment_stats(
       coalesce(jsonb_agg(jsonb_build_object(
         'workspace_id', workspace_id,
         'video_id', id
       )), '[]'::jsonb)
     ) from videos`,
  );
}

async function readStats(workspace: string, includeXmin = false) {
  await db.exec("reset role");
  const xmin = includeXmin ? ", xmin::text as xmin" : "";
  return (
    await db.query<Stat>(
      `select video_id::text as video_id, total, analysed${xmin}
       from private.video_comment_stats
       where workspace_id=$1
       order by video_id`,
      [workspace],
    )
  ).rows;
}

async function bruteForce(workspace: string) {
  await db.exec("reset role");
  return (
    await db.query<Stat>(
      `select
         v.id::text as video_id,
         count(c.id)::int as total,
         count(c.id) filter (where exists (
           select 1 from sentiment_predictions sp
           where sp.workspace_id = c.workspace_id
             and sp.comment_id = c.id
             and sp.status = 'succeeded'
         ))::int as analysed
       from videos v
       left join comments c
         on c.workspace_id = v.workspace_id
        and c.video_id = v.id
       where v.workspace_id=$1
       group by v.id
       order by v.id`,
      [workspace],
    )
  ).rows;
}

async function reconcileWorkspace(workspace: string) {
  await db.exec("reset role; set role service_role");
  const result = await db.query<{ result: ReconcileResult }>(
    "select private.reconcile_video_comment_stats($1) as result",
    [workspace],
  );
  await db.exec("reset role");
  return result.rows[0].result;
}

async function reconcileAll() {
  await db.exec("reset role; set role service_role");
  const result = await db.query<{ result: ReconcileAllResult }>(
    "select private.reconcile_all_video_comment_stats() as result",
  );
  await db.exec("reset role");
  return result.rows[0].result;
}

describe("video comment stats reconciliation", () => {
  beforeAll(async () => {
    db = new PGlite();
    await bootstrap(db);
    await applyMigrations(db);
    await db.exec("reset role");
    await seedWorkspace(A, ownerA, channelA, `UC${"a".repeat(22)}`);
    await seedWorkspace(B, ownerB, channelB, `UC${"b".repeat(22)}`);
    await insertVideo(A, channelA, videoA1, "video-a-1");
    await insertVideo(A, channelA, videoA2, "video-a-2");
    await insertVideo(A, channelA, videoA3, "video-a-3");
    await insertVideo(B, channelB, videoB1, "video-b-1");
    await insertComment(commentA1, A, videoA1, "a-1");
    await insertComment(commentA2, A, videoA1, "a-2");
    await insertComment(commentA3, A, videoA2, "a-3");
    await insertComment(commentA4, A, videoA3, "a-4");
    await insertComment(commentB1, B, videoB1, "b-1");
    await db.query(
      `insert into analysis_runs(
         id,workspace_id,model_id,revision_sha,preprocessing_version,status
       ) values ($1,$2,'model','revision','preprocessing','succeeded')`,
      [runA, A],
    );
    await db.query(
      `insert into sentiment_predictions(
         id,workspace_id,comment_id,content_hash,analysis_run_id,analysis_key,
         status,label
       ) values
       (gen_random_uuid(),$1,$2,'a-1',$4,'first','succeeded','positive'),
       (gen_random_uuid(),$1,$2,'a-1',$4,'second','succeeded','negative'),
       (gen_random_uuid(),$1,$3,'a-3',$4,'third','succeeded','neutral')`,
      [A, commentA1, commentA3, runA],
    );
  });

  beforeEach(async () => {
    await refreshAllStats();
  });

  afterAll(async () => {
    await db?.close();
  });

  it("corrects total, analysed, and missing-row drift exactly", async () => {
    await db.query(
      "update private.video_comment_stats set total=9 where workspace_id=$1 and video_id=$2",
      [A, videoA1],
    );
    await db.query(
      "update private.video_comment_stats set analysed=0 where workspace_id=$1 and video_id=$2",
      [A, videoA2],
    );
    await db.query(
      "delete from private.video_comment_stats where workspace_id=$1 and video_id=$2",
      [A, videoA3],
    );

    await expect(reconcileWorkspace(A)).resolves.toEqual({
      workspace_id: A,
      videos_checked: 3,
      rows_corrected: 3,
    });
    expect(await readStats(A)).toEqual(await bruteForce(A));
  });

  it("does not rewrite clean rows", async () => {
    const before = await readStats(A, true);
    await expect(reconcileWorkspace(A)).resolves.toEqual({
      workspace_id: A,
      videos_checked: 3,
      rows_corrected: 0,
    });
    expect(await readStats(A, true)).toEqual(before);
  });

  it("isolates one workspace and reports all drifted workspaces", async () => {
    await db.query(
      "update private.video_comment_stats set total=8 where workspace_id=$1 and video_id=$2",
      [A, videoA1],
    );
    await db.query(
      "update private.video_comment_stats set total=7 where workspace_id=$1 and video_id=$2",
      [B, videoB1],
    );

    expect((await reconcileWorkspace(A)).rows_corrected).toBe(1);
    expect(await readStats(A)).toEqual(await bruteForce(A));
    expect(await readStats(B)).not.toEqual(await bruteForce(B));

    await db.query(
      "update private.video_comment_stats set analysed=0 where workspace_id=$1 and video_id=$2",
      [A, videoA2],
    );
    const workspaceCount = (
      await db.query<{ count: number }>(
        "select count(*)::int as count from workspaces",
      )
    ).rows[0].count;
    const result = await reconcileAll();
    expect(result).toMatchObject({
      workspaces_checked: workspaceCount,
      videos_checked: 4,
      rows_corrected: 2,
    });
    expect(result.drifted.map((row) => row.workspace_id).sort()).toEqual([
      A,
      B,
    ]);
    expect(await readStats(A)).toEqual(await bruteForce(A));
    expect(await readStats(B)).toEqual(await bruteForce(B));
  });

  it("allows only service_role to execute reconciliation", async () => {
    await db.exec("reset role");
    const privileges = await db.query<{
      role: string;
      one: boolean;
      all: boolean;
    }>(
      `select role,
         has_function_privilege(role, 'private.reconcile_video_comment_stats(uuid)', 'execute') as one,
         has_function_privilege(role, 'private.reconcile_all_video_comment_stats()', 'execute') as all
       from unnest(array['anon','authenticated','service_role']) role
       order by role`,
    );
    expect(privileges.rows).toEqual([
      { role: "anon", one: false, all: false },
      { role: "authenticated", one: false, all: false },
      { role: "service_role", one: true, all: true },
    ]);

    await db.exec("set role authenticated");
    await expect(
      db.query("select private.reconcile_video_comment_stats($1)", [A]),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role; set role service_role");
    await expect(
      db.query("select private.reconcile_video_comment_stats($1)", [A]),
    ).resolves.toBeDefined();
  });

  it("refuses moving comments but permits identity-preserving upserts", async () => {
    await db.exec("reset role");
    await expect(
      db.query("update comments set video_id=$1 where id=$2", [
        videoA2,
        commentA1,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      message: "comments do not move between videos",
    });
    await expect(
      db.query("update comments set workspace_id=$1 where id=$2", [
        B,
        commentA1,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      message: "comments do not move between videos",
    });

    await expect(
      db.query(
        `insert into comments(
           id,workspace_id,video_id,platform,external_comment_id,text_raw,
           content_hash,timestamp_precision,source,first_seen_at,last_seen_at
         ) values ($1,$2,$3,'youtube','a-1','refreshed','a-1','second',
           'youtube_data_api_public',now(),now())
         on conflict (workspace_id,platform,external_comment_id) do update set
           text_raw=excluded.text_raw,
           last_seen_at=excluded.last_seen_at`,
        [commentA1, A, videoA1],
      ),
    ).resolves.toBeDefined();
  });

  it("calls the locked refresh helper instead of updating stats directly", async () => {
    await db.exec("reset role");
    const definition = (
      await db.query<{ definition: string }>(
        `select pg_get_functiondef(
           'private.reconcile_video_comment_stats(uuid)'::regprocedure
         ) as definition`,
      )
    ).rows[0].definition.toLowerCase();
    expect(definition).toContain("private.refresh_video_comment_stats");
    expect(definition).not.toContain("update private.video_comment_stats");
  });

  it("schedules the all-workspace reconcile nightly with an availability guard", () => {
    const sql = readFileSync(`supabase/migrations/${migration}`, "utf8")
      .toLowerCase()
      .replace(/\s+/g, " ");
    expect(sql).toContain("pg_available_extensions");
    expect(sql).toMatch(
      /cron\.unschedule\([^;]+jobname = 'reconcile-video-comment-stats'/,
    );
    expect(sql).toMatch(
      /cron\.schedule\(\s*'reconcile-video-comment-stats',\s*'37 2 \* \* \*'/,
    );
  });
});
