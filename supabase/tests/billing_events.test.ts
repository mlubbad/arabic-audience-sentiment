/**
 * Paddle is the seller of record; this database is the entitlement of record.
 * Every webhook lands once, by event_id; an older event never moves a
 * subscription backwards; a pack grants once; seven days past due drops to
 * free; a price id resolves to a plan and interval, or to a pack.
 *
 * Concurrency: apply_billing_event and apply_pack_event take
 * pg_advisory_xact_lock on the billing root before their duplicate and
 * staleness reads, so two overlapping deliveries for one root serialise.
 * PGlite is a single connection and cannot run two transactions at once, so
 * that guarantee is verified by reading the migration, not by a concurrent
 * test; what the tests below prove is that the functions behave the same
 * with the lock in place.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const OWNER = "10000000-0000-4000-8000-000000000001";
const CLIENT = "20000000-0000-4000-8000-000000000002";
let db: PGlite;
let W: string;
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
  // The trigger gave OWNER a personal workspace on free; that is W.
  W = (
    await db.query<{ id: string }>(
      "select id from workspaces where created_by=$1 order by created_at asc limit 1",
      [OWNER],
    )
  ).rows[0].id;
  // A client workspace billing through W, inserted as superuser so the
  // test does not depend on the workspace limit of whatever plan W is on.
  await db.query(
    "insert into workspaces(id,name,created_by) values ($1,'client',$2)",
    [CLIENT, OWNER],
  );
  await db.query(
    `insert into subscriptions(workspace_id, plan_key, status, period_start, period_end, billing_workspace_id)
     select $1, plan_key, status, period_start, period_end, $2 from subscriptions where workspace_id=$2`,
    [CLIENT, W],
  );
};

const apply = (id: string, status = "active", cancel = false) =>
  db.query<{ apply_billing_event: string }>(
    `select private.apply_billing_event($1,'subscription.activated',now(),$2,'creator','month',
       now(), now()+interval '30 days', $3, $4, 'sub_1', 'ctm_1', '{}'::jsonb)`,
    [id, W, status, cancel],
  );

describe("billing events", () => {
  beforeAll(bootstrap);

  it("an event applies once", async () => {
    expect((await apply("evt_1")).rows[0].apply_billing_event).toBe("applied");
    expect((await apply("evt_1")).rows[0].apply_billing_event).toBe(
      "duplicate",
    );
    const s = await db.query<{
      plan_key: string;
      provider: string;
      provider_ref: string;
      billing_interval: string;
    }>(
      "select plan_key,provider,provider_ref,billing_interval from subscriptions where workspace_id=$1",
      [W],
    );
    expect(s.rows[0]).toEqual({
      plan_key: "creator",
      provider: "paddle",
      provider_ref: "sub_1",
      billing_interval: "month",
    });
    const a = await db.query<{ action: string; target_id: string }>(
      "select action,target_id from audit_events where workspace_id=$1 order by created_at desc limit 1",
      [W],
    );
    expect(a.rows[0]).toEqual({
      action: "plan_paddle_activated",
      target_id: "creator",
    });
    const e = await db.query<{ n: number }>(
      "select count(*)::int as n from private.billing_events where event_id='evt_1'",
    );
    expect(e.rows[0].n).toBe(1);
  });

  it("an event on the root moves every client row with it", async () => {
    const c = await db.query<{
      plan_key: string;
      provider: string;
      provider_ref: string;
      billing_interval: string;
      billing_workspace_id: string;
    }>(
      "select plan_key,provider,provider_ref,billing_interval,billing_workspace_id from subscriptions where workspace_id=$1",
      [CLIENT],
    );
    expect(c.rows[0]).toEqual({
      plan_key: "creator",
      provider: "paddle",
      provider_ref: "sub_1",
      billing_interval: "month",
      billing_workspace_id: W,
    });
    // The event is recorded against the root, and the root still has one row.
    const e = await db.query<{ workspace_id: string }>(
      "select workspace_id from private.billing_events where event_id='evt_1'",
    );
    expect(e.rows[0].workspace_id).toBe(W);
    const n = await db.query<{ n: number }>(
      "select count(*)::int as n from subscriptions where workspace_id=$1",
      [W],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("an event named on a client workspace writes the root", async () => {
    const r = await db.query<{ apply_billing_event: string }>(
      `select private.apply_billing_event('evt_client','subscription.updated',now(),$1,'creator_plus','year',
         now(), now()+interval '365 days','active',false,'sub_1','ctm_1','{}'::jsonb)`,
      [CLIENT],
    );
    expect(r.rows[0].apply_billing_event).toBe("applied");
    const rows = await db.query<{ workspace_id: string; plan_key: string }>(
      "select workspace_id,plan_key from subscriptions where workspace_id in ($1,$2)",
      [W, CLIENT],
    );
    expect(rows.rows.map((x) => x.plan_key)).toEqual([
      "creator_plus",
      "creator_plus",
    ]);
    const e = await db.query<{ workspace_id: string }>(
      "select workspace_id from private.billing_events where event_id='evt_client'",
    );
    expect(e.rows[0].workspace_id).toBe(W);
  });

  it("an older event never overwrites a newer one", async () => {
    await db.query(
      `select private.apply_billing_event('evt_new','subscription.updated',now(),$1,'creator_plus','month',now(),now()+interval '30 days','active',false,'sub_1','ctm_1','{}')`,
      [W],
    );
    const old = await db.query<{ apply_billing_event: string }>(
      `select private.apply_billing_event('evt_old','subscription.updated',now()-interval '1 hour',$1,'creator','month',now(),now()+interval '30 days','active',false,'sub_1','ctm_1','{}')`,
      [W],
    );
    expect(old.rows[0].apply_billing_event).toBe("stale");
    expect(
      (
        await db.query<{ plan_key: string }>(
          "select plan_key from subscriptions where workspace_id=$1",
          [W],
        )
      ).rows[0].plan_key,
    ).toBe("creator_plus");
    const e = await db.query<{ outcome: string }>(
      "select outcome from private.billing_events where event_id='evt_old'",
    );
    expect(e.rows[0].outcome).toBe("stale");
    // Recorded once: replaying the stale event is a duplicate, not a second row.
    const again = await db.query<{ apply_billing_event: string }>(
      `select private.apply_billing_event('evt_old','subscription.updated',now()-interval '1 hour',$1,'creator','month',now(),now()+interval '30 days','active',false,'sub_1','ctm_1','{}')`,
      [W],
    );
    expect(again.rows[0].apply_billing_event).toBe("duplicate");
  });

  it("a pack event grants units once", async () => {
    const a = await db.query<{ apply_pack_event: string }>(
      `select private.apply_pack_event('evt_p1',now(),$1,'comment_analysis',10000,'txn_9','{}')`,
      [W],
    );
    const b = await db.query<{ apply_pack_event: string }>(
      `select private.apply_pack_event('evt_p1',now(),$1,'comment_analysis',10000,'txn_9','{}')`,
      [W],
    );
    expect(a.rows[0].apply_pack_event).toBe("applied");
    expect(b.rows[0].apply_pack_event).toBe("duplicate");
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from usage_grants where workspace_id=$1",
          [W],
        )
      ).rows[0].n,
    ).toBe(1);
    const g = await db.query<{ source: string; provider_ref: string }>(
      "select source,provider_ref from usage_grants where workspace_id=$1",
      [W],
    );
    expect(g.rows[0]).toEqual({ source: "paddle", provider_ref: "txn_9" });
    const au = await db.query<{ action: string; target_id: string }>(
      "select action,target_id from audit_events where workspace_id=$1 order by created_at desc limit 1",
      [W],
    );
    expect(au.rows[0]).toEqual({
      action: "pack_paddle",
      target_id: "comment_analysis:10000",
    });
  });

  it("the sweep drops a subscription seven days past due to free, clients with it", async () => {
    await db.query(
      "update subscriptions set status='past_due', period_start=now()-interval '38 days', period_end=now()-interval '8 days' where workspace_id in ($1,$2)",
      [W, CLIENT],
    );
    const n = await db.query<{ billing_sweep: number }>(
      "select private.billing_sweep()",
    );
    expect(n.rows[0].billing_sweep).toBe(1);
    for (const id of [W, CLIENT]) {
      const s = await db.query<{
        plan_key: string;
        status: string;
        provider: string | null;
        provider_ref: string | null;
        billing_interval: string | null;
      }>(
        "select plan_key,status,provider,provider_ref,billing_interval from subscriptions where workspace_id=$1",
        [id],
      );
      expect(s.rows[0]).toEqual({
        plan_key: "free",
        status: "active",
        provider: null,
        provider_ref: null,
        billing_interval: null,
      });
    }
    const a = await db.query<{ action: string }>(
      "select action from audit_events where workspace_id=$1 order by created_at desc limit 1",
      [W],
    );
    expect(a.rows[0].action).toBe("plan_dropped");
    // One audit row per dropped root, none on the client.
    const dropped = await db.query<{ workspace_id: string }>(
      "select workspace_id from audit_events where action='plan_dropped'",
    );
    expect(dropped.rows).toEqual([{ workspace_id: W }]);
    // Nothing left to sweep.
    expect(
      (
        await db.query<{ billing_sweep: number }>(
          "select private.billing_sweep()",
        )
      ).rows[0].billing_sweep,
    ).toBe(0);
  });

  it("the sweep leaves a subscription less than seven days past due alone", async () => {
    await db.query(
      "update subscriptions set plan_key='creator', status='past_due', period_end=now()-interval '6 days', period_start=now()-interval '36 days' where workspace_id=$1",
      [W],
    );
    await db.query("select private.billing_sweep()");
    const s = await db.query<{ plan_key: string; status: string }>(
      "select plan_key,status from subscriptions where workspace_id=$1",
      [W],
    );
    expect(s.rows[0]).toEqual({ plan_key: "creator", status: "past_due" });
  });

  it("a price id resolves to its plan and interval", async () => {
    await db.query(
      `update plans set provider_prices='{"month":"pri_m","year":"pri_y"}' where key='creator'`,
    );
    const r = await db.query<{ k: string }>(
      "select private.plan_key_for_price('pri_y') as k",
    );
    expect(r.rows[0].k).toBe("creator:year");
    const m = await db.query<{ k: string }>(
      "select private.plan_key_for_price('pri_m') as k",
    );
    expect(m.rows[0].k).toBe("creator:month");
    const none = await db.query<{ k: string | null }>(
      "select private.plan_key_for_price('pri_nope') as k",
    );
    expect(none.rows[0].k).toBeNull();
  });

  it("a pack price id resolves to its addon key", async () => {
    const seeded = await db.query<{
      key: string;
      kind: string;
      units: number;
      price_cents: number;
    }>("select key,kind,units,price_cents from addon_prices");
    expect(seeded.rows).toEqual([
      {
        key: "pack_10k",
        kind: "comment_analysis",
        units: 10000,
        price_cents: 500,
      },
    ]);
    await db.query(
      `update addon_prices set provider_prices='{"pack":"pri_p"}' where key='pack_10k'`,
    );
    const r = await db.query<{ k: string }>(
      "select private.plan_key_for_price('pri_p') as k",
    );
    expect(r.rows[0].k).toBe("pack_10k:pack");
    // Prices are public: anon reads the row.
    await db.exec("set role anon");
    const pub = await db.query<{ n: number }>(
      "select count(*)::int as n from addon_prices",
    );
    expect(pub.rows[0].n).toBe(1);
    await db.exec("reset role");
  });

  it("tenants cannot call the billing functions", async () => {
    await db.exec("set role authenticated");
    await expect(db.query("select private.billing_sweep()")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query(
        `select private.apply_billing_event('evt_t','subscription.updated',now(),$1,'creator','month',now(),now()+interval '30 days','active',false,'sub_1','ctm_1','{}')`,
        [W],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        `select private.apply_pack_event('evt_t',now(),$1,'comment_analysis',10000,'txn_t','{}')`,
        [W],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select private.plan_key_for_price('pri_y')"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select * from private.billing_events"),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });
});
