/**
 * Which analysis a channel's labels come from.
 *
 * channels.active_analysis_key decides whether a stored prediction is a
 * comment's effective label or merely history. Nothing wrote it, so a workspace
 * could hold a complete set of correct predictions and still show every comment
 * as unanalysed. These assert the adoption rule and, just as importantly, its
 * limit: a later analysis must not take over silently.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000001";
let db: PGlite;

const activeKey = async () => {
  const r = await db.query<{ active_analysis_key: string | null }>(
    "select active_analysis_key from channels where workspace_id=$1",
    [W],
  );
  return r.rows[0].active_analysis_key;
};

const run = async (id: string, model: string, key: string) => {
  await db.query(
    `insert into analysis_runs(id,workspace_id,model_id,revision_sha,preprocessing_version,parameters,status)
     values ($1,$2,$3,'rev','v1','{}','succeeded')`,
    [id, W, model],
  );
  return key;
};

const predict = async (
  comment: string,
  runId: string,
  key: string,
  status = "succeeded",
  label: string | null = "positive",
) =>
  db.query(
    `insert into sentiment_predictions(workspace_id,comment_id,content_hash,analysis_run_id,
      analysis_key,status,label,class_scores)
     values ($1,$2,'h1',$3,$4,$5,$6,'{"positive":0.9}')`,
    [W, comment, runId, key, status, label],
  );

const C1 = "aaaaaaaa-0000-4000-8000-000000000001";
const C2 = "aaaaaaaa-0000-4000-8000-000000000002";
const R1 = "bbbbbbbb-0000-4000-8000-000000000001";
const R2 = "bbbbbbbb-0000-4000-8000-000000000002";

describe("the first successful analysis becomes the channel's active one", () => {
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
    await db.exec("reset role");
    await db.query("insert into auth.users(id) values ($1)", [OWNER]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'w',$2)",
      [W, OWNER],
    );
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
      W,
      OWNER,
    ]);
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'c')",
      [W],
    );
    // Deliberately null: a freshly connected channel has no analysis yet.
    await db.query(
      `insert into channels(id,workspace_id,client_id,external_channel_id,status)
       values ($1,$1,$1,$2,'connected')`,
      [W, `UC${"a".repeat(22)}`],
    );
    await db.query(
      `insert into videos(id,workspace_id,channel_id,external_video_id,title,kind)
       values ($1,$1,$1,'vid','حلقة','video')`,
      [W],
    );
    for (const [id, ext] of [
      [C1, "c1"],
      [C2, "c2"],
    ])
      await db.query(
        `insert into comments(id,workspace_id,video_id,external_comment_id,text_raw,text_plain,
          content_hash,timestamp_precision,source,author_name,published_at)
         values ($1,$2,$2,$3,'نص','نص','h1','second','youtube_oauth','مؤلف',now())`,
        [id, W, ext],
      );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("lets the worker's role meter usage, which nothing could do before", async () => {
    // private.reserve_usage is security invoker and calls private.used_units.
    // The foundation revokes every private function and grants a named list
    // back to service_role; reserve_usage was on it and used_units was not, so
    // the first batch of real predictions died on "permission denied for
    // function used_units" and reached the worker as a bare 500.
    await db.exec("reset role");
    await db.query(
      "insert into plans(key,analysis_units,backfill_units) values ('t',100,0) on conflict do nothing",
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'t','active',now()-interval '1 day',now()+interval '29 days')
       on conflict (workspace_id) do nothing`,
      [W],
    );
    await db.exec("set role service_role");
    const reserved = await db.query<{ reserve_usage: string[] }>(
      "select private.reserve_usage($1,'comment_analysis',array['k1']) as reserve_usage",
      [W],
    );
    expect(reserved.rows[0].reserve_usage).toEqual(["k1"]);
    await db.exec("reset role");
  });

  it("starts with no analysis, which is why every comment read as unanalysed", async () => {
    expect(await activeKey()).toBeNull();
  });

  it("a failed prediction does not become the channel's analysis", async () => {
    const key = await run(R1, "m1", "m1@rev+v1+aaa");
    await predict(C1, R1, key, "failed", null);
    // A run that produced nothing is not an analysis to label a channel by.
    expect(await activeKey()).toBeNull();
  });

  it("adopts the first successful one", async () => {
    await predict(C2, R1, "m1@rev+v1+aaa");
    expect(await activeKey()).toBe("m1@rev+v1+aaa");
  });

  it("does not let a later analysis take over silently", async () => {
    const key = await run(R2, "m2", "m2@rev+v1+bbb");
    await db.query(
      `insert into sentiment_predictions(workspace_id,comment_id,content_hash,analysis_run_id,
        analysis_key,status,label,class_scores)
       values ($1,$2,'h2',$3,$4,'succeeded','negative','{"negative":0.9}')`,
      [W, C1, R2, key],
    );
    // Running an experiment must not relabel every figure on the dashboard.
    expect(await activeKey()).toBe("m1@rev+v1+aaa");
  });
});
