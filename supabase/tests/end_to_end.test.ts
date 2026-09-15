/**
 * The seam: the real edge handler, the real SQL, and a payload produced by the
 * real Python client. Every other test stands one of these in for another.
 */
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommitBatchSchema } from "../../packages/contracts/src/index";
import {
  handleWorkerRequest,
  type WorkerDb,
} from "../functions/_shared/worker-gateway";

const A = "00000000-0000-4000-8000-000000000001";
const ownerA = "10000000-0000-4000-8000-000000000001";
const CREDENTIAL = "worker-bearer-token-for-workspace-a";
const golden = JSON.parse(
  readFileSync("workers/python/tests/fixtures/golden_batch.json", "utf8"),
) as {
  envelope: Record<string, unknown> & { payload: Record<string, unknown> };
  payload_hash: string;
};

let db: PGlite;

/** Canonical JSON the way the Python client does it: sorted keys, no spaces. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value as object)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The adapter a deployed Edge Function would use, pointed at the real SQL. */
const liveDb: WorkerDb = {
  async claim(hash) {
    const r = await db.query<Record<string, unknown>>(
      "select * from private.worker_claim($1)",
      [hash],
    );
    return r.rows[0] ?? null;
  },
  async heartbeat(hash, job, lease) {
    await db.query("select private.worker_heartbeat($1,$2,$3)", [
      hash,
      job,
      lease,
    ]);
  },
  async commitBatch(hash, job, lease, key, payloadHash, payload) {
    const r = await db.query<{ result: unknown }>(
      "select private.worker_commit_batch($1,$2,$3,$4,$5,$6) as result",
      [hash, job, lease, key, payloadHash, JSON.stringify(payload)],
    );
    return r.rows[0].result;
  },
  async finish(hash, job, lease, outcome, errorCode) {
    await db.query("select private.worker_finish($1,$2,$3,$4,$5)", [
      hash,
      job,
      lease,
      outcome,
      errorCode,
    ]);
  },
  async dueVideos(hash, job, lease) {
    const r = await db.query<{ result: unknown }>(
      "select private.worker_due_videos($1,$2,$3) as result",
      [hash, job, lease],
    );
    return r.rows[0].result;
  },
  async commitCatalogue(hash, job, lease, payload) {
    const r = await db.query<{ result: unknown }>(
      "select private.worker_commit_catalogue($1,$2,$3,$4) as result",
      [hash, job, lease, JSON.stringify(payload)],
    );
    return r.rows[0].result;
  },
  async videoFinished(hash, job, lease, video, outcome, errorCode) {
    await db.query("select private.worker_video_finished($1,$2,$3,$4,$5,$6)", [
      hash,
      job,
      lease,
      video,
      outcome,
      errorCode,
    ]);
  },
  async topicsDue(hash, job, lease, modelId, promptVersion, maxRows) {
    const r = await db.query<{ result: unknown }>(
      "select private.worker_topics_due($1,$2,$3,$4,$5,$6) as result",
      [hash, job, lease, modelId, promptVersion, maxRows],
    );
    return r.rows[0].result;
  },
  async commitTopics(hash, job, lease, batchKey, records) {
    const r = await db.query<{ result: unknown }>(
      "select private.worker_commit_topics($1,$2,$3,$4,$5) as result",
      [hash, job, lease, batchKey, JSON.stringify(records)],
    );
    return r.rows[0].result;
  },
  async tick(hash) {
    const r = await db.query<{ result: unknown }>(
      "select private.worker_tick($1) as result",
      [hash],
    );
    return r.rows[0].result;
  },
};

const post = (path: string, body: unknown) =>
  handleWorkerRequest(
    new Request(`https://edge.invalid${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${CREDENTIAL}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    liveDb,
  );
const scalar = async (sql: string, p: unknown[] = []) =>
  (await db.query<{ n: number }>(sql, p)).rows[0].n;

describe("worker to database, through the real handler", () => {
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
      "insert into plans(key,analysis_units,backfill_units,topic_units) values ('t',10,0,10)",
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'t','active',now()-interval '1 day',now()+interval '29 days')`,
      [A],
    );
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'w',$2)",
      [createHash("sha256").update(CREDENTIAL).digest("hex"), A],
    );
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'collect','d1')",
      [A],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("agrees with Python on the canonical hash of the same payload", async () => {
    // If the two languages canonicalise differently, a correct replay reads as
    // a conflicting payload. Nothing else in the suite would catch that.
    const here = createHash("sha256")
      .update(canonical(golden.envelope.payload))
      .digest("hex");
    expect(here).toBe(golden.payload_hash);
  });

  it("accepts the request body the Python client posts, unmodified", () => {
    // Parsed exactly as captured. This test used to rebuild the envelope around
    // the payload before parsing, which is how the contract went on describing
    // a flat object nothing sends: the reshaping was doing the adapting, so the
    // mismatch could never fail a test.
    const parsed = CommitBatchSchema.safeParse(golden.envelope);
    expect(parsed.success).toBe(true);
  });

  it("runs claim, heartbeat, commit and finish through the handler into the database", async () => {
    const claimed = await post("/worker/claim", {});
    expect(claimed.status).toBe(200);
    const lease = (await claimed.json()) as {
      job_id: string;
      lease_token: string;
      checkpoint: unknown;
      type: string;
      videos: unknown[];
    };
    // The exact keys the Python client reads. A jobs row keyed `id` would make
    // every later call raise KeyError, which no mock-based test would catch.
    expect(Object.keys(lease).sort()).toEqual([
      // access_token joined the claim so the worker can reach the channel
      // without holding the sealing key. Pinned here because the Python client
      // reads these exact keys, and a rename would raise KeyError at the first
      // call after the claim — which no mock-based test would catch.
      "access_token",
      "checkpoint",
      "job_id",
      "lease_token",
      // type and videos joined the claim so a collect job is handed its due
      // list without a second round trip. The seeded job is a real 'collect'
      // row with no video_selections, so this also exercises the real
      // worker_due_videos -> due_videos SQL path, not a stand-in: an empty
      // channel must come back as an empty list, not null or an error.
      "type",
      "videos",
    ]);
    expect(lease.lease_token).toBeTruthy();
    expect(lease.type).toBe("collect");
    expect(lease.videos).toEqual([]);

    expect(
      (
        await post("/worker/heartbeat", {
          job_id: lease.job_id,
          lease_token: lease.lease_token,
        })
      ).status,
    ).toBe(200);

    // The client's own body, with only the two values a live lease decides
    // substituted. batch_key, payload_hash and payload are the client's.
    const committed = await post("/worker/commit-batch", {
      ...golden.envelope,
      job_id: lease.job_id,
      lease_token: lease.lease_token,
    });
    expect(committed.status).toBe(200);

    // The rows the Python client described actually landed.
    expect(await scalar("select count(*)::int as n from comments")).toBe(2);
    expect(await scalar("select count(*)::int as n from videos")).toBe(1);
    // Both verdicts stored: the fixture's predictions are built by the real
    // analyzer, so this is the first point at which a record it produces is
    // checked against the contract and the database rather than against a
    // hand-written stand-in.
    expect(
      await scalar("select count(*)::int as n from sentiment_predictions"),
    ).toBe(2);
    // One of the two was analysable, so exactly one billable unit. The
    // unsupported row is recorded and costs nothing.
    expect(await scalar("select count(*)::int as n from usage_events")).toBe(1);
    const verdicts = await db.query<{ status: string; label: string | null }>(
      `select p.status, p.label from sentiment_predictions p
       join comments c on c.id=p.comment_id order by c.external_comment_id`,
    );
    expect(verdicts.rows).toEqual([
      { status: "succeeded", label: "positive" },
      // Unsupported is a real result and explicitly not a neutral verdict.
      { status: "unsupported", label: null },
    ]);
    // The verdict is joined to its comment by the text it judged, so a hash
    // that drifted would store a prediction that never becomes effective.
    expect(
      await scalar(
        `select count(*)::int as n from sentiment_predictions p
         join comments c on c.id=p.comment_id and c.content_hash=p.content_hash`,
      ),
    ).toBe(2);
    // Unknown engagement survived as null rather than becoming zero.
    expect(
      (
        await db.query<{ likes_value: number | null }>(
          "select likes_value from comments where external_comment_id='cmt-2'",
        )
      ).rows[0].likes_value,
    ).toBeNull();

    const finished = await post("/worker/finish", {
      job_id: lease.job_id,
      lease_token: lease.lease_token,
      outcome: "succeeded",
    });
    expect(finished.status).toBe(200);
    expect(
      (
        await db.query<{ status: string }>(
          "select status from jobs where id=$1",
          [lease.job_id],
        )
      ).rows[0].status,
    ).toBe("succeeded");
  });

  it("surfaces a database refusal as the status the Python client expects", async () => {
    // The lease is released, so every further call must read as lease_lost with
    // the 409 the client turns back into LeaseLost.
    const stale = await post("/worker/heartbeat", {
      job_id: "20000000-0000-4000-8000-000000000001",
      lease_token: "30000000-0000-4000-8000-000000000001",
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ code: "lease_lost" });

    const badCredential = await handleWorkerRequest(
      new Request("https://edge.invalid/worker/claim", {
        method: "POST",
        headers: {
          authorization: "Bearer not-a-real-credential",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      liveDb,
    );
    expect(badCredential.status).toBe(401);
    expect(await badCredential.json()).toEqual({
      code: "invalid_worker_credential",
    });
  });

  it("runs topics-due and commit-topics through the handler into the database", async () => {
    // An analyse job over the two comments the collect run above stored.
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'analyse','d2')",
      [A],
    );
    const claimed = await post("/worker/claim", {});
    expect(claimed.status).toBe(200);
    const lease = (await claimed.json()) as {
      job_id: string;
      lease_token: string;
      type: string;
      videos: unknown[];
    };
    expect(lease.type).toBe("analyse");
    // An analyse claim carries no due-video list: the gateway does not ask,
    // and the database would refuse the question for this job type.
    expect(lease.videos).toEqual([]);

    // The body ControlPlane.topics_due posts, key for key.
    const due = await post("/worker/topics-due", {
      job_id: lease.job_id,
      lease_token: lease.lease_token,
      model_id: "gemini-2.5-flash",
      prompt_version: "p1",
      max_rows: 200,
    });
    expect(due.status).toBe(200);
    const list = (await due.json()) as {
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
      blocked?: string;
    };
    // The exact keys run_topics and topics.analysis.classify read.
    expect(Object.keys(list).sort()).toEqual([
      "active",
      "classification_key",
      "rows",
      "taxonomy",
    ]);
    expect(list.classification_key).toBe("topics:v1+gemini-2.5-flash+p1");
    expect(list.active).toBe(true);
    expect(list.taxonomy.map((t) => t.key)).toContain("question");
    const rows = Object.fromEntries(
      list.rows.map((r) => [r.external_comment_id, r]),
    );
    expect(Object.keys(rows).sort()).toEqual(["cmt-1", "cmt-2"]);
    expect(Object.keys(rows["cmt-2"]).sort()).toEqual([
      "content_hash",
      "external_comment_id",
      "is_reply",
      "parent_text",
      "text",
    ]);
    // The reply travels with its parent's text, as the prompt needs it.
    expect(rows["cmt-2"]).toMatchObject({
      is_reply: true,
      text: "أتمنى تحسين الصوت",
      parent_text: "المحتوى واضح ومفيد ﹢",
    });
    // The verdict is joined to the text it judged: the hash the client will
    // echo back is the one the collect run stored.
    expect(rows["cmt-1"].content_hash).toBe(
      (golden.envelope.payload.comments as { content_hash: string }[])[0]
        .content_hash,
    );

    // The records topics.analysis.classify builds, key for key, under the
    // batch key run_topics derives (lease token, round 1, slice 0, sorted ids).
    const record = (
      r: (typeof list.rows)[number],
      verdict: Partial<{
        status: string;
        topic_key: string | null;
        confidence: number | null;
        error_code: string | null;
      }>,
    ) => ({
      external_comment_id: r.external_comment_id,
      content_hash: r.content_hash,
      classification_key: list.classification_key,
      status: "succeeded",
      topic_key: "question",
      confidence: 0.9,
      model_id: "gemini-2.5-flash",
      prompt_version: "p1",
      error_code: null,
      ...verdict,
    });
    const batchKey = createHash("sha256")
      .update(`${lease.lease_token}:1:0:cmt-1,cmt-2`)
      .digest("hex")
      .slice(0, 32);
    const committed = await post("/worker/commit-topics", {
      job_id: lease.job_id,
      lease_token: lease.lease_token,
      batch_key: batchKey,
      records: [
        record(rows["cmt-1"], { topic_key: "praise" }),
        record(rows["cmt-2"], {
          status: "failed",
          topic_key: null,
          confidence: null,
          error_code: "gemini_unavailable",
        }),
      ],
    });
    expect(committed.status).toBe(200);
    expect(await committed.json()).toEqual({ replayed: false, stored: 2 });

    // The verdict landed in PGlite, against the row the collect run stored,
    // and the one success was metered as a topic unit.
    const verdicts = await db.query<{
      external_comment_id: string;
      status: string;
      topic_key: string | null;
    }>(
      `select c.external_comment_id, p.status, p.topic_key from topic_predictions p
       join comments c on c.id=p.comment_id and c.content_hash=p.content_hash
       order by c.external_comment_id`,
    );
    expect(verdicts.rows).toEqual([
      {
        external_comment_id: "cmt-1",
        status: "succeeded",
        topic_key: "praise",
      },
      { external_comment_id: "cmt-2", status: "failed", topic_key: null },
    ]);
    expect(
      await scalar(
        "select count(*)::int as n from usage_events where event_type='topic_classification'",
      ),
    ).toBe(1);
    // The first success adopted the key, so the dashboard's read is now live.
    expect(
      (
        await db.query<{ active_topic_key: string }>(
          "select active_topic_key from workspaces where id=$1",
          [A],
        )
      ).rows[0].active_topic_key,
    ).toBe(list.classification_key);
    // Only the failed row is due again.
    const again = (await (
      await post("/worker/topics-due", {
        job_id: lease.job_id,
        lease_token: lease.lease_token,
        model_id: "gemini-2.5-flash",
        prompt_version: "p1",
        max_rows: 200,
      })
    ).json()) as typeof list;
    expect(again.rows.map((r) => r.external_comment_id)).toEqual(["cmt-2"]);

    const finished = await post("/worker/finish", {
      job_id: lease.job_id,
      lease_token: lease.lease_token,
      outcome: "partial",
      error_code: "gemini_unavailable",
    });
    expect(finished.status).toBe(200);
  });
});
