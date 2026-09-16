/**
 * A top-up pack is extra allowance on the same budget, spent after the plan's
 * units and gone when it expires. The allowance is one per billing root: a
 * client workspace spends its owner's, and a pack bought for the client lands
 * on the same shared figure.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const OWNER = "10000000-0000-4000-8000-000000000001";
const W = "00000000-0000-4000-8000-000000000001";
const C = "00000000-0000-4000-8000-000000000002";
let db: PGlite;

type Budget = {
  event_type: string;
  allowance: number;
  granted: number;
  used: number;
  remaining: number;
};
const summary = async (w: string) => {
  const r = await db.query<{ usage_summary: { budgets: Budget[] } }>(
    "select private.usage_summary_impl($1) as usage_summary",
    [w],
  );
  return r.rows[0].usage_summary;
};
const analysis = async (w: string) =>
  (await summary(w)).budgets.find((b) => b.event_type === "comment_analysis")!;
// reserve_usage caps a batch at 500 keys, so a large spend is many calls.
const reserve = async (w: string, keys: string[]) => {
  let reserved = 0;
  for (let i = 0; i < keys.length; i += 500) {
    const r = await db.query<{ reserve_usage: string[] }>(
      "select private.reserve_usage($1,'comment_analysis',$2)",
      [w, keys.slice(i, i + 500)],
    );
    reserved += r.rows[0].reserve_usage.length;
  }
  return reserved;
};
const keysFrom = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

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
  // usage_summary_impl asks has_role, which reads auth.uid(); the claim is
  // set for the session so the summary answers while the role stays high.
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    OWNER,
  ]);
  await db.query(
    "insert into workspaces(id,name,created_by) values ($1,'الرئيسية',$2)",
    [W, OWNER],
  );
  await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
    W,
    OWNER,
  ]);
  await db.query("insert into clients(workspace_id,name) values ($1,'عميل')", [
    W,
  ]);
  await db.query(
    `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
     values ($1,'creator','active',now()-interval '1 day',now()+interval '29 days')`,
    [W],
  );
};

describe("usage grants", () => {
  beforeAll(bootstrap);

  it("a pack raises the allowance for the current period", async () => {
    await db.exec("reset role");
    await db.query(
      "select private.grant_units($1,'comment_analysis',10000,'paddle','txn_1')",
      [W],
    );
    expect(await analysis(W)).toMatchObject({
      allowance: 20000,
      granted: 10000,
      used: 0,
      remaining: 20000,
    });
  });

  it("the same provider_ref grants once", async () => {
    await db.query(
      "select private.grant_units($1,'comment_analysis',10000,'paddle','txn_1')",
      [W],
    );
    const r = await db.query<{ n: number }>(
      "select count(*)::int as n from usage_grants where workspace_id=$1",
      [W],
    );
    expect(r.rows[0].n).toBe(1);
  });

  it("reserve_usage spends the plan first, then the grant, then stops", async () => {
    expect(await reserve(W, keysFrom("k", 20001))).toBe(20000);
    expect(await analysis(W)).toMatchObject({ used: 20000, remaining: 0 });
  });

  it("an expired grant counts for nothing", async () => {
    await db.query(
      "update usage_grants set expires_at = now() - interval '1 minute' where provider_ref='txn_1'",
    );
    expect((await analysis(W)).allowance).toBe(10000);
  });

  it("a plan without a ceiling reports -1 and reserves everything", async () => {
    await db.query(
      "update subscriptions set plan_key='owner' where workspace_id=$1",
      [W],
    );
    expect(await analysis(W)).toMatchObject({
      allowance: -1,
      granted: 0,
      remaining: -1,
    });
    expect(await reserve(W, keysFrom("o", 500))).toBe(500);
    await db.query(
      "update subscriptions set plan_key='creator' where workspace_id=$1",
      [W],
    );
  });
});

describe("one allowance per billing root", () => {
  beforeAll(async () => {
    // A client workspace of the same owner, billing through W: its row mirrors
    // W's and points at it, as create_workspace_impl would have written it.
    await db.exec("reset role");
    await db.query("delete from usage_events");
    await db.query("delete from usage_grants");
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'عميل ب',$2)",
      [C, OWNER],
    );
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
      C,
      OWNER,
    ]);
    await db.query(
      "insert into clients(workspace_id,name) values ($1,'عميل ب')",
      [C],
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end,billing_workspace_id)
       select $1,'creator',s.status,s.period_start,s.period_end,$2 from subscriptions s where s.workspace_id=$2`,
      [C, W],
    );
  });

  it("what the client spends shows on the root's summary", async () => {
    // The worker's role does the spending: the root lookup and the grant
    // sum must be reachable to it, not only to the migration's owner.
    await db.exec("set role service_role");
    expect(await reserve(C, keysFrom("c", 3000))).toBe(3000);
    await db.exec("reset role");
    expect(await analysis(W)).toMatchObject({ used: 3000, remaining: 7000 });
    expect(await analysis(C)).toMatchObject({ used: 3000, remaining: 7000 });
  });

  it("a pack bought for the client raises the root's allowance", async () => {
    await db.query(
      "select private.grant_units($1,'comment_analysis',10000,'paddle','txn_2')",
      [C],
    );
    expect(await analysis(W)).toMatchObject({
      allowance: 20000,
      granted: 10000,
    });
    // Its expiry follows the root's period, not a period of the client's own.
    const r = await db.query<{ ok: boolean }>(
      `select g.expires_at = s.period_end + interval '30 days' as ok
       from usage_grants g join subscriptions s on s.workspace_id=$1 where g.provider_ref='txn_2'`,
      [W],
    );
    expect(r.rows[0].ok).toBe(true);
  });

  it("the client and the root cannot together exceed the shared allowance", async () => {
    await db.query("delete from usage_events");
    await db.query("delete from usage_grants");
    expect(await reserve(W, keysFrom("w", 10000))).toBe(10000);
    expect(await reserve(C, keysFrom("x", 500))).toBe(0);
  });
});
