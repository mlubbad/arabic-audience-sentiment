import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Owner console review batch E (2026-10-13, findings 9, 10, 11, 20).
const ADMIN = "10000000-0000-4000-8000-00000000000a";
const OWNER = "10000000-0000-4000-8000-000000000001";
let db: PGlite;

const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};

/** A workspace with one channel, one video and `comments` comments, each
 *  with a succeeded prediction. Returns the workspace id. */
async function seed(name: string, comments: number): Promise<string> {
  await as(OWNER);
  await db.query("select create_workspace($1)", [name]);
  await db.exec("reset role");
  const w = (
    await db.query<{ id: string }>("select id from workspaces where name=$1", [
      name,
    ])
  ).rows[0].id;
  await db.query(
    `insert into channels(id,workspace_id,client_id,external_channel_id,status)
     values ($1,$1,(select id from clients where workspace_id=$1),$2,'connected')`,
    [w, "UC" + w.replace(/-/g, "").slice(0, 22)],
  );
  await db.query(
    `insert into videos(id,workspace_id,channel_id,external_video_id,title) values ($1,$1,$1,'vvvvvvvvvvv','v')`,
    [w],
  );
  await db.query(
    `insert into analysis_runs(id,workspace_id,model_id,revision_sha,preprocessing_version,parameters,status)
     values ($1,$1,'m','rev','v1','{}','succeeded')`,
    [w],
  );
  for (let i = 0; i < comments; i++)
    await db.query(
      `insert into comments(workspace_id,video_id,external_comment_id,text_raw,text_plain,
        content_hash,timestamp_precision,source,author_name,likes_raw,likes_value,published_at)
       values ($1,$1,$2,'نص','نص',$2,'second','youtube_data_api_public','مؤلف','1',1,'2026-09-01T09:00:00Z')`,
      [w, `c${i}`],
    );
  await db.query(
    `insert into sentiment_predictions(workspace_id,comment_id,content_hash,analysis_run_id,analysis_key,status,label,class_scores)
     select $1, c.id, c.content_hash, $1, 'm@rev+v1+p', 'succeeded', 'positive', '{"positive":0.9}'
       from comments c where c.workspace_id=$1`,
    [w],
  );
  return w;
}

const stats = async (w: string) =>
  (
    await db.query<{ total: number; analysed: number }>(
      "select total, analysed from private.video_comment_stats where workspace_id=$1",
      [w],
    )
  ).rows[0];

describe("admin definitions and scale", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const f of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await db.query("insert into auth.users(id) values ($1),($2)", [
      ADMIN,
      OWNER,
    ]);
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      ADMIN,
    ]);
    // Room for the test's workspaces.
    await db.query(
      "update subscriptions set plan_key='agency' where workspace_id=(select id from workspaces where created_by=$1 order by created_at limit 1)",
      [OWNER],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("does not recount the stats of a workspace that is being deleted, and still recounts every other", async () => {
    const doomed = await seed("doomed", 3);
    const other = await seed("other", 2);
    expect(await stats(doomed)).toEqual({ total: 3, analysed: 3 });
    expect(await stats(other)).toEqual({ total: 2, analysed: 2 });

    // Inside one transaction, as delete_workspace opens it.
    await db.exec("begin");
    await db.query("select set_config('app.deleting_workspace',$1,true)", [
      doomed,
    ]);
    await db.query("delete from sentiment_predictions where workspace_id=$1", [
      doomed,
    ]);
    await db.query("delete from sentiment_predictions where workspace_id=$1", [
      other,
    ]);
    // The doomed workspace's stats were not recounted (its rows go with its
    // videos); the other one's were.
    expect(await stats(doomed)).toEqual({ total: 3, analysed: 3 });
    expect(await stats(other)).toEqual({ total: 2, analysed: 0 });
    await db.exec("rollback");

    // Outside a delete, both recount as before.
    await db.query("delete from sentiment_predictions where workspace_id=$1", [
      doomed,
    ]);
    expect(await stats(doomed)).toEqual({ total: 3, analysed: 0 });
  });

  it("deletes a workspace with comments and predictions, and leaves its neighbour's stats right", async () => {
    const big = await seed("big", 5);
    const neighbour = await seed("neighbour", 1);
    await as(ADMIN);
    await db.query("select delete_workspace($1)", [big]);
    await db.exec("reset role");
    const left = await db.query<{ n: number }>(
      "select count(*)::int n from private.video_comment_stats where workspace_id=$1",
      [big],
    );
    expect(left.rows[0].n).toBe(0);
    expect(await stats(neighbour)).toEqual({ total: 1, analysed: 1 });
  });

  it("gives the delete, its footprint and the ops read their own limits", async () => {
    const { rows } = await db.query<{ name: string; config: string[] | null }>(
      `select p.proname as name, p.proconfig as config from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('delete_workspace','admin_workspace_footprint','admin_ops')
       order by 1`,
    );
    const limit = (name: string) =>
      rows
        .find((r) => r.name === name)
        ?.config?.find((c) => c.startsWith("statement_timeout="));
    expect(limit("delete_workspace")).toBe("statement_timeout=120s");
    expect(limit("admin_workspace_footprint")).toBe("statement_timeout=60s");
    expect(limit("admin_ops")).toBe("statement_timeout=30s");
  });

  it("counts failed syncs apart from partial ones", async () => {
    const w = (
      await db.query<{ id: string }>(
        "select id from workspaces where name='other'",
      )
    ).rows[0].id;
    for (const status of ["failed", "partial", "partial", "succeeded"])
      await db.query(
        `insert into sync_runs(workspace_id,channel_id,mode,source,status,ended_at)
         values ($1,$1,'collect','youtube_data_api_public',$2,now())`,
        [w, status],
      );
    await as(ADMIN);
    const ops = (
      await db.query<{ o: Record<string, number> }>("select admin_ops() as o")
    ).rows[0].o;
    await db.exec("reset role");
    expect(ops.sync_failed_7d).toBe(1);
    expect(ops.sync_partial_7d).toBe(2);
    expect(ops.sync_runs_7d).toBe(4);
  });

  it("indexes the audit trail by time, by actor and by target", async () => {
    const { rows } = await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where tablename='audit_events' order by indexname",
    );
    const defs = rows.map((r) => r.indexdef.replace(/\s+/g, " "));
    expect(defs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("(created_at DESC)"),
        expect.stringContaining("(actor_id, created_at DESC)"),
        expect.stringContaining("(target_type, target_id)"),
      ]),
    );
  });
});
