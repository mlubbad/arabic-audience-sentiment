/**
 * A refresh discover lists only what is new, so the database must (a) tell
 * the worker what the channel already has and (b) take a list of only the
 * new videos without losing the ones it leaves out.
 *
 * Why: refresh discovers re-read every channel's whole catalogue daily and
 * spent about 7,600 of the shared project's 10,000 YouTube units
 * (2026-10-17).
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const YT = "00000000-0000-4000-8000-0000000000d1";
const OTHER = "00000000-0000-4000-8000-0000000000d2";
const FRESH = "00000000-0000-4000-8000-0000000000d3";
const TG = "00000000-0000-4000-8000-0000000000d4";
const OWNER = "10000000-0000-4000-8000-0000000000d1";
const EXTERNAL: Record<string, string> = {
  [YT]: `UC${"Y".repeat(22)}`,
  [OTHER]: `UC${"O".repeat(22)}`,
  [FRESH]: `UC${"F".repeat(22)}`,
  [TG]: "@sometelegram",
};
const PLATFORM = "e".repeat(64);
const SCOPED_OTHER = "d".repeat(64);
let db: PGlite;

type Lease = { id: string; lease_token: string };

/** A running job on the workspace's one channel, as a claim leaves it. The
 * queue holds one outstanding discover per channel, so the last one ends. */
async function lease(w: string, key: string, type = "discover") {
  await db.query(
    "update jobs set status='succeeded' where workspace_id=$1 and status in ('queued','running')",
    [w],
  );
  const { rows } = await db.query<Lease>(
    `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
     values ($1,$1,$2,$3,'running',gen_random_uuid(),now()+interval '5 minutes')
     returning id, lease_token`,
    [w, type, key],
  );
  return rows[0]!;
}

const asWorker = async () => {
  await db.exec("reset role");
  await db.exec("set role service_role");
};

async function known(job: Lease, cred = PLATFORM) {
  await asWorker();
  try {
    const { rows } = await db.query<{ k: string[] | null }>(
      "select svc_worker_known_videos($1,$2,$3) as k",
      [cred, job.id, job.lease_token],
    );
    return rows[0]!.k;
  } finally {
    await db.exec("reset role");
  }
}

async function commit(job: Lease, items: unknown[]) {
  await asWorker();
  try {
    return (
      await db.query<{ r: { videos: number } }>(
        "select svc_worker_commit_catalogue($1,$2,$3,$4) as r",
        [PLATFORM, job.id, job.lease_token, JSON.stringify(items)],
      )
    ).rows[0]!.r;
  } finally {
    await db.exec("reset role");
  }
}

const item = (w: string, id: string, extra: Record<string, unknown> = {}) => ({
  external_video_id: id,
  channel_external_id: EXTERNAL[w],
  title: `t-${id}`,
  kind: "video",
  published_at: "2026-01-01T00:00:00Z",
  reported_comment_count: 5,
  view_count: 100,
  like_count: 10,
  ...extra,
});

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
  for (const [w, platform] of [
    [YT, "youtube"],
    [OTHER, "youtube"],
    [FRESH, "youtube"],
    [TG, "telegram"],
  ] as const) {
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
       values ($1,$1,$1,$2,'public_unverified',$3)`,
      [w, EXTERNAL[w], platform],
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
  await db.query(
    "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'scoped',$2)",
    [SCOPED_OTHER, OTHER],
  );
});

afterAll(async () => {
  await db.close();
});

describe("worker_known_videos", () => {
  it("is nothing for a channel never catalogued, so its first discover reads it whole", async () => {
    expect(await known(await lease(FRESH, "k-fresh"))).toBeNull();
  });

  it("lists the channel's own videos, newest first, after a catalogue", async () => {
    const first = await lease(YT, "k-first");
    await commit(first, [
      item(YT, "aaaaaaaaaa1", { published_at: "2026-01-01T00:00:00Z" }),
      item(YT, "aaaaaaaaaa2", { published_at: "2026-03-01T00:00:00Z" }),
      item(YT, "aaaaaaaaaa3", { published_at: "2026-02-01T00:00:00Z" }),
    ]);
    // Another channel's catalogue is not this channel's knowledge.
    await commit(await lease(OTHER, "k-other"), [item(OTHER, "ooooooooooo")]);

    expect(await known(await lease(YT, "k-refresh"))).toEqual([
      "aaaaaaaaaa2",
      "aaaaaaaaaa3",
      "aaaaaaaaaa1",
    ]);
  });

  it("is nothing for a collect job or a channel that is not YouTube", async () => {
    expect(await known(await lease(YT, "k-collect", "collect"))).toBeNull();
    await commit(await lease(TG, "k-tg-first"), [
      { external_video_id: "42", kind: "channel_post" },
    ]);
    expect(await known(await lease(TG, "k-tg"))).toBeNull();
  });

  it("answers only the lease's holder and the job's own workspace", async () => {
    const job = await lease(YT, "k-guard");
    await expect(known({ id: job.id, lease_token: OWNER })).rejects.toThrow(
      /lease_lost/,
    );
    // A credential scoped to another workspace cannot read this channel's list.
    await expect(known(job, SCOPED_OTHER)).rejects.toThrow(/forbidden/);
  });

  it("caps the list at the 5,000 most recent", async () => {
    await db.query(
      `insert into videos(workspace_id,channel_id,platform,external_video_id,title,published_at)
       select $1,$1,'youtube','z' || lpad(g::text,10,'0'),'x',
              timestamptz '2020-01-01' + make_interval(hours => g)
         from generate_series(1,5100) g`,
      [YT],
    );
    const list = (await known(await lease(YT, "k-cap")))!;
    expect(list).toHaveLength(5000);
    expect(list[0]).toBe("aaaaaaaaaa2");
    // The oldest are the ones left off; the 2026 videos are newer than all.
    expect(list).not.toContain("z0000000001");
    expect(list).toContain("z0000005100");
    await db.query(
      "delete from videos where workspace_id=$1 and external_video_id like 'z%'",
      [YT],
    );
  });
});

describe("a refresh commit that lists only what is new", () => {
  it("keeps every video it leaves out exactly as it was, and adds the new", async () => {
    const before = (
      await db.query<{ external_video_id: string; snapshot: string }>(
        `select external_video_id, row(title,kind,published_at,reported_comment_count,
                comments_state,view_count,like_count,field_provenance)::text as snapshot
           from videos where workspace_id=$1 order by 1`,
        [YT],
      )
    ).rows;
    expect(before.map((r) => r.external_video_id)).toEqual([
      "aaaaaaaaaa1",
      "aaaaaaaaaa2",
      "aaaaaaaaaa3",
    ]);
    await db.query(
      `insert into video_selections(workspace_id,channel_id,video_id)
       select workspace_id, channel_id, id from videos where workspace_id=$1`,
      [YT],
    );

    const result = await commit(await lease(YT, "k-new"), [
      item(YT, "bbbbbbbbbb1", { published_at: "2026-04-01T00:00:00Z" }),
    ]);
    expect(result.videos).toBe(1);

    const after = (
      await db.query<{ external_video_id: string; snapshot: string }>(
        `select external_video_id, row(title,kind,published_at,reported_comment_count,
                comments_state,view_count,like_count,field_provenance)::text as snapshot
           from videos where workspace_id=$1 order by 1`,
        [YT],
      )
    ).rows;
    expect(after.filter((r) => r.external_video_id !== "bbbbbbbbbb1")).toEqual(
      before,
    );
    expect(after.map((r) => r.external_video_id)).toContain("bbbbbbbbbb1");
    const { rows: sel } = await db.query<{ n: number }>(
      "select count(*)::int as n from video_selections where workspace_id=$1",
      [YT],
    );
    expect(sel[0]!.n).toBe(3);
  });

  it("takes an empty list when nothing is new, and the channel counts as catalogued now", async () => {
    await db.query(
      "update channels set catalogued_at = now() - interval '2 days' where id=$1",
      [YT],
    );
    const result = await commit(await lease(YT, "k-empty"), []);
    expect(result.videos).toBe(0);
    const { rows } = await db.query<{ fresh: boolean; n: number }>(
      `select c.catalogued_at > now() - interval '1 minute' as fresh,
              (select count(*)::int from videos v where v.workspace_id=c.workspace_id) as n
         from channels c where c.id=$1`,
      [YT],
    );
    expect(rows[0]).toEqual({ fresh: true, n: 4 });
  });

  it("is out of reach of every role but the gateway's", async () => {
    const job = await lease(YT, "k-roles");
    for (const role of ["authenticated", "anon"]) {
      await db.exec(`set role ${role}`);
      await expect(
        db.query("select svc_worker_known_videos($1,$2,$3)", [
          PLATFORM,
          job.id,
          job.lease_token,
        ]),
      ).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });
});
