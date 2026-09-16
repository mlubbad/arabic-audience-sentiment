/**
 * A platform admin is a row in a private table, not a role claim. Only that
 * row lets set_workspace_plan, admin_workspaces and grant_pack act — and
 * every hand activation leaves an audit_events row behind.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const ADMIN = "10000000-0000-4000-8000-00000000000a";
const USER = "10000000-0000-4000-8000-00000000000b";
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
  await db.query("insert into auth.users(id) values ($1),($2)", [ADMIN, USER]);
  await db.query("insert into private.platform_admins(user_id) values ($1)", [
    ADMIN,
  ]);
};

describe("platform admin", () => {
  beforeAll(bootstrap);

  it("a member is not a platform admin; the listed user is", async () => {
    await as(USER);
    expect(
      (await db.query<{ ok: boolean }>("select is_platform_admin() as ok"))
        .rows[0].ok,
    ).toBe(false);
    await as(ADMIN);
    expect(
      (await db.query<{ ok: boolean }>("select is_platform_admin() as ok"))
        .rows[0].ok,
    ).toBe(true);
  });

  it("only an admin may set a plan, and the change is audited", async () => {
    // The previous test left the session as ADMIN; a plain select against
    // workspaces is still RLS-scoped to the caller's own memberships, so
    // reset to the superuser role before looking up USER's workspace by id.
    await db.exec("reset role");
    const w = (
      await db.query<{ id: string }>(
        "select id from workspaces where created_by=$1",
        [USER],
      )
    ).rows[0].id;
    await as(USER);
    await expect(
      db.query("select set_workspace_plan($1,'agency',1,'manual')", [w]),
    ).rejects.toThrow(/forbidden/);
    await as(ADMIN);
    const r = await db.query<{
      set_workspace_plan: { plan_key: string; status: string };
    }>("select set_workspace_plan($1,'agency',1,'invoice 17')", [w]);
    expect(r.rows[0].set_workspace_plan).toMatchObject({
      plan_key: "agency",
      status: "active",
    });
    await db.exec("reset role");
    const audit = await db.query<{
      action: string;
      actor_id: string;
      target_id: string;
    }>(
      "select action,actor_id,target_id from audit_events where workspace_id=$1",
      [w],
    );
    expect(audit.rows).toEqual([
      { action: "plan_set", actor_id: ADMIN, target_id: "agency" },
    ]);
    const sub = await db.query<{ provider: string; provider_ref: string }>(
      "select provider,provider_ref from subscriptions where workspace_id=$1",
      [w],
    );
    expect(sub.rows[0]).toEqual({
      provider: "admin",
      provider_ref: "invoice 17",
    });
  });

  it("setting the owner plan removes every ceiling", async () => {
    await db.exec("reset role");
    const w = (
      await db.query<{ id: string }>(
        "select id from workspaces where created_by=$1",
        [ADMIN],
      )
    ).rows[0].id;
    await as(ADMIN);
    const r = await db.query<{
      set_workspace_plan: { budgets: { allowance: number }[] };
    }>("select set_workspace_plan($1,'owner',1200,'self')", [w]);
    expect(
      r.rows[0].set_workspace_plan.budgets.every((b) => b.allowance === -1),
    ).toBe(true);
  });

  it("admin_workspaces lists everyone; a member sees forbidden", async () => {
    await as(USER);
    await expect(db.query("select * from admin_workspaces()")).rejects.toThrow(
      /forbidden/,
    );
    await as(ADMIN);
    const r = await db.query<{ admin_workspaces: { plan_key: string } }>(
      "select * from admin_workspaces()",
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
    // The trigger gives ADMIN and USER one personal workspace each; the two
    // prior tests moved USER's onto agency and ADMIN's onto owner.
    expect(r.rows.map((x) => x.admin_workspaces.plan_key).sort()).toEqual([
      "agency",
      "owner",
    ]);
  });

  it("grant_pack is admin-only and idempotent on the note", async () => {
    await db.exec("reset role");
    const w = (
      await db.query<{ id: string }>(
        "select id from workspaces where created_by=$1",
        [USER],
      )
    ).rows[0].id;
    await as(USER);
    await expect(
      db.query("select grant_pack($1,'comment_analysis',10000,'gift-1')", [w]),
    ).rejects.toThrow(/forbidden/);
    await as(ADMIN);
    const a = await db.query<{ grant_pack: string }>(
      "select grant_pack($1,'comment_analysis',10000,'gift-1')",
      [w],
    );
    const b = await db.query<{ grant_pack: string }>(
      "select grant_pack($1,'comment_analysis',10000,'gift-1')",
      [w],
    );
    expect(a.rows[0].grant_pack).toBe(b.rows[0].grant_pack);
  });

  it("activating a client workspace's plan propagates to the root and every sibling", async () => {
    // USER's home is on agency (test 2) with a workspace limit of 5, so two
    // clients fit. Both start out billing through home, per
    // create_workspace_impl copying the home row.
    await as(USER);
    await db.query("select create_workspace('client a')");
    await db.query("select create_workspace('client b')");

    await db.exec("reset role");
    const home = (
      await db.query<{ id: string }>(
        "select id from workspaces where created_by=$1 order by created_at asc limit 1",
        [USER],
      )
    ).rows[0].id;
    const clientA = (
      await db.query<{ id: string }>(
        "select id from workspaces where name=$1",
        ["client a"],
      )
    ).rows[0].id;

    // The admin activates a plan on the CLIENT workspace, not the root.
    await as(ADMIN);
    await db.query(
      "select set_workspace_plan($1,'creator_plus',2,'propagate')",
      [clientA],
    );

    await db.exec("reset role");

    // (a) the home's own subscription row carries the new terms.
    const homeSub = (
      await db.query<{
        plan_key: string;
        provider: string;
        provider_ref: string;
        period_end: string;
      }>(
        "select plan_key, provider, provider_ref, period_end from subscriptions where workspace_id=$1",
        [home],
      )
    ).rows[0];
    expect(homeSub).toMatchObject({
      plan_key: "creator_plus",
      provider: "admin",
      provider_ref: "propagate",
    });

    // (b) client b, never named in the call, followed the root it bills
    // through and still points at it.
    const clientBSub = (
      await db.query<{
        plan_key: string;
        provider_ref: string;
        period_end: string;
        billing_workspace_id: string;
      }>(
        "select s.plan_key, s.provider_ref, s.period_end, s.billing_workspace_id from workspaces w join subscriptions s on s.workspace_id=w.id where w.name=$1",
        ["client b"],
      )
    ).rows[0];
    expect(clientBSub).toEqual({
      plan_key: "creator_plus",
      provider_ref: "propagate",
      period_end: homeSub.period_end,
      billing_workspace_id: home,
    });

    // (c) exactly one audit row, on the workspace actually named in the call.
    const audit = await db.query<{ action: string; workspace_id: string }>(
      "select action, workspace_id from audit_events where workspace_id=$1",
      [clientA],
    );
    expect(audit.rows).toEqual([{ action: "plan_set", workspace_id: clientA }]);

    // (d) the propagation update never created a second row for the root.
    const rootCount = await db.query<{ count: string }>(
      "select count(*) from subscriptions where workspace_id=$1",
      [home],
    );
    expect(Number(rootCount.rows[0].count)).toBe(1);
  });
});

describe("set_workspace_plan over a Paddle subscription", () => {
  // USER's home is on creator_plus / admin after the propagation test, with
  // two clients billing through it. Put the root on Paddle by hand, as a
  // webhook would have left it.
  let home: string;
  let clientA: string;
  beforeAll(async () => {
    await db.exec("reset role");
    home = (
      await db.query<{ id: string }>(
        "select id from workspaces where created_by=$1 order by created_at asc limit 1",
        [USER],
      )
    ).rows[0].id;
    clientA = (
      await db.query<{ id: string }>(
        "select id from workspaces where name=$1",
        ["client a"],
      )
    ).rows[0].id;
    await db.query(
      `update subscriptions set plan_key='creator', status='active', provider='paddle', provider_ref='sub_live',
         provider_customer_ref='ctm_live', billing_interval='month', cancel_at_period_end=true,
         period_start=now()-interval '1 day', period_end=now()+interval '29 days'
       where workspace_id=$1 or billing_workspace_id=$1`,
      [home],
    );
  });

  it("refuses without override, on the root and through a client alike", async () => {
    await as(ADMIN);
    await expect(
      db.query("select set_workspace_plan($1,'agency',1,'by hand')", [home]),
    ).rejects.toThrow(/paddle_subscription_active/);
    await expect(
      db.query("select set_workspace_plan($1,'agency',1,'by hand',false)", [
        clientA,
      ]),
    ).rejects.toThrow(/paddle_subscription_active/);
    await db.exec("reset role");
    const s = await db.query<{ plan_key: string; provider_ref: string }>(
      "select plan_key,provider_ref from subscriptions where workspace_id=$1",
      [home],
    );
    expect(s.rows[0]).toEqual({
      plan_key: "creator",
      provider_ref: "sub_live",
    });
    // past_due is live too.
    await db.query(
      "update subscriptions set status='past_due' where workspace_id=$1",
      [home],
    );
    await as(ADMIN);
    await expect(
      db.query("select set_workspace_plan($1,'agency',1,'by hand')", [home]),
    ).rejects.toThrow(/paddle_subscription_active/);
  });

  it("with override changes the plan and period but keeps the Paddle link, and audits plan:note", async () => {
    await as(ADMIN);
    const r = await db.query<{
      set_workspace_plan: {
        plan_key: string;
        status: string;
        provider: string;
      };
    }>("select set_workspace_plan($1,'agency',2,'goodwill',true)", [clientA]);
    expect(r.rows[0].set_workspace_plan).toMatchObject({
      plan_key: "agency",
      status: "active",
      provider: "paddle",
    });
    await db.exec("reset role");
    const rows = await db.query<{
      workspace_id: string;
      plan_key: string;
      status: string;
      provider: string;
      provider_ref: string;
      provider_customer_ref: string;
      billing_interval: string;
      cancel_at_period_end: boolean;
      months: number;
    }>(
      `select workspace_id, plan_key, status, provider, provider_ref, provider_customer_ref, billing_interval,
              cancel_at_period_end,
              round(extract(epoch from (period_end - period_start)) / 86400)::int as months
         from subscriptions where workspace_id=$1 or billing_workspace_id=$1`,
      [home],
    );
    expect(rows.rows).toHaveLength(3);
    for (const row of rows.rows)
      expect(row).toMatchObject({
        plan_key: "agency",
        status: "active",
        provider: "paddle",
        provider_ref: "sub_live",
        provider_customer_ref: "ctm_live",
        billing_interval: "month",
        cancel_at_period_end: true,
      });
    // Two months, give or take a day of month length.
    expect(rows.rows[0].months).toBeGreaterThanOrEqual(59);
    expect(rows.rows[0].months).toBeLessThanOrEqual(62);
    const audit = await db.query<{ action: string; target_id: string }>(
      "select action,target_id from audit_events where workspace_id=$1 order by created_at desc limit 1",
      [clientA],
    );
    expect(audit.rows[0]).toEqual({
      action: "plan_set",
      target_id: "agency:goodwill",
    });
  });

  it("a root not on Paddle behaves as before, override or not", async () => {
    await db.exec("reset role");
    await db.query(
      "update subscriptions set provider='admin', provider_ref='old' where workspace_id=$1 or billing_workspace_id=$1",
      [home],
    );
    await as(ADMIN);
    await db.query("select set_workspace_plan($1,'creator',1,'note 9',true)", [
      home,
    ]);
    await db.exec("reset role");
    const s = await db.query<{
      plan_key: string;
      provider: string;
      provider_ref: string;
    }>(
      "select plan_key,provider,provider_ref from subscriptions where workspace_id=$1",
      [home],
    );
    expect(s.rows[0]).toEqual({
      plan_key: "creator",
      provider: "admin",
      provider_ref: "note 9",
    });
    const audit = await db.query<{ target_id: string }>(
      "select target_id from audit_events where workspace_id=$1 order by created_at desc limit 1",
      [home],
    );
    expect(audit.rows[0].target_id).toBe("creator");
    // The four-argument form is gone: one signature, so PostgREST never sees two candidates.
    const sigs = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_proc where proname='set_workspace_plan'",
    );
    expect(sigs.rows[0].n).toBe(1);
  });
});
