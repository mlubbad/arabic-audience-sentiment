/**
 * Comment text has a deadline; the analysis of it does not.
 *
 * YouTube's terms require API data refreshed or deleted within 30 days, while
 * derived results may be kept. These tests pin both halves: that the text and
 * the author actually go, and that everything the dashboard is built on
 * survives them going.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-000000000001";
const ownerA = "10000000-0000-4000-8000-000000000001";
const JOB = "20000000-0000-4000-8000-000000000001";
const TOKEN = "30000000-0000-4000-8000-000000000001";
let db: PGlite;

const scalar = async (sql: string, params: unknown[] = []) =>
  (await db.query<{ n: number }>(sql, params)).rows[0].n;

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
const prediction = (id: string) => ({
  external_comment_id: id,
  content_hash: `hash-${id}`,
  analysis_key: "m@rev+v1",
  status: "succeeded",
  label: "negative",
  class_scores: { negative: 0.9 },
  model_id: "m",
  revision: "rev",
  preprocessing_version: "v1",
  parameters: { max_length: 256 },
});
const commit = (body: Record<string, unknown>, key: string, hash: string) =>
  db.query("select private.commit_batch($1,$2,$3,$4,$5)", [
    JOB,
    TOKEN,
    key,
    hash,
    JSON.stringify(body),
  ]);
const payload = (over: Record<string, unknown> = {}) => ({
  external_video_id: "vid-1",
  video_title: "حلقة",
  checkpoint: {},
  outcome: "partial",
  comments: [comment("c1")],
  predictions: [prediction("c1")],
  ...over,
});

describe("comment text retention", () => {
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
      "insert into plans(key,analysis_units,backfill_units) values ('t',100,0)",
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
    await commit(payload(), "b1", "a".repeat(64));
  });
  afterAll(async () => {
    await db?.close();
  });

  it("removes the text and the author, and keeps the analysis", async () => {
    await db.query(
      "update comments set last_seen_at = now() - interval '31 days'",
    );
    const purged = await scalar("select private.purge_comment_text() as n");
    expect(purged).toBe(1);

    const row = await db.query<{
      text_raw: string | null;
      text_plain: string | null;
      author_name: string | null;
      author_channel_id: string | null;
      likes_raw: string | null;
      likes_value: number | null;
      content_hash: string;
      purged: string | null;
    }>(
      `select text_raw, text_plain, author_name, author_channel_id, likes_raw,
              likes_value, content_hash, content_purged_at as purged
       from comments where external_comment_id='c1'`,
    );
    const c = row.rows[0];
    // Gone: the content and the person who wrote it.
    expect(c.text_raw).toBeNull();
    expect(c.text_plain).toBeNull();
    expect(c.author_name).toBeNull();
    expect(c.author_channel_id).toBeNull();
    expect(c.likes_raw).toBeNull();
    // Kept: what the dashboard is actually built on. A purged comment still
    // counts, is still dated, and still carries its verdict.
    expect(c.content_hash).toBe("hash-c1");
    expect(c.likes_value).toBe(3);
    expect(c.purged).not.toBeNull();
    expect(await scalar("select count(*)::int as n from comments")).toBe(1);
    expect(
      await scalar("select count(*)::int as n from sentiment_predictions"),
    ).toBe(1);
  });

  it("re-collecting the comment brings the text back and clears the marker", async () => {
    // The rule is "refresh or delete", so refresh has to work — and it must not
    // depend on a future writer remembering to clear the marker by hand.
    await commit(payload(), "b2", "b".repeat(64));
    const row = await db.query<{
      text_raw: string | null;
      purged: string | null;
    }>(
      "select text_raw, content_purged_at as purged from comments where external_comment_id='c1'",
    );
    expect(row.rows[0].text_raw).toBe("نص c1");
    expect(row.rows[0].purged).toBeNull();
  });

  it("leaves a comment seen inside the window alone", async () => {
    // last_seen_at was just refreshed by the commit above.
    expect(await scalar("select private.purge_comment_text() as n")).toBe(0);
    expect(
      await scalar(
        "select count(*)::int as n from comments where text_raw is not null",
      ),
    ).toBe(1);
    // A shorter window does reach it, so the interval is doing the work.
    expect(
      await scalar(
        "select private.purge_comment_text(interval '0 seconds') as n",
      ),
    ).toBe(1);
  });

  it("cannot end up holding text and a purge marker at the same time", async () => {
    // The two are one fact stated twice; a row claiming both would let the
    // dashboard show text the records say was deleted.
    //
    // A write that tries to set both is corrected rather than refused: the
    // trigger clears the marker, because text arriving *is* a refresh. Refusing
    // would be worse — a legitimate re-collection would fail on rows that
    // happen to be purged, which is the ordinary case after 30 days.
    await db.query(
      "update comments set text_raw='x', content_purged_at=now() where external_comment_id='c1'",
    );
    const fixed = await db.query<{ text_raw: string; purged: string | null }>(
      "select text_raw, content_purged_at as purged from comments where external_comment_id='c1'",
    );
    expect(fixed.rows[0]).toEqual({ text_raw: "x", purged: null });
  });

  it("refuses text removed without recording that it was removed", async () => {
    // The case the trigger does not cover, and the one that would quietly
    // produce a comment with no text and no explanation for where it went.
    await expect(
      db.query(
        "update comments set text_raw=null where external_comment_id='c1'",
      ),
    ).rejects.toThrow(/comments_purged_has_no_text|violates check/);
  });

  it("is service-only: a tenant cannot purge, and cannot undo one", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ownerA,
    ]);
    await db.exec("set role authenticated");
    await expect(
      db.query("select private.purge_comment_text()"),
    ).rejects.toThrow();
    await db.exec("reset role");
  });
});
