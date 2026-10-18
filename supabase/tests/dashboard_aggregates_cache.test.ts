import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const owner = "10000000-0000-4000-8000-000000000001";
const stranger = "10000000-0000-4000-8000-000000000002";

let db: PGlite;

async function as(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}

type Cache = { state: string; computed_at?: string; error?: string };
async function read(f: object = {}) {
  await as(owner);
  const r = await db.query<{ r: Record<string, unknown> & { cache?: Cache } }>(
    "select public.dashboard_aggregates($1, $2::jsonb) as r",
    [W, JSON.stringify(f)],
  );
  return r.rows[0].r;
}
async function drain() {
  await db.exec("reset role");
  await db.exec("select private.drain_dashboard_aggregates(5)");
}

// A read must never compute: the page used to scan every comment of the
// workspace on each load, under a 30 s ceiling, and failed with 57014 once the
// workspace outgrew it. Reads now answer from a cache that the drain fills.
describe("dashboard_aggregates answers from a cache the drain fills", () => {
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
      .sort()) {
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    }
    await db.query("insert into auth.users(id) values ($1),($2)", [
      owner,
      stranger,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'Cache WS',$2)",
      [W, owner],
    );
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
      W,
      owner,
    ]);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("a first read computes nothing and says the numbers are being prepared", async () => {
    const r = await read();
    expect(r.cache?.state).toBe("pending");
    expect(r.total).toBeUndefined();
  });

  it("the drain computes the payload; the next read returns it as fresh", async () => {
    await drain();
    const r = await read();
    expect(r.cache?.state).toBe("fresh");
    expect(r.total).toBe(0);
    expect(r.sentiments).toEqual({
      positive: 0,
      negative: 0,
      neutral: 0,
      mixed: 0,
    });
  });

  it("an old payload is still served, marked stale, and queued for refresh", async () => {
    await db.exec("reset role");
    await db.exec(
      "update private.dashboard_aggregates_cache set computed_at = now() - interval '10 minutes', requested_at = now() - interval '10 minutes'",
    );
    const r = await read();
    expect(r.cache?.state).toBe("stale");
    expect(r.total).toBe(0);
    await drain();
    expect((await read()).cache?.state).toBe("fresh");
  });

  it("each distinct filter set has its own entry", async () => {
    const r = await read({ sentiment: "negative" });
    expect(r.cache?.state).toBe("pending");
    await drain();
    expect((await read({ sentiment: "negative" })).cache?.state).toBe("fresh");
  });

  it("a failed compute is reported with its database code and backs off", async () => {
    await db.exec("reset role");
    await db.exec(
      "update private.dashboard_aggregates_cache set filters = '{\"from\":\"not a date\"}'::jsonb where filters ? 'sentiment'",
    );
    await db.exec(
      "update private.dashboard_aggregates_cache set payload = null, computed_at = null, requested_at = now() where filters ? 'from'",
    );
    await drain();
    const r = await read({ sentiment: "negative" });
    expect(r.cache?.state).toBe("failed");
    expect(r.cache?.error).toMatch(/^[0-9A-Z]{5}$/);
    await db.exec("reset role");
    const rows = await db.query<{ attempts: number }>(
      "select attempts from private.dashboard_aggregates_cache where filters ? 'from'",
    );
    expect(rows.rows[0].attempts).toBe(1);
    await drain(); // inside the back-off window: not tried again
    const again = await db.query<{ attempts: number }>(
      "select attempts from private.dashboard_aggregates_cache where filters ? 'from'",
    );
    expect(again.rows[0].attempts).toBe(1);
  });

  it("a stranger is refused, and cannot read or fill the cache", async () => {
    await as(stranger);
    await expect(
      db.query("select public.dashboard_aggregates($1, '{}'::jsonb)", [W]),
    ).rejects.toThrow(/forbidden/);
    await expect(
      db.query("select * from private.dashboard_aggregates_cache"),
    ).rejects.toThrow();
  });

  it("entries nobody has read for a week are dropped by the drain", async () => {
    await db.exec("reset role");
    await db.exec(
      "update private.dashboard_aggregates_cache set requested_at = now() - interval '8 days'",
    );
    await drain();
    const n = await db.query<{ n: string }>(
      "select count(*) as n from private.dashboard_aggregates_cache",
    );
    expect(Number(n.rows[0].n)).toBe(0);
  });
});
