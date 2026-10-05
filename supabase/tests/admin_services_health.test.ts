import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const MEMBER = "10000000-0000-4000-8000-000000000002";
const RESTORE = "20261009010000_restore_admin_services_health.sql";

let db: PGlite;

async function as(role: "authenticated" | "anon", sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    sub ?? "",
  ]);
  await db.exec(`set role ${role}`);
}

async function functionExists() {
  await db.exec("reset role");
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_services_health'`,
  );
  return rows[0]!.n;
}

describe("restoring admin_services_health", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
      create function public.__pgrst_probe() returns int language sql as 'select 42';
      create function public.__pgrst_probe2(text) returns int language sql as 'select 42';
      create function public.__pgrst_probe2(text, text[]) returns int language sql as 'select 42';`);
    // Every migration before the restore, as production holds them.
    for (const filename of readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql") && name < RESTORE)
      .sort()) {
      await db.exec(readFileSync(`supabase/migrations/${filename}`, "utf8"));
    }
    await db.exec("reset role");
    await db.query(
      "insert into auth.users(id,email) values ($1,'admin@example.test'),($2,'member@example.test')",
      [ADMIN, MEMBER],
    );
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      ADMIN,
    ]);
  });

  afterAll(async () => {
    await db.close();
  });

  it("brings the function back where production lost it", async () => {
    // Production's state on 2026-10-05: the version recorded, no function.
    await db.exec("drop function public.admin_services_health()");
    expect(await functionExists()).toBe(0);

    await db.exec(readFileSync(`supabase/migrations/${RESTORE}`, "utf8"));
    expect(await functionExists()).toBe(1);

    await as("authenticated", ADMIN);
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      "select public.admin_services_health() as r",
    );
    expect(rows[0]!.r).toMatchObject({
      database: expect.any(Object),
      worker: expect.any(Object),
    });
  });

  it("is a no-op where the function already exists", async () => {
    await db.exec("reset role");
    await db.exec(readFileSync(`supabase/migrations/${RESTORE}`, "utf8"));
    expect(await functionExists()).toBe(1);
  });

  it("still refuses a non-admin and anon", async () => {
    await as("authenticated", MEMBER);
    await expect(
      db.query("select public.admin_services_health()"),
    ).rejects.toThrow(/forbidden/);
    await as("anon", null);
    await expect(
      db.query("select public.admin_services_health()"),
    ).rejects.toThrow(/permission denied/i);
  });
});
