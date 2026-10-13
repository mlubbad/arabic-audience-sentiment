import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// private.worker_topics_due read every comment of the channel in full before
// keeping 200, which on a 155k-comment channel passed the 8 s statement
// timeout on every call (57014, 2026-10-13). Its behaviour is pinned by
// worker_topics.test.ts and the quota cases there; the speed was measured on a
// production-sized local Postgres (docs/verification.md). These pin the shape
// that makes it fast, so a rebuild cannot quietly bring the full read back.
let db: PGlite;

describe("the topics batch reads only what it returns", () => {
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
  });

  afterAll(async () => {
    await db?.close();
  });

  it("carries the selection's columns in an index, so the walk reads no comment text", async () => {
    const { rows } = await db.query<{ def: string }>(
      "select pg_get_indexdef('public.comments_topic_scan'::regclass) as def",
    );
    expect(rows[0].def).toContain(
      "(workspace_id, video_id, published_at, id) INCLUDE (content_hash, author_channel_id, external_comment_id, content_purged_at)",
    );
  });

  it("walks the due comments in order and stops at the batch size", async () => {
    const { rows } = await db.query<{ src: string }>(
      `select p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname = 'worker_topics_due'`,
    );
    expect(rows).toHaveLength(1);
    const src = rows[0].src;
    expect(src).toMatch(/order by cm\.published_at nulls last, cm\.id\s+loop/);
    expect(src).toMatch(/exit when cardinality\(picked\) >= cap/);
    // The text is read for the picked rows only, and no running total is
    // computed over the whole channel any more.
    expect(src).toMatch(/from unnest\(picked\)/);
    expect(src).not.toMatch(/over \(order by/i);
  });

  it("gives the RPC its own 25 s statement timeout and keeps its other settings", async () => {
    const { rows } = await db.query<{ config: string[] | null }>(
      `select p.proconfig as config from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'svc_worker_topics_due'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].config).toContain("statement_timeout=25s");
    expect(rows[0].config).toContain('search_path=""');
  });
});
