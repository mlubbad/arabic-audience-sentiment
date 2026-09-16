-- Paddle is the seller of record; this database is the entitlement of record.
-- Every webhook lands here once, by event_id, and out-of-order delivery cannot
-- move a subscription backwards: an event older than the last applied one for
-- the billing root is recorded and ignored.
--
-- The row a webhook writes is the ROOT's (private.billing_root, 20260917010000):
-- a client workspace has no allowance of its own, so the event named on it
-- lands on the workspace that pays, and the client rows that copied the root
-- at creation are moved with it — the same propagation set_workspace_plan does
-- (20260917030000). workspace_id below is therefore always the root.
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

-- A pack is a price too. The webhook maps a Paddle price id back to what was
-- bought, and a pack row lives beside the plans so one lookup answers both.
-- Prices are public: the pricing page reads this signed out, like plan_catalogue.
create table public.addon_prices (
  key text primary key,
  kind text not null check (kind in ('comment_analysis','historical_backfill','topic_classification')),
  units int not null check (units > 0),
  price_cents int not null check (price_cents >= 0),
  provider_prices jsonb not null default '{}'::jsonb
);
insert into public.addon_prices (key, kind, units, price_cents, provider_prices)
values ('pack_10k', 'comment_analysis', 10000, 500, '{}'::jsonb);
alter table public.addon_prices enable row level security;
create policy addon_prices_read on public.addon_prices for select to anon, authenticated using (true);
grant select on public.addon_prices to anon, authenticated;

-- 'creator:year' for a plan price, 'pack_10k:pack' for a pack price, null for
-- a price this database has never been told about. provider_prices on a plan
-- is {"month":"pri_...","year":"pri_..."}; on a pack it is {"pack":"pri_..."}.
create function private.plan_key_for_price(price_id text) returns text
language sql stable security definer set search_path='' as $$
  select k from (
    select p.key || ':' || kv.key as k
    from public.plans p, jsonb_each_text(p.provider_prices) kv
    where kv.value = price_id
    union all
    select a.key || ':pack'
    from public.addon_prices a, jsonb_each_text(a.provider_prices) kv
    where kv.value = price_id
  ) found limit 1;
$$;
revoke all on function private.plan_key_for_price(text) from public, anon, authenticated;

-- Returns 'applied', 'duplicate' (this event_id was seen before, whatever its
-- outcome) or 'stale' (an applied subscription event for this root is newer).
-- The stale event is still recorded so its replay is a duplicate, not a second
-- verdict. Audited against w, the workspace named in the event, like
-- set_workspace_plan; the event row carries the root.
create function private.apply_billing_event(
  event_id text, event_type text, occurred_at timestamptz, w uuid, plan text, billing_interval text,
  period_start timestamptz, period_end timestamptz, status text, cancel_at_period_end boolean,
  provider_ref text, customer_ref text, payload jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare root uuid; last_seen timestamptz; begin
  if exists (select 1 from private.billing_events e where e.event_id = apply_billing_event.event_id) then
    return 'duplicate'; end if;
  root := coalesce(private.billing_root(w), w);
  select max(e.occurred_at) into last_seen from private.billing_events e
   where e.workspace_id = root and e.outcome = 'applied' and e.event_type like 'subscription.%';
  if last_seen is not null and occurred_at < last_seen then
    insert into private.billing_events(event_id, event_type, occurred_at, workspace_id, applied_at, outcome, payload)
    values (event_id, event_type, occurred_at, root, now(), 'stale', payload);
    return 'stale';
  end if;
  insert into public.subscriptions(workspace_id, plan_key, status, period_start, period_end, provider, provider_ref,
                                   provider_customer_ref, billing_interval, cancel_at_period_end)
  values (root, plan, status, period_start, period_end, 'paddle', provider_ref, customer_ref, billing_interval, cancel_at_period_end)
  on conflict (workspace_id) do update set
    plan_key = excluded.plan_key, status = excluded.status,
    period_start = excluded.period_start, period_end = excluded.period_end,
    provider = 'paddle', provider_ref = excluded.provider_ref, provider_customer_ref = excluded.provider_customer_ref,
    billing_interval = excluded.billing_interval, cancel_at_period_end = excluded.cancel_at_period_end;
  -- Every client workspace billing through root copied its row from the root
  -- at creation (private.create_workspace_impl); keep the copies in step.
  update public.subscriptions s
     set plan_key = apply_billing_event.plan, status = apply_billing_event.status,
         period_start = apply_billing_event.period_start, period_end = apply_billing_event.period_end,
         provider = 'paddle', provider_ref = apply_billing_event.provider_ref,
         provider_customer_ref = apply_billing_event.customer_ref,
         billing_interval = apply_billing_event.billing_interval,
         cancel_at_period_end = apply_billing_event.cancel_at_period_end
   where s.billing_workspace_id = root;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, null, 'plan_paddle_' || replace(event_type, 'subscription.', ''), 'plan', plan);
  insert into private.billing_events(event_id, event_type, occurred_at, workspace_id, applied_at, outcome, payload)
  values (event_id, event_type, occurred_at, root, now(), 'applied', payload);
  return 'applied';
end $$;
revoke all on function private.apply_billing_event(text,text,timestamptz,uuid,text,text,timestamptz,timestamptz,text,boolean,text,text,jsonb) from public, anon, authenticated;

-- A completed pack transaction. grant_units (20260917020000) is itself
-- idempotent on (source, provider_ref), so a replay under a new event_id
-- still grants once; the event_id check keeps the audit row single too.
create function private.apply_pack_event(event_id text, occurred_at timestamptz, w uuid, kind text, units int, provider_ref text, payload jsonb) returns text
language plpgsql security definer set search_path='' as $$
begin
  if exists (select 1 from private.billing_events e where e.event_id = apply_pack_event.event_id) then
    return 'duplicate'; end if;
  perform private.grant_units(w, kind, units, 'paddle', provider_ref);
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, null, 'pack_paddle', 'usage_grant', kind || ':' || units);
  insert into private.billing_events(event_id, event_type, occurred_at, workspace_id, applied_at, outcome, payload)
  values (event_id, 'transaction.completed', occurred_at, coalesce(private.billing_root(w), w), now(), 'applied', payload);
  return 'applied';
end $$;
revoke all on function private.apply_pack_event(text,timestamptz,uuid,text,int,text,jsonb) from public, anon, authenticated;

-- Seven days of grace, then free. Nothing is deleted: the rows stay, the
-- ceiling drops, and the account page said so for a week. A root past due
-- takes its client rows down with it, and is audited once, on the root.
-- Returns the number of roots dropped.
create function private.billing_sweep() returns int
language plpgsql security definer set search_path='' as $$
declare n int; begin
  with roots as (
    select s.workspace_id from public.subscriptions s
     where s.billing_workspace_id is null
       and s.status = 'past_due' and s.period_end + interval '7 days' < now()),
  dropped as (
    update public.subscriptions s
       set plan_key = 'free', status = 'active', provider = null, provider_ref = null,
           provider_customer_ref = null, billing_interval = null, cancel_at_period_end = false,
           period_start = now(), period_end = now() + interval '100 years'
     where s.workspace_id in (select workspace_id from roots)
        or s.billing_workspace_id in (select workspace_id from roots)
     returning s.workspace_id),
  audited as (
    insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
    select r.workspace_id, null, 'plan_dropped', 'plan', 'free' from roots r
    where exists (select 1 from dropped d where d.workspace_id = r.workspace_id)
    returning workspace_id)
  select count(*) into n from audited;
  return n;
end $$;
revoke all on function private.billing_sweep() from public, anon, authenticated;

-- Scheduled where the retention jobs are (20260914100000), under the same
-- guard: PGlite has no pg_cron, and the test suite proves what the sweep does
-- and not that anything calls it. Off the hour, apart from the other two.
do $$ begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable here; billing sweep is not scheduled';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  perform cron.unschedule(jobid) from cron.job where jobname = 'billing-sweep';
  perform cron.schedule('billing-sweep', '23 4 * * *', $job$select private.billing_sweep()$job$);
end $$;
