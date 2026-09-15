/**
 * The worker classifies topics through the control plane: it is handed the
 * rows that lack a verdict under the key its model produces, and commits
 * verdicts idempotently and metered.
 */
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000001";
const CRED = "worker-credential";
const HASH = createHash("sha256").update(CRED).digest("hex");
const MODEL = "gemini-2.5-flash";
const KEY = "topics:v1+gemini-2.5-flash+p1";
let db: PGlite;
let job: { id: string; lease_token: string };

const scalar = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<{ v: T }>(sql, params)).rows[0].v;
const admin = () => db.exec("reset role");
const service = () => db.exec("set role service_role");

const due = (max = 200) =>
  scalar<{
    classification_key: string;
    active: boolean;
    taxonomy: { key: string; description: string }[];
    rows: {
      external_comment_id: string;
      content_hash: string;
      text: string | null;
      parent_text: string | null;
      is_reply: boolean;
    }[];
  }>("select private.worker_topics_due($1,$2,$3,$4,'p1',$5) as v", [
    HASH,
    job.id,
    job.lease_token,
    MODEL,
    max,
  ]);
const record = (id: string, over: Record<string, unknown> = {}) => ({
  external_comment_id: id,
  content_hash: `h-${id}`,
  classification_key: KEY,
  status: "succeeded",
  topic_key: "praise",
  confidence: 0.91,
  model_id: MODEL,
  prompt_version: "p1",
  error_code: null,
  ...over,
});
const commit = (key: string, records: unknown[]) =>
  scalar<{ replayed: boolean; stored: number }>(
    "select private.worker_commit_topics($1,$2,$3,$4,$5::jsonb) as v",
    [HASH, job.id, job.lease_token, key, JSON.stringify(records)],
  );

describe("the worker classifies topics", () => {
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
    // Already catalogued and with nothing selected for collection, so the
    // tick's only due work for this channel is the topic classification
    // this test exercises — otherwise a discover job (also due for a never-
    // catalogued channel) would race the analyse job for claim_job's pick,
    // since both share one transaction's now() as their not_before and the
    // tie-break is an unordered uuid.
    await db.query(
      `insert into channels(id,workspace_id,client_id,external_channel_id,status,catalogued_at)
       values ($1,$1,$1,$2,'connected',now())`,
      [W, `UC${"a".repeat(22)}`],
    );
    await db.query(
      `insert into videos(id,workspace_id,channel_id,external_video_id,title,kind)
       values ($1,$1,$1,'vid','حلقة','video')`,
      [W],
    );
    // c1 top-level, c2 a reply to c1, c3 purged, c4 the channel's own voice.
    for (const [ext, parent, reply, text, author] of [
      ["c1", null, false, "ما اسم الأغنية؟", "UCviewer"],
      ["c2", "c1", true, "آمين", "UCviewer2"],
      ["c3", null, false, null, "UCviewer3"],
      ["c4", null, false, "شكرا للمتابعة", `UC${"a".repeat(22)}`],
    ] as const)
      await db.query(
        `insert into comments(workspace_id,video_id,external_comment_id,external_parent_id,is_reply,
           text_raw,text_plain,content_hash,timestamp_precision,source,author_channel_id,author_name,
           published_at,content_purged_at)
         values ($1,$1,$2,$3,$4,$5,$5,$6,'second','youtube_oauth',$7,'مؤلف',now(),
                 case when $5::text is null then now() else null end)`,
        [W, ext, parent, reply, text, `h-${ext}`, author],
      );
    await db.query(
      "insert into plans(key,analysis_units,backfill_units,topic_units) values ('t',100,0,3)",
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'t','active',now()-interval '1 day',now()+interval '29 days')`,
      [W],
    );
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'w',$2)",
      [HASH, W],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("the tick enqueues one analyse job for a channel with unclassified comments", async () => {
    await service();
    const first = await scalar<{ analyse: number }>(
      "select private.schedule_due_work($1) as v",
      [W],
    );
    expect(first.analyse).toBe(1);
    const again = await scalar<{ analyse: number }>(
      "select private.schedule_due_work($1) as v",
      [W],
    );
    expect(again.analyse).toBe(0); // one outstanding per channel
    const claimed = await db.query<{
      id: string;
      lease_token: string;
      type: string;
    }>("select id, lease_token, type from private.claim_job($1)", [W]);
    expect(claimed.rows[0].type).toBe("analyse");
    job = claimed.rows[0];
  });

  it("hands over the rows lacking a verdict, with parent text and the taxonomy", async () => {
    await service();
    const list = await due();
    expect(list.classification_key).toBe(KEY);
    expect(list.active).toBe(true); // no active key yet: this one may be adopted
    expect(list.taxonomy.map((t) => t.key)).toContain("question");
    expect(list.taxonomy[0]).not.toHaveProperty("name_ar"); // the prompt needs key + description only
    const byId = Object.fromEntries(
      list.rows.map((r) => [r.external_comment_id, r]),
    );
    expect(Object.keys(byId).sort()).toEqual(["c1", "c2", "c3"]); // c4 is the channel's own voice
    expect(byId.c2).toMatchObject({
      is_reply: true,
      parent_text: "ما اسم الأغنية؟",
    });
    expect(byId.c3.text).toBeNull(); // purged: returned so the worker records it unsupported
    expect((await due(1)).rows).toHaveLength(1);
    // Nothing identifying travels: no author, no ids beyond the external one.
    expect(byId.c1).not.toHaveProperty("author_name");
  });

  it("commits verdicts once, meters only successes, and replays a batch as a no-op", async () => {
    await service();
    const first = await commit("b1", [
      record("c1", { topic_key: "question" }),
      record("c2", { topic_key: "religious" }),
      record("c3", {
        status: "unsupported",
        topic_key: null,
        confidence: null,
        error_code: "text_purged",
      }),
    ]);
    expect(first).toEqual({ replayed: false, stored: 3 });
    expect(
      await scalar<number>(
        "select count(*)::int as v from usage_events where event_type='topic_classification'",
      ),
    ).toBe(2);
    const replay = await commit("b1", [
      record("c1", { topic_key: "question" }),
      record("c2", { topic_key: "religious" }),
      record("c3", {
        status: "unsupported",
        topic_key: null,
        confidence: null,
        error_code: "text_purged",
      }),
    ]);
    expect(replay).toEqual({ replayed: true, stored: 0 });
    expect(
      await scalar<number>("select count(*)::int as v from topic_predictions"),
    ).toBe(3);
    await expect(commit("b1", [record("c1")])).rejects.toThrow(
      /batch_conflict/,
    );
    // The first success adopted the key, and nothing is due any more.
    expect(
      await scalar<string>(
        "select active_topic_key as v from workspaces where id=$1",
        [W],
      ),
    ).toBe(KEY);
    expect((await due()).rows).toEqual([]);
    expect(
      await scalar<boolean>("select private.topics_pending($1,$1) as v", [W]),
    ).toBe(false);
  });

  it("refuses a verdict on a topic not in the taxonomy, a key it did not assign, and a comment it does not hold", async () => {
    await service();
    await expect(
      commit("b2", [
        record("c1", { content_hash: "h-c1-v2", topic_key: "shipping" }),
      ]),
    ).rejects.toThrow(/invalid_batch/);
    await expect(
      commit("b3", [
        record("c1", {
          content_hash: "h-c1-v2",
          classification_key: "topics:v9+x+p1",
        }),
      ]),
    ).rejects.toThrow(/invalid_batch/);
    await expect(commit("b4", [record("ghost")])).rejects.toThrow(
      /invalid_batch/,
    );
    expect(
      await scalar<number>(
        "select count(*)::int as v from usage_events where event_type='topic_classification'",
      ),
    ).toBe(2);
  });

  it("makes an edited comment and a failed verdict due again, and a purged one not", async () => {
    await service();
    await db.query(
      "update comments set content_hash='h-c1-v2', text_raw='نص معدل', text_plain='نص معدل' where external_comment_id='c1'",
    );
    const ids = (await due()).rows.map((r) => r.external_comment_id).sort();
    expect(ids).toEqual(["c1"]); // c2 already has a succeeded verdict on its hash; c3 stays unsupported
    await db.query(
      "delete from topic_predictions where status='succeeded' and comment_id=(select id from comments where external_comment_id='c2')",
    );
    await db.query(
      `insert into topic_predictions(workspace_id,comment_id,content_hash,classification_key,status,model_id,prompt_version,error_code)
      select $1,id,'h-c2',$2,'failed','gemini-2.5-flash','p1','gemini_unavailable' from comments where external_comment_id='c2'`,
      [W, KEY],
    );
    expect((await due()).rows.map((r) => r.external_comment_id).sort()).toEqual(
      ["c1", "c2"],
    );
  });

  it("refuses the batch when the plan cannot pay for it, charging nothing", async () => {
    await service();
    // Allowance 3, two spent (c1, c2 — charged once ever, so re-classifying
    // them costs nothing). Two comments never charged do not fit.
    await expect(
      commit("b6", [
        record("c3", { content_hash: "h-c3" }),
        record("c4", { content_hash: "h-c4" }),
      ]),
    ).rejects.toThrow(/quota_exceeded/);
    expect(
      await scalar<number>(
        "select count(*)::int as v from usage_events where event_type='topic_classification'",
      ),
    ).toBe(2);
  });

  it("tells a worker whose model is not the active one to stand down", async () => {
    await service();
    const list = await scalar<{ active: boolean; rows: unknown[] }>(
      "select private.worker_topics_due($1,$2,$3,'some-other-model','p1',200) as v",
      [HASH, job.id, job.lease_token],
    );
    expect(list.active).toBe(false);
    expect(list.rows).toEqual([]);
  });

  it("is lease-checked and refuses a collect job", async () => {
    await service();
    await expect(
      db.query(
        "select private.worker_topics_due($1,$2,'30000000-0000-4000-8000-000000000009',$3,'p1',200)",
        [HASH, job.id, MODEL],
      ),
    ).rejects.toThrow(/lease_lost/);
    await db.query(
      `insert into jobs(id,workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
       values ('20000000-0000-4000-8000-000000000077',$1,$1,'collect','d-collect','running','30000000-0000-4000-8000-000000000077',now()+interval '10 minutes')`,
      [W],
    );
    await expect(
      db.query(
        "select private.worker_topics_due($1,'20000000-0000-4000-8000-000000000077','30000000-0000-4000-8000-000000000077',$2,'p1',200)",
        [HASH, MODEL],
      ),
    ).rejects.toThrow(/invalid_job_type/);
    await admin();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      OWNER,
    ]);
    await db.exec("set role authenticated");
    await expect(due()).rejects.toThrow();
    await admin();
  });
});
