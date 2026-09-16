/**
 * A sentiment verdict that failed is retried, not remembered for ever.
 *
 * commit_batch stored predictions with `on conflict ... do nothing` on the
 * natural key (workspace, comment, text, analysis key). A failed verdict took
 * that key, so the retry that finally succeeded was dropped on the floor —
 * after reserve_usage had already charged for it, and without the adoption
 * trigger ever seeing a success. The customer paid for an analysis the
 * dashboard could never show. The topic layer had the same defect and fixed
 * it in 20260916011000; this is the sentiment twin.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-000000000001";
const ownerA = "10000000-0000-4000-8000-000000000001";
const JOB = "20000000-0000-4000-8000-000000000001";
const TOKEN = "30000000-0000-4000-8000-000000000001";
const KEY = "m@rev+v1";
let db: PGlite;

const comment = (id: string, over: Record<string, unknown> = {}) => ({
  external_comment_id: id,
  external_parent_id: null,
  is_reply: false,
  parent_source: "api",
  author_channel_id: "UCauthor",
  author_name: "مؤلف",
  text_raw: `نص ${id}`,
  text_plain: `نص ${id}`,
  content_hash: `hash-${id}`,
  published_time_raw: "2026-09-01T09:00:00Z",
  published_at: "2026-09-01T09:00:00Z",
  timestamp_precision: "second",
  likes_raw: "3",
  likes_value: 3,
  source: "youtube_data_api_public",
  field_provenance: { source: "api" },
  ...over,
});
const prediction = (id: string, over: Record<string, unknown> = {}) => ({
  external_comment_id: id,
  content_hash: `hash-${id}`,
  analysis_key: KEY,
  status: "succeeded",
  label: "negative",
  class_scores: { negative: 0.9 },
  model_id: "m",
  revision: "rev",
  preprocessing_version: "v1",
  parameters: { max_length: 256 },
  ...over,
});
const failed = (id: string) =>
  prediction(id, { status: "failed", label: null, class_scores: {} });
const payload = (over: Record<string, unknown> = {}) => ({
  external_video_id: "vid-1",
  video_title: "حلقة",
  checkpoint: { page: 1 },
  outcome: "partial",
  comments: [comment("c1")],
  predictions: [prediction("c1")],
  ...over,
});
const commit = (body: Record<string, unknown>, key: string, hash: string) =>
  db.query("select private.commit_batch($1,$2,$3,$4,$5) as result", [
    JOB,
    TOKEN,
    key,
    hash,
    JSON.stringify(body),
  ]);
const scalar = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<{ v: T }>(sql, params)).rows[0].v;
const verdict = (id: string) =>
  scalar<{ status: string; label: string | null; scores: unknown }>(
    `select jsonb_build_object('status',p.status,'label',p.label,'scores',p.class_scores) as v
       from sentiment_predictions p join comments c on c.id=p.comment_id
      where c.external_comment_id=$1 and p.analysis_key=$2`,
    [id, KEY],
  );
const charges = () =>
  scalar<number>(
    "select count(*)::int as v from usage_events where event_type='comment_analysis'",
  );
const activeKey = () =>
  scalar<string | null>(
    "select active_analysis_key as v from channels where id=$1",
    [A],
  );

describe("a failed sentiment verdict is retried", () => {
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
    await db.query("insert into auth.users(id) values ($1)", [ownerA]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'A',$2)",
      [A, ownerA],
    );
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
      A,
      ownerA,
    ]);
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'c')",
      [A],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id) values ($1,$1,$1,'UC_A')",
      [A],
    );
    await db.query(
      "insert into plans(key,analysis_units,backfill_units) values ('t',3,0)",
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'t','active',now()-interval '1 day',now()+interval '29 days')`,
      [A],
    );
    await db.query(
      `insert into jobs(id,workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
       values ($1,$2,$2,'analyse','d1','running',$3,now()+interval '10 minutes')`,
      [JOB, A, TOKEN],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("stores a failed verdict, charging nothing and adopting nothing", async () => {
    await commit(
      payload({ predictions: [failed("c1")] }),
      "b1",
      "a".repeat(64),
    );
    expect(await verdict("c1")).toEqual({
      status: "failed",
      label: null,
      scores: {},
    });
    expect(await charges()).toBe(0);
    expect(await activeKey()).toBeNull();
  });

  it("replaces the failed verdict with the retry's success, charged once", async () => {
    // Before: the natural key was taken by the failure, `do nothing` dropped
    // the success, and the row below still read `failed` — while the usage
    // event for it had already been written.
    await commit(payload(), "b2", "b".repeat(64));
    expect(await verdict("c1")).toEqual({
      status: "succeeded",
      label: "negative",
      scores: { negative: 0.9 },
    });
    expect(await charges()).toBe(1);
    expect(
      await scalar<number>(
        `select count(*)::int as v from sentiment_predictions p
           join comments c on c.id=p.comment_id where c.external_comment_id='c1'`,
      ),
    ).toBe(1);
  });

  it("adopts the retried success as the channel's first analysis", async () => {
    // The retry is an update, not an insert, so the insert-only adoption
    // trigger never saw the workspace's first success and every comment kept
    // reading as unanalysed.
    expect(await activeKey()).toBe(KEY);
  });

  it("never overwrites a final verdict with a later attempt", async () => {
    // A failure arriving after a success is the retry loop lagging, not new
    // information; a second success with a different label is a worker
    // replaying an old batch under a new key. Neither touches what is stored.
    await commit(
      payload({ predictions: [failed("c1")] }),
      "b3",
      "c".repeat(64),
    );
    expect(await verdict("c1")).toEqual({
      status: "succeeded",
      label: "negative",
      scores: { negative: 0.9 },
    });
    await commit(
      payload({
        predictions: [
          prediction("c1", {
            label: "positive",
            class_scores: { positive: 1 },
          }),
        ],
      }),
      "b4",
      "d".repeat(64),
    );
    expect(await verdict("c1")).toEqual({
      status: "succeeded",
      label: "negative",
      scores: { negative: 0.9 },
    });
    // Charged once ever for this comment, whatever the retries did.
    expect(await charges()).toBe(1);
  });
});
