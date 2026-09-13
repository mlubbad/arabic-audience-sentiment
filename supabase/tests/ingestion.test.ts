import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-000000000001";
const ownerA = "10000000-0000-4000-8000-000000000001";
const JOB = "20000000-0000-4000-8000-000000000001";
const TOKEN = "30000000-0000-4000-8000-000000000001";
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
  analysis_key: "m@rev+v1",
  status: "succeeded",
  label: "negative",
  class_scores: { negative: 0.9 },
  model_id: "m",
  revision: "rev",
  preprocessing_version: "v1",
  ...over,
});
const payload = (over: Record<string, unknown> = {}) => ({
  external_video_id: "vid-1",
  video_title: "حلقة",
  checkpoint: { page: 1 },
  outcome: "partial",
  comments: [comment("c1"), comment("c2")],
  predictions: [prediction("c1"), prediction("c2")],
  ...over,
});
const commit = (
  body: Record<string, unknown>,
  key = "b1",
  hash = "a".repeat(64),
) =>
  db.query("select private.commit_batch($1,$2,$3,$4,$5) as result", [
    JOB,
    TOKEN,
    key,
    hash,
    JSON.stringify(body),
  ]);
const scalar = async (sql: string, params: unknown[] = []) =>
  (await db.query<{ n: number }>(sql, params)).rows[0].n;

describe("atomic batch ingestion", () => {
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
       values ($1,$2,$2,'collect','d1','running',$3,now()+interval '10 minutes')`,
      [JOB, A, TOKEN],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("writes rows, predictions, checkpoint and usage in one call", async () => {
    await commit(payload());
    expect(await scalar("select count(*)::int as n from comments")).toBe(2);
    expect(
      await scalar("select count(*)::int as n from sentiment_predictions"),
    ).toBe(2);
    expect(await scalar("select count(*)::int as n from videos")).toBe(1);
    // One unit per unique comment analysed.
    expect(await scalar("select count(*)::int as n from usage_events")).toBe(2);
    const job = await db.query<{ checkpoint: string; status: string }>(
      "select checkpoint::text as checkpoint, status from jobs where id=$1",
      [JOB],
    );
    expect(JSON.parse(job.rows[0].checkpoint)).toEqual({ page: 1 });
    // "partial" is carried through, never promoted to success.
    expect(job.rows[0].status).toBe("running");
  });

  it("replays the same key and hash as a no-op, charging nothing more", async () => {
    await commit(payload());
    expect(await scalar("select count(*)::int as n from comments")).toBe(2);
    expect(await scalar("select count(*)::int as n from usage_events")).toBe(2);
  });

  it("refuses the same key carrying different rows", async () => {
    // A reused key with a different payload is a worker bug, not an update.
    await expect(
      commit(
        payload({ comments: [comment("c9")], predictions: [] }),
        "b1",
        "b".repeat(64),
      ),
    ).rejects.toThrow(/batch_conflict/);
    expect(await scalar("select count(*)::int as n from comments")).toBe(2);
  });

  it("updates changed text and likes without charging again", async () => {
    await commit(
      payload({
        batch: undefined,
        comments: [
          comment("c1", {
            text_raw: "نص معدل",
            content_hash: "hash-c1-v2",
            likes_value: 99,
          }),
        ],
        predictions: [],
      }),
      "b2",
      "c".repeat(64),
    );
    const row = await db.query<{ text_raw: string; likes_value: number }>(
      "select text_raw, likes_value from comments where external_comment_id='c1'",
    );
    expect(row.rows[0]).toEqual({ text_raw: "نص معدل", likes_value: 99 });
    // Still two comments and two charges: an edit is not a new billable unit.
    expect(await scalar("select count(*)::int as n from comments")).toBe(2);
    expect(await scalar("select count(*)::int as n from usage_events")).toBe(2);
  });

  it("refuses the whole batch when the plan cannot pay for it", async () => {
    // Allowance is 3 and 2 are spent, so a two-comment batch does not fit.
    await expect(
      commit(
        payload({
          comments: [comment("q1"), comment("q2")],
          predictions: [prediction("q1"), prediction("q2")],
        }),
        "b3",
        "d".repeat(64),
      ),
    ).rejects.toThrow(/quota_exceeded/);
    // Nothing half-written: no rows, no receipt, no units.
    expect(await scalar("select count(*)::int as n from comments")).toBe(2);
    expect(await scalar("select count(*)::int as n from usage_events")).toBe(2);
    expect(
      await scalar("select count(*)::int as n from private.job_batches"),
    ).toBe(2);
  });

  it("refuses a stale lease and an unknown token", async () => {
    await expect(
      db.query("select private.commit_batch($1,$2,$3,$4,$5)", [
        JOB,
        "30000000-0000-4000-8000-000000000009",
        "b4",
        "e".repeat(64),
        JSON.stringify(payload()),
      ]),
    ).rejects.toThrow(/lease_lost/);
    await db.query(
      "update jobs set lease_expires_at=now()-interval '1 second' where id=$1",
      [JOB],
    );
    await expect(commit(payload(), "b5", "f".repeat(64))).rejects.toThrow(
      /lease_lost/,
    );
    await db.query(
      "update jobs set lease_expires_at=now()+interval '10 minutes' where id=$1",
      [JOB],
    );
  });

  it("records progress without ending the job, whatever the batch outcome", async () => {
    // The outcome travels with the receipt, but only worker_finish makes a job
    // terminal. Otherwise a worker that died after its last batch would be
    // silently marked complete, which section 10 forbids.
    await commit(
      payload({ outcome: "exhausted", comments: [], predictions: [] }),
      "b6",
      "1".repeat(64),
    );
    expect(
      (
        await db.query<{ status: string }>(
          "select status from jobs where id=$1",
          [JOB],
        )
      ).rows[0].status,
    ).toBe("running");
    expect(
      (
        await db.query<{ outcome: string }>(
          "select outcome from private.job_batches where batch_key='b6'",
        )
      ).rows[0].outcome,
    ).toBe("exhausted");
  });

  it("is service-only: a tenant cannot call it", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ownerA,
    ]);
    await db.exec("set role authenticated");
    await expect(
      db.query("select private.commit_batch($1,$2,$3,$4,$5)", [
        JOB,
        TOKEN,
        "b7",
        "2".repeat(64),
        JSON.stringify(payload()),
      ]),
    ).rejects.toThrow();
    await db.exec("reset role");
  });
  it("bounds a batch in the database, not only in the client", async () => {
    // The 500-row cap lives in the Zod schema and the Python client, but the
    // handler does not parse against the contract, so the database is the only
    // server-side guard. An unbounded batch is one transaction holding an
    // arbitrary number of rows.
    const many = Array.from({ length: 501 }, (_, i) => comment(`big-${i}`));
    await expect(
      commit(
        payload({ comments: many, predictions: [] }),
        "too-big",
        "9".repeat(64),
      ),
    ).rejects.toThrow(/batch_too_large/);
    expect(await scalar("select count(*)::int as n from comments")).toBe(2);

    const predictions = Array.from({ length: 501 }, (_, i) =>
      prediction(`big-${i}`),
    );
    await expect(
      commit(
        payload({ comments: [comment("c1")], predictions }),
        "too-many-preds",
        "8".repeat(64),
      ),
    ).rejects.toThrow(/batch_too_large/);
  });
});
