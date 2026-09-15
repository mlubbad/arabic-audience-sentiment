/**
 * The worker is handed what to read and reports what it found, per video.
 * The workspace comes from the credential; the list from the selection table.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const OWNER_A = "10000000-0000-4000-8000-00000000000a";
const OWNER_B = "10000000-0000-4000-8000-00000000000b";
const CRED_A = "a".repeat(64);
const CRED_B = "b".repeat(64);
let db: PGlite;

const claim = async (cred: string) =>
  (
    await db.query<{
      id: string;
      lease_token: string;
      type: string;
      channel_id: string;
    }>("select id, lease_token, type, channel_id from svc_worker_claim($1)", [
      cred,
    ])
  ).rows[0];
const one = async <T>(sql: string, params: unknown[]) =>
  (await db.query<T>(sql, params)).rows[0];

describe("worker catalogue and due lists", () => {
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
    for (const [w, owner, external, cred] of [
      [A, OWNER_A, `UC${"a".repeat(22)}`, CRED_A],
      [B, OWNER_B, `UC${"b".repeat(22)}`, CRED_B],
    ]) {
      await db.query("insert into auth.users(id) values ($1)", [owner]);
      await db.query(
        "insert into workspaces(id,name,created_by) values ($1,'w',$2)",
        [w, owner],
      );
      await db.query(
        "insert into memberships values ($1,$2,'workspace_owner')",
        [w, owner],
      );
      await db.query(
        "insert into clients(id,workspace_id,name) values ($1,$1,'c')",
        [w],
      );
      await db.query(
        `insert into channels(id,workspace_id,client_id,external_channel_id,status)
         values ($1,$1,$1,$2,'connected')`,
        [w, external],
      );
      await db.query(
        `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
         values ($1,'pilot','active',now()-interval '1 day',now()+interval '29 days')`,
        [w],
      );
      await db.query(
        "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'x',$2)",
        [cred, w],
      );
    }
  });
  afterAll(async () => {
    await db?.close();
  });

  it("a claimed discover job opens a run in discover mode", async () => {
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'discover','d1')",
      [A],
    );
    const lease = await claim(CRED_A);
    expect(lease.type).toBe("discover");
    const run = await one<{ mode: string }>(
      "select mode from sync_runs where job_id=$1",
      [lease.id],
    );
    expect(run.mode).toBe("discover");
  });

  it("commits a catalogue as videos and refuses a malformed one whole", async () => {
    const lease = await one<{ id: string; lease_token: string }>(
      "select id, lease_token from jobs where workspace_id=$1 and type='discover' and status='running'",
      [A],
    );
    await expect(
      db.query("select svc_worker_commit_catalogue($1,$2,$3,$4)", [
        CRED_A,
        lease.id,
        lease.lease_token,
        JSON.stringify([
          { external_video_id: "ok_id_11chr", title: "x" },
          { external_video_id: "too-short" },
        ]),
      ]),
    ).rejects.toThrow(/invalid_catalogue/);
    expect(
      (await db.query("select 1 from videos where workspace_id=$1", [A])).rows,
    ).toHaveLength(0);

    const r = await one<{ r: { videos: number } }>(
      "select svc_worker_commit_catalogue($1,$2,$3,$4) as r",
      [
        CRED_A,
        lease.id,
        lease.lease_token,
        JSON.stringify([
          {
            external_video_id: "aaaaaaaaaaa",
            title: "أول",
            kind: "video",
            published_at: "2026-01-01T00:00:00Z",
            thumbnail_url: "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg",
            reported_comment_count: 12,
            field_provenance: {
              source: "youtube_oauth",
              discovered_in_tabs: ["video"],
            },
          },
          {
            external_video_id: "bbbbbbbbbbb",
            title: "معطّل",
            kind: "short",
            reported_comment_count: null,
          },
        ]),
      ],
    );
    expect(r.r.videos).toBe(2);
    const rows = await db.query<{
      external_video_id: string;
      comments_state: string;
      reported_comment_count: number | null;
      kind: string;
    }>(
      "select external_video_id, comments_state, reported_comment_count, kind from videos where workspace_id=$1 order by external_video_id",
      [A],
    );
    expect(rows.rows).toEqual([
      {
        external_video_id: "aaaaaaaaaaa",
        comments_state: "open",
        reported_comment_count: 12,
        kind: "video",
      },
      {
        external_video_id: "bbbbbbbbbbb",
        comments_state: "disabled",
        reported_comment_count: null,
        kind: "short",
      },
    ]);
    const ch = await one<{ catalogued_at: string | null }>(
      "select catalogued_at from channels where id=$1",
      [A],
    );
    expect(ch.catalogued_at).not.toBeNull();
    const run = await one<{ coverage_summary: { videos_found: number } }>(
      "select coverage_summary from sync_runs where job_id=$1",
      [lease.id],
    );
    expect(run.coverage_summary.videos_found).toBe(2);
  });

  it("re-cataloguing keeps a real title over a bare id and updates the count", async () => {
    const lease = await one<{ id: string; lease_token: string }>(
      "select id, lease_token from jobs where workspace_id=$1 and type='discover' and status='running'",
      [A],
    );
    await db.query("select svc_worker_commit_catalogue($1,$2,$3,$4)", [
      CRED_A,
      lease.id,
      lease.lease_token,
      JSON.stringify([
        {
          external_video_id: "aaaaaaaaaaa",
          title: "aaaaaaaaaaa",
          reported_comment_count: 15,
        },
      ]),
    ]);
    const v = await one<{ title: string; reported_comment_count: number }>(
      "select title, reported_comment_count from videos where external_video_id='aaaaaaaaaaa'",
      [],
    );
    expect(v).toEqual({ title: "أول", reported_comment_count: 15 });
    await db.query("select svc_worker_finish($1,$2,$3,'succeeded',null)", [
      CRED_A,
      lease.id,
      lease.lease_token,
    ]);
  });

  it("another credential cannot commit into this job", async () => {
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'discover','d2')",
      [A],
    );
    const lease = await claim(CRED_A);
    await expect(
      db.query("select svc_worker_commit_catalogue($1,$2,$3,'[]')", [
        CRED_B,
        lease.id,
        lease.lease_token,
      ]),
    ).rejects.toThrow(/forbidden|lease_lost/);
    await db.query("select svc_worker_finish($1,$2,$3,'succeeded',null)", [
      CRED_A,
      lease.id,
      lease.lease_token,
    ]);
  });

  it("hands a collect claim its due list and nothing beyond the selection", async () => {
    await db.exec("reset role");
    const a = await one<{ id: string }>(
      "select id from videos where external_video_id='aaaaaaaaaaa'",
      [],
    );
    const b = await one<{ id: string }>(
      "select id from videos where external_video_id='bbbbbbbbbbb'",
      [],
    );
    await db.query(
      "insert into video_selections(workspace_id,channel_id,video_id) values ($1,$1,$2),($1,$1,$3)",
      [A, a.id, b.id],
    );
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'collect','c1')",
      [A],
    );
    const lease = await claim(CRED_A);
    expect(lease.type).toBe("collect");
    const due = await one<{
      d: { video_id: string; external_video_id: string }[];
    }>("select svc_worker_due_videos($1,$2,$3) as d", [
      CRED_A,
      lease.id,
      lease.lease_token,
    ]);
    // b is disabled: selected, but not read.
    expect(due.d.map((v) => v.external_video_id)).toEqual(["aaaaaaaaaaa"]);

    await db.query(
      "select svc_worker_video_finished($1,$2,$3,$4,'exhausted',null)",
      [CRED_A, lease.id, lease.lease_token, a.id],
    );
    const sel = await one<{ last_outcome: string; later: boolean }>(
      "select last_outcome, next_check_at > now() + interval '23 hours' as later from video_selections where video_id=$1",
      [a.id],
    );
    expect(sel).toEqual({ last_outcome: "exhausted", later: true });
    const again = await one<{ d: unknown[] }>(
      "select svc_worker_due_videos($1,$2,$3) as d",
      [CRED_A, lease.id, lease.lease_token],
    );
    expect(again.d).toEqual([]);

    await expect(
      db.query(
        "select svc_worker_video_finished($1,$2,$3,$4,'sideways',null)",
        [CRED_A, lease.id, lease.lease_token, a.id],
      ),
    ).rejects.toThrow(/invalid_outcome/);
    await db.query("select svc_worker_finish($1,$2,$3,'succeeded',null)", [
      CRED_A,
      lease.id,
      lease.lease_token,
    ]);
  });

  it("a video that refused comments is marked disabled by the collection", async () => {
    await db.exec("reset role");
    const a = await one<{ id: string }>(
      "select id from videos where external_video_id='aaaaaaaaaaa'",
      [],
    );
    await db.query(
      "update video_selections set next_check_at=now() where video_id=$1",
      [a.id],
    );
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'collect','c2')",
      [A],
    );
    const lease = await claim(CRED_A);
    await db.query(
      "select svc_worker_video_finished($1,$2,$3,$4,'blocked','comments_disabled')",
      [CRED_A, lease.id, lease.lease_token, a.id],
    );
    const v = await one<{ comments_state: string }>(
      "select comments_state from videos where id=$1",
      [a.id],
    );
    expect(v.comments_state).toBe("disabled");
    await db.query("update videos set comments_state='open' where id=$1", [
      a.id,
    ]);
    await db.query("select svc_worker_finish($1,$2,$3,'succeeded',null)", [
      CRED_A,
      lease.id,
      lease.lease_token,
    ]);
  });

  it("the tick enqueues a discover for an uncatalogued channel and a collect for due videos, once", async () => {
    await db.exec("reset role");
    // B: never catalogued, nothing selected.
    const first = await one<{ r: { discover: number; collect: number } }>(
      "select svc_worker_tick($1) as r",
      [CRED_B],
    );
    expect(first.r).toEqual({ discover: 1, collect: 0 });
    const second = await one<{ r: { discover: number; collect: number } }>(
      "select svc_worker_tick($1) as r",
      [CRED_B],
    );
    expect(second.r).toEqual({ discover: 0, collect: 0 });
    // A: catalogued today, one video due.
    const a = await one<{ id: string }>(
      "select id from videos where external_video_id='aaaaaaaaaaa'",
      [],
    );
    await db.query(
      "update video_selections set next_check_at=now()-interval '1 minute' where video_id=$1",
      [a.id],
    );
    const third = await one<{ r: { discover: number; collect: number } }>(
      "select svc_worker_tick($1) as r",
      [CRED_A],
    );
    expect(third.r).toEqual({ discover: 0, collect: 1 });
  });

  it("connecting a channel queues its first discovery", async () => {
    await db.exec("reset role");
    await db.query(
      "update jobs set status='succeeded' where workspace_id=$1 and status in ('queued','running')",
      [B],
    );
    await db.query(
      "select private.oauth_attach_channel_for($1,$2,$2,$3,'\\x00'::bytea,'k1',array['s'])",
      [OWNER_B, B, `UC${"b".repeat(22)}`],
    );
    const n = await one<{ n: number }>(
      "select count(*)::int as n from jobs where workspace_id=$1 and type='discover' and status='queued'",
      [B],
    );
    expect(n.n).toBe(1);
  });
});
