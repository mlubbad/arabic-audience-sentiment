/**
 * A catalogue is filed under the job's channel only when its videos are that
 * channel's, and the videos another channel uploaded can be taken back out.
 *
 * The incident (2026-10-12 → 2026-10-16): a worker built before the platform
 * reader read the reader's token as the channel owner's and listed
 * `mine=true` — the reader's own channel, AJ360 — for public channels' discover
 * jobs. Its 4,604 uploads were filed under 73 public channels, because nothing
 * between the source's answer and `public.videos` asked whose they were.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const READER_WS = "00000000-0000-4000-8000-0000000000a1";
const PUBLIC_WS = "00000000-0000-4000-8000-0000000000b1";
const TG_WS = "00000000-0000-4000-8000-0000000000c1";
const OWNER = "10000000-0000-4000-8000-0000000000a1";
const READER = `UC${"R".repeat(22)}`;
const PUBLIC = `UC${"P".repeat(22)}`;
const PLATFORM = "f".repeat(64);
let db: PGlite;

const ids = async (sql: string, params: unknown[]) =>
  (await db.query<{ v: string }>(sql, params)).rows.map((r) => r.v).sort();

/** A running discover job on the workspace's one channel, as a claim leaves it. */
async function lease(w: string, key: string) {
  const { rows } = await db.query<{ id: string; lease_token: string }>(
    `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
     values ($1,$1,'discover',$2,'running',gen_random_uuid(),now()+interval '5 minutes')
     returning id, lease_token`,
    [w, key],
  );
  return rows[0]!;
}

const commit = (job: { id: string; lease_token: string }, items: unknown[]) =>
  db.query<{ r: { videos: number } }>(
    "select private.worker_commit_catalogue($1,$2,$3,$4) as r",
    [PLATFORM, job.id, job.lease_token, JSON.stringify(items)],
  );

let seq = 0;
/** A video under the workspace's channel with one judged, reviewed comment. */
async function videoWithComment(w: string, external: string) {
  seq++;
  const { rows: v } = await db.query<{ id: string }>(
    `insert into videos(workspace_id,channel_id,external_video_id,title,field_provenance)
     values ($1,$1,$2,$2,'{"source":"youtube_oauth"}') returning id`,
    [w, external],
  );
  const { rows: c } = await db.query<{ id: string }>(
    `insert into comments(workspace_id,video_id,external_comment_id,text_raw,text_plain,
       content_hash,timestamp_precision,source)
     values ($1,$2,$3,'t','t',$4,'second','test') returning id`,
    [w, v[0]!.id, `c-${seq}`, `h-${seq}`],
  );
  await db.query(
    `insert into analysis_runs(workspace_id,model_id,revision_sha,preprocessing_version,status)
     values ($1,'m','sha','v1','succeeded') on conflict do nothing`,
    [w],
  );
  await db.query(
    `insert into sentiment_predictions(workspace_id,comment_id,content_hash,analysis_run_id,
       analysis_key,status,label)
     select $1,$2,$3,id,'k','succeeded','positive' from analysis_runs where workspace_id=$1 limit 1`,
    [w, c[0]!.id, `h-${seq}`],
  );
  await db.query(
    `insert into comment_reviews(workspace_id,comment_id,content_hash,label,reviewer_id,reason)
     values ($1,$2,$3,'negative',$4,'checked')`,
    [w, c[0]!.id, `h-${seq}`, OWNER],
  );
  await db.query(
    "insert into video_selections(workspace_id,channel_id,video_id) values ($1,$1,$2)",
    [w, v[0]!.id],
  );
}

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
  for (const [w, external, status, platform] of [
    [READER_WS, READER, "connected", "youtube"],
    [PUBLIC_WS, PUBLIC, "public_unverified", "youtube"],
    [TG_WS, "@somechannel", "public_unverified", "telegram"],
  ]) {
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'w',$2)",
      [w, OWNER],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'c')",
      [w],
    );
    await db.query(
      `insert into channels(id,workspace_id,client_id,external_channel_id,status,platform)
       values ($1,$1,$1,$2,$3,$4)`,
      [w, external, status, platform],
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'owner','active',now()-interval '1 day',now()+interval '29 days')`,
      [w],
    );
  }
  await db.query(
    "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'platform',null)",
    [PLATFORM],
  );
});

afterAll(async () => {
  await db.close();
});

describe("a catalogue names its channel", () => {
  it("refuses whole a list with another channel's videos, or one that does not say whose", async () => {
    const job = await lease(PUBLIC_WS, "d-guard");
    // The incident's list: the reader's own uploads, sent for a public channel.
    await expect(
      commit(job, [
        { external_video_id: "pppppppppp1", channel_external_id: PUBLIC },
        { external_video_id: "rrrrrrrrrr1", channel_external_id: READER },
      ]),
    ).rejects.toThrow(/catalogue_channel_mismatch/);
    // A worker older than the name: it cannot say, so it is not believed.
    await expect(
      commit(job, [{ external_video_id: "rrrrrrrrrr1", title: "x" }]),
    ).rejects.toThrow(/catalogue_channel_mismatch/);
    expect(
      await ids(
        "select external_video_id as v from videos where workspace_id=$1",
        [PUBLIC_WS],
      ),
    ).toEqual([]);

    const ok = await commit(job, [
      { external_video_id: "pppppppppp1", channel_external_id: PUBLIC },
    ]);
    expect(ok.rows[0]!.r.videos).toBe(1);
  });

  it("asks only of YouTube, whose API names the uploader", async () => {
    const job = await lease(TG_WS, "d-tg");
    const ok = await commit(job, [
      { external_video_id: "123", kind: "channel_post" },
    ]);
    expect(ok.rows[0]!.r.videos).toBe(1);
  });
});

describe("purge_foreign_catalogue", () => {
  it("takes another channel's videos out of a channel, with everything hung on them", async () => {
    await videoWithComment(READER_WS, "rrrrrrrrrr2");
    await videoWithComment(READER_WS, "rrrrrrrrrr3");
    // The public channel: its own video, and two of the reader's filed under it.
    await videoWithComment(PUBLIC_WS, "pppppppppp2");
    await videoWithComment(PUBLIC_WS, "rrrrrrrrrr2");
    await videoWithComment(PUBLIC_WS, "rrrrrrrrrr3");

    const { rows } = await db.query<{
      r: { videos: number; comments: number };
    }>("select private.purge_foreign_catalogue($1,$2) as r", [
      PUBLIC_WS,
      READER,
    ]);
    expect(rows[0]!.r).toEqual({ videos: 2, comments: 2 });

    expect(
      await ids(
        "select external_video_id as v from videos where workspace_id=$1",
        [PUBLIC_WS],
      ),
    ).toEqual(["pppppppppp1", "pppppppppp2"]);
    for (const table of [
      "comments",
      "sentiment_predictions",
      "comment_reviews",
      "video_selections",
    ])
      expect(
        (
          await db.query<{ n: number }>(
            `select count(*)::int as n from ${table} where workspace_id=$1`,
            [PUBLIC_WS],
          )
        ).rows[0]!.n,
      ).toBe(1);
    // The reader's own channel keeps its own videos, and asking it to purge
    // itself is a no-op.
    expect(
      await ids(
        "select external_video_id as v from videos where workspace_id=$1",
        [READER_WS],
      ),
    ).toEqual(["rrrrrrrrrr2", "rrrrrrrrrr3"]);
    const self = await db.query<{ r: { videos: number } }>(
      "select private.purge_foreign_catalogue($1,$2) as r",
      [READER_WS, READER],
    );
    expect(self.rows[0]!.r.videos).toBe(0);
  });

  it("is out of reach of every API role", async () => {
    for (const role of ["service_role", "authenticated", "anon"]) {
      await db.exec(`set role ${role}`);
      await expect(
        db.query("select private.purge_foreign_catalogue($1,$2)", [
          PUBLIC_WS,
          READER,
        ]),
      ).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });
});
