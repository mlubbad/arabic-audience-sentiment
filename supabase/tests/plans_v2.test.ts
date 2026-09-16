/**
 * The ladder is rows. Plans carry a segment, prices and a workspace limit;
 * only an internal plan may spell a limit as null; a client workspace bills
 * through its owner's home workspace rather than carrying its own allowance.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const OWNER = "10000000-0000-4000-8000-000000000001";
let db: PGlite;
const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};
const bootstrap = async () => {
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
};

describe("plans v2", () => {
  beforeAll(bootstrap);

  it("carries the seven rows of the ladder with segment and prices", async () => {
    const r = await db.query<{
      key: string;
      segment: string;
      price_monthly_cents: number | null;
      self_serve: boolean;
    }>(
      "select key,segment,price_monthly_cents,self_serve from plans order by sort_order",
    );
    expect(r.rows.map((p) => p.key)).toEqual([
      "free",
      "creator",
      "creator_plus",
      "agency",
      "media",
      "enterprise",
      "owner",
      "pilot",
    ]);
    expect(r.rows.find((p) => p.key === "creator")).toMatchObject({
      segment: "individual",
      price_monthly_cents: 1200,
      self_serve: true,
    });
    expect(r.rows.find((p) => p.key === "media")).toMatchObject({
      segment: "business",
      price_monthly_cents: 24900,
      self_serve: false,
    });
    expect(r.rows.find((p) => p.key === "owner")).toMatchObject({
      segment: "internal",
      price_monthly_cents: 0,
    });
  });

  it("owner is unlimited and every other plan has finite limits", async () => {
    const r = await db.query<{
      key: string;
      analysis_units: number | null;
      channels_limit: number | null;
    }>(
      "select key,analysis_units,channels_limit from plans where key in ('owner','agency')",
    );
    expect(r.rows.find((p) => p.key === "owner")).toEqual({
      key: "owner",
      analysis_units: null,
      channels_limit: null,
    });
    expect(r.rows.find((p) => p.key === "agency")).toEqual({
      key: "agency",
      analysis_units: 150000,
      channels_limit: 10,
    });
  });

  it("refuses a null limit on a plan that is not internal", async () => {
    await expect(
      db.query("update plans set analysis_units=null where key='creator'"),
    ).rejects.toThrow(/plans_limits_finite_unless_internal/);
  });

  it("a personal workspace on creator cannot create a second workspace", async () => {
    // The trigger gave OWNER a personal workspace on the default plan; move it to creator.
    await db.exec("reset role");
    await db.query(
      "update subscriptions set plan_key='creator' where workspace_id=(select id from workspaces where created_by=$1)",
      [OWNER],
    );
    await as(OWNER);
    await expect(db.query("select create_workspace('second')")).rejects.toThrow(
      /workspace_limit_reached/,
    );
  });

  it("a workspace on agency can create up to five", async () => {
    await db.exec("reset role");
    await db.query(
      "update subscriptions set plan_key='agency' where workspace_id=(select id from workspaces where created_by=$1)",
      [OWNER],
    );
    await as(OWNER);
    for (let i = 0; i < 4; i++)
      await db.query("select create_workspace($1)", [`client ${i}`]);
    await expect(db.query("select create_workspace('sixth')")).rejects.toThrow(
      /workspace_limit_reached/,
    );
  });

  it("a client workspace bills through its owner's home workspace", async () => {
    await db.exec("reset role");
    const home = await db.query<{ id: string }>(
      "select id from workspaces where created_by=$1 order by created_at asc limit 1",
      [OWNER],
    );
    const client = await db.query<{ id: string; billing_workspace_id: string }>(
      "select w.id, s.billing_workspace_id from workspaces w join subscriptions s on s.workspace_id=w.id where w.name='client 0'",
    );
    expect(client.rows[0].billing_workspace_id).toBe(home.rows[0].id);
    const root = await db.query<{ root: string }>(
      "select private.billing_root($1) as root",
      [client.rows[0].id],
    );
    expect(root.rows[0].root).toBe(home.rows[0].id);
  });

  it("a client workspace reads its owner's plan limits", async () => {
    await db.exec("reset role");
    const client = await db.query<{ id: string }>(
      "select id from workspaces where name='client 0'",
    );
    // The client's own row was copied from home, so it already says agency.
    // Point it somewhere else to prove the limit is read through the root
    // and not off the client's own row.
    await db.query(
      "update subscriptions set plan_key='free' where workspace_id=$1",
      [client.rows[0].id],
    );
    const limit = await db.query<{ channels: number | null }>(
      "select private.plan_limit($1,'channels') as channels",
      [client.rows[0].id],
    );
    expect(limit.rows[0].channels).toBe(10);
  });

  it("past_due is an accepted subscription status", async () => {
    await db.exec("reset role");
    await db.query(
      "update subscriptions set status='past_due' where workspace_id=(select id from workspaces where created_by=$1 order by created_at asc limit 1)",
      [OWNER],
    );
    const r = await db.query<{ status: string }>(
      "select status from subscriptions where workspace_id=(select id from workspaces where created_by=$1 order by created_at asc limit 1)",
      [OWNER],
    );
    expect(r.rows[0].status).toBe("past_due");
  });
});
