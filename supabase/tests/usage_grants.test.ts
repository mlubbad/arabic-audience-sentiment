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

describe("the pre-check gates agree with the meter", () => {
  // Video selection and the worker's topic due-list ask these helpers before
  // reserve_usage is reached; a figure that differs from the meter's refuses
  // what a pack paid for or lets a paused ledger through.
  const analysisRemaining = async (w: string) =>
    (
      await db.query<{ n: number }>(
        "select private.analysis_remaining($1) as n",
        [w],
      )
    ).rows[0].n;
  const topicRemaining = async (w: string) =>
    (
      await db.query<{ n: number | null }>(
        "select private.topic_units_remaining($1) as n",
        [w],
      )
    ).rows[0].n;

  it("count a pack after the plan's units are spent", async () => {
    // W spent its 10,000 in the test above; a pack of 10,000 reopens the gate.
    await db.exec("reset role");
    expect(await analysisRemaining(W)).toBe(0);
    await db.query(
      "select private.grant_units($1,'comment_analysis',10000,'paddle','txn_3')",
      [W],
    );
    expect(await analysisRemaining(W)).toBe(10000);
    expect(await topicRemaining(W)).toBe(4000);
    await db.query(
      "select private.grant_units($1,'topic_classification',1000,'admin','manual_1')",
      [W],
    );
    expect(await topicRemaining(W)).toBe(5000);
  });

  it("still answer while a payment is being retried", async () => {
    await db.query(
      "update subscriptions set status='past_due' where workspace_id=$1",
      [W],
    );
    expect(await analysisRemaining(W)).toBe(10000);
    expect(await topicRemaining(W)).toBe(5000);
    await db.query(
      "update subscriptions set status='active' where workspace_id=$1",
      [W],
    );
  });

  it("carry a past-due subscription seven days past its period, and the meter agrees", async () => {
    // The grace is the code's, not Paddle's period: three days past the end
    // all three still answer; eight days past, all three refuse — the same
    // moment billing_sweep would have dropped the row to free.
    // The period moves as a whole (period_end must follow period_start),
    // so the spend keyed on the old period_start no longer counts: the plan's
    // 10,000 and the pack's 10,000 are both unspent on the new one.
    const before = (
      await db.query<{ period_start: string }>(
        "select period_start from subscriptions where workspace_id=$1",
        [W],
      )
    ).rows[0].period_start;
    await db.query(
      "update subscriptions set status='past_due', period_start=now()-interval '33 days', period_end=now()-interval '3 days' where workspace_id=$1",
      [W],
    );
    expect(await analysisRemaining(W)).toBe(20000);
    expect(await topicRemaining(W)).toBe(5000);
    expect(await reserve(W, ["grace-0"])).toBe(1);
    expect(await analysisRemaining(W)).toBe(19999);
    await db.query(
      "update subscriptions set period_end=now()-interval '8 days' where workspace_id=$1",
      [W],
    );
    await expect(
      db.query("select private.analysis_remaining($1)", [W]),
    ).rejects.toThrow(/no_active_plan/);
    expect(await topicRemaining(W)).toBeNull();
    await expect(
      db.query("select private.reserve_usage($1,'comment_analysis',$2)", [
        W,
        ["grace-1"],
      ]),
    ).rejects.toThrow(/plan_inactive/);
    // An active subscription past its period is closed at once: no grace.
    await db.query(
      "update subscriptions set status='active', period_end=now()-interval '1 minute' where workspace_id=$1",
      [W],
    );
    await expect(
      db.query("select private.analysis_remaining($1)", [W]),
    ).rejects.toThrow(/no_active_plan/);
    await db.query(
      "update subscriptions set status='active', period_start=$2, period_end=now()+interval '29 days' where workspace_id=$1",
      [W, before],
    );
    await db.query("delete from usage_events where event_key='grace-0'");
    expect(await analysisRemaining(W)).toBe(10000);
  });

  it("answer null for a plan without a ceiling", async () => {
    await db.query(
      "update subscriptions set plan_key='owner' where workspace_id=$1",
      [W],
    );
    expect(await analysisRemaining(W)).toBeNull();
    expect(await topicRemaining(W)).toBeNull();
    await db.query(
      "update subscriptions set plan_key='creator' where workspace_id=$1",
      [W],
    );
  });

  it("answer the client workspace with its root's figure", async () => {
    expect(await analysisRemaining(C)).toBe(await analysisRemaining(W));
    expect(await topicRemaining(C)).toBe(await topicRemaining(W));
  });
});
