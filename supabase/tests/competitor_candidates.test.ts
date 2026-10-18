import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const LIMIT_CHANNEL = "00000000-0000-4000-8000-0000000000a2";
const TELEGRAM_CHANNEL = "00000000-0000-4000-8000-0000000000a3";
const OWNER_A = "10000000-0000-4000-8000-0000000000a1";
const OWNER_B = "10000000-0000-4000-8000-0000000000b1";
const VIEWER_A = "10000000-0000-4000-8000-0000000000a2";
const CHANNEL_A = `UC${"A".repeat(22)}`;
const CHANNEL_B = `UC${"B".repeat(22)}`;
const C1 = `UC${"c".repeat(22)}`;
const C2 = `UC${"d".repeat(22)}`;
const HASH = "a".repeat(64);
let db: PGlite;

async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}

async function admin() {
  await db.exec("reset role");
}

async function lease(channel = A) {
  await admin();
  await db.query(
    "update jobs set status='cancelled' where workspace_id=$1 and channel_id=$2 and type='discover' and status in ('queued','running')",
    [A, channel],
  );
  const { rows } = await db.query<{ id: string; lease_token: string }>(
    `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
     values ($1,$2,'discover',gen_random_uuid()::text,'running',gen_random_uuid(),now()+interval '5 minutes')
     returning id,lease_token`,
    [A, channel],
  );
  return rows[0]!;
}

async function commit(
  job: { id: string; lease_token: string },
  key: string,
  candidates: unknown[],
) {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    "select svc_worker_commit_featured($1,$2,$3,$4,$5) result",
    [HASH, job.id, job.lease_token, key, JSON.stringify(candidates)],
  );
  return rows[0]!.result;
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
  for (const file of readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values ($1),($2),($3)", [
    OWNER_A,
    OWNER_B,
    VIEWER_A,
  ]);
  await db.query(
    "insert into workspaces(id,name,created_by) values ($1,'A',$3),($2,'B',$4)",
    [A, B, OWNER_A, OWNER_B],
  );
  await db.query(
    `insert into memberships(workspace_id,user_id,role) values
       ($1,$3,'workspace_owner'),($2,$4,'workspace_owner'),($1,$5,'viewer')`,
    [A, B, OWNER_A, OWNER_B, VIEWER_A],
  );
  await db.query(
    "insert into clients(id,workspace_id,name) values ($1,$1,'A'),($2,$2,'B')",
    [A, B],
  );
  await db.query(
    `insert into channels(id,workspace_id,client_id,external_channel_id,status,platform) values
      ($1,$1,$1,$4,'connected','youtube'),($2,$2,$2,$5,'connected','youtube'),
      ($3,$1,$1,$6,'connected','youtube'),($7,$1,$1,'@telegram','connected','telegram')`,
    [
      A,
      B,
      LIMIT_CHANNEL,
      CHANNEL_A,
      CHANNEL_B,
      `UC${"L".repeat(22)}`,
      TELEGRAM_CHANNEL,
    ],
  );
  await db.query(
    "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'worker',$2)",
    [HASH, A],
  );
});

afterAll(async () => db.close());

describe("manual competitor candidates", () => {
  it("adds, merges sources in the list, and removes only the manual source", async () => {
    await user(OWNER_A);
    await db.query("select competitor_candidate_add($1,$2,$3,$4)", [
      A,
      C1,
      "Manual",
      "@manual",
    ]);
    await db.query("select competitor_candidate_add($1,$2,null,null)", [A, C1]);
    const metadata = await db.query<{ title: string; handle: string }>(
      "select title,handle from competitor_candidates where channel_id=$1 and candidate_external_id=$2 and source='manual'",
      [A, C1],
    );
    expect(metadata.rows).toEqual([{ title: "Manual", handle: "@manual" }]);
    await admin();
    await db.query(
      `insert into competitor_candidates(workspace_id,channel_id,candidate_external_id,title,handle,source)
       values ($1,$1,$2,'Featured','@featured','featured')`,
      [A, C1],
    );
    await user(VIEWER_A);
    const listed = await db.query<{
      candidate_external_id: string;
      sources: string[];
    }>("select candidate_external_id,sources from competitor_candidates($1)", [
      A,
    ]);
    expect(listed.rows).toEqual([
      { candidate_external_id: C1, sources: ["featured", "manual"] },
    ]);
    await user(OWNER_A);
    await db.query("select competitor_candidate_remove($1,$2)", [A, C1]);
    const sources = await db.query<{ source: string }>(
      "select source from competitor_candidates where channel_id=$1 and candidate_external_id=$2",
      [A, C1],
    );
    expect(sources.rows).toEqual([{ source: "featured" }]);
  });

  it("refuses bad ids, self candidates, viewers, non-members and the 101st manual row", async () => {
    await user(OWNER_A);
    await expect(
      db.query("select competitor_candidate_add($1,'bad',null,null)", [A]),
    ).rejects.toThrow(/invalid_input/);
    await expect(
      db.query("select competitor_candidate_add($1,$2,null,null)", [
        A,
        CHANNEL_A,
      ]),
    ).rejects.toThrow(/invalid_candidate/);
    await user(VIEWER_A);
    await expect(
      db.query("select competitor_candidate_add($1,$2,null,null)", [A, C2]),
    ).rejects.toThrow(/forbidden/);
    await user(OWNER_B);
    await expect(
      db.query("select competitor_candidate_add($1,$2,null,null)", [A, C2]),
    ).rejects.toThrow(/forbidden/);

    await admin();
    for (let index = 0; index < 100; index += 1)
      await db.query(
        `insert into competitor_candidates(workspace_id,channel_id,candidate_external_id,source,added_by)
         values ($1,$2,$3,'manual',$4)`,
        [A, LIMIT_CHANNEL, `UC${index.toString().padStart(22, "0")}`, OWNER_A],
      );
    await user(OWNER_A);
    await expect(
      db.query("select competitor_candidate_add($1,$2,null,null)", [
        LIMIT_CHANNEL,
        C2,
      ]),
    ).rejects.toThrow(/candidate_limit_reached/);
  });

  it("keeps workspace rows isolated under RLS and direct RPC calls", async () => {
    await admin();
    await db.query(
      `insert into competitor_candidates(workspace_id,channel_id,candidate_external_id,source,added_by)
       values ($1,$1,$3,'manual',$4),($2,$2,$5,'manual',$6)`,
      [A, B, C2, OWNER_A, `UC${"e".repeat(22)}`, OWNER_B],
    );
    await user(OWNER_A);
    const rows = await db.query<{ workspace_id: string }>(
      "select workspace_id from competitor_candidates",
    );
    expect(rows.rows.every((row) => row.workspace_id === A)).toBe(true);
    await expect(
      db.query("select * from competitor_candidates($1)", [B]),
    ).rejects.toThrow(/forbidden/);
  });
});

describe("featured candidates", () => {
  it("answers due by age and platform under a live discover lease", async () => {
    for (const [channel, age, expected] of [
      [A, null, true],
      [A, "8 days", true],
      [A, "6 days", false],
      [TELEGRAM_CHANNEL, null, false],
    ] as const) {
      await admin();
      await db.query(
        "update channels set featured_checked_at=case when $2::text is null then null else now()-$2::interval end where id=$1",
        [channel, age],
      );
      const job = await lease(channel);
      const { rows } = await db.query<{ result: { due: boolean } }>(
        "select svc_worker_featured_due($1,$2,$3) result",
        [HASH, job.id, job.lease_token],
      );
      expect(rows[0]!.result.due).toBe(expected);
    }
  });

  it("refuses every malformed batch whole", async () => {
    const job = await lease();
    const invalid = [
      [{ candidate_external_id: "bad", title: null, handle: null }],
      [{ candidate_external_id: CHANNEL_A, title: null, handle: null }],
      [
        { candidate_external_id: C1, title: null, handle: null },
        { candidate_external_id: C1, title: null, handle: null },
      ],
      [{ candidate_external_id: C1, title: "x".repeat(201), handle: null }],
      Array.from({ length: 101 }, (_, index) => ({
        candidate_external_id: `UC${index.toString().padStart(22, "0")}`,
        title: null,
        handle: null,
      })),
    ];
    for (let index = 0; index < invalid.length; index += 1)
      await expect(
        commit(job, `bad-${index}`, invalid[index]!),
      ).rejects.toThrow(/invalid_batch/);
    const count = await db.query<{ n: number }>(
      "select count(*)::int n from competitor_candidates where channel_id=$1 and source='featured'",
      [A],
    );
    expect(count.rows[0]!.n).toBe(1);
  });

  it("replays safely, detects conflicts, replaces featured rows and preserves manual rows", async () => {
    const job = await lease();
    const first = [
      { candidate_external_id: C1, title: "One", handle: "@one" },
      { candidate_external_id: C2, title: "Two", handle: null },
    ];
    expect(await commit(job, "featured-1", first)).toEqual({
      replayed: false,
      stored: 2,
    });
    expect(await commit(job, "featured-1", first)).toEqual({
      replayed: true,
      stored: 0,
    });
    await expect(commit(job, "featured-1", [first[0]!])).rejects.toThrow(
      /batch_conflict/,
    );
    await commit(job, "featured-2", [first[1]!]);
    const c1 = await db.query<{ source: string }>(
      "select source from competitor_candidates where channel_id=$1 and candidate_external_id=$2 order by source",
      [A, C1],
    );
    expect(c1.rows).toEqual([]);
    await user(OWNER_A);
    await db.query("select competitor_candidate_add($1,$2,'Manual',null)", [
      A,
      C2,
    ]);
    await admin();
    await commit(job, "featured-3", []);
    const remaining = await db.query<{ source: string }>(
      "select source from competitor_candidates where channel_id=$1 and candidate_external_id=$2",
      [A, C2],
    );
    expect(remaining.rows).toEqual([{ source: "manual" }]);
    const channel = await db.query<{ checked: boolean }>(
      "select featured_checked_at is not null checked from channels where id=$1",
      [A],
    );
    expect(channel.rows[0]!.checked).toBe(true);
  });
});
