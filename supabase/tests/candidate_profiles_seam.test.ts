import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { CandidateProfilesCommit } from "../../packages/contracts/src/index";

const WORKSPACE = "00000000-0000-4000-8000-000000000025";
const USER = "10000000-0000-4000-8000-000000000025";
const TOKEN_HASH = "5".repeat(64);
const CANDIDATE = `UC${"c".repeat(22)}`;
const envelope = JSON.parse(
  readFileSync("workers/python/tests/fixtures/golden_candidates.json", "utf8"),
) as unknown;
let db: PGlite;
let job: { id: string; lease_token: string };

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
  await db.query("insert into auth.users(id) values ($1)", [USER]);
  await db.query(
    "insert into workspaces(id,name,created_by) values ($1,'workspace',$2)",
    [WORKSPACE, USER],
  );
  await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
    WORKSPACE,
    USER,
  ]);
  await db.query(
    "insert into clients(id,workspace_id,name) values ($1,$1,'client')",
    [WORKSPACE],
  );
  await db.query(
    "insert into channels(id,workspace_id,client_id,external_channel_id,status,platform) values ($1,$1,$1,$2,'connected','youtube')",
    [WORKSPACE, `UC${"x".repeat(22)}`],
  );
  await db.query(
    "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'worker',$2)",
    [TOKEN_HASH, WORKSPACE],
  );
  await db.query(
    "insert into competitor_candidates(workspace_id,channel_id,candidate_external_id,source) values ($1,$1,$2,'manual')",
    [WORKSPACE, CANDIDATE],
  );
  const { rows } = await db.query<{ id: string; lease_token: string }>(
    `insert into jobs(id,workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
    values ('20000000-0000-4000-8000-000000000001',$1,$1,'discover','candidate-seam','running','30000000-0000-4000-8000-000000000001',now()+interval '5 minutes') returning id,lease_token`,
    [WORKSPACE],
  );
  job = rows[0]!;
});
afterAll(async () => db.close());

it("commits the Python-built strict envelope through the real service RPC", async () => {
  const parsed = CandidateProfilesCommit.parse(envelope);
  expect(parsed.job_id).toBe(job.id);
  expect(parsed.lease_token).toBe(job.lease_token);
  await db.query(
    "select svc_worker_commit_candidate_profiles($1,$2,$3,$4::jsonb)",
    [
      TOKEN_HASH,
      parsed.job_id,
      parsed.lease_token,
      JSON.stringify(parsed.profiles),
    ],
  );
  const { rows } = await db.query<{
    subscriber_count: number;
    country: string;
    profile_observed_at: Date;
  }>(
    "select subscriber_count,country,profile_observed_at from competitor_candidates where workspace_id=$1 and candidate_external_id=$2",
    [WORKSPACE, CANDIDATE],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ subscriber_count: 12, country: "TR" });
  expect(rows[0]!.profile_observed_at).toBeInstanceOf(Date);
});
