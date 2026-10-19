import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  handleWorkerRequest,
  type WorkerDb,
} from "../functions/_shared/worker-gateway";

// Per-video comment counts are recounted in the background, and a lost lease is
// refused with a code PostgREST does not retry.
//
// Production, 2026-10-18: every commit_batch recounted its whole video twice
// (once after the comments insert, once after the predictions insert). That is
// 14-36 s on the two ~97k-comment videos and 2-5 s on the ~20k ones, against
// the 8 s every gateway RPC has, so 52 of 463 batches since 15:10 UTC ended in
// 57014. And `lease_lost` was raised as SQLSTATE 40001, which PostgREST takes
// for a serialization failure and retries without end: about 1,550 rolled-back
// transactions a second, on ten pool connections that had been looping since
// 10-13..10-16.

const OWNER = "10000000-0000-4000-8000-000000000001";
const W = "00000000-0000-4000-8000-000000000001";
const CH = "00000000-0000-4000-8000-0000000000a1";
const OTHER_VIDEO = "00000000-0000-4000-8000-0000000000b2";
const BEARER = "worker-secret";
let TOKEN = "";
const RETRIED_BY_POSTGREST = ["40001", "40P01"];

let db: PGlite;
let jobN = 0;

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

async function lease() {
  jobN += 1;
  const r = await db.query<{ id: string; lease_token: string }>(
    `insert into jobs(workspace_id, channel_id, type, dedupe_key, status,
                      lease_token, lease_expires_at, attempt)
     values ($1, $2, 'collect', $3, 'running', gen_random_uuid(),
             now() + interval '5 minutes', 1)
     returning id, lease_token`,
    [W, CH, `drain-${jobN}`],
  );
  return r.rows[0];
}

const comment = (id: string, hash = id) => ({
  external_comment_id: id,
  text_raw: `text ${id}`,
  text_plain: `text ${id}`,
  content_hash: hash,
  published_at: "2026-10-01T00:00:00Z",
  source: "youtube_data_api",
});

const prediction = (id: string, status: string, label: string | null) => ({
  external_comment_id: id,
  content_hash: id,
  analysis_key: "camelbert",
  status,
  label,
  class_scores: {},
  model_id: "camelbert-da",
  revision: "b0df630d23e5",
  preprocessing_version: "v2",
});

async function commit(
  externalVideo: string,
  comments: object[],
  predictions: object[] = [],
) {
  const { id, lease_token } = await lease();
  await db.query("select private.commit_batch($1, $2, $3, $4, $5)", [
    id,
    lease_token,
    `batch-${jobN}`,
    "a".repeat(64),
    JSON.stringify({
      external_video_id: externalVideo,
      video_title: externalVideo,
      outcome: "partial",
      comments,
      predictions,
    }),
  ]);
  // One outstanding collect per channel: this job is done.
  await db.query("update jobs set status = 'succeeded' where id = $1", [id]);
}

const videoId = async (external: string) =>
  (
    await db.query<{ id: string }>(
      "select id from videos where workspace_id = $1 and external_video_id = $2",
      [W, external],
    )
  ).rows[0].id;

const stats = async (video: string) =>
  (
    await db.query<{ total: number; analysed: number }>(
      "select total, analysed from private.video_comment_stats where workspace_id = $1 and video_id = $2",
      [W, video],
    )
  ).rows[0] ?? null;

const marks = async (video: string) =>
  Number(
    (
      await db.query<{ n: string }>(
        "select count(*) n from private.video_comment_stats_dirty where workspace_id = $1 and video_id = $2",
        [W, video],
      )
    ).rows[0].n,
  );

const drain = async () =>
  (
    await db.query<{ n: number }>(
      "select private.drain_video_comment_stats() n",
    )
  ).rows[0].n;

// What the counts must be, computed from the rows themselves (the nightly
// reconcile's definition): every comment, and every comment with at least one
// succeeded prediction, purged text included.
const exact = async (video: string) =>
  (
    await db.query<{ total: number; analysed: number }>(
      `select count(c.id)::int total,
              count(c.id) filter (where exists (
                select 1 from sentiment_predictions sp
                 where sp.workspace_id = c.workspace_id and sp.comment_id = c.id
                   and sp.status = 'succeeded'))::int analysed
         from comments c where c.workspace_id = $1 and c.video_id = $2`,
      [W, video],
    )
  ).rows[0];

async function sqlstate(sql: string, params: unknown[]) {
  try {
    await db.query(sql, params);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: err.code, message: err.message };
  }
  throw new Error(`expected ${sql} to raise`);
}

beforeAll(async () => {
  TOKEN = await sha256Hex(BEARER);
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
  `);
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));

  await db.query("insert into auth.users(id) values ($1)", [OWNER]);
  await db.query(
    "insert into workspaces(id, name, created_by) values ($1, 'W', $2)",
    [W, OWNER],
  );
  await db.query(
    "insert into memberships(workspace_id, user_id, role) values ($1, $2, 'workspace_owner')",
    [W, OWNER],
  );
  await db.query(
    `insert into subscriptions(workspace_id, plan_key, status, period_start, period_end)
     values ($1, 'owner', 'active', now() - interval '1 day', now() + interval '20 days')`,
    [W],
  );
  await db.query(
    "insert into clients(id, workspace_id, name) values ($1, $1, 'c')",
    [W],
  );
  await db.query(
    `insert into channels(id, workspace_id, client_id, external_channel_id, platform, status)
     values ($1, $2, $2, 'UC_one', 'youtube', 'connected')`,
    [CH, W],
  );
  await db.query(
    `insert into private.worker_credentials(token_hash, label, workspace_id)
     values ($1, 'worker', $2)`,
    [TOKEN, W],
  );
});

afterAll(async () => {
  await db.close();
});

describe("per-video comment counts", () => {
  it("a committed batch marks its video and leaves the recount to the drain", async () => {
    await commit(
      "vid-a",
      [comment("a1"), comment("a2"), comment("a3")],
      [
        prediction("a1", "succeeded", "mixed"),
        prediction("a2", "skipped", null),
      ],
    );
    const v = await videoId("vid-a");

    // Inline, this was {total: 3, analysed: 1} before commit_batch returned.
    expect(await stats(v)).toBeNull();
    expect(await marks(v)).toBeGreaterThan(0);

    expect(await drain()).toBe(1);
    expect(await stats(v)).toEqual({ total: 3, analysed: 1 });
    expect(await marks(v)).toBe(0);
  });

  it("the drain reaches the counts the inline recount gave, through every kind of change", async () => {
    // Mixed counts as analysed; skipped, failed and unsupported do not; two
    // succeeded keys on one comment count it once; a purged comment is still
    // a comment.
    await commit(
      "vid-b",
      [
        comment("b1"),
        comment("b2"),
        comment("b3"),
        comment("b4"),
        comment("b5"),
        comment("b6"),
      ],
      [
        prediction("b1", "succeeded", "mixed"),
        prediction("b2", "skipped", null),
        prediction("b3", "failed", null),
        prediction("b4", "unsupported", null),
      ],
    );
    const v = await videoId("vid-b");
    const run = (
      await db.query<{ id: string }>(
        "select id from analysis_runs where workspace_id = $1 limit 1",
        [W],
      )
    ).rows[0].id;
    const id = async (ext: string) =>
      (
        await db.query<{ id: string }>(
          "select id from comments where workspace_id = $1 and external_comment_id = $2",
          [W, ext],
        )
      ).rows[0].id;

    await db.query(
      `insert into sentiment_predictions(workspace_id, comment_id, content_hash, analysis_run_id,
                                         analysis_key, status, label)
       values ($1, $2, 'b1', $3, 'second-key', 'succeeded', 'positive')`,
      [W, await id("b1"), run],
    );
    // A skipped prediction later succeeds (the update trigger's path).
    await db.query(
      "update sentiment_predictions set status = 'succeeded', label = 'neutral' where comment_id = $1",
      [await id("b2")],
    );
    // Purged text keeps the comment.
    await db.query(
      "update comments set text_raw = null, text_plain = null, content_purged_at = now() where id = $1",
      [await id("b5")],
    );
    // A deleted prediction and a deleted comment (the delete triggers' paths).
    await db.query("delete from sentiment_predictions where comment_id = $1", [
      await id("b3"),
    ]);
    await db.query("delete from comments where id = $1", [await id("b6")]);

    await drain();
    // b1 (mixed + positive) and b2 (now neutral) of the five left; b3 lost its
    // failed prediction, b4 is unsupported, b5 is purged.
    expect(await stats(v)).toEqual({ total: 5, analysed: 2 });
    expect(await stats(v)).toEqual(await exact(v));
  });

  it("draining again changes nothing", async () => {
    const v = await videoId("vid-b");
    const before = await stats(v);
    expect(await drain()).toBe(0);
    expect(await drain()).toBe(0);
    expect(await stats(v)).toEqual(before);
  });

  it("keeps a mark written while the drain is recounting that video", async () => {
    // Stand-in for a writer that commits between the drain clearing a video's
    // marks and the drain's recount: its mark must survive for the next run.
    await commit("vid-c", [comment("c1")]);
    const v = await videoId("vid-c");
    await db.exec(`
      create function pg_temp.late_writer() returns trigger language plpgsql as $$
      begin
        insert into private.video_comment_stats_dirty(workspace_id, video_id)
        values (new.workspace_id, new.video_id);
        return null;
      end $$;
      create trigger late_writer after update on private.video_comment_stats
        for each row execute function pg_temp.late_writer();
    `);
    try {
      await drain();
    } finally {
      await db.exec("drop trigger late_writer on private.video_comment_stats");
    }
    expect(await stats(v)).toEqual({ total: 1, analysed: 0 });
    expect(await marks(v)).toBe(1);
    expect(await drain()).toBe(1);
    expect(await marks(v)).toBe(0);
  });

  it("clears a mark whose video is gone instead of retrying it every minute", async () => {
    await db.query(
      "insert into private.video_comment_stats_dirty(workspace_id, video_id) values ($1, $2)",
      [W, OTHER_VIDEO],
    );
    expect(await drain()).toBe(1);
    expect(await marks(OTHER_VIDEO)).toBe(0);
  });
});

describe("refusals PostgREST would retry forever", () => {
  it("lease_lost is not a serialization failure, wherever it is raised", async () => {
    const lost = [
      [
        "select private.worker_job($1, gen_random_uuid(), gen_random_uuid())",
        [TOKEN],
      ],
      ["select private.heartbeat(gen_random_uuid(), gen_random_uuid())", []],
      [
        "select private.commit_batch(gen_random_uuid(), gen_random_uuid(), 'b', $1, '{}'::jsonb)",
        ["a".repeat(64)],
      ],
      [
        "select private.commit_checkpoint(gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 'b')",
        [],
      ],
    ] as const;
    for (const [sql, params] of lost) {
      const r = await sqlstate(sql, [...params]);
      expect(r.message).toBe("lease_lost");
      expect(RETRIED_BY_POSTGREST).not.toContain(r.code);
    }
  });

  it("stale_comment_text is not a serialization failure", async () => {
    const c = (
      await db.query<{ id: string }>(
        "select id from comments where workspace_id = $1 limit 1",
        [W],
      )
    ).rows[0].id;
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      OWNER,
    ]);
    const topic = (
      await db.query<{ key: string }>(
        "select key from workspace_topics where workspace_id = $1 and retired_at is null limit 1",
        [W],
      )
    ).rows[0]?.key;
    // Seeded with the workspace (seed_default_topics).
    expect(topic).toBeDefined();
    const reviews: [string, unknown[]][] = [
      [
        "select private.submit_comment_review_impl($1, $2, 'not-the-hash', 'positive', 'why')",
        [W, c],
      ],
      [
        "select private.submit_topic_review_impl($1, $2, 'not-the-hash', $3, 'why')",
        [W, c, topic],
      ],
    ];
    for (const [sql, params] of reviews) {
      const r = await sqlstate(sql, params);
      expect(r.message).toBe("stale_comment_text");
      expect(RETRIED_BY_POSTGREST).not.toContain(r.code);
    }
  });

  it("the gateway still answers a lost lease 409 lease_lost from the real SQL", async () => {
    // The seam: the handler with a data layer that calls the real functions and
    // throws what supabase-js throws for a PostgREST error, {code: SQLSTATE,
    // message}. The handler resolves the refusal by its message.
    const codes: (string | undefined)[] = [];
    const viaPostgrest = async (sql: string, params: unknown[]) => {
      try {
        await db.query(sql, params);
      } catch (e) {
        const err = e as { code?: string; message?: string };
        codes.push(err.code);
        throw { code: err.code, message: err.message };
      }
    };
    const real = {
      heartbeat: (hash: string, j: string, t: string) =>
        viaPostgrest("select public.svc_worker_heartbeat($1, $2, $3)", [
          hash,
          j,
          t,
        ]),
      finish: (
        hash: string,
        j: string,
        t: string,
        outcome: string,
        code: string | null,
      ) =>
        viaPostgrest("select public.svc_worker_finish($1, $2, $3, $4, $5)", [
          hash,
          j,
          t,
          outcome,
          code,
        ]),
    } as unknown as WorkerDb;
    const post = (path: string, body: unknown) =>
      handleWorkerRequest(
        new Request(`https://edge.invalid${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${BEARER}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        real,
      );
    const gone = {
      job_id: "00000000-0000-4000-9000-00000000dead",
      lease_token: "00000000-0000-4000-a000-00000000dead",
    };
    for (const [path, body] of [
      ["/worker/heartbeat", gone],
      ["/worker/finish", { ...gone, outcome: "partial" }],
    ] as const) {
      const r = await post(path, body);
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ code: "lease_lost" });
    }
    // And PostgREST would have answered once, not retried.
    expect(codes).toHaveLength(2);
    for (const code of codes) expect(RETRIED_BY_POSTGREST).not.toContain(code);
  });
});
