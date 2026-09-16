-- The final whole-branch review of plans v2 / Paddle billing, eight findings
-- in one file. Every function below is rebuilt from its latest definition
-- (named beside it); the applied migrations stay as they are.
--
--  1. A cancelled or paused subscription is free, not a dead end below free.
--  2. plan_limit refuses when there is no live subscription instead of
--     answering null, which now means "no ceiling".
--  3. One rule for "this subscription is open", shared by every gate: the
--     seven-day past-due grace lives in code, not in Paddle's period.
--  4. A second Paddle subscription arriving for a root already on another
--     is a 'conflict': recorded, nothing moved.
--  7. set_workspace_plan refuses to erase a live Paddle link unless told to,
--     and even then keeps the link.
--  8. The workspace limit counts client workspaces; the home is not a client.

-- ---------------------------------------------------------------------------
-- 3. subscription_open: the one answer to "may this subscription spend".
-- An active subscription is open inside its period; a past-due one for seven
-- days past the period's end — the grace docs/pricing.md promised and
-- billing_sweep (20260917050000) enforces from the other side, so a
-- subscription the sweep has not reached yet is refused at the same moment
-- it would have been dropped. Paused and cancelled are never open, and after
-- this file neither state persists on a row: a webhook saying either writes
-- the free plan instead (apply_billing_event below).
create function private.subscription_open(s public.subscriptions) returns boolean
language sql stable set search_path='' as $$
  select (s.status = 'active'   and now() >= s.period_start and now() < s.period_end)
      or (s.status = 'past_due' and now() < s.period_end + interval '7 days')
$$;
revoke all on function private.subscription_open(public.subscriptions) from public, anon, authenticated;
-- reserve_usage and topic_units_remaining are security invoker and run as
-- the worker's role, which holds execute on a named list (20260914050000).
grant execute on function private.subscription_open(public.subscriptions) to service_role;

-- ---------------------------------------------------------------------------
-- 2. plan_limit, rebuilt from 20260917010000. A plan's own null limit (owner)
-- still means no ceiling; a root with no active or past-due subscription is
-- refused, where the sql form answered null for both and a cancelled root
-- read as unlimited. Same signature; service_role keeps the execute it was
-- granted in 20260915150000.
create or replace function private.plan_limit(w uuid, which text) returns integer
language plpgsql stable security definer set search_path='' as $$
declare p public.plans; begin
  select pl.* into p
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = private.billing_root(w) and s.status in ('active','past_due');
  if not found then raise exception 'no_active_plan' using errcode='42501'; end if;
  return case which
           when 'channels' then p.channels_limit
           when 'members' then p.members_limit
           when 'workspaces' then p.workspaces_limit
           when 'sync_interval' then p.min_sync_interval_minutes
           when 'live_interval' then p.live_interval_minutes
           when 'catalogue_interval' then p.catalogue_interval_minutes
         end;
end $$;

-- ---------------------------------------------------------------------------
-- 8. The workspace limit counts client workspaces. The pricing card says
-- "workspaces (clients): 5" and the individual ladder says one workspace, so
-- the column is the number of clients a subscriber may open beside the home:
-- 0 for the individual plans, 5/15/50 for the business ones. The check that
-- forbade zero goes with it (the yearly correction in 20260917052000 did the
-- same kind of data fix as its own file).
alter table public.plans drop constraint plans_workspaces_limit_check;
alter table public.plans add constraint plans_workspaces_limit_check
  check (workspaces_limit is null or workspaces_limit >= 0);
update public.plans set workspaces_limit = 0 where key in ('free','creator','creator_plus');

-- create_workspace_impl, rebuilt from 20260917010000 with one change: the
-- home is not a client, so the count compared against the limit leaves it out.
create or replace function private.create_workspace_impl(workspace_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare w uuid; home uuid; allowed int; owned int; begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  home := private.owner_plan_workspace(auth.uid());
  if home is not null then
    allowed := private.plan_limit(home,'workspaces');
    select count(*) into owned from public.workspaces where created_by = auth.uid();
    if allowed is not null and owned - 1 >= allowed then
      raise exception 'workspace_limit_reached' using errcode='53400'; end if;
  end if;
  insert into public.workspaces(name,created_by) values(workspace_name,auth.uid()) returning id into w;
  insert into public.memberships values(w,auth.uid(),'workspace_owner');
  insert into public.clients(workspace_id,name) values(w,workspace_name);
  if home is not null then
    insert into public.subscriptions(workspace_id, plan_key, status, period_start, period_end, provider, provider_ref, billing_workspace_id)
    select w, s.plan_key, s.status, s.period_start, s.period_end, s.provider, s.provider_ref, home
    from public.subscriptions s where s.workspace_id = home
    on conflict (workspace_id) do nothing;
  end if;
  perform private.grant_default_plan(w);
  return w;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The meter and the two gates, rebuilt from 20260917020000, each asking
-- subscription_open instead of carrying its own period arithmetic: the meter
-- had refused at period_end while analysis_remaining never looked at the
-- period, so a past-due tenant passed video selection and met plan_inactive
-- in the worker. Everything else — root lookup, packs added, spend summed
-- across the root, the largest int for no ceiling — is unchanged.
create or replace function private.reserve_usage(w uuid,kind text,keys text[]) returns text[]
language plpgsql security invoker set search_path='' as $$
declare sub record; allowance int; used int; covered text[]; fresh text[]; begin
 if kind not in ('comment_analysis','historical_backfill','topic_classification') then
   raise exception 'invalid_event_type' using errcode='22023'; end if;
 if coalesce(array_length(keys,1),0) > 500 then raise exception 'batch_too_large' using errcode='22023'; end if;
 select private.subscription_open(s) as open,s.period_start,pl.analysis_units,pl.backfill_units,pl.topic_units into sub
 from public.subscriptions s join public.plans pl on pl.key=s.plan_key
 where s.workspace_id=private.billing_root(w) for update of s;
 if not found then raise exception 'no_active_plan' using errcode='42501'; end if;
 if not sub.open then raise exception 'plan_inactive' using errcode='42501'; end if;
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

create or replace function private.analysis_remaining(w uuid) returns integer
language plpgsql stable security definer set search_path='' as $$
declare sub record; begin
  select s.period_start, pl.analysis_units into sub
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = private.billing_root(w) and private.subscription_open(s);
  if not found then raise exception 'no_active_plan' using errcode='53400'; end if;
  if sub.analysis_units is null then return 2147483647; end if;
  return greatest(0, sub.analysis_units + private.granted_units(w, 'comment_analysis')
                     - private.used_units(w, 'comment_analysis', sub.period_start));
end $$;

create or replace function private.topic_units_remaining(w uuid) returns int
language plpgsql stable security invoker set search_path='' as $$
declare sub record; begin
  select s.period_start, pl.topic_units into sub
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = private.billing_root(w) and private.subscription_open(s);
  if not found then return null; end if;
  if sub.topic_units is null then return 2147483647; end if;
  return greatest(0, sub.topic_units + private.granted_units(w, 'topic_classification')
                     - private.used_units(w, 'topic_classification', sub.period_start));
end $$;

-- ---------------------------------------------------------------------------
-- 4. A fifth outcome. 'conflict': the event names a Paddle subscription other
-- than the one the root is live on. The workspace in a webhook is Paddle's
-- custom_data, which the browser minted at checkout, so until the checkout
-- is minted on the server (docs/decisions.md, pre-live) a second
-- subscription bought against a root that already pays must not replace it.
alter table private.billing_events drop constraint billing_events_outcome_check;
alter table private.billing_events add constraint billing_events_outcome_check
  check (outcome in ('applied','duplicate','stale','unmapped','conflict'));

-- 1 and 4. apply_billing_event, rebuilt from 20260917050000 with two changes.
-- A status of cancelled or paused writes the sweep's free shape to the root
-- and every client row — plan free, active, no provider, an open-ended
-- period — instead of storing the word: a row that says cancelled cannot
-- spend even the free hundred, and the spec is "down to free, nothing
-- deleted". The event is still applied and audited (plan_paddle_canceled or
-- plan_paddle_paused, target free); a later activated re-applies the plan.
-- And a subscription event whose provider_ref is not the one the root is
-- live on is 'conflict', recorded like a stale event and moving nothing.
create or replace function private.apply_billing_event(
  event_id text, event_type text, occurred_at timestamptz, w uuid, plan text, billing_interval text,
  period_start timestamptz, period_end timestamptz, status text, cancel_at_period_end boolean,
  provider_ref text, customer_ref text, payload jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare root uuid; last_seen timestamptz; live record; begin
  root := coalesce(private.billing_root(w), w);
  -- One root's events serialise on this lock for the rest of the transaction
  -- (see 20260917050000 for why): a duplicate beside its original waits and
  -- reads 'duplicate', an older event waits and reads 'stale'.
  perform pg_advisory_xact_lock(hashtextextended(root::text, 0));
  if exists (select 1 from private.billing_events e where e.event_id = apply_billing_event.event_id) then
    return 'duplicate'; end if;
  select max(e.occurred_at) into last_seen from private.billing_events e
   where e.workspace_id = root and e.outcome = 'applied' and e.event_type like 'subscription.%';
  if last_seen is not null and occurred_at < last_seen then
    insert into private.billing_events(event_id, event_type, occurred_at, workspace_id, applied_at, outcome, payload)
    values (event_id, event_type, occurred_at, root, now(), 'stale', payload);
    return 'stale';
  end if;
  select s.provider, s.status, s.provider_ref into live from public.subscriptions s where s.workspace_id = root;
  if found and live.provider = 'paddle' and live.status in ('active','past_due')
     and live.provider_ref <> apply_billing_event.provider_ref then
    insert into private.billing_events(event_id, event_type, occurred_at, workspace_id, applied_at, outcome, payload)
    values (event_id, event_type, occurred_at, root, now(), 'conflict', payload);
    return 'conflict';
  end if;
  if status in ('cancelled','paused') then
    insert into public.subscriptions(workspace_id, plan_key, status, period_start, period_end, provider, provider_ref,
                                     provider_customer_ref, billing_interval, cancel_at_period_end)
    values (root, 'free', 'active', now(), now() + interval '100 years', null, null, null, null, false)
    on conflict (workspace_id) do update set
      plan_key = 'free', status = 'active', provider = null, provider_ref = null,
      provider_customer_ref = null, billing_interval = null, cancel_at_period_end = false,
      period_start = now(), period_end = now() + interval '100 years';
    update public.subscriptions s
       set plan_key = 'free', status = 'active', provider = null, provider_ref = null,
           provider_customer_ref = null, billing_interval = null, cancel_at_period_end = false,
           period_start = now(), period_end = now() + interval '100 years'
     where s.billing_workspace_id = root;
    insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
    values (w, null, 'plan_paddle_' || replace(event_type, 'subscription.', ''), 'plan', 'free');
    insert into private.billing_events(event_id, event_type, occurred_at, workspace_id, applied_at, outcome, payload)
    values (event_id, event_type, occurred_at, root, now(), 'applied', payload);
    return 'applied';
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

-- ---------------------------------------------------------------------------
-- 7. set_workspace_plan, rebuilt from 20260917030000 with a fifth argument.
-- Over a root that Paddle is billing (provider paddle, active or past_due)
-- the call refuses with paddle_subscription_active unless override is true;
-- with it, the plan and period change but provider, provider_ref and
-- provider_customer_ref stay, so the portal and the next webhook still find
-- the subscription Paddle keeps charging, and the note goes into the audit
-- row's target_id (plan:note) instead of over the provider_ref. A root not
-- on Paddle behaves as before. The four-argument form goes: with a default
-- on the fifth, PostgREST would find two candidates for a four-field call.
drop function public.set_workspace_plan(uuid,text,int,text);
create function public.set_workspace_plan(w uuid, plan text, months int default 1, note text default null, override boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  root uuid;
  p_start timestamptz := now();
  p_end timestamptz;
  live record;
  on_paddle boolean := false;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.plans where key = plan) then raise exception 'unknown_plan' using errcode='22023'; end if;
  if months < 1 or months > 1200 then raise exception 'invalid_months' using errcode='22023'; end if;
  p_end := p_start + make_interval(months => months);
  root := coalesce(private.billing_root(w), w);
  select s.provider, s.status into live from public.subscriptions s where s.workspace_id = root;
  on_paddle := found and live.provider = 'paddle' and live.status in ('active','past_due');
  if on_paddle and not override then
    raise exception 'paddle_subscription_active' using errcode='55000'; end if;
  if on_paddle then
    update public.subscriptions
       set plan_key = plan, status = 'active', period_start = p_start, period_end = p_end
     where workspace_id = root or billing_workspace_id = root;
    insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
    values (w, auth.uid(), 'plan_set', 'plan', plan || ':' || coalesce(note, ''));
    return private.usage_summary_unchecked(w);
  end if;
  insert into public.subscriptions(workspace_id, plan_key, status, period_start, period_end, provider, provider_ref)
  values (root, plan, 'active', p_start, p_end, 'admin', note)
  on conflict (workspace_id) do update
    set plan_key = excluded.plan_key, status = 'active',
        period_start = excluded.period_start, period_end = excluded.period_end,
        provider = 'admin', provider_ref = excluded.provider_ref, cancel_at_period_end = false;
  -- Every client workspace billing through root copied its subscription row
  -- from the root at creation (private.create_workspace_impl); keep those
  -- copies in step rather than letting them read stale terms.
  update public.subscriptions
     set plan_key = plan, status = 'active',
         period_start = p_start, period_end = p_end,
         provider = 'admin', provider_ref = note, cancel_at_period_end = false
   where billing_workspace_id = root;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, auth.uid(), 'plan_set', 'plan', plan);
  return private.usage_summary_unchecked(w);
end $$;
revoke all on function public.set_workspace_plan(uuid,text,int,text,boolean) from public, anon;
grant execute on function public.set_workspace_plan(uuid,text,int,text,boolean) to authenticated;
