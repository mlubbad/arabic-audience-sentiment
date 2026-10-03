/**
 * The ops snapshot reads exact, precomputed per-video counters. These tests
 * exercise statement-sized writes because the production adoption path copies
 * a whole channel at once.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpsSnapshotSchema } from "../../packages/contracts/src/index";

const migration = "20261003120000_ops_snapshot_video_stats.sql";
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";
const ownerA = "10000000-0000-4000-8000-000000000001";
const ownerB = "10000000-0000-4000-8000-000000000002";
const ownerC = "10000000-0000-4000-8000-000000000003";
const admin = "10000000-0000-4000-8000-00000000000a";
const channelA = "20000000-0000-4000-8000-000000000001";
const channelB = "20000000-0000-4000-8000-000000000002";
const channelC = "20000000-0000-4000-8000-000000000003";
const videoA1 = "30000000-0000-4000-8000-000000000001";
const videoA2 = "30000000-0000-4000-8000-000000000002";
const videoB = "30000000-0000-4000-8000-000000000003";
const commentA1 = "40000000-0000-4000-8000-000000000001";
const commentA2 = "40000000-0000-4000-8000-000000000002";
const commentA3 = "40000000-0000-4000-8000-000000000003";
const commentB = "40000000-0000-4000-8000-000000000004";
const runA = "50000000-0000-4000-8000-000000000001";
const runB = "50000000-0000-4000-8000-000000000002";
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

async function applyMigrations(
  database: PGlite,
  include: (filename: string) => boolean = () => true,
) {
  for (const filename of readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql") && include(name))
    .sort()) {
    await database.exec(
      readFileSync(`supabase/migrations/${filename}`, "utf8"),
    );
  }
}

async function as(database: PGlite, user: string) {
  await database.exec("reset role");
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [
    user,
  ]);
  await database.exec("set role authenticated");
}

async function seedWorkspace(
  database: PGlite,
  workspace: string,
  owner: string,
  channel: string,
  externalChannel: string,
  status = "connected",
) {
  await database.query("insert into auth.users(id) values ($1)", [owner]);
  await database.query(
    "insert into workspaces(id,name,created_by) values ($1,'workspace',$2)",
    [workspace, owner],
  );
  await database.query(
    "insert into memberships(workspace_id,user_id,role) values ($1,$2,'workspace_owner')",
    [workspace, owner],
  );
  await database.query(
    "insert into clients(id,workspace_id,name) values ($1,$1,'client')",
    [workspace],
  );
  await database.query(
    `insert into channels(id,workspace_id,client_id,platform,external_channel_id,title,status)
     values ($1,$2,$2,'youtube',$3,'channel',$4)`,
    [channel, workspace, externalChannel, status],
  );
}

async function insertVideo(
  database: PGlite,
  workspace: string,
  channel: string,
  video: string,
  external: string,
) {
  await database.query(
    `insert into videos(id,workspace_id,channel_id,platform,external_video_id,title)
     values ($1,$2,$3,'youtube',$4,$4)`,
    [video, workspace, channel, external],
  );
}

async function insertComments(
  database: PGlite,
  rows: { id: string; workspace: string; video: string; external: string }[],
) {
  await database.query(
    `insert into comments(
       id,workspace_id,video_id,platform,external_comment_id,text_raw,
       content_hash,timestamp_precision,source,first_seen_at,last_seen_at
     )
     select
       r.id::uuid,r.workspace::uuid,r.video::uuid,'youtube',r.external,
       r.external,r.external,'second','youtube_data_api_public',now(),now()
     from jsonb_to_recordset($1::jsonb)
       as r(id text, workspace text, video text, external text)`,
    [JSON.stringify(rows)],
  );
}

async function insertRun(database: PGlite, workspace: string, run: string) {
  await database.query(
    `insert into analysis_runs(
       id,workspace_id,model_id,revision_sha,preprocessing_version,status
     ) values ($1,$2,'model','revision','preprocessing','succeeded')`,
    [run, workspace],
  );
}

async function readOps(database: PGlite, workspace: string, owner: string) {
  await as(database, owner);
  const result = await database.query<{ workspace_ops_snapshot: unknown }>(
    "select public.workspace_ops_snapshot($1)",
    [workspace],
  );
  return OpsSnapshotSchema.parse(result.rows[0].workspace_ops_snapshot);
}

async function bruteForce(database: PGlite, workspace: string) {
  await database.exec("reset role");
  const result = await database.query<{
    id: string;
    total: number;
    analysed: number;
  }>(
    `select
       v.id::text,
       count(c.id)::int as total,
       count(c.id) filter (where exists (
         select 1 from sentiment_predictions sp
         where sp.workspace_id = c.workspace_id
           and sp.comment_id = c.id
           and sp.status = 'succeeded'
       ))::int as analysed
     from videos v
     left join comments c
       on c.workspace_id = v.workspace_id and c.video_id = v.id
     where v.workspace_id = $1
     group by v.id
     order by v.id`,
    [workspace],
  );
  return result.rows;
}

async function expectParity(
  database: PGlite,
  workspace: string,
  owner: string,
) {
  const expected = await bruteForce(database, workspace);
  const snapshot = await readOps(database, workspace, owner);
  const actual = [...snapshot.video_counts].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  expect(actual).toEqual(expected);
  expect(snapshot.catalogue_summary).toEqual({
    total_comments_collected: expected.reduce((sum, row) => sum + row.total, 0),
    total_comments_analysed: expected.reduce(
      (sum, row) => sum + row.analysed,
      0,
    ),
    videos_with_comments: expected.filter((row) => row.total > 0).length,
  });
  expect(actual.every((row) => (row.analysed ?? 0) <= (row.total ?? 0))).toBe(
    true,
  );
}

describe("precomputed ops snapshot video counters", () => {
  beforeAll(async () => {
    db = new PGlite();
    await bootstrap(db);
    await applyMigrations(db);
    await db.exec("reset role");
    await seedWorkspace(db, A, ownerA, channelA, `UC${"a".repeat(22)}`);
    await seedWorkspace(db, B, ownerB, channelB, `UC${"b".repeat(22)}`);
    await insertVideo(db, A, channelA, videoA1, "video-a-1");
    await insertVideo(db, A, channelA, videoA2, "video-a-2");
    await insertVideo(db, B, channelB, videoB, "video-b");
    await insertRun(db, A, runA);
    await insertRun(db, B, runB);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("matches brute force after comment, prediction, status, and delete changes", async () => {
    await db.exec("reset role");
    await insertComments(db, [
      { id: commentA1, workspace: A, video: videoA1, external: "a-1" },
      { id: commentA2, workspace: A, video: videoA1, external: "a-2" },
      { id: commentA3, workspace: A, video: videoA2, external: "a-3" },
      { id: commentB, workspace: B, video: videoB, external: "b-1" },
    ]);
    await expectParity(db, A, ownerA);
    await expectParity(db, B, ownerB);

    await db.exec("reset role");
    await db.query(
      `insert into sentiment_predictions(
         id,workspace_id,comment_id,content_hash,analysis_run_id,analysis_key,
         status,label
       ) values
       (gen_random_uuid(),$1,$2,'a-1',$3,'first','succeeded','positive'),
       (gen_random_uuid(),$1,$2,'a-1',$3,'second','succeeded','positive')`,
      [A, commentA1, runA],
    );
    await expectParity(db, A, ownerA);

    await db.exec("reset role");
    const mutablePrediction = "60000000-0000-4000-8000-000000000001";
    await db.query(
      `insert into sentiment_predictions(
         id,workspace_id,comment_id,content_hash,analysis_run_id,analysis_key,status
       ) values ($1,$2,$3,'a-2',$4,'mutable','skipped')`,
      [mutablePrediction, A, commentA2, runA],
    );
    await db.query(
      "update sentiment_predictions set status='succeeded',label='neutral' where id=$1",
      [mutablePrediction],
    );
    await expectParity(db, A, ownerA);

    await db.exec("reset role");
    await db.query(
      "update sentiment_predictions set status='failed',label=null where id=$1",
      [mutablePrediction],
    );
    await expectParity(db, A, ownerA);

    await db.exec("reset role");
    await db.query(
      "delete from sentiment_predictions where workspace_id=$1 and comment_id=$2",
      [A, commentA1],
    );
    await expectParity(db, A, ownerA);

    await db.exec("reset role");
    await db.query("delete from comments where id=$1", [commentA1]);
    await expectParity(db, A, ownerA);
  });

  it("isolates tenant counters and denies authenticated table reads", async () => {
    const snapshotA = await readOps(db, A, ownerA);
    expect(snapshotA.video_counts.map((row) => row.id).sort()).toEqual([
      videoA1,
      videoA2,
    ]);
    expect(snapshotA.video_counts).not.toContainEqual(
      expect.objectContaining({ id: videoB }),
    );

    await as(db, ownerA);
    await expect(
      db.query("select * from private.video_comment_stats"),
    ).rejects.toThrow(/permission denied/);

    await db.exec("reset role");
    const security = await db.query<{
      row_security: boolean;
      authenticated_select: boolean;
    }>(
      `select
         c.relrowsecurity as row_security,
         has_table_privilege('authenticated', c.oid, 'select') as authenticated_select
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'private' and c.relname = 'video_comment_stats'`,
    );
    expect(security.rows).toEqual([
      { row_security: true, authenticated_select: false },
    ]);
  });

  it("uses only statement triggers with transition tables and no snapshot base-table scan", async () => {
    await db.exec("reset role");
    const definition = (
      await db.query<{ definition: string }>(
        `select pg_get_functiondef(
           'private.workspace_ops_snapshot_impl(uuid)'::regprocedure
         ) as definition`,
      )
    ).rows[0].definition;
    expect(definition).not.toContain("public.comments");
    expect(definition).not.toContain("public.sentiment_predictions");

    const triggers = await db.query<{ name: string; definition: string }>(
      `select tgname as name, pg_get_triggerdef(oid) as definition
       from pg_trigger
       where not tgisinternal
         and tgname like 'refresh_video_comment_stats_after_%'
       order by tgname`,
    );
    expect(triggers.rows).toHaveLength(5);
    for (const trigger of triggers.rows) {
      expect(trigger.definition).toContain("FOR EACH STATEMENT");
      expect(trigger.definition).toContain("REFERENCING");
      expect(trigger.definition).not.toContain("FOR EACH ROW");
    }
  });

  it("keeps adoption and destructive bulk paths exact without stale rows", async () => {
    await db.exec("reset role");
    await seedWorkspace(
      db,
      C,
      ownerC,
      channelC,
      `UC${"a".repeat(22)}`,
      "public_unverified",
    );
    await db.exec("set role service_role");
    await db.query("select private.adopt_channel_content($1,$2)", [
      C,
      channelC,
    ]);
    await expectParity(db, C, ownerC);

    await db.exec("reset role");
    await db.exec("set role service_role");
    await db.query("select private.remove_channel_impl($1,$2)", [C, channelC]);
    await db.exec("reset role");
    await expectParity(db, C, ownerC);
    await db.exec("reset role");
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from private.video_comment_stats where workspace_id=$1",
          [C],
        )
      ).rows[0].count,
    ).toBe(0);

    await db.query("insert into auth.users(id) values ($1)", [admin]);
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      admin,
    ]);
    await as(db, admin);
    await db.query("select public.delete_workspace($1)", [B]);
    await db.exec("reset role");
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from private.video_comment_stats where workspace_id=$1",
          [B],
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it("backfills exact distinct analysed counts for pre-existing data", async () => {
    const backfillDb = new PGlite();
    try {
      await bootstrap(backfillDb);
      await applyMigrations(backfillDb, (filename) => filename < migration);
      await seedWorkspace(
        backfillDb,
        A,
        ownerA,
        channelA,
        `UC${"z".repeat(22)}`,
      );
      await insertVideo(backfillDb, A, channelA, videoA1, "backfill-video");
      await insertRun(backfillDb, A, runA);
      await insertComments(backfillDb, [
        { id: commentA1, workspace: A, video: videoA1, external: "old-1" },
        { id: commentA2, workspace: A, video: videoA1, external: "old-2" },
      ]);
      await backfillDb.query(
        `insert into sentiment_predictions(
           id,workspace_id,comment_id,content_hash,analysis_run_id,analysis_key,
           status,label
         ) values
         (gen_random_uuid(),$1,$2,'old-1',$3,'first','succeeded','positive'),
         (gen_random_uuid(),$1,$2,'old-1',$3,'second','succeeded','negative')`,
        [A, commentA1, runA],
      );

      await backfillDb.exec(
        readFileSync(`supabase/migrations/${migration}`, "utf8"),
      );
      const stats = await backfillDb.query<{
        total: number;
        analysed: number;
      }>(
        `select total,analysed from private.video_comment_stats
         where workspace_id=$1 and video_id=$2`,
        [A, videoA1],
      );
      expect(stats.rows).toEqual([{ total: 2, analysed: 1 }]);
      await expectParity(backfillDb, A, ownerA);
    } finally {
      await backfillDb.close();
    }
  });
});
