import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// PostgREST applies a statement_timeout only when it is set on the function
// the RPC names. Every public dashboard read must therefore carry its own;
// a timeout set on the private implementation alone left the reads at the
// `authenticated` role's 8 s and failed them with 57014 (2026-10-07).
let db: PGlite;

describe("dashboard RPC statement timeouts", () => {
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

  it("sets 30 s on every public dashboard_* function", async () => {
    const { rows } = await db.query<{
      name: string;
      config: string[] | null;
      definer: boolean;
    }>(
      `select p.proname as name, p.proconfig as config, p.prosecdef as definer
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'dashboard\\_%'
       order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        "dashboard_aggregates",
        "dashboard_comments",
        "dashboard_snapshot",
      ]),
    );
    for (const row of rows) {
      expect(row.config ?? [], row.name).toContain("statement_timeout=30s");
      // ALTER ... SET must not drop the existing settings or the definer.
      expect(row.config ?? [], row.name).toContain('search_path=""');
      expect(row.definer, row.name).toBe(true);
    }
  });
});
