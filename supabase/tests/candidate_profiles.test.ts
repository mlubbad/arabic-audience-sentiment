import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const USER_A = "10000000-0000-4000-8000-0000000000a1";
const USER_B = "10000000-0000-4000-8000-0000000000b1";
const HASH = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const CANDIDATE = `UC${"c".repeat(22)}`;
let db: PGlite;

async function lease(channel = A) {
  await db.query(
    "update jobs set status='cancelled' where channel_id=$1 and type='discover' and status in ('queued','running')",
    [channel],
  );
  const { rows } = await db.query<{ id: string; lease_token: string }>(
    `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
     values ($1,$1,'discover',gen_random_uuid()::text,'running',gen_random_uuid(),now()+interval '5 minutes') returning id,lease_token`,
    [channel],
  );
  return rows[0]!;
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
  await db.query("insert into auth.users(id) values ($1),($2)", [
    USER_A,
    USER_B,
  ]);
  for (const [workspace, user, external] of [
    [A, USER_A, `UC${"A".repeat(22)}`],
    [B, USER_B, `UC${"B".repeat(22)}`],
  ]) {
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'w',$2)",
      [workspace, user],
    );
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
      workspace,
      user,
    ]);
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'c')",
      [workspace],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,status,platform) values ($1,$1,$1,$2,'connected','youtube')",
      [workspace, external],
    );
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'w',$2)",
      [workspace === A ? HASH : TOKEN_B, workspace],
    );
  }
  await db.query(
    `insert into competitor_candidates(workspace_id,channel_id,candidate_external_id,source)
    values ($1,$1,$3,'manual'),($1,$1,$3,'featured'),($2,$2,$4,'manual')`,
    [A, B, CANDIDATE, `UC${"d".repeat(22)}`],
  );
});
afterAll(async () => db.close());

describe("candidate profile SQL contract", () => {
  it("returns only due ids for this channel, capped at fifty, and checks credential and lease", async () => {
    const job = await lease();
    await db.query(
      "update competitor_candidates set profile_observed_at=now()-interval '30 days' where workspace_id=$1 and candidate_external_id=$2",
      [A, CANDIDATE],
    );
    await db.query(
      "insert into competitor_candidates(workspace_id,channel_id,candidate_external_id,source,profile_observed_at) values ($1,$1,$2,'manual',now()),($1,$1,$3,'manual',null)",
      [A, `UC${"f".repeat(22)}`, `UC${"g".repeat(22)}`],
    );
    for (let index = 0; index < 55; index += 1)
      await db.query(
        "insert into competitor_candidates(workspace_id,channel_id,candidate_external_id,source,profile_observed_at) values ($1,$1,$2,'manual',now()-interval '8 days')",
        [A, `UC${"z".repeat(18)}${index.toString().padStart(4, "0")}`],
      );
    const { rows } = await db.query<{ ids: string[] }>(
      "select svc_worker_candidates_due($1,$2,$3) ids",
      [HASH, job.id, job.lease_token],
    );
    expect(rows[0]!.ids).toHaveLength(50);
    expect(rows[0]!.ids).toContain(CANDIDATE);
    expect(rows[0]!.ids).not.toContain(`UC${"f".repeat(22)}`);
    expect(rows[0]!.ids).not.toContain(`UC${"d".repeat(22)}`);
    await expect(
      db.query("select svc_worker_candidates_due($1,$2,$3)", [
        TOKEN_B,
        job.id,
        job.lease_token,
      ]),
    ).rejects.toThrow(/forbidden/);
    await expect(
      db.query("select svc_worker_candidates_due($1,$2,$3)", [
        HASH,
        job.id,
        crypto.randomUUID(),
      ]),
    ).rejects.toThrow(/lease_lost/);
    await db.query("update jobs set status='cancelled' where id=$1", [job.id]);
  });

  it("refuses malformed commits whole and preserves every row", async () => {
    const job = await lease();
    await db.query(
      "update competitor_candidates set profile_observed_at=null where workspace_id=$1",
      [A],
    );
    const invalid = [
      "{}",
      JSON.stringify(
        Array.from({ length: 51 }, (_, i) => ({
          external_channel_id: CANDIDATE,
          subscriber_count: i,
        })),
      ),
      JSON.stringify([{ external_channel_id: `UC${"z".repeat(22)}` }]),
      JSON.stringify([
        { external_channel_id: CANDIDATE, subscriber_count: "3" },
      ]),
      JSON.stringify([
        { external_channel_id: CANDIDATE, topic_categories: ["ok", 3] },
      ]),
    ];
    for (const payload of invalid)
      await expect(
        db.query(
          "select svc_worker_commit_candidate_profiles($1,$2,$3,$4::jsonb)",
          [HASH, job.id, job.lease_token, payload],
        ),
      ).rejects.toThrow(/invalid_candidate_profiles/);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int n from competitor_candidates where workspace_id=$1 and profile_observed_at is not null",
      [A],
    );
    expect(rows[0]!.n).toBe(0);
    await db.query("update jobs set status='cancelled' where id=$1", [job.id]);
  });

  it("writes null, preserves absent fields, updates both source rows and purges at thirty days", async () => {
    const job = await lease();
    await db.query(
      "update competitor_candidates set country='TR',subscriber_count=8,profile_observed_at=now()-interval '1 day' where workspace_id=$1 and candidate_external_id=$2",
      [A, CANDIDATE],
    );
    await db.query(
      "select svc_worker_commit_candidate_profiles($1,$2,$3,$4::jsonb)",
      [
        HASH,
        job.id,
        job.lease_token,
        JSON.stringify([{ external_channel_id: CANDIDATE, country: null }]),
      ],
    );
    const { rows } = await db.query<{
      country: string | null;
      subscriber_count: number | null;
      n: number;
      observed: boolean;
    }>(
      `select min(country) country,min(subscriber_count)::int subscriber_count,count(*)::int n,bool_and(profile_observed_at is not null) observed from competitor_candidates where workspace_id=$1 and candidate_external_id=$2`,
      [A, CANDIDATE],
    );
    expect(rows[0]).toEqual({
      country: null,
      subscriber_count: 8,
      n: 2,
      observed: true,
    });
    await db.query(
      "update competitor_candidates set subscriber_count=9,view_count=12,profile_observed_at=now()-interval '31 days' where workspace_id=$1 and candidate_external_id=$2",
      [A, CANDIDATE],
    );
    await db.query(
      "update competitor_candidates set subscriber_count=9,profile_observed_at=now()-interval '29 days' where workspace_id=$1 and candidate_external_id=$2",
      [B, `UC${"d".repeat(22)}`],
    );
    await db.query("select private.purge_channel_profile('30 days','30 days')");
    const purged = await db.query<{ expired: number; recent: number }>(
      `select (select count(*)::int from competitor_candidates where workspace_id=$1 and candidate_external_id=$2 and subscriber_count is null and profile_observed_at is null) expired,(select count(*)::int from competitor_candidates where workspace_id=$3 and subscriber_count=9 and profile_observed_at is not null) recent`,
      [A, CANDIDATE, B],
    );
    expect(purged.rows[0]).toEqual({ expired: 2, recent: 1 });
  });
});
