import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A workspace whose rows arrived after the tables' last ANALYZE was estimated
// at one row, the planner chose nested loops, and the comparison recount for
// a 25,849-comment channel ran past the 2-minute cron limit on every attempt
// (production, 2026-10-13). Reproduced locally: cancelled at 150 s, 1.03 s
// with nested loops off. The two background counts therefore plan without
// nested loops, and the tables the worker writes most refresh their
// statistics after 1 % of their rows change (20261027000000).
let db: PGlite;

describe("background counts plan without stale estimates", () => {
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
      .sort()) {
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    }
  });

  afterAll(async () => {
    await db?.close();
  });

  it("turns nested loops off for the channel recount and the stats reconcile", async () => {
    const { rows } = await db.query<{
      name: string;
      config: string[] | null;
      definer: boolean;
    }>(
      `select p.proname as name, p.proconfig as config, p.prosecdef as definer
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private'
         and p.proname in ('refresh_channel_compare_channel', 'reconcile_video_comment_stats')
       order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual([
      "reconcile_video_comment_stats",
      "refresh_channel_compare_channel",
    ]);
    for (const row of rows) {
      expect(row.config ?? [], row.name).toContain("enable_nestloop=off");
      // ALTER ... SET must keep the existing settings and the definer.
      expect(row.config ?? [], row.name).toContain('search_path=""');
      expect(row.definer, row.name).toBe(true);
    }
  });

  it("refreshes statistics after 1 % change on the tables the worker writes most", async () => {
    const { rows } = await db.query<{ name: string; options: string[] | null }>(
      `select c.relname as name, c.reloptions as options
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('comments', 'sentiment_predictions', 'topic_predictions', 'videos')
       order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual([
      "comments",
      "sentiment_predictions",
      "topic_predictions",
      "videos",
    ]);
    for (const row of rows) {
      expect(row.options ?? [], row.name).toContain(
        "autovacuum_analyze_scale_factor=0.01",
      );
    }
  });
});
