/**
 * The live check reads a video only when its comment count moved.
 *
 * Every due video used to cost a commentThreads page even when nothing had
 * changed. videos.list(part=statistics) answers fifty counts for one unit; the
 * worker sends those counts here first, and the server defers every selected
 * video whose count is exactly what it was at the last exhausted read.
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
// Eleven characters, as the catalogue requires.
const V1 = "aaaaaaaaaaa";
const V2 = "bbbbbbbbbbb";
const V3 = "ccccccccccc";
const VB = "ddddddddddd";
let db: PGlite;

const asWorker = async () => {
  await db.exec("reset role");
  await db.exec("set role service_role");
};
const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];

type Lease = { id: string; lease_token: string };
type Answer = { read: string[]; unchanged: number; updated: number };

const claim = async (cred: string): Promise<Lease> => {
  await asWorker();
  return (
    await db.query<Lease>("select id, lease_token from svc_worker_claim($1)", [
      cred,
    ])
  ).rows[0];
};
const counts = async (lease: Lease, payload: unknown, cred = CRED_A) => {
  await asWorker();
  return (
    await one<{ r: Answer }>(
      "select svc_worker_video_counts($1,$2,$3,$4) as r",
      [cred, lease.id, lease.lease_token, JSON.stringify(payload)],
    )
  ).r;
};
const due = async (lease: Lease) => {
  await asWorker();
  const r = await one<{ d: { external_video_id: string }[] }>(
    "select svc_worker_due_videos($1,$2,$3) as d",
    [CRED_A, lease.id, lease.lease_token],
  );
  return r.d.map((v) => v.external_video_id);
};
const videoId = async (external: string, w = A) =>
  (
    await one<{ id: string }>(
      "select id from videos where workspace_id=$1 and external_video_id=$2",
      [w, external],
    )
  ).id;
const selection = (external: string, w = A) =>
  one<{
    last_outcome: string | null;
    last_seen_comment_count: number | null;
    deferred: boolean;
  }>(
    `select s.last_outcome, s.last_seen_comment_count,
            s.next_check_at > now() + interval '23 hours' as deferred
       from video_selections s join videos v on v.workspace_id=s.workspace_id and v.id=s.video_id
      where s.workspace_id=$1 and v.external_video_id=$2`,
    [w, external],
  );
const stored = (external: string, w = A) =>
  one<{ reported_comment_count: number | null; stamped: boolean }>(
    "select reported_comment_count, reported_comment_count_at is not null as stamped from videos where workspace_id=$1 and external_video_id=$2",
    [w, external],
  );

describe("the live check by comment count", () => {
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
    // Three catalogued videos in A, one in B, all selected and due.
    for (const [w, external, count] of [
      [A, V1, 10],
      [A, V2, 20],
      [A, V3, 30],
      [B, VB, 40],
    ] as const) {
      await db.query(
        `insert into videos(workspace_id,channel_id,external_video_id,title,reported_comment_count,comments_state)
         values ($1,$1,$2,$2,$3,'open')`,
        [w, external, count],
      );
      await db.query(
        `insert into video_selections(workspace_id,channel_id,video_id)
         select $1,$1,id from videos where workspace_id=$1 and external_video_id=$2`,
        [w, external],
      );
    }
  });

  it("carries the last seen and reported counts on the due list", async () => {
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'collect','c0')",
      [A],
    );
    const lease = await claim(CRED_A);
    await asWorker();
    const r = await one<{
      d: {
        external_video_id: string;
        last_seen_comment_count: number | null;
        reported_comment_count: number | null;
      }[];
    }>("select svc_worker_due_videos($1,$2,$3) as d", [
      CRED_A,
      lease.id,
      lease.lease_token,
    ]);
    expect(r.d.map((v) => v.external_video_id)).toEqual([V1, V2, V3]);
    expect(r.d[0]).toMatchObject({
      last_seen_comment_count: null,
      reported_comment_count: 10,
    });
  });

  it("(d) a selection never read stays due whatever count arrives", async () => {
    const lease = await one<Lease>(
      "select id, lease_token from jobs where workspace_id=$1 and status='running'",
      [A],
    );
    const answer = await counts(lease, [
      { external_video_id: V1, comment_count: 10 },
      { external_video_id: V2, comment_count: 20 },
      { external_video_id: V3, comment_count: 30 },
    ]);
    expect(answer).toEqual({ read: [V1, V2, V3], unchanged: 0, updated: 3 });
    expect(await due(lease)).toEqual([V1, V2, V3]);
    expect(await stored(V1)).toEqual({
      reported_comment_count: 10,
      stamped: true,
    });
  });

  it("(e) an exhausted read records the count it was read at", async () => {
    const lease = await one<Lease>(
      "select id, lease_token from jobs where workspace_id=$1 and status='running'",
      [A],
    );
    await asWorker();
    for (const v of [V1, V2, V3])
      await db.query(
        "select svc_worker_video_finished($1,$2,$3,$4,'exhausted',null)",
        [CRED_A, lease.id, lease.lease_token, await videoId(v)],
      );
    expect(await selection(V1)).toEqual({
      last_outcome: "exhausted",
      last_seen_comment_count: 10,
      deferred: true,
    });
    await asWorker();
    await db.query("select svc_worker_finish($1,$2,$3,'succeeded',null)", [
      CRED_A,
      lease.id,
      lease.lease_token,
    ]);
    // Everything is due again for the checks that follow, in a known order.
    await db.exec("reset role");
    for (const [v, mins] of [
      [V1, 3],
      [V2, 2],
      [V3, 1],
    ] as const)
      await db.query(
        "update video_selections s set next_check_at=now()-make_interval(mins => $2) from videos v where v.workspace_id=s.workspace_id and v.id=s.video_id and v.external_video_id=$1",
        [v, mins],
      );
    await db.query(
      "update jobs set created_at=now()-interval '2 hours' where workspace_id=$1",
      [A],
    );
  });

  it("(a)(b)(c) an unchanged count defers; a moved or unknown count keeps the video due", async () => {
    await db.query(
      "insert into jobs(workspace_id,channel_id,type,dedupe_key) values ($1,$1,'collect','c1')",
      [A],
    );
    const lease = await claim(CRED_A);
    expect(await due(lease)).toEqual([V1, V2, V3]);
    const answer = await counts(lease, [
      { external_video_id: V1, comment_count: 10 },
      { external_video_id: V2, comment_count: 21 },
      { external_video_id: V3, comment_count: null },
    ]);
    // V1 is unchanged and deferred; V2 moved; V3's count is unknown, and
    // unknown is never "the same".
    expect(answer).toEqual({ read: [V2, V3], unchanged: 1, updated: 3 });
    expect(await due(lease)).toEqual([V2, V3]);
    expect(await selection(V1)).toEqual({
      last_outcome: "unchanged",
      last_seen_comment_count: 10,
      deferred: true,
    });
    expect(await selection(V2)).toMatchObject({
      last_outcome: "exhausted",
      deferred: false,
    });
    // The moved count is stored; the unknown one leaves the old value alone
    // but still records that the source was asked.
    expect(await stored(V2)).toEqual({
      reported_comment_count: 21,
      stamped: true,
    });
    expect(await stored(V3)).toEqual({
      reported_comment_count: 30,
      stamped: true,
    });
  });

  it("a video deferred as unchanged is deferred again while the count holds", async () => {
    // last_seen was written by an exhausted read and no read has happened
    // since, so it is still the truth to compare against. Reading every
    // second check would halve the saving the check exists for.
    await db.exec("reset role");
    await db.query(
      "update video_selections s set next_check_at=now()-interval '1 minute' from videos v where v.workspace_id=s.workspace_id and v.id=s.video_id and v.external_video_id=$1",
      [V1],
    );
    const lease = await one<Lease>(
      "select id, lease_token from jobs where workspace_id=$1 and status='running'",
      [A],
    );
    const answer = await counts(lease, [
      { external_video_id: V1, comment_count: 10 },
    ]);
    expect(answer).toEqual({ read: [V2, V3], unchanged: 1, updated: 1 });
    expect(await selection(V1)).toMatchObject({
      last_outcome: "unchanged",
      deferred: true,
    });
  });

  it("(d2) a selection read before the count existed stays due until read again", async () => {
    // Every selection that existed before this migration is exactly this:
    // last_outcome 'exhausted', last_seen_comment_count null. Its count
    // cannot be "the same"; it is read once more and then compared.
    await db.exec("reset role");
    await db.query(
      `update video_selections s set last_seen_comment_count=null, last_outcome='exhausted',
              next_check_at=now()-interval '1 minute'
         from videos v where v.workspace_id=s.workspace_id and v.id=s.video_id and v.external_video_id=$1`,
      [V3],
    );
    const lease = await one<Lease>(
      "select id, lease_token from jobs where workspace_id=$1 and status='running'",
      [A],
    );
    const answer = await counts(lease, [
      { external_video_id: V3, comment_count: 30 },
    ]);
    expect(answer).toEqual({ read: [V2, V3], unchanged: 0, updated: 1 });
    expect(await selection(V3)).toMatchObject({
      last_outcome: "exhausted",
      last_seen_comment_count: null,
      deferred: false,
    });
  });

  it("(f) ids of another workspace, and ids nobody catalogued, are ignored", async () => {
    const lease = await one<Lease>(
      "select id, lease_token from jobs where workspace_id=$1 and status='running'",
      [A],
    );
    const answer = await counts(lease, [
      { external_video_id: VB, comment_count: 40 },
      { external_video_id: "zzzzzzzzzzz", comment_count: 1 },
    ]);
    expect(answer).toEqual({ read: [V2, V3], unchanged: 0, updated: 0 });
    await db.exec("reset role");
    expect(await stored(VB, B)).toEqual({
      reported_comment_count: 40,
      stamped: false,
    });
  });

  it("(g) a malformed item refuses the whole call and writes nothing", async () => {
    const lease = await one<Lease>(
      "select id, lease_token from jobs where workspace_id=$1 and status='running'",
      [A],
    );
    for (const payload of [
      {},
      [{ external_video_id: V2, comment_count: 22 }, "not an object"],
      [{ external_video_id: "short", comment_count: 1 }],
      [{ external_video_id: V2, comment_count: "22" }],
      [{ external_video_id: V2, comment_count: -1 }],
      [{ external_video_id: V2, comment_count: 2.5 }],
      [{ external_video_id: V2 }],
    ]) {
      await expect(counts(lease, payload)).rejects.toThrow(/invalid_counts/);
    }
    await db.exec("reset role");
    expect(await stored(V2)).toMatchObject({ reported_comment_count: 21 });
  });

  it("another credential cannot report counts into this job", async () => {
    const lease = await one<Lease>(
      "select id, lease_token from jobs where workspace_id=$1 and status='running'",
      [A],
    );
    await expect(
      counts(lease, [{ external_video_id: V2, comment_count: 99 }], CRED_B),
    ).rejects.toThrow(/forbidden|lease_lost/);
  });

  it("(h) a tenant cannot execute the wrapper or the primitive", async () => {
    const lease = await one<Lease>(
      "select id, lease_token from jobs where workspace_id=$1 and status='running'",
      [A],
    );
    await db.exec("reset role");
    // The privilege itself. A runtime refusal alone would also come from the
    // private schema the wrapper reaches into, and hide an open wrapper.
    for (const role of ["authenticated", "anon"]) {
      const p = await one<{ wrapper: boolean; primitive: boolean }>(
        `select has_function_privilege($1, 'public.svc_worker_video_counts(text,uuid,uuid,jsonb)', 'execute') as wrapper,
                has_function_privilege($1, 'private.worker_video_counts(text,uuid,uuid,jsonb)', 'execute') as primitive`,
        [role],
      );
      expect(p).toEqual({ wrapper: false, primitive: false });
    }
    const svc = await one<{ wrapper: boolean }>(
      "select has_function_privilege('service_role', 'public.svc_worker_video_counts(text,uuid,uuid,jsonb)', 'execute') as wrapper",
    );
    expect(svc.wrapper).toBe(true);
    await db.exec("set role authenticated");
    await expect(
      db.query("select svc_worker_video_counts($1,$2,$3,'[]')", [
        CRED_A,
        lease.id,
        lease.lease_token,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select private.worker_video_counts($1,$2,$3,'[]')", [
        CRED_A,
        lease.id,
        lease.lease_token,
      ]),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });
});

afterAll(async () => {
  await db?.close();
});
