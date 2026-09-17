/**
 * The service-only RPC surface the paddle-webhook function calls.
 *
 * PostgREST exposes `public` alone, and the billing primitives live in
 * `private`. These wrappers publish exactly what the webhook needs, each
 * revoked from anon and authenticated so a tenant key reaching one gets
 * "permission denied for function", which is asserted rather than assumed.
 * The superuser stands in for service_role, which holds the one grant.
 *
 * Two are readable by tenants on purpose: addon_catalogue, because prices are
 * public and the pricing page reads them signed out, and billing_customer_ref,
 * which an owner reads to open Paddle's portal for their own root.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const OWNER = "10000000-0000-4000-8000-000000000001";
const ANALYST = "10000000-0000-4000-8000-000000000002";
const STRANGER = "10000000-0000-4000-8000-000000000003";
const CLIENT = "20000000-0000-4000-8000-000000000002";
let db: PGlite;
let W: string;
const as = async (user: string, role = "authenticated") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`set role ${role}`);
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
  await db.query("insert into auth.users(id) values ($1),($2),($3)", [
    OWNER,
    ANALYST,
    STRANGER,
  ]);
  // The trigger gave OWNER a personal workspace on free; that is W.
  W = (
    await db.query<{ id: string }>(
      "select id from workspaces where created_by=$1 order by created_at asc limit 1",
      [OWNER],
    )
  ).rows[0].id;
  await db.query("insert into memberships values ($1,$2,'analyst')", [
    W,
    ANALYST,
  ]);
  // A client workspace billing through W, owned by OWNER, inserted as
  // superuser so the test does not depend on the workspace limit of free.
  await db.query(
    "insert into workspaces(id,name,created_by) values ($1,'client',$2)",
    [CLIENT, OWNER],
  );
  await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
    CLIENT,
    OWNER,
  ]);
  await db.query(
    `insert into subscriptions(workspace_id, plan_key, status, period_start, period_end, billing_workspace_id)
     select $1, plan_key, status, period_start, period_end, $2 from subscriptions where workspace_id=$2`,
    [CLIENT, W],
  );
  await db.query(
    `update plans set provider_prices='{"month":"pri_m","year":"pri_y"}' where key='creator'`,
  );
  await db.query(
    `update addon_prices set provider_prices='{"pack":"pri_p"}' where key='pack_10k'`,
  );
};

const subscription = (id: string, w: string) =>
  db.query<{ r: string }>(
    `select billing_apply_subscription($1,'subscription.activated',now(),$2,'creator','month',
       now(), now()+interval '30 days','active',false,'sub_1','ctm_1','{}'::jsonb) as r`,
    [id, w],
  );
const pack = (id: string, w: string, ref: string) =>
  db.query<{ r: string }>(
    `select billing_apply_pack($1,now(),$2,'comment_analysis',10000,$3,'{}'::jsonb) as r`,
    [id, w, ref],
  );

describe("billing rpc surface", () => {
  beforeAll(bootstrap);

  it("a tenant is refused every billing_* wrapper", async () => {
    for (const role of ["authenticated", "anon"]) {
      await as(OWNER, role);
      await expect(
        db.query("select billing_plan_for_price('pri_m')"),
      ).rejects.toThrow(/permission denied/);
      await expect(subscription("evt_t", W)).rejects.toThrow(
        /permission denied/,
      );
      await expect(pack("evt_t", W, "txn_t")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query(
          "select billing_record_unmapped('evt_t','subscription.created','{}'::jsonb)",
        ),
      ).rejects.toThrow(/permission denied/);
    }
    await db.exec("reset role");
    // Nothing was written by the refused calls.
    const n = await db.query<{ n: number }>(
      "select count(*)::int as n from private.billing_events",
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("the service role holds the grant on each wrapper", async () => {
    await db.exec("reset role; set role service_role");
    const r = await db.query<{ k: string }>(
      "select billing_plan_for_price('pri_m') as k",
    );
    expect(r.rows[0].k).toBe("creator:month");
    await db.exec("reset role");
  });

  it("a price resolves through the wrapper to its plan, interval or pack", async () => {
    const y = await db.query<{ k: string }>(
      "select billing_plan_for_price('pri_y') as k",
    );
    expect(y.rows[0].k).toBe("creator:year");
    const p = await db.query<{ k: string }>(
      "select billing_plan_for_price('pri_p') as k",
    );
    expect(p.rows[0].k).toBe("pack_10k:pack");
    const none = await db.query<{ k: string | null }>(
      "select billing_plan_for_price('pri_nope') as k",
    );
    expect(none.rows[0].k).toBeNull();
  });

  it("a subscription event reaches apply_billing_event: applied once, the root and its client moved", async () => {
    expect((await subscription("evt_1", W)).rows[0].r).toBe("applied");
    expect((await subscription("evt_1", W)).rows[0].r).toBe("duplicate");
    const rows = await db.query<{
      workspace_id: string;
      plan_key: string;
      provider: string;
      provider_customer_ref: string;
      billing_interval: string;
    }>(
      "select workspace_id,plan_key,provider,provider_customer_ref,billing_interval from subscriptions where workspace_id in ($1,$2) order by workspace_id=$1 desc",
      [W, CLIENT],
    );
    expect(rows.rows).toEqual([
      {
        workspace_id: W,
        plan_key: "creator",
        provider: "paddle",
        provider_customer_ref: "ctm_1",
        billing_interval: "month",
      },
      {
        workspace_id: CLIENT,
        plan_key: "creator",
        provider: "paddle",
        provider_customer_ref: "ctm_1",
        billing_interval: "month",
      },
    ]);
    const e = await db.query<{ outcome: string; workspace_id: string }>(
      "select outcome,workspace_id from private.billing_events where event_id='evt_1'",
    );
    expect(e.rows).toEqual([{ outcome: "applied", workspace_id: W }]);
  });

  it("a pack event reaches apply_pack_event: granted once", async () => {
    expect((await pack("evt_p1", W, "txn_9")).rows[0].r).toBe("applied");
    expect((await pack("evt_p1", W, "txn_9")).rows[0].r).toBe("duplicate");
    const g = await db.query<{
      source: string;
      provider_ref: string;
      units: number;
    }>(
      "select source,provider_ref,units from usage_grants where workspace_id=$1",
      [W],
    );
    expect(g.rows).toEqual([
      { source: "paddle", provider_ref: "txn_9", units: 10000 },
    ]);
  });

  it("an unmapped event is recorded once, on no workspace, and acknowledged again", async () => {
    for (let i = 0; i < 2; i++)
      await db.query(
        `select billing_record_unmapped('evt_u','subscription.created','{"id":"sub_x"}'::jsonb)`,
      );
    const e = await db.query<{
      n: number;
      outcome: string;
      workspace_id: string | null;
      event_type: string;
      payload: { id: string };
    }>(
      "select count(*) over ()::int as n, outcome, workspace_id, event_type, payload from private.billing_events where event_id='evt_u'",
    );
    expect(e.rows).toEqual([
      {
        n: 1,
        outcome: "unmapped",
        workspace_id: null,
        event_type: "subscription.created",
        payload: { id: "sub_x" },
      },
    ]);
    // Recorded is recorded: the same event_id through the apply path is a duplicate.
    expect((await subscription("evt_u", W)).rows[0].r).toBe("duplicate");
  });

  it("the addon catalogue is public and carries the pack", async () => {
    await as(STRANGER, "anon");
    const c = await db.query<{ c: unknown[] }>("select addon_catalogue() as c");
    expect(c.rows[0].c).toEqual([
      {
        key: "pack_10k",
        kind: "comment_analysis",
        units: 10000,
        price_cents: 500,
        provider_prices: { pack: "pri_p" },
      },
    ]);
    await db.exec("reset role");
  });

  it("an owner reads the root's customer ref; anyone else is refused", async () => {
    await as(OWNER);
    const own = await db.query<{ r: string }>(
      "select billing_customer_ref($1) as r",
      [W],
    );
    expect(own.rows[0].r).toBe("ctm_1");
    // Named on the client, answered from the root.
    const viaClient = await db.query<{ r: string }>(
      "select billing_customer_ref($1) as r",
      [CLIENT],
    );
    expect(viaClient.rows[0].r).toBe("ctm_1");
    await as(ANALYST);
    await expect(
      db.query("select billing_customer_ref($1)", [W]),
    ).rejects.toThrow(/forbidden/);
    await as(STRANGER);
    await expect(
      db.query("select billing_customer_ref($1)", [W]),
    ).rejects.toThrow(/forbidden/);
    await as(STRANGER, "anon");
    await expect(
      db.query("select billing_customer_ref($1)", [W]),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });

  it("billing_assert_owner passes for the owner and refuses everyone else — the check paddle-checkout mints a transaction behind", async () => {
    await as(OWNER);
    await expect(
      db.query("select billing_assert_owner($1)", [W]),
    ).resolves.toBeTruthy();
    await as(ANALYST);
    await expect(
      db.query("select billing_assert_owner($1)", [W]),
    ).rejects.toThrow(/forbidden/);
    await as(STRANGER);
    await expect(
      db.query("select billing_assert_owner($1)", [W]),
    ).rejects.toThrow(/forbidden/);
    await as(STRANGER, "anon");
    await expect(
      db.query("select billing_assert_owner($1)", [W]),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });
});
