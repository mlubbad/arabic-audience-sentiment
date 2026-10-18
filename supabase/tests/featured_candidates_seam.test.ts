import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { FeaturedCandidatesCommitSchema } from "../../packages/contracts/src/index";

const WORKSPACE = "00000000-0000-4000-8000-000000000023";
const USER = "10000000-0000-4000-8000-000000000023";
const TOKEN_HASH = "3".repeat(64);
const CHANNEL = `UC${"x".repeat(22)}`;
const envelope = JSON.parse(
  readFileSync("workers/python/tests/fixtures/golden_featured.json", "utf8"),
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
    `insert into channels(id,workspace_id,client_id,external_channel_id,status,platform)
     values ($1,$1,$1,$2,'connected','youtube')`,
    [WORKSPACE, CHANNEL],
  );
  await db.query(
    "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'worker',$2)",
    [TOKEN_HASH, WORKSPACE],
  );
  const result = await db.query<{ id: string; lease_token: string }>(
    `insert into jobs(id,workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
     values ($1,$2,$2,'discover','featured-seam','running',$3,now()+interval '5 minutes')
     returning id,lease_token`,
    [
      "20000000-0000-4000-8000-000000000001",
      WORKSPACE,
      "30000000-0000-4000-8000-000000000001",
    ],
  );
  job = result.rows[0]!;
});

afterAll(async () => db.close());

it("commits the Python-built strict envelope through real SQL", async () => {
  const parsed = FeaturedCandidatesCommitSchema.parse(envelope);
  expect(parsed.job_id).toBe(job.id);
  expect(parsed.lease_token).toBe(job.lease_token);
  await db.query("select svc_worker_commit_featured($1,$2,$3,$4,$5)", [
    TOKEN_HASH,
    parsed.job_id,
    parsed.lease_token,
    parsed.batch_key,
    JSON.stringify(parsed.candidates),
  ]);
  const rows = await db.query<{
    candidate_external_id: string;
    title: string | null;
    handle: string | null;
  }>(
    `select candidate_external_id,title,handle from competitor_candidates
      where workspace_id=$1 order by candidate_external_id`,
    [WORKSPACE],
  );
  expect(rows.rows).toEqual(parsed.candidates);
});
