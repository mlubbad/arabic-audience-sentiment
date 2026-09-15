/**
 * The live dashboard read, against real migrations and real RLS.
 *
 * Until this existed the dashboard had no live path at all: data.ts pinned the
 * mode to the fixture with nothing able to change it. The result is parsed with
 * the same schema the fixture is parsed with, so the two modes cannot drift
 * into producing different shapes from equivalent rows.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LiveSnapshotSchema,
  snapshot,
  type Comment,
} from "../../packages/contracts/src/index";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const ownerA = "10000000-0000-4000-8000-000000000001";
const ownerB = "10000000-0000-4000-8000-000000000002";
const KEY = "m@rev+v1+set";
let db: PGlite;

const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};
const read = async (w: string) => {
  const r = await db.query<{ dashboard_snapshot: unknown }>(
    "select public.dashboard_snapshot($1)",
    [w],
  );
  return r.rows[0].dashboard_snapshot;
};

describe("live dashboard read", () => {
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
        "insert into memberships values ($1,$2,'workspace_owner')",
        [w, owner],
      );
      await db.query(
        "insert into clients(id,workspace_id,name) values ($1,$1,'c')",
        [w],
      );
      await db.query(
        `insert into channels(id,workspace_id,client_id,external_channel_id,status,active_analysis_key)
         values ($1,$1,$1,$2,'connected',$3)`,
        [w, external, KEY],
      );
      await db.query(
        `insert into videos(id,workspace_id,channel_id,external_video_id,title,kind)
         values ($1,$1,$1,'vid','حلقة','short')`,
        [w],
      );
    }
    await db.query(
      "insert into plans(key,analysis_units,backfill_units) values ('t',100,0)",
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'t','active',now()-interval '1 day',now()+interval '29 days')`,
      [A],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("assembles the shape the fixture uses, from the tables", async () => {
    await db.exec("reset role");
    await db.query(
      `insert into comments(id,workspace_id,video_id,external_comment_id,text_raw,text_plain,
        content_hash,timestamp_precision,source,author_name,likes_raw,likes_value,published_at)
       values ('aaaaaaaa-0000-4000-8000-000000000001',$1,$1,'c1','نص','نص','h1','second',
               'youtube_data_api_public','مؤلف','12',12,'2026-09-01T09:00:00Z')`,
      [A],
    );
    // A reply, so the stored platform parent has to be resolved to an internal id.
    await db.query(
      `insert into comments(id,workspace_id,video_id,external_comment_id,external_parent_id,is_reply,
        parent_source,text_raw,text_plain,content_hash,timestamp_precision,source,author_name,
        likes_raw,likes_value,published_at)
       values ('aaaaaaaa-0000-4000-8000-000000000002',$1,$1,'c2','c1',true,'api','رد','رد','h2','second',
               'youtube_data_api_public','مؤلف ٢','1.2K',null,'2026-09-02T09:00:00Z')`,
      [A],
    );
    await db.query(
      `insert into analysis_runs(id,workspace_id,model_id,revision_sha,preprocessing_version,parameters,status)
       values ($1,$1,'m','rev','v1','{"max_length":256}','succeeded')`,
      [A],
    );
    await db.query(
      `insert into sentiment_predictions(workspace_id,comment_id,content_hash,analysis_run_id,
        analysis_key,status,label,class_scores)
       values ($1,'aaaaaaaa-0000-4000-8000-000000000001','h1',$1,$2,'succeeded','positive','{"positive":0.9}')`,
      [A, KEY],
    );

    await as(ownerA);
    const parsed = LiveSnapshotSchema.safeParse(await read(A));
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    const live = parsed.data!;
    expect(live.comments).toHaveLength(2);
    const [first, second] = live.comments;
    expect(first.prediction?.label).toBe("positive");
    expect(first.video_kind).toBe("short");
    // A count the source displayed but nobody could parse stays unknown.
    expect(second.likes_raw).toBe("1.2K");
    expect(second.likes_value).toBeNull();
    // The reply names its parent by internal id, not by the platform's.
    expect(second.parent_comment_id).toBe(first.id);
    expect(live.plan?.plan_key).toBe("t");
  });

  it("feeds the same snapshot the fixture feeds, with the same result", async () => {
    await as(ownerA);
    const live = LiveSnapshotSchema.parse(await read(A));
    // The whole point of sharing the shape: aggregates computed over live rows
    // go through the identical code path the fixture uses.
    const s = snapshot(
      live.comments as Comment[],
      { workspace_id: A },
      live.active_analysis_key,
    );
    expect(s.total).toBe(2);
    expect(s.sentiments.positive).toBe(1);
    // The unlabelled reply is counted in the total and outside analysed rather
    // than being guessed at.
    expect(s.analysed).toBe(1);
    expect(s.unanalysed).toBe(1);
    expect(s.videos).toHaveLength(1);
    expect(s.videos[0].total).toBe(2);
    // The aggregation makes no claim about where the rows came from.
    expect("mode" in s).toBe(false);
  });

  it("does not return a verdict on text the comment no longer has", async () => {
    // The prediction is joined on content_hash, so an edited comment loses its
    // effective label rather than keeping a verdict about text that is gone.
    await db.exec("reset role");
    await db.query(
      "update comments set content_hash='h1-v2' where external_comment_id='c1' and workspace_id=$1",
      [A],
    );
    await as(ownerA);
    const live = LiveSnapshotSchema.parse(await read(A));
    expect(live.comments[0].prediction).toBeNull();
    await db.exec("reset role");
    await db.query(
      "update comments set content_hash='h1' where external_comment_id='c1' and workspace_id=$1",
      [A],
    );
  });

  it("reports the last collection as the last run, not a newer discovery", async () => {
    // A discover run that succeeded after the last collect carries no
    // comment coverage; read as last_run it would say the collection found
    // nothing and never finished.
    await db.exec("reset role");
    await db.query(
      `insert into sync_runs(workspace_id,channel_id,mode,source,status,started_at,ended_at,coverage_summary)
       values ($1,$1,'collect','youtube_oauth','succeeded',now()-interval '2 hours',now()-interval '2 hours',
               '{"videos_seen":3,"comments_collected":2,"complete":true}'),
              ($1,$1,'discover','youtube_oauth','succeeded',now()-interval '1 hour',now()-interval '1 hour',
               '{"videos_found":9}')`,
      [A],
    );
    await as(ownerA);
    const live = LiveSnapshotSchema.parse(await read(A));
    expect(live.sync?.last_run?.coverage).toEqual({
      videos_seen: 3,
      comments_collected: 2,
      complete: true,
    });
    await db.exec("reset role");
    await db.query("delete from sync_runs where workspace_id=$1", [A]);
  });

  it("refuses another tenant's workspace instead of returning an empty one", async () => {
    // Tested as a direct call, not by hiding a control. An empty snapshot would
    // read as a healthy workspace with no comments.
    await as(ownerB);
    await expect(read(A)).rejects.toThrow(/forbidden/);
    // B sees its own, and it is genuinely empty rather than A's rows.
    const mine = LiveSnapshotSchema.parse(await read(B));
    expect(mine.comments).toEqual([]);
    // No subscription was created for B, so there is no plan to report.
    expect(mine.plan).toBeNull();
  });

  it("is closed to anonymous callers", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.exec("set role anon");
    await expect(read(A)).rejects.toThrow();
    await db.exec("reset role");
  });
});
