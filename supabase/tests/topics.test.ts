/**
 * A comment has a topic, stored under the sentiment layer's rules.
 *
 * The taxonomy is per workspace and seeded; a prediction is keyed on the text
 * it judged and the key it was produced under; a review is append-only and
 * names its reviewer; the first successful classification becomes the active
 * one and a taxonomy edit unseats it.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const OWNER = "10000000-0000-4000-8000-000000000001";
const STRANGER = "10000000-0000-4000-8000-000000000002";
const C1 = "aaaaaaaa-0000-4000-8000-000000000001";
const C2 = "aaaaaaaa-0000-4000-8000-000000000002";
const KEY = "topics:v1+gemini-2.5-flash+p1";
let db: PGlite;

const as = async (id: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
};
const admin = () => db.exec("reset role");
const scalar = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<{ v: T }>(sql, params)).rows[0].v;

const predict = (
  comment: string,
  hash: string,
  key: string,
  status = "succeeded",
  topic: string | null = "praise",
) =>
  db.query(
    `insert into topic_predictions(workspace_id,comment_id,content_hash,classification_key,
       status,topic_key,confidence,model_id,prompt_version)
     values ($1,$2,$3,$4,$5,$6,0.9,'gemini-2.5-flash','p1')`,
    [W, comment, hash, key, status, topic],
  );

describe("a comment has a topic", () => {
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
    await admin();
    for (const u of [OWNER, STRANGER])
      await db.query("insert into auth.users(id) values ($1)", [u]);
    for (const [w, u] of [
      [W, OWNER],
      [OTHER, STRANGER],
    ]) {
      await db.query(
        "insert into workspaces(id,name,created_by) values ($1,'w',$2)",
        [w, u],
      );
      await db.query(
        "insert into memberships values ($1,$2,'workspace_owner')",
        [w, u],
      );
      await db.query(
        "insert into clients(id,workspace_id,name) values ($1,$1,'c')",
        [w],
      );
      await db.query(
        `insert into channels(id,workspace_id,client_id,external_channel_id,status)
         values ($1,$1,$1,$2,'connected')`,
        [w, `UC${w.slice(-1).repeat(22)}`],
      );
      await db.query(
        `insert into videos(id,workspace_id,channel_id,external_video_id,title,kind)
         values ($1,$1,$1,'vid','حلقة','video')`,
        [w],
      );
    }
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

  it("seeds ten topics into every workspace, existing or new", async () => {
    await admin();
    expect(
      await scalar<number>(
        "select count(*)::int as v from workspace_topics where workspace_id=$1",
        [W],
      ),
    ).toBe(10);
    const keys = await db.query<{ key: string }>(
      "select key from workspace_topics where workspace_id=$1 order by position",
      [W],
    );
    expect(keys.rows.map((r) => r.key)).toEqual([
      "question",
      "religious",
      "praise",
      "criticism",
      "request",
      "discussion",
      "personal",
      "humour",
      "promotion",
      "other",
    ]);
    expect(
      await scalar<number>(
        "select topic_taxonomy_version as v from workspaces where id=$1",
        [W],
      ),
    ).toBe(1);
  });

  it("refuses a succeeded prediction without a topic and a topic without success", async () => {
    await admin();
    await expect(predict(C1, "h1", KEY, "succeeded", null)).rejects.toThrow();
    await expect(predict(C1, "h1", KEY, "failed", "praise")).rejects.toThrow();
    await expect(
      predict(C1, "h1", KEY, "succeeded", "not_a_topic"),
    ).rejects.toThrow();
  });

  it("adopts the first successful classification as the workspace's active key", async () => {
    await admin();
    expect(
      await scalar<string | null>(
        "select active_topic_key as v from workspaces where id=$1",
        [W],
      ),
    ).toBeNull();
    await predict(C1, "h0", KEY, "failed", null); // a failure adopts nothing
    expect(
      await scalar<string | null>(
        "select active_topic_key as v from workspaces where id=$1",
        [W],
      ),
    ).toBeNull();
    await predict(C1, "h1", KEY);
    expect(
      await scalar<string | null>(
        "select active_topic_key as v from workspaces where id=$1",
        [W],
      ),
    ).toBe(KEY);
    await predict(C2, "h1", "topics:v1+other-model+p1");
    // Later analyses do not take over silently.
    expect(
      await scalar<string | null>(
        "select active_topic_key as v from workspaces where id=$1",
        [W],
      ),
    ).toBe(KEY);
  });

  it("stores one verdict per comment, text and key", async () => {
    await admin();
    await expect(predict(C1, "h1", KEY)).rejects.toThrow();
    await predict(C1, "h2", KEY); // an edited text is a new verdict
  });

  it("lets a member correct a topic with a reason, on the text they read", async () => {
    await as(OWNER);
    const id = await scalar<string>(
      "select submit_topic_review($1,$2,'h1','request','هذا طلب لا مدح') as v",
      [W, C1],
    );
    expect(id).toMatch(/[0-9a-f-]{36}/);
    await expect(
      db.query("select submit_topic_review($1,$2,'stale','request','x')", [
        W,
        C1,
      ]),
    ).rejects.toThrow(/stale_comment_text/);
    await expect(
      db.query("select submit_topic_review($1,$2,'h1','not_a_topic','x')", [
        W,
        C1,
      ]),
    ).rejects.toThrow(/invalid_topic/);
    await expect(
      db.query("select submit_topic_review($1,$2,'h1','request','')", [W, C1]),
    ).rejects.toThrow(/invalid_reason/);
    await admin();
    const row = await db.query<{ reviewer_id: string; origin: string }>(
      "select reviewer_id, origin from topic_reviews where comment_id=$1",
      [C1],
    );
    expect(row.rows[0]).toEqual({ reviewer_id: OWNER, origin: "human" });
  });

  it("is append-only and refuses a stranger by direct call", async () => {
    await admin();
    await expect(db.query("delete from topic_reviews")).rejects.toThrow(
      /append_only/,
    );
    await as(STRANGER);
    await expect(
      db.query("select submit_topic_review($1,$2,'h1','request','x')", [W, C1]),
    ).rejects.toThrow(/forbidden/);
    expect(
      await scalar<number>("select count(*)::int as v from topic_predictions"),
    ).toBe(0);
    expect(
      await scalar<number>(
        "select count(*)::int as v from workspace_topics where workspace_id=$1",
        [W],
      ),
    ).toBe(0);
  });

  it("retires rather than deletes on a taxonomy edit, bumps the version and unseats the key", async () => {
    await as(OWNER);
    const version = await scalar<number>(
      `select set_workspace_topics($1, $2::jsonb) as v`,
      [
        W,
        JSON.stringify([
          {
            key: "question",
            name_ar: "أسئلة",
            name_en: "Questions",
            description: "Asks something.",
          },
          {
            key: "praise",
            name_ar: "إشادة",
            name_en: "Praise",
            description: "Compliments.",
          },
          {
            key: "shipping",
            name_ar: "الشحن",
            name_en: "Shipping",
            description: "Delivery questions.",
          },
        ]),
      ],
    );
    expect(version).toBe(2);
    await admin();
    expect(
      await scalar<number>(
        "select count(*)::int as v from workspace_topics where workspace_id=$1 and retired_at is null",
        [W],
      ),
    ).toBe(3);
    expect(
      await scalar<number>(
        "select count(*)::int as v from workspace_topics where workspace_id=$1 and retired_at is not null",
        [W],
      ),
    ).toBe(8);
    expect(
      await scalar<string | null>(
        "select active_topic_key as v from workspaces where id=$1",
        [W],
      ),
    ).toBeNull();
    // Old verdicts remain: history, not deleted.
    expect(
      await scalar<number>(
        "select count(*)::int as v from topic_predictions where workspace_id=$1",
        [W],
      ),
    ).toBe(4);
    await as(STRANGER);
    await expect(
      db.query("select set_workspace_topics($1,'[]'::jsonb)", [W]),
    ).rejects.toThrow(/forbidden/);
  });

  it("meters topic classification as its own kind against its own allowance", async () => {
    await admin();
    await db.query(
      "insert into plans(key,analysis_units,backfill_units,topic_units) values ('t',100,0,2)",
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'t','active',now()-interval '1 day',now()+interval '29 days')`,
      [W],
    );
    await db.exec("set role service_role");
    const granted = await scalar<string[]>(
      "select private.reserve_usage($1,'topic_classification',array['topics:youtube:a','topics:youtube:b','topics:youtube:c']) as v",
      [W],
    );
    expect(granted).toEqual(["topics:youtube:a", "topics:youtube:b"]);
    await admin();
    await as(OWNER);
    const summary = await scalar<{
      budgets: { event_type: string; used: number; allowance: number }[];
    }>("select usage_summary($1) as v", [W]);
    expect(summary.budgets.map((b) => b.event_type)).toEqual([
      "comment_analysis",
      "historical_backfill",
      "topic_classification",
    ]);
    expect(summary.budgets[2]).toMatchObject({ used: 2, allowance: 2 });
  });
});
