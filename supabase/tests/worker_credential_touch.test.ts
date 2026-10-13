import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Every worker request authenticates through private.worker_workspace. It used
// to UPDATE the credential's row on each call, which held the row's lock to the
// end of the transaction: a claim or a commit queued behind a tick using the
// same credential until the 8 s statement timeout (57014, 2026-10-13).
// PGlite is one connection, so the lock itself is reproduced against a real
// Postgres (docs/verification.md); these pin the behaviour and the shape.
const W = "00000000-0000-4000-8000-000000000001";
const owner = "10000000-0000-4000-8000-000000000001";
const ACTIVE = "a".repeat(64);
const PLATFORM = "p".repeat(64);
const REVOKED = "r".repeat(64);
let db: PGlite;

const workspaceOf = async (hash: string) =>
  (
    await db.query<{ w: string | null }>(
      "select private.worker_workspace($1) as w",
      [hash],
    )
  ).rows[0].w;
const lastSeen = async (hash: string) =>
  (
    await db.query<{ t: Date | null }>(
      "select last_seen_at as t from private.worker_credentials where token_hash = $1",
      [hash],
    )
  ).rows[0].t;

describe("worker credential authentication", () => {
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
    await db.query("insert into auth.users(id) values ($1)", [owner]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'W',$2)",
      [W, owner],
    );
    await db.query(
      `insert into private.worker_credentials(token_hash,label,workspace_id,status)
       values ($1,'tenant',$4,'active'),($2,'platform',null,'active'),($3,'old',$4,'revoked')`,
      [ACTIVE, PLATFORM, REVOKED, W],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  it("answers the credential's workspace, and null for the platform credential", async () => {
    expect(await workspaceOf(ACTIVE)).toBe(W);
    expect(await workspaceOf(PLATFORM)).toBeNull();
  });

  it("refuses a revoked or unknown credential with 42501", async () => {
    for (const hash of [REVOKED, "z".repeat(64)])
      await expect(workspaceOf(hash)).rejects.toMatchObject({
        code: "42501",
        message: "invalid_worker_credential",
      });
    expect(await lastSeen(REVOKED)).toBeNull();
  });

  it("touches last_seen_at at most once a minute", async () => {
    await db.query(
      "update private.worker_credentials set last_seen_at = null where token_hash = $1",
      [ACTIVE],
    );
    await workspaceOf(ACTIVE);
    const first = await lastSeen(ACTIVE);
    expect(first).not.toBeNull();

    // Within the minute: authenticated, not written again.
    await db.query(
      "update private.worker_credentials set last_seen_at = now() - interval '30 seconds' where token_hash = $1",
      [ACTIVE],
    );
    const recent = await lastSeen(ACTIVE);
    expect(await workspaceOf(ACTIVE)).toBe(W);
    expect(await lastSeen(ACTIVE)).toEqual(recent);

    // Older than a minute: refreshed.
    await db.query(
      "update private.worker_credentials set last_seen_at = now() - interval '2 minutes' where token_hash = $1",
      [ACTIVE],
    );
    const stale = (await lastSeen(ACTIVE))!;
    await workspaceOf(ACTIVE);
    expect((await lastSeen(ACTIVE))!.getTime()).toBeGreaterThan(
      stale.getTime() + 60_000,
    );
  });

  it("never waits on another request's lock to record a sighting", async () => {
    const { rows } = await db.query<{ src: string }>(
      `select p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname = 'worker_workspace'`,
    );
    expect(rows).toHaveLength(1);
    // The only write is behind `skip locked`; authentication is a plain read.
    expect(rows[0].src).toMatch(/for update skip locked/);
    expect(rows[0].src.match(/\bupdate\b/gi)).toHaveLength(2);
    expect(rows[0].src).not.toMatch(/returning/i);
  });

  it("gives the tick its own 25 s statement timeout and keeps its other settings", async () => {
    const { rows } = await db.query<{ config: string[] | null }>(
      `select p.proconfig as config from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'svc_worker_tick'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].config).toContain("statement_timeout=25s");
    expect(rows[0].config).toContain('search_path=""');
  });
});
