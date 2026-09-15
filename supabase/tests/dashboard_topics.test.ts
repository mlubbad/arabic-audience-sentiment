/** The live read carries the taxonomy and each comment's effective topic verdict. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000001";
const C1 = "aaaaaaaa-0000-4000-8000-000000000001";
const KEY = "topics:v1+gemini-2.5-flash+p1";
let db: PGlite;

const as = async (id: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
};
const snapshot = async () =>
  (await db.query<{ v: { topics: { key: string; retired: boolean }[]; active_topic_key: string;
    comments: { id: string; topic_prediction: { topic_key: string; classification_key: string } | null;
                topic_reviews: { topic_key: string; reviewer_id: string }[] }[] } }>(
    "select dashboard_snapshot($1) as v", [W])).rows[0].v;

describe("the dashboard reads topics", () => {
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
    await db.query("insert into workspaces(id,name,created_by) values ($1,'w',$2)", [W, OWNER]);
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [W, OWNER]);
    await db.query("insert into clients(id,workspace_id,name) values ($1,$1,'c')", [W]);
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
    await db.query(
      `insert into comments(id,workspace_id,video_id,external_comment_id,text_raw,text_plain,
        content_hash,timestamp_precision,source,author_name,published_at)
       values ($1,$2,$2,'c1','نص','نص','h1','second','youtube_oauth','مؤلف',now())`,
      [C1, W],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("carries the taxonomy, no active key, and null verdicts before any classification", async () => {
    await as(OWNER);
    const s = await snapshot();
    expect(s.topics).toHaveLength(10);
    expect(s.topics[0]).toMatchObject({ key: "question", retired: false });
    expect(s.active_topic_key).toBe("");
    expect(s.comments[0].topic_prediction).toBeNull();
    expect(s.comments[0].topic_reviews).toEqual([]);
  });

  it("carries the effective verdict only — current hash, active key — and every review", async () => {
    await db.exec("reset role");
    // Split into two statements: adopt_first_topic_classification (20260916010000)
    // only adopts a batch whose successful rows share one classification_key, so a
    // single insert mixing KEY and the 'other' key would adopt neither. Inserting
    // the two same-key rows first lets the active key be adopted as intended; the
    // second insert's distinct key then finds active_topic_key already set and is
    // correctly ignored, which is itself part of what this test means to cover.
    await db.query(
      `insert into topic_predictions(workspace_id,comment_id,content_hash,classification_key,status,topic_key,confidence,model_id,prompt_version)
       values ($1,$2,'h0',$3,'succeeded','praise',0.5,'gemini-2.5-flash','p1'),
              ($1,$2,'h1',$3,'succeeded','question',0.9,'gemini-2.5-flash','p1')`,
      [W, C1, KEY],
    );
    await db.query(
      `insert into topic_predictions(workspace_id,comment_id,content_hash,classification_key,status,topic_key,confidence,model_id,prompt_version)
       values ($1,$2,'h1','topics:v1+other+p1','succeeded','humour',0.9,'other','p1')`,
      [W, C1],
    );
    await as(OWNER);
    await db.query("select submit_topic_review($1,$2,'h1','request','طلب')", [W, C1]);
    const s = await snapshot();
    expect(s.active_topic_key).toBe(KEY);
    expect(s.comments[0].topic_prediction).toMatchObject({ topic_key: "question", classification_key: KEY });
    expect(s.comments[0].topic_reviews).toEqual([
      expect.objectContaining({ topic_key: "request", reviewer_id: OWNER }),
    ]);
  });
});
