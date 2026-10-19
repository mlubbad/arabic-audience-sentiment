import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-0000000000c1";
const OWNER = "10000000-0000-4000-8000-0000000000c1";
const CRED = "c".repeat(64);
const LEASE = "20000000-0000-4000-8000-0000000000c1";
let db: PGlite;

describe("Python genre record to PostgreSQL seam", () => {
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
      .filter((file) => file.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.query("insert into auth.users(id) values ($1)", [OWNER]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'W',$2)",
      [W, OWNER],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'W')",
      [W],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id) values ($1,$1,$1,'UC_W')",
      [W],
    );
    await db.query(
      "insert into videos(workspace_id,channel_id,external_video_id,title) values ($1,$1,'video-golden','Golden')",
      [W],
    );
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'golden',$2)",
      [CRED, W],
    );
  });

  afterAll(async () => db?.close());

  it("commits the fixture written by the real Python builder", async () => {
    const fixture = JSON.parse(
      readFileSync("workers/python/tests/fixtures/golden_genres.json", "utf8"),
    ) as { batch_key: string; records: unknown[] };
    const job = (
      await db.query<{ id: string }>(
        `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
         values ($1,$1,'genre_classify','golden','running',$2,now()+interval '1 hour') returning id`,
        [W, LEASE],
      )
    ).rows[0];
    const result = await db.query<{ value: { stored: number } }>(
      "select public.svc_worker_commit_genres($1,$2,$3,$4,$5::jsonb) value",
      [CRED, job.id, LEASE, fixture.batch_key, JSON.stringify(fixture.records)],
    );
    expect(result.rows[0].value.stored).toBe(1);
    expect(
      (
        await db.query<{ genre_key: string }>(
          "select genre_key from video_genre_predictions where workspace_id=$1",
          [W],
        )
      ).rows[0].genre_key,
    ).toBe("sports_football");
  });
});
