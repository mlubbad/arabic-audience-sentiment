/**
 * A claim names the kinds of work its caller can run.
 *
 * An operator's one-shot collection run once claimed whatever job was oldest
 * and ran it as a collection. The oldest job that day was a queued `analyse`
 * job: it was claimed, held, and finished «succeeded» with nothing classified
 * — recorded as work done that nobody had done. The claim now carries the
 * caller's kinds, and the database never hands across the boundary.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000001";
let db: PGlite;

const enqueue = async (type: string, key: string) =>
  (
    await db.query<{ id: string; type: string }>(
      `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,not_before)
       values ($1,$1,$2,$3,'queued',now()) returning id, type`,
      [W, type, key],
    )
  ).rows[0];
/** Claim as a caller able to run the named kinds; null is no preference. */
const claim = async (types: string[] | null) =>
  types === null
    ? (
        await db.query<{ id: string; type: string }>(
          "select * from private.claim_job($1)",
          [W],
        )
      ).rows
    : (
        await db.query<{ id: string; type: string }>(
          "select * from private.claim_job($1, $2)",
          [W, types],
        )
      ).rows;

describe("a claim scoped to the work its caller can run", () => {
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
    await db.exec("reset role");
    await db.query("insert into auth.users(id) values ($1)", [OWNER]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'w',$2)",
      [W, OWNER],
    );
    await db.query(
      "insert into memberships(workspace_id,user_id,role) values ($1,$2,'workspace_owner') on conflict do nothing",
      [W, OWNER],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'c')",
      [W],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,status) values ($1,$1,$1,$2,'connected')",
      [W, `UC${"b".repeat(22)}`],
    );
  });

  it("never hands a collection run the topics job that is older", async () => {
    const analyse = await enqueue("analyse", "k-analyse-1");
    const collect = await enqueue("collect", "k-collect-1");
    const got = await claim(["collect"]);
    // The analyse job is older and due, and the claim leaves it alone: a
    // worker without a classifier would otherwise hold its lease and finish
    // it with nothing classified.
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe(collect.id);
    expect(got[0].id).not.toBe(analyse.id);
  });

  it("hands a topics worker the analyse job it asked for", async () => {
    await enqueue("collect", "k-collect-2");
    const analyse = await enqueue("analyse", "k-analyse-2");
    const got = await claim(["analyse"]);
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe(analyse.id);
  });

  it("orders what it can run by due time, not by type", async () => {
    const first = await enqueue("discover", "k-discover-1");
    const second = await enqueue("collect", "k-collect-3");
    const got = await claim(["collect", "discover"]);
    expect(got.map((j) => j.id)).toEqual([first.id, second.id]);
  });

  it("claims everything when no kind is named", async () => {
    await enqueue("analyse", "k-analyse-3");
    const got = await claim(null);
    // The unscoped call is what a worker able to run every kind still sends.
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe("analyse");
  });

  it("the two-argument RPC door exists and still derives the tenant", async () => {
    await enqueue("collect", "k-collect-4");
    // The scoped RPC resolves the workspace from the credential first: an
    // unknown credential is refused before any job is read, exactly like the
    // single-argument door beside it.
    await expect(
      db.query("select * from svc_worker_claim($1, $2)", [
        "no-such-credential-hash",
        ["collect"],
      ]),
    ).rejects.toThrow(/invalid_worker_credential/);
  });
});
