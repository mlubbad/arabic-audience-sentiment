# Plans v2 and Paddle Billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hand-activated `pilot` plan with the two-segment ladder in `docs/pricing-v2-draft.md` (individual: `free`/`creator`/`creator_plus`; business: `agency`/`media`/`enterprise`; internal: `owner`), enforce every new limit server-side, give the platform owner an admin surface to activate plans by hand, and connect self-serve plans to Paddle Billing (merchant of record) with webhook-driven truth.

**Architecture:** Plans stay rows in `public.plans`; new columns carry prices, segment, workspace limit, visibility and the provider's price ids. Entitlement truth lives in `public.subscriptions` and is written only by (a) the platform admin RPC and (b) the Paddle webhook edge function, both idempotent and audited. Add-on packs are rows in a new `public.usage_grants` table that `private.reserve_usage` counts after the plan allowance. The web app reads a public `plan_catalogue()` for the pricing page and an extended `usage_summary` for the account page; checkout opens Paddle's hosted overlay with `workspace_id` in `custom_data`, so no card data ever touches this code.

**Tech Stack:** Postgres (Supabase migrations, PGlite tests via vitest), Deno edge functions (pure handler + injected db, as `_shared/worker-gateway.ts`), React 19 + react-router + TanStack Query, zod contracts in `packages/contracts`, Paddle Billing API v1 + Paddle.js v2 (sandbox first), Playwright for e2e.

**Spec:** `docs/pricing-v2-draft.md` (ladder, limits, add-on, owner plan, §7 schema notes, §8 payment rules) and `docs/pricing-consultation-2026-09-16.md` §7 (decisions: `media` published but not self-serve; annual offer after first successful report; Paddle first).

## Global Constraints

- Migrations are immutable once applied: every change is a new timestamped file under `supabase/migrations/`, and a rebuilt function is copied from its **latest** definition (`grep -n 'create or replace function private.<name>' supabase/migrations/*.sql` — take the last file).
- Every `security definer` function ends with `revoke all on function ... from public, anon, authenticated;` and an explicit `grant execute ... to authenticated` only when tenants call it.
- Tenants never write `plans`, `subscriptions`, `usage_grants` or `billing_events` directly; only RPCs and the service role do.
- Nothing secret in `VITE_*`. Paddle's **client-side token** (`test_...`/`live_...`) is public by design and may be `VITE_PADDLE_CLIENT_TOKEN`; the API key and webhook secret live only in edge-function secrets.
- Sandbox first: `PADDLE_ENV=sandbox` until the user says otherwise (AGENTS.md: no real billing without explicit approval — approval given for Paddle on 2026-09-16, sandbox → live is a separate "yes").
- Strings: Arabic in `apps/web/src/strings/ar.ts`, English twin in `en.ts`; both must have every new key (the `Strings` type enforces it).
- Prices are integers in cents, USD only (`pricing-consultation` §7.1, decision 5).
- Run `npm run check` before the final commit of each Part; it runs lint, format, typecheck, deno check, unit, db, worker tests, build, secrets.
- Commit message style: the repo's, a sentence of what changed and why (see `git log --oneline -10`), ending with the attribution line from the session reminder.

## File Structure

| Path | Responsibility |
| --- | --- |
| `supabase/migrations/20260917010000_plans_v2.sql` | New `plans` columns, the seven rows, `free` as downgrade target, `subscriptions.status` gains `past_due`, `plan_limit('workspaces')`, workspace-limit check in `create_workspace_impl` |
| `supabase/migrations/20260917020000_usage_grants.sql` | `usage_grants` table; `reserve_usage` and `usage_summary_impl` count grants |
| `supabase/migrations/20260917030000_platform_admin.sql` | `private.platform_admins`, `public.is_platform_admin()`, `public.set_workspace_plan(...)`, `public.admin_workspaces()`, audit rows |
| `supabase/migrations/20260917040000_plan_catalogue.sql` | `public.plan_catalogue()` for signed-out readers; `usage_summary` carries plan meta |
| `supabase/migrations/20260917050000_billing_events.sql` | `private.billing_events` (webhook idempotency), `private.apply_billing_event(...)`, `private.billing_sweep()` + pg_cron guard |
| `supabase/tests/plans_v2.test.ts`, `usage_grants.test.ts`, `platform_admin.test.ts`, `plan_catalogue.test.ts`, `billing_events.test.ts` | PGlite tests, one per migration |
| `packages/contracts/src/plans.ts` | `PlanCatalogueSchema`, `PlanSchema`; `usage.ts` extended |
| `apps/web/src/Pricing.tsx`, `pricing.ts`, `pricing.test.ts` | `/pricing` route, two segments, words decided in `pricing.ts` |
| `apps/web/src/PlanPanel.tsx`, `planPanel.ts`, `planPanel.test.ts` | Account page section: current plan, limits, upgrade/manage/top-up buttons |
| `apps/web/src/Admin.tsx`, `admin.ts`, `admin.test.ts` | `/admin` route for platform admins |
| `apps/web/src/paddle.ts`, `paddle.test.ts` | Loads Paddle.js, opens checkout with `custom_data.workspace_id` |
| `supabase/functions/_shared/paddle.ts` | Signature verification, event → subscription mapping (pure) |
| `supabase/functions/paddle-webhook/index.ts` | Service-role entry: verify, `apply_billing_event` |
| `supabase/functions/billing-portal/index.ts` | Signed-in entry: Paddle customer-portal session URL for the caller's workspace |
| `supabase/tests/paddle_webhook.test.ts`, `billing_portal.test.ts` | Handler tests with injected db/fetch |
| `scripts/paddle-sync-prices.mjs` | Creates Paddle products/prices from `plans`, writes `provider_prices` |
| `docs/pricing.md` | Replaced by the v2 ladder once Part A lands |
| `docs/decisions.md`, `docs/progress.md`, `docs/verification.md` | Dated entries per Part |

---

## Part A — Plans v2 in the database

### Task A1: The plans table learns prices, segments and the workspace limit

**Files:**
- Create: `supabase/migrations/20260917010000_plans_v2.sql`
- Test: `supabase/tests/plans_v2.test.ts`

**Interfaces:**
- Produces: columns on `public.plans`: `segment text` (`individual|business|internal`), `price_monthly_cents int`, `price_yearly_cents int`, `workspaces_limit int` (null = unlimited), `insight_reports int`, `internal boolean`, `self_serve boolean`, `sort_order int`, `provider_prices jsonb`, `title_ar text`, `title_en text`; all `*_limit`/`*_units` columns become nullable-as-unlimited **only** for the `owner` row via a `check` that allows null when `internal`.
- Produces: `private.plan_limit(w, 'workspaces')`; `create_workspace_impl` raises `workspace_limit_reached` (errcode `53400`).
- Produces: `subscriptions.status` accepts `past_due`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/tests/plans_v2.test.ts
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
  for (const f of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec("reset role");
  await db.query("insert into auth.users(id) values ($1)", [OWNER]);
};

describe("plans v2", () => {
  beforeAll(bootstrap);

  it("carries the seven rows of the ladder with segment and prices", async () => {
    const r = await db.query<{ key: string; segment: string; price_monthly_cents: number | null; self_serve: boolean }>(
      "select key,segment,price_monthly_cents,self_serve from plans order by sort_order",
    );
    expect(r.rows.map((p) => p.key)).toEqual(["free", "creator", "creator_plus", "agency", "media", "enterprise", "owner", "pilot"]);
    expect(r.rows.find((p) => p.key === "creator")).toMatchObject({ segment: "individual", price_monthly_cents: 1200, self_serve: true });
    expect(r.rows.find((p) => p.key === "media")).toMatchObject({ segment: "business", price_monthly_cents: 24900, self_serve: false });
    expect(r.rows.find((p) => p.key === "owner")).toMatchObject({ segment: "internal", price_monthly_cents: 0 });
  });

  it("owner is unlimited and every other plan has finite limits", async () => {
    const r = await db.query<{ key: string; analysis_units: number | null; channels_limit: number | null }>(
      "select key,analysis_units,channels_limit from plans where key in ('owner','agency')",
    );
    expect(r.rows.find((p) => p.key === "owner")).toEqual({ key: "owner", analysis_units: null, channels_limit: null });
    expect(r.rows.find((p) => p.key === "agency")).toEqual({ key: "agency", analysis_units: 150000, channels_limit: 10 });
  });

  it("refuses a null limit on a plan that is not internal", async () => {
    await expect(db.query("update plans set analysis_units=null where key='creator'")).rejects.toThrow(/plans_limits_finite_unless_internal/);
  });

  it("a personal workspace on creator cannot create a second workspace", async () => {
    // The trigger gave OWNER a personal workspace on the default plan; move it to creator.
    await db.exec("reset role");
    await db.query("update subscriptions set plan_key='creator' where workspace_id=(select id from workspaces where created_by=$1)", [OWNER]);
    await as(OWNER);
    await expect(db.query("select create_workspace('second')")).rejects.toThrow(/workspace_limit_reached/);
  });

  it("a workspace on agency can create up to five", async () => {
    await db.exec("reset role");
    await db.query("update subscriptions set plan_key='agency' where workspace_id=(select id from workspaces where created_by=$1)", [OWNER]);
    await as(OWNER);
    for (let i = 0; i < 4; i++) await db.query("select create_workspace($1)", [`client ${i}`]);
    await expect(db.query("select create_workspace('sixth')")).rejects.toThrow(/workspace_limit_reached/);
  });

  it("past_due is an accepted subscription status", async () => {
    await db.exec("reset role");
    await db.query("update subscriptions set status='past_due' where workspace_id=(select id from workspaces where created_by=$1)", [OWNER]);
    const r = await db.query<{ status: string }>("select status from subscriptions where workspace_id=(select id from workspaces where created_by=$1)", [OWNER]);
    expect(r.rows[0].status).toBe("past_due");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/tests/plans_v2.test.ts`
Expected: FAIL — `column "segment" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260917010000_plans_v2.sql
-- The ladder in docs/pricing-v2-draft.md becomes rows. Plans stay operator-owned:
-- no tenant grant exists on this table and none is added here.

alter table public.plans
  add column segment text not null default 'individual'
    check (segment in ('individual','business','internal')),
  add column price_monthly_cents integer not null default 0 check (price_monthly_cents >= 0),
  add column price_yearly_cents integer not null default 0 check (price_yearly_cents >= 0),
  add column workspaces_limit integer check (workspaces_limit is null or workspaces_limit >= 1),
  add column insight_reports integer not null default 0 check (insight_reports >= 0),
  add column internal boolean not null default false,
  add column self_serve boolean not null default false,
  add column sort_order integer not null default 100,
  add column provider_prices jsonb not null default '{}'::jsonb,
  add column title_ar text not null default '',
  add column title_en text not null default '';

-- Unlimited is spelled null, and only an internal plan may spell it.
alter table public.plans
  alter column analysis_units drop not null,
  alter column backfill_units drop not null,
  alter column topic_units drop not null,
  alter column channels_limit drop not null,
  alter column members_limit drop not null;
alter table public.plans add constraint plans_limits_finite_unless_internal check (
  internal or (analysis_units is not null and backfill_units is not null and topic_units is not null
               and channels_limit is not null and members_limit is not null and workspaces_limit is not null));

-- The ladder. Prices in USD cents; yearly is ten months for twelve.
insert into public.plans
  (key, segment, title_ar, title_en, price_monthly_cents, price_yearly_cents, self_serve, sort_order,
   analysis_units, backfill_units, topic_units, insight_reports,
   channels_limit, members_limit, workspaces_limit,
   min_sync_interval_minutes, live_interval_minutes, catalogue_interval_minutes)
values
  ('free',        'individual', 'مجاني',   'Free',         0,     0,     true,  10,
      100,     0,      100,    1,    0,  1,  1,  0,    0,    0),
  ('creator',     'individual', 'منشئ',    'Creator',      1200,  12000, true,  20,
      10000,   40000,  4000,   10,   1,  1,  1,  60,   1440, 1440),
  ('creator_plus','individual', 'منشئ بلس','Creator Plus', 2900,  29000, true,  30,
      30000,   120000, 12000,  50,   2,  2,  1,  30,   720,  1440),
  ('agency',      'business',   'وكالة',   'Agency',       9900,  99000, true,  40,
      150000,  600000, 60000,  200,  10, 10, 5,  15,   360,  720),
  ('media',       'business',   'ميديا',   'Media',        24900, 249000,false, 50,
      500000,  2000000,200000, 600,  30, 25, 15, 10,   120,  360),
  ('enterprise',  'business',   'مؤسسات',  'Enterprise',   0,     0,     false, 60,
      1000000, 4000000,400000, 2000, 100,100,50, 5,    60,   360),
  ('owner',       'internal',   'المالك',  'Owner',        0,     0,     false, 90,
      null,    null,   null,   0,    null,null,null,0,  60,   360);
update public.plans set internal = true where key = 'owner';
update public.plans set segment='internal', internal=true, sort_order=99, title_ar='تجريبي', title_en='Pilot'
  where key = 'pilot';

-- A subscription whose payment failed is neither active nor cancelled.
alter table public.subscriptions drop constraint subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check
  check (status in ('active','past_due','paused','cancelled'));
alter table public.subscriptions
  add column cancel_at_period_end boolean not null default false,
  add column provider_customer_ref text,
  add column billing_interval text check (billing_interval is null or billing_interval in ('month','year'));

-- plan_limit, rebuilt from 20260915130000 with the sixth name.
create or replace function private.plan_limit(w uuid, which text) returns integer
language sql stable security definer set search_path='' as $$
  select case which
           when 'channels' then p.channels_limit
           when 'members' then p.members_limit
           when 'workspaces' then p.workspaces_limit
           when 'sync_interval' then p.min_sync_interval_minutes
           when 'live_interval' then p.live_interval_minutes
           when 'catalogue_interval' then p.catalogue_interval_minutes
         end
  from public.subscriptions s join public.plans p on p.key = s.plan_key
  where s.workspace_id = w and s.status in ('active','past_due');
$$;
revoke all on function private.plan_limit(uuid,text) from public, anon, authenticated;

-- The workspace limit counts the workspaces the caller owns. The plan that
-- governs is the one on the caller's first (personal) workspace: a person has
-- one plan, and their client workspaces hang off it.
create or replace function private.owner_plan_workspace(u uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select w.id from public.workspaces w
  where w.created_by = u order by w.created_at asc limit 1;
$$;
revoke all on function private.owner_plan_workspace(uuid) from public, anon, authenticated;

-- create_workspace_impl, rebuilt from 20260914090000 with the limit check.
-- New workspaces get the free plan, not pilot: pilot was the hand-activated
-- allowance of the pilot phase, and it is now internal.
create or replace function private.grant_default_plan(w uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.plans where key = 'free') then return; end if;
  insert into public.subscriptions(workspace_id, plan_key, status, period_start, period_end)
  values (w, 'free', 'active', now(), now() + interval '100 years')
  on conflict (workspace_id) do nothing;
end $$;
revoke all on function private.grant_default_plan(uuid) from public, anon, authenticated;

create or replace function private.create_workspace_impl(workspace_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare w uuid; home uuid; allowed int; owned int; begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  home := private.owner_plan_workspace(auth.uid());
  if home is not null then
    allowed := private.plan_limit(home,'workspaces');
    select count(*) into owned from public.workspaces where created_by = auth.uid();
    if allowed is not null and owned >= allowed then
      raise exception 'workspace_limit_reached' using errcode='53400'; end if;
  end if;
  insert into public.workspaces(name,created_by) values(workspace_name,auth.uid()) returning id into w;
  insert into public.memberships values(w,auth.uid(),'workspace_owner');
  insert into public.clients(workspace_id,name) values(w,workspace_name);
  -- A client workspace shares its owner's plan row? No: it has its own
  -- subscription row so metering stays per workspace, on the same plan key.
  if home is not null then
    insert into public.subscriptions(workspace_id, plan_key, status, period_start, period_end, provider, provider_ref)
    select w, s.plan_key, s.status, s.period_start, s.period_end, s.provider, s.provider_ref
    from public.subscriptions s where s.workspace_id = home
    on conflict (workspace_id) do nothing;
  end if;
  perform private.grant_default_plan(w);
  return w;
end $$;

create or replace function private.bootstrap_personal_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
declare w uuid; begin
  insert into public.workspaces(name,created_by) values('مساحة العمل الشخصية',new.id) returning id into w;
  insert into public.memberships values(w,new.id,'workspace_owner');
  insert into public.clients(workspace_id,name) values(w,'مساحة العمل الشخصية');
  perform private.grant_default_plan(w);
  return new;
end $$;
```

Note on the test's fifth case: the personal workspace counts as one of the five, so four `create_workspace` calls succeed and the fifth refuses.

- [ ] **Step 4: Run the test and the full db suite**

Run: `npx vitest run supabase/tests/plans_v2.test.ts && npm run test:db`
Expected: PASS. If `selection.test.ts`/`foundation.test.ts` fail on `pilot` expectations (they insert `pilot` subscriptions by hand and that row still exists), they pass; if a test asserted `create_workspace` grants `pilot`, update that assertion to `free` and note it in the commit.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260917010000_plans_v2.sql supabase/tests/plans_v2.test.ts
git commit -m "The ladder is rows: seven plans with segment, prices, workspace limit; new workspaces start on free"
```

### Task A2: Add-on packs — `usage_grants` counted after the plan allowance

**Files:**
- Create: `supabase/migrations/20260917020000_usage_grants.sql`
- Test: `supabase/tests/usage_grants.test.ts`

**Interfaces:**
- Produces: `public.usage_grants(id uuid, workspace_id, kind, units int, granted_at, expires_at, source text, provider_ref text unique)`.
- Produces: `private.grant_units(w uuid, kind text, units int, source text, provider_ref text) returns uuid` — idempotent on `provider_ref`.
- Produces: `private.reserve_usage` allowance = plan units + live grants; `usage_summary` budgets carry `granted` (int) alongside `allowance`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/tests/usage_grants.test.ts — bootstrap identical to plans_v2.test.ts
const W = "00000000-0000-4000-8000-000000000001";
// ...after bootstrap: insert workspace W owned by OWNER, membership, client, and
// a subscription on 'creator' with period now()-1d .. now()+29d.

it("a pack raises the allowance for the current period", async () => {
  await db.exec("reset role");
  await db.query("select private.grant_units($1,'comment_analysis',10000,'paddle','txn_1')", [W]);
  const r = await db.query<{ usage_summary: { budgets: { event_type: string; allowance: number; granted: number }[] } }>(
    "select private.usage_summary_impl($1) as usage_summary", [W]);
  const a = r.rows[0].usage_summary.budgets.find((b) => b.event_type === "comment_analysis")!;
  expect(a).toMatchObject({ allowance: 20000, granted: 10000 });
});

it("the same provider_ref grants once", async () => {
  await db.query("select private.grant_units($1,'comment_analysis',10000,'paddle','txn_1')", [W]);
  const r = await db.query<{ n: number }>("select count(*)::int as n from usage_grants where workspace_id=$1", [W]);
  expect(r.rows[0].n).toBe(1);
});

it("reserve_usage spends the plan first, then the grant, then stops", async () => {
  const keys = Array.from({ length: 20001 }, (_, i) => `k${i}`);
  let reserved = 0;
  for (let i = 0; i < keys.length; i += 500) {
    const r = await db.query<{ reserve_usage: string[] }>(
      "select private.reserve_usage($1,'comment_analysis',$2)", [W, keys.slice(i, i + 500)]);
    reserved += r.rows[0].reserve_usage.length;
  }
  expect(reserved).toBe(20000);
});

it("an expired grant counts for nothing", async () => {
  await db.query("update usage_grants set expires_at = now() - interval '1 minute' where provider_ref='txn_1'");
  const r = await db.query<{ usage_summary: { budgets: { event_type: string; allowance: number }[] } }>(
    "select private.usage_summary_impl($1) as usage_summary", [W]);
  expect(r.rows[0].usage_summary.budgets.find((b) => b.event_type === "comment_analysis")!.allowance).toBe(10000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/tests/usage_grants.test.ts`
Expected: FAIL — `function private.grant_units(...) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260917020000_usage_grants.sql
-- A top-up is not a second period model: it is extra allowance on the same
-- budget, valid to the end of the current period plus thirty days, spent after
-- the plan's own units. Tenants read it through usage_summary and never write it.
create table public.usage_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  kind text not null check (kind in ('comment_analysis','historical_backfill','topic_classification')),
  units integer not null check (units > 0),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  source text not null check (source in ('paddle','admin')),
  provider_ref text,
  unique (source, provider_ref)
);
create index usage_grants_live on public.usage_grants(workspace_id, kind, expires_at);
alter table public.usage_grants enable row level security;
create policy usage_grants_read on public.usage_grants for select to authenticated
  using (private.has_role(workspace_id));

create function private.granted_units(w uuid, kind text) returns int
language sql stable security definer set search_path='' as $$
  select coalesce(sum(g.units),0)::int from public.usage_grants g
  where g.workspace_id = w and g.kind = kind and g.expires_at > now();
$$;
revoke all on function private.granted_units(uuid,text) from public, anon, authenticated;

create function private.grant_units(w uuid, kind text, units int, source text, provider_ref text) returns uuid
language plpgsql security definer set search_path='' as $$
declare sub record; g uuid; begin
  select period_end into sub from public.subscriptions where workspace_id = w;
  if not found then raise exception 'no_active_plan' using errcode='42501'; end if;
  insert into public.usage_grants(workspace_id, kind, units, expires_at, source, provider_ref)
  values (w, kind, units, sub.period_end + interval '30 days', source, provider_ref)
  on conflict (source, provider_ref) do nothing returning id into g;
  if g is null then select id into g from public.usage_grants where usage_grants.source = grant_units.source and usage_grants.provider_ref = grant_units.provider_ref; end if;
  return g;
end $$;
revoke all on function private.grant_units(uuid,text,int,text,text) from public, anon, authenticated;

-- reserve_usage, rebuilt from 20260916010000: allowance now includes live
-- grants, and a null plan allowance (owner) means no ceiling.
create or replace function private.reserve_usage(w uuid,kind text,keys text[]) returns text[]
language plpgsql security invoker set search_path='' as $$
declare sub record; allowance int; used int; covered text[]; fresh text[]; begin
 if kind not in ('comment_analysis','historical_backfill','topic_classification') then
   raise exception 'invalid_event_type' using errcode='22023'; end if;
 if coalesce(array_length(keys,1),0) > 500 then raise exception 'batch_too_large' using errcode='22023'; end if;
 select s.status,s.period_start,s.period_end,pl.analysis_units,pl.backfill_units,pl.topic_units into sub
 from public.subscriptions s join public.plans pl on pl.key=s.plan_key
 where s.workspace_id=w for update of s;
 if not found then raise exception 'no_active_plan' using errcode='42501'; end if;
 if sub.status not in ('active','past_due') or now()<sub.period_start or now()>=sub.period_end then
 raise exception 'plan_inactive' using errcode='42501'; end if;
 allowance := case kind when 'comment_analysis' then sub.analysis_units
                        when 'historical_backfill' then sub.backfill_units
                        else sub.topic_units end;
 select coalesce(array_agg(u.event_key),'{}') into covered
 from public.usage_events u where u.workspace_id=w and u.event_key=any(keys);
 select coalesce(array_agg(distinct k),'{}') into fresh from unnest(keys) as k where not (k=any(covered));
 if allowance is not null then
   allowance := allowance + private.granted_units(w,kind);
   used := private.used_units(w,kind,sub.period_start);
   fresh := fresh[1:greatest(allowance-used,0)];
 end if;
 insert into public.usage_events(workspace_id,period_start,event_key,event_type)
 select w,sub.period_start,k,kind from unnest(fresh) as k;
 return covered||fresh;
end $$;

-- budget_entry gains the granted figure; a null allowance is reported as -1
-- so the contract can say "unlimited" rather than inventing a number.
create or replace function private.budget_entry(kind text,allowance int,used int,granted int default 0) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('event_type',kind,
   'allowance', case when allowance is null then -1 else allowance+granted end,
   'granted', granted, 'used',used,
   'remaining', case when allowance is null then -1 else greatest(allowance+granted-used,0) end);
$$;

create or replace function private.usage_summary_impl(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sub record; begin
 if not private.has_role(w) then raise exception 'forbidden' using errcode='42501'; end if;
 select s.plan_key,s.status,s.period_start,s.period_end,pl.analysis_units,pl.backfill_units,pl.topic_units into sub
 from public.subscriptions s join public.plans pl on pl.key=s.plan_key where s.workspace_id=w;
 if not found then return null; end if;
 return jsonb_build_object(
 'plan_key',sub.plan_key,'status',sub.status,
 'period_start',to_jsonb(sub.period_start),'period_end',to_jsonb(sub.period_end),
 'budgets',jsonb_build_array(
 private.budget_entry('comment_analysis',sub.analysis_units,private.used_units(w,'comment_analysis',sub.period_start),private.granted_units(w,'comment_analysis')),
 private.budget_entry('historical_backfill',sub.backfill_units,private.used_units(w,'historical_backfill',sub.period_start),private.granted_units(w,'historical_backfill')),
 private.budget_entry('topic_classification',sub.topic_units,private.used_units(w,'topic_classification',sub.period_start),private.granted_units(w,'topic_classification'))));
end $$;
```

- [ ] **Step 4: Update the contract for `granted` and `-1`**

In `packages/contracts/src/usage.ts` replace `BudgetSchema` with:

```ts
export const BudgetSchema = z
  .object({
    event_type: z.enum(["comment_analysis", "historical_backfill", "topic_classification"]),
    used: z.number().int().nonnegative(),
    /** -1 means no ceiling (an internal plan). */
    allowance: z.number().int().min(-1),
    granted: z.number().int().nonnegative().default(0),
    remaining: z.number().int().min(-1),
  })
  .strict()
  .refine(
    (b) => b.allowance === -1 ? b.remaining === -1 : b.remaining === Math.max(b.allowance - b.used, 0),
    "remaining must follow from used and allowance",
  );
export const unlimited = (b: Budget) => b.allowance === -1;
```

and make `budgetState` return `"ok"` when `unlimited(b)`. Add to `usage.test.ts`:

```ts
it("an unlimited budget is always ok", () => {
  expect(budgetState({ event_type: "comment_analysis", used: 999999, allowance: -1, granted: 0, remaining: -1 })).toBe("ok");
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run supabase/tests/usage_grants.test.ts packages/contracts && npm run test:db && npm test`
Expected: PASS. `planWords.ts` reads `analysis.allowance`; with `-1` the note would print "-1" — Task B3 fixes the words; for now the contract test is enough.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260917020000_usage_grants.sql supabase/tests/usage_grants.test.ts packages/contracts/src/usage.ts packages/contracts/src/usage.test.ts
git commit -m "A top-up pack is extra allowance on the same budget, spent after the plan's units; owner has no ceiling"
```

### Task A3: Platform admin — who may activate a plan by hand, and the audit of it

**Files:**
- Create: `supabase/migrations/20260917030000_platform_admin.sql`
- Test: `supabase/tests/platform_admin.test.ts`

**Interfaces:**
- Produces: `private.platform_admins(user_id uuid primary key, added_at)`; `public.is_platform_admin() returns boolean` (callable by `authenticated`).
- Produces: `public.set_workspace_plan(w uuid, plan text, months int default 1, note text default null) returns jsonb` — admin only; writes `subscriptions` (`provider='admin'`, `provider_ref=note`), an `audit_events` row `action='plan_set'`, returns the new `usage_summary`.
- Produces: `public.admin_workspaces() returns setof jsonb` — admin only; one row per workspace: `id, name, created_by, plan_key, status, period_end, provider`.
- Produces: `public.grant_pack(w uuid, kind text, units int, note text) returns uuid` — admin only; wraps `private.grant_units(..., 'admin', note)`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/tests/platform_admin.test.ts — bootstrap as plans_v2.test.ts, then:
const ADMIN = "10000000-0000-4000-8000-00000000000a";
const USER = "10000000-0000-4000-8000-00000000000b";
// insert both into auth.users (the trigger gives each a personal workspace on free)
// then: insert into private.platform_admins(user_id) values (ADMIN)

it("a member is not a platform admin; the listed user is", async () => {
  await as(USER);
  expect((await db.query<{ ok: boolean }>("select is_platform_admin() as ok")).rows[0].ok).toBe(false);
  await as(ADMIN);
  expect((await db.query<{ ok: boolean }>("select is_platform_admin() as ok")).rows[0].ok).toBe(true);
});

it("only an admin may set a plan, and the change is audited", async () => {
  const w = (await db.query<{ id: string }>("select id from workspaces where created_by=$1", [USER])).rows[0].id;
  await as(USER);
  await expect(db.query("select set_workspace_plan($1,'agency',1,'manual')", [w])).rejects.toThrow(/forbidden/);
  await as(ADMIN);
  const r = await db.query<{ set_workspace_plan: { plan_key: string; status: string } }>(
    "select set_workspace_plan($1,'agency',1,'invoice 17')", [w]);
  expect(r.rows[0].set_workspace_plan).toMatchObject({ plan_key: "agency", status: "active" });
  await db.exec("reset role");
  const audit = await db.query<{ action: string; actor_id: string; target_id: string }>(
    "select action,actor_id,target_id from audit_events where workspace_id=$1", [w]);
  expect(audit.rows).toEqual([{ action: "plan_set", actor_id: ADMIN, target_id: "agency" }]);
  const sub = await db.query<{ provider: string; provider_ref: string }>("select provider,provider_ref from subscriptions where workspace_id=$1", [w]);
  expect(sub.rows[0]).toEqual({ provider: "admin", provider_ref: "invoice 17" });
});

it("setting the owner plan removes every ceiling", async () => {
  const w = (await db.query<{ id: string }>("select id from workspaces where created_by=$1", [ADMIN])).rows[0].id;
  await as(ADMIN);
  const r = await db.query<{ set_workspace_plan: { budgets: { allowance: number }[] } }>(
    "select set_workspace_plan($1,'owner',1200,'self')", [w]);
  expect(r.rows[0].set_workspace_plan.budgets.every((b) => b.allowance === -1)).toBe(true);
});

it("admin_workspaces lists everyone; a member sees forbidden", async () => {
  await as(USER);
  await expect(db.query("select * from admin_workspaces()")).rejects.toThrow(/forbidden/);
  await as(ADMIN);
  const r = await db.query<{ admin_workspaces: { plan_key: string } }>("select * from admin_workspaces()");
  expect(r.rows.length).toBeGreaterThanOrEqual(2);
  expect(r.rows.map((x) => x.admin_workspaces.plan_key).sort()).toEqual(["agency", "owner"]);
});

it("grant_pack is admin-only and idempotent on the note", async () => {
  const w = (await db.query<{ id: string }>("select id from workspaces where created_by=$1", [USER])).rows[0].id;
  await as(USER);
  await expect(db.query("select grant_pack($1,'comment_analysis',10000,'gift-1')", [w])).rejects.toThrow(/forbidden/);
  await as(ADMIN);
  const a = await db.query<{ grant_pack: string }>("select grant_pack($1,'comment_analysis',10000,'gift-1')", [w]);
  const b = await db.query<{ grant_pack: string }>("select grant_pack($1,'comment_analysis',10000,'gift-1')", [w]);
  expect(a.rows[0].grant_pack).toBe(b.rows[0].grant_pack);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/tests/platform_admin.test.ts`
Expected: FAIL — `relation "private.platform_admins" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260917030000_platform_admin.sql
-- The hand activation the handoff describes, given a door. A platform admin
-- is a row in a private table, not a role claim, so it cannot be minted from
-- a client; the first one is inserted by the operator over the SQL editor.
create table private.platform_admins (
  user_id uuid primary key references auth.users(id),
  added_at timestamptz not null default now()
);

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists (select 1 from private.platform_admins where user_id = auth.uid());
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

create function public.set_workspace_plan(w uuid, plan text, months int default 1, note text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.plans where key = plan) then raise exception 'unknown_plan' using errcode='22023'; end if;
  if months < 1 or months > 1200 then raise exception 'invalid_months' using errcode='22023'; end if;
  insert into public.subscriptions(workspace_id, plan_key, status, period_start, period_end, provider, provider_ref)
  values (w, plan, 'active', now(), now() + make_interval(months => months), 'admin', note)
  on conflict (workspace_id) do update
    set plan_key = excluded.plan_key, status = 'active',
        period_start = excluded.period_start, period_end = excluded.period_end,
        provider = 'admin', provider_ref = excluded.provider_ref, cancel_at_period_end = false;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, auth.uid(), 'plan_set', 'plan', plan);
  return private.usage_summary_impl(w);
end $$;
revoke all on function public.set_workspace_plan(uuid,text,int,text) from public, anon;
grant execute on function public.set_workspace_plan(uuid,text,int,text) to authenticated;

create function public.admin_workspaces() returns setof jsonb
language sql stable security definer set search_path='' as $$
  select case when public.is_platform_admin() then jsonb_build_object(
    'id', w.id, 'name', w.name, 'created_by', w.created_by,
    'plan_key', s.plan_key, 'status', s.status, 'period_end', s.period_end, 'provider', s.provider)
  else private.raise_forbidden() end
  from public.workspaces w left join public.subscriptions s on s.workspace_id = w.id
  order by w.created_at desc;
$$;
-- A sql function cannot raise directly; this helper does, with the errcode the app maps.
create function private.raise_forbidden() returns jsonb
language plpgsql immutable set search_path='' as $$
begin raise exception 'forbidden' using errcode='42501'; end $$;
revoke all on function public.admin_workspaces() from public, anon;
grant execute on function public.admin_workspaces() to authenticated;

create function public.grant_pack(w uuid, kind text, units int, note text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, auth.uid(), 'pack_granted', 'usage_grant', kind || ':' || units);
  return private.grant_units(w, kind, units, 'admin', note);
end $$;
revoke all on function public.grant_pack(uuid,text,int,text) from public, anon;
grant execute on function public.grant_pack(uuid,text,int,text) to authenticated;
```

Order matters: `private.raise_forbidden` must be created **before** `public.admin_workspaces` — move it above in the file. The usage_summary_impl check `has_role(w)` would refuse an admin who is not a member; `set_workspace_plan` therefore calls a member-agnostic read — add at the top of the migration:

```sql
-- usage_summary_impl refuses non-members; the admin path reads through this twin.
create function private.usage_summary_unchecked(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sub record; begin
 select s.plan_key,s.status,s.period_start,s.period_end,pl.analysis_units,pl.backfill_units,pl.topic_units into sub
 from public.subscriptions s join public.plans pl on pl.key=s.plan_key where s.workspace_id=w;
 if not found then return null; end if;
 return jsonb_build_object('plan_key',sub.plan_key,'status',sub.status,
 'period_start',to_jsonb(sub.period_start),'period_end',to_jsonb(sub.period_end),
 'budgets',jsonb_build_array(
 private.budget_entry('comment_analysis',sub.analysis_units,private.used_units(w,'comment_analysis',sub.period_start),private.granted_units(w,'comment_analysis')),
 private.budget_entry('historical_backfill',sub.backfill_units,private.used_units(w,'historical_backfill',sub.period_start),private.granted_units(w,'historical_backfill')),
 private.budget_entry('topic_classification',sub.topic_units,private.used_units(w,'topic_classification',sub.period_start),private.granted_units(w,'topic_classification'))));
end $$;
revoke all on function private.usage_summary_unchecked(uuid) from public, anon, authenticated;
```

and have `set_workspace_plan` `return private.usage_summary_unchecked(w);`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run supabase/tests/platform_admin.test.ts && npm run test:db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260917030000_platform_admin.sql supabase/tests/platform_admin.test.ts
git commit -m "A platform admin is a private row; set_workspace_plan and grant_pack are the hand activation, audited"
```

### Task A4: The public catalogue and a richer usage summary

**Files:**
- Create: `supabase/migrations/20260917040000_plan_catalogue.sql`
- Create: `packages/contracts/src/plans.ts`
- Modify: `packages/contracts/src/index.ts` (export), `packages/contracts/src/usage.ts`
- Test: `supabase/tests/plan_catalogue.test.ts`, `packages/contracts/src/plans.test.ts`

**Interfaces:**
- Produces: `public.plan_catalogue() returns jsonb` — callable by `anon` and `authenticated`; array of non-internal plans ordered by `sort_order`, each `{key, segment, title_ar, title_en, price_monthly_cents, price_yearly_cents, self_serve, limits:{analysis_units, topic_units, insight_reports, channels, members, workspaces, live_interval_minutes}, provider_prices}`.
- Produces: `usage_summary` gains `plan: {key, segment, title_ar, title_en, self_serve, limits:{...}}`, `cancel_at_period_end`, `billing_interval`, `provider`.
- Produces contracts: `PlanSchema`, `PlanCatalogueSchema = z.array(PlanSchema)`, `UsageSummarySchema` extended, `planLimits(plan)` helper.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/tests/plan_catalogue.test.ts — bootstrap as plans_v2.test.ts
it("anon reads six sellable plans and never owner or pilot", async () => {
  await db.exec("reset role; set role anon");
  const r = await db.query<{ plan_catalogue: { key: string; segment: string }[] }>("select plan_catalogue()");
  expect(r.rows[0].plan_catalogue.map((p) => p.key)).toEqual(["free", "creator", "creator_plus", "agency", "media", "enterprise"]);
});
it("a plan's limits are the table's numbers", async () => {
  await db.exec("reset role; set role anon");
  const r = await db.query<{ plan_catalogue: { key: string; limits: Record<string, number> }[] }>("select plan_catalogue()");
  expect(r.rows[0].plan_catalogue.find((p) => p.key === "agency")!.limits).toEqual({
    analysis_units: 150000, topic_units: 60000, insight_reports: 200, channels: 10, members: 10, workspaces: 5, live_interval_minutes: 360 });
});
it("usage_summary names the plan and its limits", async () => {
  // OWNER's personal workspace, on free by the trigger
  await as(OWNER);
  const w = (await db.query<{ id: string }>("select id from workspaces where created_by=$1", [OWNER])).rows[0].id;
  const r = await db.query<{ usage_summary: { plan: { key: string; limits: { channels: number } }; provider: string | null } }>("select usage_summary($1)", [w]);
  expect(r.rows[0].usage_summary.plan).toMatchObject({ key: "free", limits: { channels: 0 } });
  expect(r.rows[0].usage_summary.provider).toBeNull();
});
```

```ts
// packages/contracts/src/plans.test.ts
import { PlanCatalogueSchema } from "./index";
it("parses a catalogue row", () => {
  const p = PlanCatalogueSchema.parse([{ key: "creator", segment: "individual", title_ar: "منشئ", title_en: "Creator",
    price_monthly_cents: 1200, price_yearly_cents: 12000, self_serve: true,
    limits: { analysis_units: 10000, topic_units: 4000, insight_reports: 10, channels: 1, members: 1, workspaces: 1, live_interval_minutes: 1440 },
    provider_prices: {} }]);
  expect(p[0].key).toBe("creator");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run supabase/tests/plan_catalogue.test.ts packages/contracts/src/plans.test.ts`
Expected: FAIL — `function plan_catalogue() does not exist` / module not found.

- [ ] **Step 3: Write the migration and contracts**

```sql
-- supabase/migrations/20260917040000_plan_catalogue.sql
-- The pricing page reads this signed out. It never exposes an internal plan,
-- and it is the one place the web app learns prices from — not a copy in code.
create function private.plan_json(p public.plans) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'key', p.key, 'segment', p.segment, 'title_ar', p.title_ar, 'title_en', p.title_en,
    'price_monthly_cents', p.price_monthly_cents, 'price_yearly_cents', p.price_yearly_cents,
    'self_serve', p.self_serve, 'provider_prices', p.provider_prices,
    'limits', jsonb_build_object(
      'analysis_units', coalesce(p.analysis_units, -1), 'topic_units', coalesce(p.topic_units, -1),
      'insight_reports', p.insight_reports, 'channels', coalesce(p.channels_limit, -1),
      'members', coalesce(p.members_limit, -1), 'workspaces', coalesce(p.workspaces_limit, -1),
      'live_interval_minutes', p.live_interval_minutes));
$$;
create function public.plan_catalogue() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(private.plan_json(p) order by p.sort_order), '[]'::jsonb)
  from public.plans p where not p.internal;
$$;
revoke all on function public.plan_catalogue() from public;
grant execute on function public.plan_catalogue() to anon, authenticated;

-- usage_summary_impl and its unchecked twin, rebuilt from 20260917030000 with
-- the plan block and the billing fields.
create or replace function private.usage_summary_unchecked(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sub record; pl public.plans; begin
 select s.* into sub from public.subscriptions s where s.workspace_id=w;
 if not found then return null; end if;
 select * into pl from public.plans where key = sub.plan_key;
 return jsonb_build_object('plan_key',sub.plan_key,'status',sub.status,
 'period_start',to_jsonb(sub.period_start),'period_end',to_jsonb(sub.period_end),
 'cancel_at_period_end', sub.cancel_at_period_end, 'billing_interval', sub.billing_interval, 'provider', sub.provider,
 'plan', private.plan_json(pl),
 'budgets',jsonb_build_array(
 private.budget_entry('comment_analysis',pl.analysis_units,private.used_units(w,'comment_analysis',sub.period_start),private.granted_units(w,'comment_analysis')),
 private.budget_entry('historical_backfill',pl.backfill_units,private.used_units(w,'historical_backfill',sub.period_start),private.granted_units(w,'historical_backfill')),
 private.budget_entry('topic_classification',pl.topic_units,private.used_units(w,'topic_classification',sub.period_start),private.granted_units(w,'topic_classification'))));
end $$;
create or replace function private.usage_summary_impl(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role(w) then raise exception 'forbidden' using errcode='42501'; end if;
 return private.usage_summary_unchecked(w);
end $$;
```

```ts
// packages/contracts/src/plans.ts
/** The ladder as plan_catalogue() returns it; -1 in a limit means no ceiling. */
import { z } from "zod";
export const PlanLimitsSchema = z.object({
  analysis_units: z.number().int().min(-1), topic_units: z.number().int().min(-1),
  insight_reports: z.number().int().nonnegative(), channels: z.number().int().min(-1),
  members: z.number().int().min(-1), workspaces: z.number().int().min(-1),
  live_interval_minutes: z.number().int().nonnegative(),
}).strict();
export const PlanSchema = z.object({
  key: z.string().min(1), segment: z.enum(["individual", "business", "internal"]),
  title_ar: z.string(), title_en: z.string(),
  price_monthly_cents: z.number().int().nonnegative(), price_yearly_cents: z.number().int().nonnegative(),
  self_serve: z.boolean(), provider_prices: z.record(z.string()).default({}),
  limits: PlanLimitsSchema,
}).strict();
export const PlanCatalogueSchema = z.array(PlanSchema);
export type Plan = z.infer<typeof PlanSchema>;
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;
```

In `usage.ts` add to `UsageSummarySchema`: `status: z.enum(["active","past_due","paused","cancelled"])`, `cancel_at_period_end: z.boolean().default(false)`, `billing_interval: z.enum(["month","year"]).nullable().default(null)`, `provider: z.string().nullable().default(null)`, `plan: PlanSchema.optional()`. Export `plans.ts` from `index.ts`. Update `packages/contracts/src/fixture.ts`'s sanitized fixture `plan` value if it now fails parsing (run `npm test` to see).

- [ ] **Step 4: Run tests**

Run: `npx vitest run supabase/tests/plan_catalogue.test.ts packages/contracts && npm run test:db && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260917040000_plan_catalogue.sql supabase/tests/plan_catalogue.test.ts packages/contracts/src/plans.ts packages/contracts/src/plans.test.ts packages/contracts/src/usage.ts packages/contracts/src/index.ts
git commit -m "The pricing page reads plan_catalogue(); usage_summary names the plan and its limits"
```

### Task A5: Docs for Part A, and the live migration

- [ ] **Step 1: Replace `docs/pricing.md`** with the v2 ladder: copy §2 (ladder), §3 (why), the add-on rule and the owner paragraph from `docs/pricing-v2-draft.md` into `docs/pricing.md`; keep `pricing-v2-draft.md`'s §0/§1/§5–§8 as history under a "2026-09-16 decisions" heading in `docs/decisions.md` (one entry, dated, with the six answers and the Paddle decision and the UK/Türkiye tax reasoning in three lines).
- [ ] **Step 2: `docs/progress.md`** — dated entry: what Part A adds, what is fixture-tested (PGlite) and what is not yet live.
- [ ] **Step 3: Apply the four migrations to the live project** the way `docs/verification.md` 2026-09-16 recorded the last one (Supabase MCP `apply_migration` or SQL editor, one file at a time, in order), then insert the first platform admin over the SQL editor: `insert into private.platform_admins(user_id) select id from auth.users where email = 'engmlubbad@gmail.com';` and set the owner plan on his personal workspace with `select set_workspace_plan('<his workspace id>','owner',1200,'owner');` — **ask the user before touching the live project**; record the outcome in `docs/verification.md`.
- [ ] **Step 4: Commit**

```bash
git add docs/pricing.md docs/decisions.md docs/progress.md docs/verification.md
git commit -m "Record the plans v2 decisions and the live migration"
```

---

## Part B — The web app: pricing page, plan panel, admin page

### Task B1: Pricing words, decided away from the page

**Files:**
- Create: `apps/web/src/pricing.ts`, `apps/web/src/pricing.test.ts`
- Modify: `apps/web/src/strings/ar.ts`, `apps/web/src/strings/en.ts` (new keys below)

**Interfaces:**
- Produces: `pricingRows(catalogue: Plan[], segment: "individual"|"business", interval: "month"|"year", locale: "ar"|"en", S: Strings): PricingRow[]` where `PricingRow = { key, title, price: string, perLabel: string, yearlyNote: string|null, anchor: boolean, cta: {kind:"checkout"|"contact"|"free"|"current", label:string}, limits: {label:string, value:string}[] }`.
- Produces: `formatUsd(cents:number): string` → `"$12"`, `"$249"`, `"$0"`.
- Strings added (ar/en): `pricingTitle`, `pricingLead`, `pricingSegmentIndividual`, `pricingSegmentBusiness`, `pricingMonthly`, `pricingYearly`, `pricingPerMonth`, `pricingPerMonthBilledYearly(total:string)`, `pricingMostChosen`, `pricingCtaStart`, `pricingCtaContact`, `pricingCtaFree`, `pricingCtaCurrent`, `pricingLimitComments`, `pricingLimitTopics`, `pricingLimitReports`, `pricingLimitChannels`, `pricingLimitMembers`, `pricingLimitWorkspaces`, `pricingLimitLive(hours:string)`, `pricingUnlimited`, `pricingFaqTitle`, `pricingFaqNoDouble`, `pricingFaqHardStop`, `pricingFaqPack`, `pricingFaqTax`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/pricing.test.ts
import { describe, expect, it } from "vitest";
import { ar } from "./strings/ar";
import { formatUsd, pricingRows } from "./pricing";
import type { Plan } from "@sentiment/contracts";

const plan = (over: Partial<Plan>): Plan => ({
  key: "creator", segment: "individual", title_ar: "منشئ", title_en: "Creator",
  price_monthly_cents: 1200, price_yearly_cents: 12000, self_serve: true, provider_prices: {},
  limits: { analysis_units: 10000, topic_units: 4000, insight_reports: 10, channels: 1, members: 1, workspaces: 1, live_interval_minutes: 1440 },
  ...over,
});

describe("pricing rows", () => {
  it("formats dollars without cents", () => {
    expect(formatUsd(1200)).toBe("$12");
    expect(formatUsd(24900)).toBe("$249");
    expect(formatUsd(0)).toBe("$0");
  });
  it("yearly shows the monthly equivalent and the billed total", () => {
    const [row] = pricingRows([plan({})], "individual", "year", "ar", ar);
    expect(row.price).toBe("$10");
    expect(row.yearlyNote).toBe(ar.pricingPerMonthBilledYearly("$120"));
  });
  it("the anchor is creator_plus for individuals and agency for business", () => {
    const rows = pricingRows(
      [plan({}), plan({ key: "creator_plus" }), plan({ key: "agency", segment: "business" }), plan({ key: "media", segment: "business", self_serve: false })],
      "business", "month", "ar", ar);
    expect(rows.map((r) => [r.key, r.anchor])).toEqual([["agency", true], ["media", false]]);
  });
  it("a plan that is not self-serve asks to contact; free starts free", () => {
    const rows = pricingRows([plan({ key: "free", price_monthly_cents: 0 }), plan({ key: "media", self_serve: false })], "individual", "month", "ar", ar);
    expect(rows[0].cta.kind).toBe("free");
    expect(rows[1].cta.kind).toBe("contact");
  });
  it("-1 reads as unlimited", () => {
    const [row] = pricingRows([plan({ limits: { ...plan({}).limits, channels: -1 } })], "individual", "month", "ar", ar);
    expect(row.limits.find((l) => l.label === ar.pricingLimitChannels)!.value).toBe(ar.pricingUnlimited);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/pricing.test.ts`
Expected: FAIL — cannot find module `./pricing`.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/pricing.ts
/** What a pricing card says, decided away from the card so it can be tested
 *  without rendering. Prices come from plan_catalogue(), never from here. */
import type { Plan } from "@sentiment/contracts";
import type { Strings } from "./strings";

export type PricingRow = {
  key: string; title: string; price: string; perLabel: string; yearlyNote: string | null;
  anchor: boolean;
  cta: { kind: "checkout" | "contact" | "free" | "current"; label: string };
  limits: { label: string; value: string }[];
};
const ANCHOR: Record<string, string> = { individual: "creator_plus", business: "agency" };

export const formatUsd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export function pricingRows(
  catalogue: Plan[], segment: "individual" | "business", interval: "month" | "year",
  locale: "ar" | "en", S: Strings, currentKey: string | null = null,
): PricingRow[] {
  const n = (v: number) => (v === -1 ? S.pricingUnlimited : v.toLocaleString("en-US"));
  return catalogue
    .filter((p) => p.segment === segment)
    .map((p) => {
      const monthly = interval === "year" ? p.price_yearly_cents / 12 : p.price_monthly_cents;
      const cta =
        p.key === currentKey ? { kind: "current" as const, label: S.pricingCtaCurrent }
        : p.price_monthly_cents === 0 ? { kind: "free" as const, label: S.pricingCtaFree }
        : p.self_serve ? { kind: "checkout" as const, label: S.pricingCtaStart }
        : { kind: "contact" as const, label: S.pricingCtaContact };
      return {
        key: p.key,
        title: locale === "ar" ? p.title_ar : p.title_en,
        price: formatUsd(monthly),
        perLabel: S.pricingPerMonth,
        yearlyNote: interval === "year" && p.price_yearly_cents > 0 ? S.pricingPerMonthBilledYearly(formatUsd(p.price_yearly_cents)) : null,
        anchor: ANCHOR[segment] === p.key,
        cta,
        limits: [
          { label: S.pricingLimitComments, value: n(p.limits.analysis_units) },
          { label: S.pricingLimitTopics, value: n(p.limits.topic_units) },
          { label: S.pricingLimitReports, value: n(p.limits.insight_reports) },
          { label: S.pricingLimitChannels, value: n(p.limits.channels) },
          { label: S.pricingLimitMembers, value: n(p.limits.members) },
          ...(segment === "business" ? [{ label: S.pricingLimitWorkspaces, value: n(p.limits.workspaces) }] : []),
          ...(p.limits.live_interval_minutes > 0 ? [{ label: S.pricingLimitLive((p.limits.live_interval_minutes / 60).toLocaleString("en-US")), value: "" }] : []),
        ],
      };
    });
}
```

Add the strings to `ar.ts` (Arabic copy from `docs/pricing-v2-draft.md` §2/§4 — e.g. `pricingFaqNoDouble: "الفيديو الحيّ لا يكلّف مرتين: التعليقات الجديدة فقط تُحسب."`, `pricingFaqHardStop: "عند بلوغ الحد يتوقف التحليل؛ لا فاتورة مفاجئة."`, `pricingFaqPack: "حزمة 10,000 تعليق بـ 5$ تُضاف فوق حصة خطتك، صالحة لنهاية الفترة وشهر بعدها."`, `pricingFaqTax: "الأسعار بالدولار قبل الضريبة؛ تُحصَّل ضريبة بلدك عند الدفع عبر Paddle، بائعنا القانوني."`) and their English twins to `en.ts`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run apps/web/src/pricing.test.ts && npm run typecheck`
Expected: PASS; typecheck fails if any key is missing in one locale — add it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pricing.ts apps/web/src/pricing.test.ts apps/web/src/strings/ar.ts apps/web/src/strings/en.ts
git commit -m "Pricing cards are words decided from the catalogue: anchor, CTA kind, limits, yearly note"
```

### Task B2: The `/pricing` page

**Files:**
- Create: `apps/web/src/Pricing.tsx`
- Modify: `apps/web/src/main.tsx:379-386` (route), `apps/web/src/Landing.tsx` (a link to `/pricing` in the landing nav, next to the existing sign-in link), `apps/web/src/landing.css` (cards)
- Test: `tests/e2e/pricing.spec.ts`

**Interfaces:**
- Consumes: `pricingRows` (B1), `PlanCatalogueSchema` (A4), `supabase.rpc("plan_catalogue")`.
- Produces: `<Pricing />` at `/pricing`, readable signed out; in fixture mode (`configuredMode !== "live"`) it renders from `packages/contracts/src/fixture.ts`'s catalogue (add a `catalogue` field there with the six rows so e2e has data without a backend).

- [ ] **Step 1: Write the failing e2e test**

```ts
// tests/e2e/pricing.spec.ts
import { expect, test } from "@playwright/test";
test("the pricing page shows two segments and a yearly switch", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("الخطط");
  const business = page.getByRole("tab", { name: "شركات ووكالات" });
  await business.click();
  await expect(page.getByRole("heading", { name: "وكالة" })).toBeVisible();
  await expect(page.getByText("الأكثر اختيارًا")).toBeVisible();
  await page.getByRole("switch", { name: "سنوي" }).click();
  await expect(page.getByText("$79")).toBeVisible();
  await expect(page.getByRole("button", { name: "تواصل معنا" })).toBeVisible(); // media
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test tests/e2e/pricing.spec.ts`
Expected: FAIL — 404 page.

- [ ] **Step 3: Implement the page**

```tsx
// apps/web/src/Pricing.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlanCatalogueSchema } from "@sentiment/contracts";
import { supabase } from "./supabase";
import { configuredMode, fixtureCatalogue } from "./data";
import { useLocale } from "./locale";
import { useStrings } from "./strings";
import { pricingRows } from "./pricing";
import { useSession } from "./session";
import { openCheckout } from "./paddle"; // Task C4; until then export a stub that throws "checkout_unavailable"

export function Pricing() {
  const S = useStrings();
  const [locale] = useLocale();
  const { session } = useSession();
  const [segment, setSegment] = useState<"individual" | "business">("individual");
  const [yearly, setYearly] = useState(false);
  const catalogue = useQuery({
    queryKey: ["catalogue"],
    queryFn: async () => {
      if (configuredMode !== "live" || !supabase) return fixtureCatalogue;
      const { data, error } = await supabase.rpc("plan_catalogue");
      if (error) throw new Error("catalogue_unavailable");
      return PlanCatalogueSchema.parse(data);
    },
  });
  const rows = pricingRows(catalogue.data ?? [], segment, yearly ? "year" : "month", locale, S);
  return (
    <main className="pricing">
      <h1>{S.pricingTitle}</h1>
      <p className="pricing-lead">{S.pricingLead}</p>
      <div role="tablist" className="pricing-segments">
        {(["individual", "business"] as const).map((s) => (
          <button key={s} role="tab" aria-selected={segment === s} onClick={() => setSegment(s)}>
            {s === "individual" ? S.pricingSegmentIndividual : S.pricingSegmentBusiness}
          </button>
        ))}
      </div>
      <label className="pricing-interval">
        <span>{S.pricingMonthly}</span>
        <button role="switch" aria-checked={yearly} aria-label={S.pricingYearly} onClick={() => setYearly((v) => !v)} />
        <span>{S.pricingYearly}</span>
      </label>
      <section className="pricing-cards">
        {rows.map((r) => (
          <article key={r.key} className="pricing-card" data-anchor={r.anchor}>
            {r.anchor && <span className="pricing-anchor">{S.pricingMostChosen}</span>}
            <h2>{r.title}</h2>
            <p className="pricing-price"><strong>{r.price}</strong> <span>{r.perLabel}</span></p>
            {r.yearlyNote && <p className="pricing-yearly-note">{r.yearlyNote}</p>}
            <ul>{r.limits.map((l) => <li key={l.label}><span>{l.label}</span><strong>{l.value}</strong></li>)}</ul>
            <button
              className="pricing-cta"
              data-kind={r.cta.kind}
              onClick={() => {
                if (r.cta.kind === "contact") window.location.href = "mailto:engmlubbad@gmail.com?subject=" + encodeURIComponent(r.title);
                else if (r.cta.kind === "free" || !session) window.location.assign("/account");
                else void openCheckout({ planKey: r.key, interval: yearly ? "year" : "month", session });
              }}
            >{r.cta.label}</button>
          </article>
        ))}
      </section>
      <section className="pricing-faq">
        <h2>{S.pricingFaqTitle}</h2>
        <p>{S.pricingFaqNoDouble}</p><p>{S.pricingFaqHardStop}</p><p>{S.pricingFaqPack}</p><p>{S.pricingFaqTax}</p>
      </section>
    </main>
  );
}
```

Add `<Route path="/pricing" element={<Pricing />} />` beside `/` in `main.tsx`. In `data.ts` export `fixtureCatalogue` parsed from the fixture. Style `.pricing-cards` as a responsive grid in `landing.css` using existing tokens only (`docs/progress.md` 2026-09-15 audit: no raw colours outside the token layer).

- [ ] **Step 4: Run e2e, unit, lint**

Run: `npx playwright test tests/e2e/pricing.spec.ts && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/Pricing.tsx apps/web/src/main.tsx apps/web/src/Landing.tsx apps/web/src/landing.css apps/web/src/data.ts packages/contracts/src/fixture.ts tests/e2e/pricing.spec.ts
git commit -m "A pricing page: two segments, yearly switch, the anchor marked, media asks to be contacted"
```

### Task B3: The account page shows the plan, its limits and the three buttons

**Files:**
- Create: `apps/web/src/planPanel.ts`, `apps/web/src/planPanel.test.ts`, `apps/web/src/PlanPanel.tsx`
- Modify: `apps/web/src/Account.tsx` (render `<PlanPanel />` above the workspaces section at line ~395), `apps/web/src/planWords.ts` (unlimited), `apps/web/src/planWords.test.ts`

**Interfaces:**
- Consumes: `UsageSummary` with `plan` (A4), `budgetState`/`unlimited` (A2).
- Produces: `planPanelWords(summary: UsageSummary|null, S: Strings, locale): { title, statusLine, rows: {label, used:string, allowance:string, tone}[], actions: ("upgrade"|"manage"|"topup"|"contact")[] , notice: string|null }`.
  Rules: `past_due` → notice `S.planPastDue(periodEndPlus7)`; `cancel_at_period_end` → notice `S.planEndsOn(date)`; `provider === "paddle"` → `manage`; self-serve plan with `provider !== "paddle"` and key ≠ owner → `upgrade`; any finite budget → `topup`; `segment === "business"` → `contact`.
- Strings: `planPanelTitle`, `planStatusActive`, `planStatusPastDue`, `planPastDue(date)`, `planEndsOn(date)`, `planUpgrade`, `planManage`, `planTopup`, `planContact`, `planUnlimited`, `planRenews(date)`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/planPanel.test.ts
import { describe, expect, it } from "vitest";
import { ar } from "./strings/ar";
import { planPanelWords } from "./planPanel";
import type { UsageSummary } from "@sentiment/contracts";

const summary = (over: Partial<UsageSummary>): UsageSummary => ({
  plan_key: "creator", status: "active", period_start: "2026-09-01T00:00:00Z", period_end: "2026-10-01T00:00:00Z",
  cancel_at_period_end: false, billing_interval: "month", provider: "paddle",
  plan: { key: "creator", segment: "individual", title_ar: "منشئ", title_en: "Creator", price_monthly_cents: 1200, price_yearly_cents: 12000, self_serve: true, provider_prices: {},
    limits: { analysis_units: 10000, topic_units: 4000, insight_reports: 10, channels: 1, members: 1, workspaces: 1, live_interval_minutes: 1440 } },
  budgets: [{ event_type: "comment_analysis", used: 2500, allowance: 10000, granted: 0, remaining: 7500 }],
  ...over,
});

describe("plan panel words", () => {
  it("a paddle subscriber manages and tops up", () => {
    const w = planPanelWords(summary({}), ar, "ar");
    expect(w.actions).toEqual(["manage", "topup"]);
    expect(w.rows[0]).toMatchObject({ used: "2,500", allowance: "10,000", tone: "ok" });
  });
  it("a free workspace upgrades", () => {
    const w = planPanelWords(summary({ provider: null, plan_key: "free", plan: { ...summary({}).plan!, key: "free", price_monthly_cents: 0 } }), ar, "ar");
    expect(w.actions).toContain("upgrade");
  });
  it("past_due names the day the plan drops", () => {
    const w = planPanelWords(summary({ status: "past_due" }), ar, "ar");
    expect(w.notice).toBe(ar.planPastDue("2026-10-08"));
  });
  it("owner is unlimited and has no actions", () => {
    const w = planPanelWords(summary({ provider: "admin", plan_key: "owner", plan: { ...summary({}).plan!, key: "owner", segment: "internal" },
      budgets: [{ event_type: "comment_analysis", used: 1, allowance: -1, granted: 0, remaining: -1 }] }), ar, "ar");
    expect(w.rows[0].allowance).toBe(ar.planUnlimited);
    expect(w.actions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/src/planPanel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `planPanel.ts` and `PlanPanel.tsx`**

```ts
// apps/web/src/planPanel.ts
import { budgetState, unlimited, type UsageSummary } from "@sentiment/contracts";
import type { Strings } from "./strings";

export type PlanAction = "upgrade" | "manage" | "topup" | "contact";
export function planPanelWords(summary: UsageSummary | null, S: Strings, locale: "ar" | "en") {
  if (!summary || !summary.plan) return { title: S.planNoneTitle, statusLine: S.planNoneNote, rows: [], actions: [] as PlanAction[], notice: null as string | null };
  const p = summary.plan;
  const n = (v: number) => (v === -1 ? S.planUnlimited : v.toLocaleString("en-US"));
  const day = (iso: string, plusDays = 0) => new Date(new Date(iso).getTime() + plusDays * 86400000).toISOString().slice(0, 10);
  const rows = summary.budgets.map((b) => ({
    label: b.event_type === "comment_analysis" ? S.budgetAnalysis : b.event_type === "topic_classification" ? S.budgetTopics : S.budgetBackfill,
    used: n(b.used), allowance: n(b.allowance), tone: unlimited(b) ? "ok" : budgetState(b),
  }));
  const actions: PlanAction[] = [];
  if (p.segment !== "internal") {
    if (summary.provider === "paddle") actions.push("manage");
    else if (p.self_serve) actions.push("upgrade");
    if (summary.budgets.some((b) => !unlimited(b))) actions.push("topup");
    if (p.segment === "business") actions.push("contact");
  }
  const notice =
    summary.status === "past_due" ? S.planPastDue(day(summary.period_end, 7))
    : summary.cancel_at_period_end ? S.planEndsOn(day(summary.period_end))
    : null;
  return {
    title: locale === "ar" ? p.title_ar : p.title_en,
    statusLine: summary.status === "past_due" ? S.planStatusPastDue : S.planRenews(day(summary.period_end)),
    rows, actions, notice,
  };
}
```

`PlanPanel.tsx` reads `usage_summary` with the same query as `PlanCard.tsx` (copy its `useQuery` block; queryKey `["plan", userId, workspaceId]` so both share the cache), renders a `<section className="rp-section" data-testid="plan-panel">` with the title, status line, a `<ul className="budgets">` of rows (same markup as `OperationsPanels.tsx:136`), the notice, and one button per action: `upgrade` → `<Link to="/pricing">`, `manage` → calls `openPortal(session, workspaceId)` (Task C5), `topup` → `openCheckout({ planKey: "pack_10k", interval: "month", session, workspaceId })` (Task C4), `contact` → mailto. Fix `planWords.ts`: when `unlimited(analysis)` return note `S.planUnlimited` and tone `ok`; add that case to `planWords.test.ts`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/web/src/planPanel.test.ts apps/web/src/planWords.test.ts && npm run typecheck && npx playwright test tests/e2e/app-shell.spec.ts`
Expected: PASS (the shell spec still finds the account page's headings).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/planPanel.ts apps/web/src/planPanel.test.ts apps/web/src/PlanPanel.tsx apps/web/src/Account.tsx apps/web/src/planWords.ts apps/web/src/planWords.test.ts apps/web/src/strings/ar.ts apps/web/src/strings/en.ts
git commit -m "The account page carries the plan: limits, renewal, past-due notice, and the three doors"
```

### Task B4: The `/admin` page for platform admins

**Files:**
- Create: `apps/web/src/admin.ts`, `apps/web/src/admin.test.ts`, `apps/web/src/Admin.tsx`
- Modify: `apps/web/src/main.tsx` (route inside `<AppLayout />`; nav link shown only when `is_platform_admin()` is true)

**Interfaces:**
- Consumes: `is_platform_admin()`, `admin_workspaces()`, `set_workspace_plan(w, plan, months, note)`, `grant_pack(w, kind, units, note)` (A3), `plan_catalogue()` + the internal keys `owner`/`pilot` for the select.
- Produces: `adminRows(list: AdminWorkspace[], S): {id, name, plan, status, periodEnd, provider}[]`; `AdminWorkspaceSchema` in `packages/contracts/src/admin.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/admin.test.ts
import { describe, expect, it } from "vitest";
import { ar } from "./strings/ar";
import { adminRows } from "./admin";
describe("admin rows", () => {
  it("a workspace without a subscription reads as none", () => {
    const rows = adminRows([{ id: "w1", name: "x", created_by: "u", plan_key: null, status: null, period_end: null, provider: null }], ar);
    expect(rows[0]).toMatchObject({ plan: ar.adminNoPlan, provider: "—" });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run apps/web/src/admin.test.ts` → module not found.

- [ ] **Step 3: Implement**

`packages/contracts/src/admin.ts`: `AdminWorkspaceSchema = z.object({ id: z.string().uuid(), name: z.string(), created_by: z.string().uuid(), plan_key: z.string().nullable(), status: z.string().nullable(), period_end: timestamp.nullable(), provider: z.string().nullable() }).strict()`; export from `index.ts`.

`admin.ts`: `adminRows` maps to display strings (`plan_key ?? S.adminNoPlan`, `provider ?? "—"`, `period_end?.slice(0,10) ?? "—"`).

`Admin.tsx`: on mount `rpc("is_platform_admin")`; if false render `S.adminForbidden`. Otherwise a table of `admin_workspaces()` rows; each row has a `<select>` of plan keys (catalogue keys + `owner` + `pilot`), a months `<input type=number min=1 max=1200 defaultValue=1>`, a note input and a button `S.adminSetPlan` calling `set_workspace_plan`; a second form per row: kind select (`comment_analysis|topic_classification`), units, note, button `S.adminGrantPack` calling `grant_pack`. After each success `queryClient.invalidateQueries({queryKey:["admin"]})`. Strings: `adminTitle`, `adminForbidden`, `adminNoPlan`, `adminSetPlan`, `adminGrantPack`, `adminMonths`, `adminNote`, `adminDone`.

Route: `<Route path="/admin" element={<Admin />} />` inside `AppLayout`; the nav link renders only when a `useQuery(["is_admin"])` returns true.

- [ ] **Step 4: Run** — `npx vitest run apps/web/src/admin.test.ts && npm run typecheck && npm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/admin.ts apps/web/src/admin.test.ts apps/web/src/Admin.tsx apps/web/src/main.tsx packages/contracts/src/admin.ts packages/contracts/src/index.ts apps/web/src/strings/ar.ts apps/web/src/strings/en.ts
git commit -m "An admin page: every workspace, its plan, and the two hand levers — set plan, grant pack"
```

### Task B5: Part B verification and docs

- [ ] Run `npm run check` — all green.
- [ ] Deploy the preview (`npm run build && npm run deploy:preview`, credentials in `.env.local`), open `/pricing` and `/account` in the browser, screenshot both; record in `docs/verification.md` (dated) what was seen live and what remains fixture-only (checkout buttons throw `checkout_unavailable` until Part C).
- [ ] `docs/progress.md` entry for Part B. Commit: `"Pricing, plan panel and admin pages verified on the preview"`.

---

## Part C — Paddle Billing (sandbox first)

Paddle facts this part relies on (verify against https://developer.paddle.com before coding; the executor records any drift in `docs/decisions.md`):
- API base: `https://sandbox-api.paddle.com` / `https://api.paddle.com`, bearer `PADDLE_API_KEY`, header `Paddle-Version: 1`.
- Products: `POST /products {name, tax_category:"saas"}`; prices: `POST /prices {product_id, description, unit_price:{amount:"1200",currency_code:"USD"}, billing_cycle:{interval:"month",frequency:1}}` (omit `billing_cycle` for a one-time pack).
- Paddle.js: `<script src="https://cdn.paddle.com/paddle/v2/paddle.js">`, `Paddle.Environment.set("sandbox")`, `Paddle.Initialize({token})`, `Paddle.Checkout.open({items:[{priceId, quantity:1}], customData:{workspace_id}, customer:{email}, settings:{successUrl}})`.
- Webhook signature header `Paddle-Signature: ts=<unix>;h1=<hex>`; `h1 = HMAC-SHA256(secret, ts + ":" + rawBody)`. Reject if `|now - ts| > 5 min`.
- Events used: `transaction.completed` (packs, and first payment), `subscription.created`, `subscription.updated`, `subscription.activated`, `subscription.past_due`, `subscription.canceled`. Every event carries `event_id`, `event_type`, `occurred_at`, `data`. A subscription's `data.custom_data.workspace_id` is what we set at checkout; `data.items[0].price.id` names the plan; `data.current_billing_period.{starts_at,ends_at}`; `data.scheduled_change.action === "cancel"` means cancel at period end; `data.customer_id`.
- Customer portal: `POST /customers/{customer_id}/portal-sessions` → `data.urls.general.overview`.

### Task C1: Billing events in the database — idempotent application of what Paddle says

**Files:**
- Create: `supabase/migrations/20260917050000_billing_events.sql`
- Test: `supabase/tests/billing_events.test.ts`

**Interfaces:**
- Produces: `private.billing_events(event_id text primary key, event_type text, occurred_at timestamptz, workspace_id uuid, applied_at timestamptz default now(), payload jsonb)`.
- Produces: `private.apply_billing_event(event_id text, event_type text, occurred_at timestamptz, w uuid, plan text, interval text, period_start timestamptz, period_end timestamptz, status text, cancel_at_period_end boolean, provider_ref text, customer_ref text, payload jsonb) returns text` — returns `'applied'` or `'duplicate'`; writes `subscriptions` with `provider='paddle'` and an `audit_events` row `action='plan_paddle_'||event_type`.
- Produces: `private.apply_pack_event(event_id text, occurred_at timestamptz, w uuid, kind text, units int, provider_ref text, payload jsonb) returns text`.
- Produces: `private.billing_sweep()` — every `past_due` subscription whose `period_end + 7 days < now()` drops to `free` (`status='active'`, `provider=null`, period 100 years), audited `plan_dropped`; scheduled by pg_cron `'23 4 * * *'` under the same guard as `20260914100000`.
- Produces: `private.plan_key_for_price(price_id text) returns text` — looks up `plans.provider_prices` (`{"month":"pri_...","year":"pri_..."}`) and the pack row (`provider_prices.pack_10k`).

- [ ] **Step 1: Write the failing test**

```ts
// supabase/tests/billing_events.test.ts — bootstrap as plans_v2.test.ts; W owned by OWNER on free.
const apply = (id: string, status = "active", cancel = false) =>
  db.query<{ apply_billing_event: string }>(
    `select private.apply_billing_event($1,'subscription.activated',now(),$2,'creator','month',
       now(), now()+interval '30 days', $3, $4, 'sub_1', 'ctm_1', '{}'::jsonb)`, [id, W, status, cancel]);

it("an event applies once", async () => {
  expect((await apply("evt_1")).rows[0].apply_billing_event).toBe("applied");
  expect((await apply("evt_1")).rows[0].apply_billing_event).toBe("duplicate");
  const s = await db.query<{ plan_key: string; provider: string; provider_ref: string; billing_interval: string }>(
    "select plan_key,provider,provider_ref,billing_interval from subscriptions where workspace_id=$1", [W]);
  expect(s.rows[0]).toEqual({ plan_key: "creator", provider: "paddle", provider_ref: "sub_1", billing_interval: "month" });
});
it("an older event never overwrites a newer one", async () => {
  await db.query(`select private.apply_billing_event('evt_new','subscription.updated',now(),$1,'creator_plus','month',now(),now()+interval '30 days','active',false,'sub_1','ctm_1','{}')`, [W]);
  await db.query(`select private.apply_billing_event('evt_old','subscription.updated',now()-interval '1 hour',$1,'creator','month',now(),now()+interval '30 days','active',false,'sub_1','ctm_1','{}')`, [W]);
  expect((await db.query<{ plan_key: string }>("select plan_key from subscriptions where workspace_id=$1", [W])).rows[0].plan_key).toBe("creator_plus");
});
it("a pack event grants units once", async () => {
  await db.query(`select private.apply_pack_event('evt_p1',now(),$1,'comment_analysis',10000,'txn_9','{}')`, [W]);
  await db.query(`select private.apply_pack_event('evt_p1',now(),$1,'comment_analysis',10000,'txn_9','{}')`, [W]);
  expect((await db.query<{ n: number }>("select count(*)::int as n from usage_grants where workspace_id=$1", [W])).rows[0].n).toBe(1);
});
it("the sweep drops a subscription seven days past due to free", async () => {
  await db.query("update subscriptions set status='past_due', period_end=now()-interval '8 days' where workspace_id=$1", [W]);
  await db.query("select private.billing_sweep()");
  const s = await db.query<{ plan_key: string; status: string; provider: string | null }>("select plan_key,status,provider from subscriptions where workspace_id=$1", [W]);
  expect(s.rows[0]).toEqual({ plan_key: "free", status: "active", provider: null });
  const a = await db.query<{ action: string }>("select action from audit_events where workspace_id=$1 order by created_at desc limit 1", [W]);
  expect(a.rows[0].action).toBe("plan_dropped");
});
it("a price id resolves to its plan and interval", async () => {
  await db.query(`update plans set provider_prices='{"month":"pri_m","year":"pri_y"}' where key='creator'`);
  const r = await db.query<{ k: string }>("select private.plan_key_for_price('pri_y') as k");
  expect(r.rows[0].k).toBe("creator:year");
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run supabase/tests/billing_events.test.ts` → `relation "private.billing_events" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260917050000_billing_events.sql
-- Paddle is the seller of record; this database is the entitlement of record.
-- Every webhook lands here once, by event_id, and out-of-order delivery cannot
-- move a subscription backwards: an event older than the last applied one for
-- the workspace is recorded and ignored.
create table private.billing_events (
  event_id text primary key,
  event_type text not null,
  occurred_at timestamptz not null,
  workspace_id uuid references public.workspaces(id),
  applied_at timestamptz not null default now(),
  outcome text not null check (outcome in ('applied','duplicate','stale','unmapped')),
  payload jsonb not null
);
create index billing_events_workspace on private.billing_events(workspace_id, occurred_at desc);

create function private.plan_key_for_price(price_id text) returns text
language sql stable security definer set search_path='' as $$
  select p.key || ':' || kv.key
  from public.plans p, jsonb_each_text(p.provider_prices) kv
  where kv.value = price_id limit 1;
$$;
revoke all on function private.plan_key_for_price(text) from public, anon, authenticated;

create function private.apply_billing_event(
  event_id text, event_type text, occurred_at timestamptz, w uuid, plan text, interval text,
  period_start timestamptz, period_end timestamptz, status text, cancel_at_period_end boolean,
  provider_ref text, customer_ref text, payload jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare last_seen timestamptz; begin
  if exists (select 1 from private.billing_events e where e.event_id = apply_billing_event.event_id) then return 'duplicate'; end if;
  select max(e.occurred_at) into last_seen from private.billing_events e
   where e.workspace_id = w and e.outcome = 'applied' and e.event_type like 'subscription.%';
  if last_seen is not null and occurred_at < last_seen then
    insert into private.billing_events values (event_id, event_type, occurred_at, w, now(), 'stale', payload);
    return 'stale';
  end if;
  insert into public.subscriptions(workspace_id, plan_key, status, period_start, period_end, provider, provider_ref,
                                   provider_customer_ref, billing_interval, cancel_at_period_end)
  values (w, plan, status, period_start, period_end, 'paddle', provider_ref, customer_ref, interval, cancel_at_period_end)
  on conflict (workspace_id) do update set
    plan_key = excluded.plan_key, status = excluded.status,
    period_start = excluded.period_start, period_end = excluded.period_end,
    provider = 'paddle', provider_ref = excluded.provider_ref, provider_customer_ref = excluded.provider_customer_ref,
    billing_interval = excluded.billing_interval, cancel_at_period_end = excluded.cancel_at_period_end;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, null, 'plan_paddle_' || replace(event_type, 'subscription.', ''), 'plan', plan);
  insert into private.billing_events values (event_id, event_type, occurred_at, w, now(), 'applied', payload);
  return 'applied';
end $$;
revoke all on function private.apply_billing_event(text,text,timestamptz,uuid,text,text,timestamptz,timestamptz,text,boolean,text,text,jsonb) from public, anon, authenticated;

create function private.apply_pack_event(event_id text, occurred_at timestamptz, w uuid, kind text, units int, provider_ref text, payload jsonb) returns text
language plpgsql security definer set search_path='' as $$
begin
  if exists (select 1 from private.billing_events e where e.event_id = apply_pack_event.event_id) then return 'duplicate'; end if;
  perform private.grant_units(w, kind, units, 'paddle', provider_ref);
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, null, 'pack_paddle', 'usage_grant', kind || ':' || units);
  insert into private.billing_events values (event_id, 'transaction.completed', occurred_at, w, now(), 'applied', payload);
  return 'applied';
end $$;
revoke all on function private.apply_pack_event(text,timestamptz,uuid,text,int,text,jsonb) from public, anon, authenticated;

-- Seven days of grace, then free. Nothing is deleted: the rows stay, the
-- ceiling drops, and the account page said so for a week.
create function private.billing_sweep() returns int
language plpgsql security definer set search_path='' as $$
declare n int; begin
  with dropped as (
    update public.subscriptions s
       set plan_key = 'free', status = 'active', provider = null, provider_ref = null,
           billing_interval = null, cancel_at_period_end = false,
           period_start = now(), period_end = now() + interval '100 years'
     where s.status = 'past_due' and s.period_end + interval '7 days' < now()
     returning s.workspace_id)
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  select workspace_id, null, 'plan_dropped', 'plan', 'free' from dropped;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.billing_sweep() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable here; billing sweep is not scheduled'; return; end if;
  execute 'create extension if not exists pg_cron';
  perform cron.unschedule(jobid) from cron.job where jobname = 'billing-sweep';
  perform cron.schedule('billing-sweep', '23 4 * * *', $job$select private.billing_sweep()$job$);
end $$;
```

- [ ] **Step 4: Run** — `npx vitest run supabase/tests/billing_events.test.ts && npm run test:db` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260917050000_billing_events.sql supabase/tests/billing_events.test.ts
git commit -m "Paddle events apply once and never backwards; seven days past due drops to free, audited"
```

### Task C2: The webhook handler, pure

**Files:**
- Create: `supabase/functions/_shared/paddle.ts`
- Test: `supabase/tests/paddle_webhook.test.ts`

**Interfaces:**
- Produces: `verifyPaddleSignature(header: string|null, rawBody: string, secret: string, now: number): Promise<boolean>` (Web Crypto HMAC-SHA256; tolerance 300 s).
- Produces: `interface BillingDb { planForPrice(priceId: string): Promise<string|null>; applySubscription(args: {...}): Promise<string>; applyPack(args: {...}): Promise<string>; recordUnmapped(eventId: string, eventType: string, payload: unknown): Promise<void> }`.
- Produces: `handlePaddleEvent(event: PaddleEvent, db: BillingDb): Promise<{ status: number; body: {outcome: string} }>`.
  Mapping: `subscription.*` → `plan = planForPrice(items[0].price.id)` (`"creator:month"` → plan `creator`, interval `month`); `status` = `active` for `active|trialing`, `past_due` for `past_due`, `cancelled` for `canceled`, `paused` for `paused`; `cancel_at_period_end = scheduled_change?.action === "cancel"`; `period` from `current_billing_period` (fallback: `occurred_at` .. `+1 month|year`). `transaction.completed` with a pack price (`"pack_10k:pack"`) → `applyPack(kind "comment_analysis", 10000, provider_ref = transaction id)`; a `transaction.completed` for a subscription price is ignored (`{outcome:"ignored"}`, 200) — the subscription events carry the truth. Missing `custom_data.workspace_id` → `recordUnmapped`, 200 (Paddle must not retry forever).

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/tests/paddle_webhook.test.ts
import { describe, expect, it } from "vitest";
import { handlePaddleEvent, verifyPaddleSignature, type BillingDb } from "../functions/_shared/paddle.ts";

const W = "00000000-0000-4000-8000-000000000001";
const sub = (over: Record<string, unknown> = {}) => ({
  event_id: "evt_1", event_type: "subscription.activated", occurred_at: "2026-09-17T10:00:00Z",
  data: { id: "sub_1", status: "active", customer_id: "ctm_1", custom_data: { workspace_id: W },
    items: [{ price: { id: "pri_m" }, quantity: 1 }],
    current_billing_period: { starts_at: "2026-09-17T10:00:00Z", ends_at: "2026-10-17T10:00:00Z" },
    scheduled_change: null, ...over },
});
const fakeDb = () => {
  const calls: unknown[] = [];
  const db: BillingDb = {
    planForPrice: async (id) => (id === "pri_m" ? "creator:month" : id === "pri_pack" ? "pack_10k:pack" : null),
    applySubscription: async (a) => { calls.push(["sub", a]); return "applied"; },
    applyPack: async (a) => { calls.push(["pack", a]); return "applied"; },
    recordUnmapped: async (id, type) => { calls.push(["unmapped", id, type]); },
  };
  return { db, calls };
};

describe("paddle webhook", () => {
  it("verifies a signature and rejects a stale timestamp", async () => {
    const secret = "pdl_ntfset_test";
    const body = '{"a":1}';
    const ts = 1_700_000_000;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}:${body}`)))).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await verifyPaddleSignature(`ts=${ts};h1=${mac}`, body, secret, ts * 1000 + 1000)).toBe(true);
    expect(await verifyPaddleSignature(`ts=${ts};h1=${mac}`, body, secret, ts * 1000 + 600_000)).toBe(false);
    expect(await verifyPaddleSignature(`ts=${ts};h1=deadbeef`, body, secret, ts * 1000)).toBe(false);
    expect(await verifyPaddleSignature(null, body, secret, ts * 1000)).toBe(false);
  });
  it("an activated subscription becomes creator, monthly, active", async () => {
    const { db, calls } = fakeDb();
    const r = await handlePaddleEvent(sub(), db);
    expect(r).toEqual({ status: 200, body: { outcome: "applied" } });
    expect(calls[0]).toEqual(["sub", { eventId: "evt_1", eventType: "subscription.activated", occurredAt: "2026-09-17T10:00:00Z",
      workspaceId: W, plan: "creator", interval: "month", periodStart: "2026-09-17T10:00:00Z", periodEnd: "2026-10-17T10:00:00Z",
      status: "active", cancelAtPeriodEnd: false, providerRef: "sub_1", customerRef: "ctm_1", payload: sub().data }]);
  });
  it("a scheduled cancel is cancel_at_period_end; canceled is cancelled; past_due is past_due", async () => {
    const { db, calls } = fakeDb();
    await handlePaddleEvent(sub({ scheduled_change: { action: "cancel" } }), db);
    await handlePaddleEvent(sub({ status: "canceled" }), db);
    await handlePaddleEvent(sub({ status: "past_due" }), db);
    expect((calls[0] as any)[1].cancelAtPeriodEnd).toBe(true);
    expect((calls[1] as any)[1].status).toBe("cancelled");
    expect((calls[2] as any)[1].status).toBe("past_due");
  });
  it("a completed pack transaction grants units; a subscription transaction is ignored", async () => {
    const { db, calls } = fakeDb();
    const txn = (price: string) => ({ event_id: "evt_t", event_type: "transaction.completed", occurred_at: "2026-09-17T10:00:00Z",
      data: { id: "txn_1", custom_data: { workspace_id: W }, items: [{ price: { id: price }, quantity: 1 }] } });
    expect((await handlePaddleEvent(txn("pri_pack"), db)).body.outcome).toBe("applied");
    expect(calls[0]).toEqual(["pack", { eventId: "evt_t", occurredAt: "2026-09-17T10:00:00Z", workspaceId: W, kind: "comment_analysis", units: 10000, providerRef: "txn_1", payload: txn("pri_pack").data }]);
    expect((await handlePaddleEvent(txn("pri_m"), db)).body.outcome).toBe("ignored");
  });
  it("no workspace id is recorded as unmapped and answered 200", async () => {
    const { db, calls } = fakeDb();
    const r = await handlePaddleEvent(sub({ custom_data: {} }), db);
    expect(r.status).toBe(200);
    expect(calls[0]).toEqual(["unmapped", "evt_1", "subscription.activated"]);
  });
  it("an unknown price is unmapped, not applied", async () => {
    const { db, calls } = fakeDb();
    await handlePaddleEvent(sub({ items: [{ price: { id: "pri_zzz" }, quantity: 1 }] }), db);
    expect((calls[0] as any)[0]).toBe("unmapped");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run supabase/tests/paddle_webhook.test.ts` → module not found.

- [ ] **Step 3: Implement `_shared/paddle.ts`**

```ts
// supabase/functions/_shared/paddle.ts
/** Paddle's webhook, understood once and applied through injected RPCs. */
export interface BillingDb {
  planForPrice(priceId: string): Promise<string | null>;
  applySubscription(a: {
    eventId: string; eventType: string; occurredAt: string; workspaceId: string; plan: string;
    interval: "month" | "year"; periodStart: string; periodEnd: string;
    status: "active" | "past_due" | "paused" | "cancelled"; cancelAtPeriodEnd: boolean;
    providerRef: string; customerRef: string | null; payload: unknown;
  }): Promise<string>;
  applyPack(a: { eventId: string; occurredAt: string; workspaceId: string; kind: string; units: number; providerRef: string; payload: unknown }): Promise<string>;
  recordUnmapped(eventId: string, eventType: string, payload: unknown): Promise<void>;
}
export type PaddleEvent = { event_id: string; event_type: string; occurred_at: string; data: Record<string, unknown> };

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
export async function verifyPaddleSignature(header: string | null, rawBody: string, secret: string, now = Date.now()): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(";").map((kv) => kv.split("=") as [string, string]));
  const ts = Number(parts.ts); const h1 = parts.h1;
  if (!Number.isFinite(ts) || !h1) return false;
  if (Math.abs(now - ts * 1000) > 300_000) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}:${rawBody}`)));
  if (mac.length !== h1.length) return false;
  let diff = 0; for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ h1.charCodeAt(i);
  return diff === 0;
}

const STATUS: Record<string, "active" | "past_due" | "paused" | "cancelled"> = {
  active: "active", trialing: "active", past_due: "past_due", paused: "paused", canceled: "cancelled",
};
const PACKS: Record<string, { kind: string; units: number }> = { pack_10k: { kind: "comment_analysis", units: 10000 } };

export async function handlePaddleEvent(event: PaddleEvent, db: BillingDb): Promise<{ status: number; body: { outcome: string } }> {
  const d = event.data as { id: string; status?: string; customer_id?: string; custom_data?: { workspace_id?: string };
    items?: { price: { id: string } }[]; current_billing_period?: { starts_at: string; ends_at: string } | null;
    scheduled_change?: { action: string } | null };
  const workspaceId = d.custom_data?.workspace_id;
  const priceId = d.items?.[0]?.price.id;
  const unmapped = async () => { await db.recordUnmapped(event.event_id, event.event_type, d); return { status: 200, body: { outcome: "unmapped" } }; };
  if (!workspaceId || !priceId) return unmapped();
  const mapped = await db.planForPrice(priceId);
  if (!mapped) return unmapped();
  const [plan, interval] = mapped.split(":") as [string, "month" | "year" | "pack"];

  if (event.event_type === "transaction.completed") {
    const pack = PACKS[plan];
    if (interval !== "pack" || !pack) return { status: 200, body: { outcome: "ignored" } };
    const outcome = await db.applyPack({ eventId: event.event_id, occurredAt: event.occurred_at, workspaceId, kind: pack.kind, units: pack.units, providerRef: d.id, payload: d });
    return { status: 200, body: { outcome } };
  }
  if (!event.event_type.startsWith("subscription.")) return { status: 200, body: { outcome: "ignored" } };
  if (interval === "pack") return unmapped();
  const status = STATUS[d.status ?? ""] ?? "active";
  const periodStart = d.current_billing_period?.starts_at ?? event.occurred_at;
  const periodEnd = d.current_billing_period?.ends_at ?? addInterval(event.occurred_at, interval);
  const outcome = await db.applySubscription({
    eventId: event.event_id, eventType: event.event_type, occurredAt: event.occurred_at, workspaceId, plan, interval,
    periodStart, periodEnd, status, cancelAtPeriodEnd: d.scheduled_change?.action === "cancel",
    providerRef: d.id, customerRef: d.customer_id ?? null, payload: d,
  });
  return { status: 200, body: { outcome } };
}
function addInterval(iso: string, interval: "month" | "year") {
  const t = new Date(iso); if (interval === "month") t.setUTCMonth(t.getUTCMonth() + 1); else t.setUTCFullYear(t.getUTCFullYear() + 1);
  return t.toISOString();
}
```

- [ ] **Step 4: Run** — `npx vitest run supabase/tests/paddle_webhook.test.ts && npm run check:functions` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/paddle.ts supabase/tests/paddle_webhook.test.ts
git commit -m "Paddle's webhook is understood in one pure handler: signature, status map, packs, unmapped events"
```

### Task C3: The `paddle-webhook` edge function (service role)

**Files:**
- Create: `supabase/functions/paddle-webhook/index.ts`
- Modify: `supabase/functions/README.md` (secrets: `PADDLE_WEBHOOK_SECRET`), `supabase/config.toml` (`[functions.paddle-webhook] verify_jwt = false` — Paddle carries no Supabase JWT; the signature is the auth)

- [ ] **Step 1: Write the entry**

```ts
// supabase/functions/paddle-webhook/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { handlePaddleEvent, verifyPaddleSignature, type BillingDb } from "../_shared/paddle.ts";
const env = (n: string) => Deno.env.get(n) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await db.schema("private").rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
};
const billing: BillingDb = {
  planForPrice: (price_id) => rpc<string | null>("plan_key_for_price", { price_id }),
  applySubscription: (a) => rpc<string>("apply_billing_event", {
    event_id: a.eventId, event_type: a.eventType, occurred_at: a.occurredAt, w: a.workspaceId, plan: a.plan, interval: a.interval,
    period_start: a.periodStart, period_end: a.periodEnd, status: a.status, cancel_at_period_end: a.cancelAtPeriodEnd,
    provider_ref: a.providerRef, customer_ref: a.customerRef, payload: a.payload }),
  applyPack: (a) => rpc<string>("apply_pack_event", { event_id: a.eventId, occurred_at: a.occurredAt, w: a.workspaceId, kind: a.kind, units: a.units, provider_ref: a.providerRef, payload: a.payload }),
  recordUnmapped: async (event_id, event_type, payload) => {
    await db.schema("private").from("billing_events").upsert({ event_id, event_type, occurred_at: new Date().toISOString(), outcome: "unmapped", payload }, { onConflict: "event_id", ignoreDuplicates: true });
  },
};
Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const raw = await request.text();
  if (!(await verifyPaddleSignature(request.headers.get("paddle-signature"), raw, env("PADDLE_WEBHOOK_SECRET"))))
    return new Response(JSON.stringify({ code: "bad_signature" }), { status: 401 });
  const event = JSON.parse(raw);
  const { status, body } = await handlePaddleEvent(event, billing);
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
});
```

The `private` schema must be exposed to PostgREST for `db.schema("private")` to work — it is not today. Instead of exposing it, add a migration `20260917051000_billing_rpc_surface.sql` that creates thin `public.billing_*` wrappers **executable by `service_role` only**: `public.billing_plan_for_price(price_id)`, `public.billing_apply_subscription(...)`, `public.billing_apply_pack(...)`, `public.billing_record_unmapped(event_id, event_type, payload)`, each `security definer` calling its `private.*` twin with `revoke all ... from public, anon, authenticated;` (service_role bypasses). Then the entry uses `db.rpc("billing_apply_subscription", ...)` without `.schema()`. Add a PGlite test `supabase/tests/billing_surface.test.ts` asserting `authenticated` gets `permission denied` on each and `service_role` succeeds.

- [ ] **Step 2: Deploy to the sandbox and prove it** — `supabase functions deploy paddle-webhook --no-verify-jwt`, set `PADDLE_WEBHOOK_SECRET` from the Paddle sandbox notification destination pointing at the function URL, send Paddle's "simulate" `subscription.activated` with `custom_data.workspace_id` set to a test workspace; verify a row in `private.billing_events` and the subscription changed. Record the exact request id and rows in `docs/verification.md`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/paddle-webhook/index.ts supabase/migrations/20260917051000_billing_rpc_surface.sql supabase/tests/billing_surface.test.ts supabase/functions/README.md supabase/config.toml docs/verification.md
git commit -m "The paddle-webhook function: signature-authenticated, service role, applied through a service-only RPC surface"
```

### Task C4: Prices in Paddle, from the table — and checkout in the browser

**Files:**
- Create: `scripts/paddle-sync-prices.mjs`, `apps/web/src/paddle.ts`, `apps/web/src/paddle.test.ts`
- Modify: `apps/web/.env.example` (`VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_ENV=sandbox`), `apps/web/index.html` (Paddle.js script tag), `scripts/check-secrets.mjs` (allow `VITE_PADDLE_CLIENT_TOKEN` matching `^(test|live)_[A-Za-z0-9]+$` as public), `packages/contracts/src/fixture.ts`

**Interfaces:**
- `paddle-sync-prices.mjs`: reads `PADDLE_API_KEY`, `PADDLE_ENV`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; for each `plans` row with `self_serve` and price > 0 creates (or finds by `custom_data.plan_key`) one product and two prices (month/year); one product+price for `pack_10k` (`$5`, one-time); writes `plans.provider_prices = {"month":..,"year":..}` and, for the pack, a `plans` row? **No** — the pack is not a plan. Store it in a new table `public.addon_prices(key text primary key, units int, kind text, price_cents int, provider_prices jsonb)` created in `20260917051000` (fold into that migration) with the row `('pack_10k',10000,'comment_analysis',500,'{}')`, and make `private.plan_key_for_price` also search it (returning `'pack_10k:pack'`). Idempotent: re-running updates ids, never duplicates products (list products, match `custom_data.plan_key`).
- `apps/web/src/paddle.ts`: `initPaddle(): Promise<void>` (reads `window.Paddle`, sets env, `Initialize({ token })`, once); `openCheckout({ planKey, interval, session, workspaceId })`: fetches the catalogue (or `addon_prices` via a new `public.addon_catalogue()` — add to `20260917051000`, anon-readable), picks `provider_prices[interval]` (or `.pack`), calls `Paddle.Checkout.open({ items:[{priceId, quantity:1}], customData:{ workspace_id }, customer:{ email: session.user.email }, settings:{ successUrl: `${origin}/account?checkout=done` } })`. Throws `checkout_unavailable` when the token or price id is missing — the button shows `S.checkoutUnavailable`.
- `paddle.test.ts` tests `priceIdFor(plan, interval)` and the `checkout_unavailable` cases with a fake `window.Paddle`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/paddle.test.ts
import { describe, expect, it, vi } from "vitest";
import { checkoutItems, priceIdFor } from "./paddle";
describe("paddle checkout", () => {
  const plan = { key: "creator", provider_prices: { month: "pri_m", year: "pri_y" } };
  it("picks the price for the interval", () => {
    expect(priceIdFor(plan, "month")).toBe("pri_m");
    expect(priceIdFor(plan, "year")).toBe("pri_y");
    expect(priceIdFor({ key: "media", provider_prices: {} }, "month")).toBeNull();
  });
  it("builds the checkout call with the workspace in custom data", () => {
    expect(checkoutItems("pri_m", "w1", "a@b.c", "https://app.test")).toEqual({
      items: [{ priceId: "pri_m", quantity: 1 }], customData: { workspace_id: "w1" }, customer: { email: "a@b.c" },
      settings: { successUrl: "https://app.test/account?checkout=done" },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run apps/web/src/paddle.test.ts`.

- [ ] **Step 3: Implement** `paddle.ts` (pure `priceIdFor`, `checkoutItems`; side-effecting `initPaddle`, `openCheckout`) and the sync script (Node 22, `fetch`, no new dependency; Supabase writes through the REST endpoint with the service-role key, `PATCH /rest/v1/plans?key=eq.<key>`).

- [ ] **Step 4: Run the script against the sandbox** — `PADDLE_ENV=sandbox PADDLE_API_KEY=... node scripts/paddle-sync-prices.mjs` twice; the second run reports `0 created, 9 updated`. Then on the preview with `VITE_PADDLE_CLIENT_TOKEN=test_...`, click "ابدأ" on `creator`, pay with Paddle's sandbox test card (`4242 4242 4242 4242`), and watch the account page turn to `creator` after the webhook. Screenshot; record in `docs/verification.md`.

- [ ] **Step 5: Commit**

```bash
git add scripts/paddle-sync-prices.mjs apps/web/src/paddle.ts apps/web/src/paddle.test.ts apps/web/.env.example apps/web/index.html scripts/check-secrets.mjs supabase/migrations/20260917051000_billing_rpc_surface.sql docs/verification.md
git commit -m "Prices live in Paddle but are written from the plans table; checkout opens Paddle's overlay with the workspace id"
```

### Task C5: The customer portal — manage, cancel, change card

**Files:**
- Create: `supabase/functions/billing-portal/index.ts`, `supabase/functions/_shared/billing-portal.ts`
- Test: `supabase/tests/billing_portal.test.ts`
- Modify: `apps/web/src/paddle.ts` (`openPortal(session, workspaceId)` → POST to the function with the user's JWT, then `window.location.assign(url)`)

**Interfaces:**
- `_shared/billing-portal.ts`: `portalUrlFor(workspaceId, db: { customerRefFor(w): Promise<string|null> }, paddle: { createPortalSession(customerId): Promise<string> }): Promise<{status:number; body:{url?:string; code?:string}}>` — `404 no_paddle_customer` when the workspace has no `provider_customer_ref`.
- `billing-portal/index.ts`: runs as the caller (anon key + their `authorization` header, as `oauth-start` does) so RLS decides whether they may read the subscription; reads `subscriptions.provider_customer_ref` via a new tenant-readable RPC `public.billing_customer_ref(w)` (owner role only; add to `20260917051000`); calls Paddle `POST /customers/{id}/portal-sessions` with `PADDLE_API_KEY`; returns `data.urls.general.overview`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/tests/billing_portal.test.ts
import { describe, expect, it } from "vitest";
import { portalUrlFor } from "../functions/_shared/billing-portal.ts";
describe("billing portal", () => {
  it("returns the portal url for a paddle customer", async () => {
    const r = await portalUrlFor("w1", { customerRefFor: async () => "ctm_1" }, { createPortalSession: async (c) => `https://portal/${c}` });
    expect(r).toEqual({ status: 200, body: { url: "https://portal/ctm_1" } });
  });
  it("a workspace without a paddle customer is told so", async () => {
    const r = await portalUrlFor("w1", { customerRefFor: async () => null }, { createPortalSession: async () => "x" });
    expect(r).toEqual({ status: 404, body: { code: "no_paddle_customer" } });
  });
});
```

- [ ] **Step 2–4:** fail → implement (the pure function is six lines; the entry mirrors `oauth-start/index.ts` for CORS and auth) → `npx vitest run supabase/tests/billing_portal.test.ts && npm run check:functions` → PASS. Deploy, click "إدارة الاشتراك" on the preview for the sandbox subscriber, land on Paddle's portal; record.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/billing-portal supabase/functions/_shared/billing-portal.ts supabase/tests/billing_portal.test.ts apps/web/src/paddle.ts
git commit -m "Manage the subscription in Paddle's portal, reached as the signed-in owner"
```

### Task C6: Part C verification, docs, and the sandbox → live gate

- [ ] `npm run check` green.
- [ ] End-to-end on the sandbox, recorded in `docs/verification.md` with ids: sign up → free → `/pricing` → creator monthly checkout → webhook `subscription.activated` → account shows creator → buy `pack_10k` → `usage_grants` row → portal → cancel → `subscription.updated` with `scheduled_change` → account shows `S.planEndsOn` → simulate `subscription.past_due` → `billing_sweep()` after 7 days (set `period_end` back by hand on the sandbox row, run the function) → free.
- [ ] `docs/decisions.md`: Paddle as merchant of record (individual account, Türkiye residency, UK Stripe kept for later B2B); why `past_due` grace is 7 days; why packs are `usage_grants` not a plan.
- [ ] `docs/progress.md`: Part C entry, and the explicit line: **live Paddle keys are not set; switching `PADDLE_ENV=live` and the live client token is a separate approval.**
- [ ] `docs/pricing.md` gets a "How billing works" section (webhook truth, 7-day grace, pack validity).
- [ ] Commit: `"Sandbox billing walked end to end and recorded; live keys wait for a separate yes"`.

---

## Out of scope for this plan (each gets its own plan)

1. **Change detection in the live check** (`videos.list(part=statistics).commentCount` before `commentThreads`) — a worker/RPC change; it is what makes `agency`/`media` live intervals affordable in YouTube quota (`pricing-consultation` §5.1). Should land **before** `media` is set `self_serve = true`.
2. **YouTube quota extension application** — a document and a Google form, not code; needs the privacy policy and terms pages.
3. **The free funnel** («جرّب على أي فيديو عام») — public API-key collection path in the UI.
4. **Generated insight reports** (`insight_reports` is metered nowhere yet) — the column exists so the ladder is complete; the `generated_insight` event type arrives with the feature.
5. **Annual-offer nudge on day 14–21** — needs an "first successful report" event; UI only.

## Self-review

- Spec coverage: ladder rows (A1) ✓; owner plan (A1, A3) ✓; workspace limit (A1) ✓; add-on packs (A2, C2, C4) ✓; `media` not self-serve (A1 `self_serve=false`, B1 contact CTA) ✓; platform_admin (A3, B4) ✓; catalogue-driven pricing page (A4, B2) ✓; account plan panel (B3) ✓; Paddle webhook truth, idempotent, never backwards (C1, C2, C3) ✓; 7-day past_due → free (C1) ✓; no secrets in VITE (C4 check-secrets rule) ✓; prices created from `plans` by script (C4) ✓; portal (C5) ✓; USD only ✓; sandbox gate (C6) ✓. Gap: `insight_reports` metering — deliberately out of scope, listed.
- Placeholders: none of "TBD/TODO/handle edge cases"; C5 steps 2–4 are compressed but name the file to mirror and the exact commands.
- Type consistency: `apply_billing_event` parameter order in C1 SQL = C3 rpc args = `BillingDb.applySubscription` fields (C2) ✓; `plan_key_for_price` returns `"<key>:<interval>"` in C1 and is split the same way in C2 ✓; `usage_grants` columns in A2 = `apply_pack_event` in C1 ✓; `Budget.granted`/`-1` in A2 = `planPanel` in B3 ✓; `PlanSchema.limits` names in A4 = `pricingRows` in B1 ✓.
