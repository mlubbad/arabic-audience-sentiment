import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OWNER = "10000000-0000-4000-8000-000000000001";
const ANALYST = "10000000-0000-4000-8000-000000000002";
const VIEWER = "10000000-0000-4000-8000-000000000003";
const OUTSIDER = "10000000-0000-4000-8000-000000000004";
const ADMIN = "10000000-0000-4000-8000-000000000005";
const WORKSPACE = "20000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";

let db: PGlite;

async function as(role: "authenticated" | "anon", sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    sub ?? "",
  ]);
  await db.exec(`set role ${role}`);
}

async function myRole(w: string) {
  const { rows } = await db.query<{ role: string | null }>(
    "select public.my_role($1) as role",
    [w],
  );
  return rows[0]?.role ?? null;
}

describe("my_role: the caller's own role in one workspace", () => {
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
    for (const filename of readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      await db.exec(readFileSync(`supabase/migrations/${filename}`, "utf8"));
    }

    await db.exec("reset role");
    await db.query(
      `insert into auth.users(id,email) values
        ($1,'owner@example.test'),($2,'analyst@example.test'),
        ($3,'viewer@example.test'),($4,'outsider@example.test'),
        ($5,'admin@example.test')`,
      [OWNER, ANALYST, VIEWER, OUTSIDER, ADMIN],
    );
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      ADMIN,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'shared',$3),($2,'other',$3)",
      [WORKSPACE, OTHER, OWNER],
    );
    await db.query(
      `insert into memberships values
        ($1,$2,'workspace_owner'),($1,$3,'analyst'),($1,$4,'viewer'),
        ($5,$2,'workspace_owner')`,
      [WORKSPACE, OWNER, ANALYST, VIEWER, OTHER],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("answers each member's own role", async () => {
    await as("authenticated", OWNER);
    expect(await myRole(WORKSPACE)).toBe("workspace_owner");
    await as("authenticated", ANALYST);
    expect(await myRole(WORKSPACE)).toBe("analyst");
    await as("authenticated", VIEWER);
    expect(await myRole(WORKSPACE)).toBe("viewer");
  });

  it("answers null, not an error, for a workspace the caller is not in", async () => {
    await as("authenticated", OUTSIDER);
    expect(await myRole(WORKSPACE)).toBeNull();
    await as("authenticated", ANALYST);
    expect(await myRole(OTHER)).toBeNull();
  });

  it("gives a platform admin no role in a workspace they are not a member of", async () => {
    await as("authenticated", ADMIN);
    expect(await myRole(WORKSPACE)).toBeNull();
  });

  it("answers null for a caller with no verified subject", async () => {
    await as("authenticated", null);
    expect(await myRole(WORKSPACE)).toBeNull();
  });

  it("is not callable by anon", async () => {
    await as("anon", null);
    await expect(myRole(WORKSPACE)).rejects.toThrow(/permission denied/i);
  });
});
