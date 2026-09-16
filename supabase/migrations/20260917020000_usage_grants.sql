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

-- The allowance is one per billing root (20260917010000): a client workspace
-- spends its owner's, and a pack bought for the client lands on the same
-- shared figure. Every ledger read below therefore spans the workspaces that
-- bill through the same root, found off the subscription row so the
-- (workspace_id, kind, ...) indexes still serve the sum.
create function private.granted_units(w uuid, kind text) returns int
language sql stable security definer set search_path='' as $$
  select coalesce(sum(g.units),0)::int from public.usage_grants g
  where g.kind = granted_units.kind and g.expires_at > now()
    and g.workspace_id in (select s.workspace_id from public.subscriptions s
                           where coalesce(s.billing_workspace_id, s.workspace_id) = private.billing_root(w));
$$;
revoke all on function private.granted_units(uuid,text) from public, anon, authenticated;

-- used_units, rebuilt from the foundation: the period's spend is the root's,
-- summed across every workspace billing through it. Same signature, and
-- service_role keeps the execute it was granted in 20260914050000.
create or replace function private.used_units(w uuid,kind text,since timestamptz) returns int
language sql stable security definer set search_path='' as $$
 select coalesce(sum(u.units),0)::int from public.usage_events u
 where u.event_type=kind and u.period_start=since
   and u.workspace_id in (select s.workspace_id from public.subscriptions s
                          where coalesce(s.billing_workspace_id, s.workspace_id) = private.billing_root(w));
$$;

-- A grant expires thirty days after the root's period ends; the client's own
-- row mirrors the root's dates but the root is the one that pays. The same
-- provider_ref grants once, so a replayed webhook returns the first grant.
create function private.grant_units(w uuid, kind text, units int, source text, provider_ref text) returns uuid
language plpgsql security definer set search_path='' as $$
declare sub record; g uuid; begin
  select s.period_end into sub from public.subscriptions s where s.workspace_id = private.billing_root(w);
  if not found then raise exception 'no_active_plan' using errcode='42501'; end if;
  insert into public.usage_grants(workspace_id, kind, units, expires_at, source, provider_ref)
  values (w, kind, units, sub.period_end + interval '30 days', source, provider_ref)
  -- By constraint name: inside plpgsql the column names here are also the
  -- parameter names, and a bare column list would be ambiguous.
  on conflict on constraint usage_grants_source_provider_ref_key do nothing returning id into g;
  if g is null then select id into g from public.usage_grants where usage_grants.source = grant_units.source and usage_grants.provider_ref = grant_units.provider_ref; end if;
  return g;
end $$;
revoke all on function private.grant_units(uuid,text,int,text,text) from public, anon, authenticated;

-- reserve_usage, rebuilt from 20260916010000: the subscription locked and read
-- is the billing root's, so two client workspaces of one owner serialise on
-- one row and draw on one allowance; that allowance now includes live grants;
-- a null plan allowance (owner) means no ceiling; past_due still reserves.
-- The event is recorded against the workspace that spent, on the root's period.
create or replace function private.reserve_usage(w uuid,kind text,keys text[]) returns text[]
language plpgsql security invoker set search_path='' as $$
declare sub record; allowance int; used int; covered text[]; fresh text[]; begin
 if kind not in ('comment_analysis','historical_backfill','topic_classification') then
   raise exception 'invalid_event_type' using errcode='22023'; end if;
 if coalesce(array_length(keys,1),0) > 500 then raise exception 'batch_too_large' using errcode='22023'; end if;
 select s.status,s.period_start,s.period_end,pl.analysis_units,pl.backfill_units,pl.topic_units into sub
 from public.subscriptions s join public.plans pl on pl.key=s.plan_key
 where s.workspace_id=private.billing_root(w) for update of s;
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

-- reserve_usage is security invoker and runs as the worker's role, which
-- holds execute on a named list only (20260914050000 records the batch that
-- died when used_units was missing from it). The two lookups it now makes
-- join the list.
grant execute on function private.billing_root(uuid), private.granted_units(uuid,text) to service_role;

-- budget_entry gains the granted figure; a null allowance is reported as -1
-- so the contract can say "unlimited" rather than inventing a number. The
-- three-argument form goes: with a default on the fourth, a three-argument
-- call would match both and Postgres would call neither.
drop function private.budget_entry(text,int,int);
create function private.budget_entry(kind text,allowance int,used int,granted int default 0) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('event_type',kind,
   'allowance', case when allowance is null then -1 else allowance+granted end,
   'granted', granted, 'used',used,
   'remaining', case when allowance is null then -1 else greatest(allowance+granted-used,0) end);
$$;

-- usage_summary_impl, rebuilt from 20260916010000: the membership check stays
-- on the workspace asked about, the plan and period come from its billing
-- root, and each budget line carries what the packs added.
create or replace function private.usage_summary_impl(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sub record; begin
 if not private.has_role(w) then raise exception 'forbidden' using errcode='42501'; end if;
 select s.plan_key,s.status,s.period_start,s.period_end,pl.analysis_units,pl.backfill_units,pl.topic_units into sub
 from public.subscriptions s join public.plans pl on pl.key=s.plan_key where s.workspace_id=private.billing_root(w);
 if not found then return null; end if;
 return jsonb_build_object(
 'plan_key',sub.plan_key,'status',sub.status,
 'period_start',to_jsonb(sub.period_start),'period_end',to_jsonb(sub.period_end),
 'budgets',jsonb_build_array(
 private.budget_entry('comment_analysis',sub.analysis_units,private.used_units(w,'comment_analysis',sub.period_start),private.granted_units(w,'comment_analysis')),
 private.budget_entry('historical_backfill',sub.backfill_units,private.used_units(w,'historical_backfill',sub.period_start),private.granted_units(w,'historical_backfill')),
 private.budget_entry('topic_classification',sub.topic_units,private.used_units(w,'topic_classification',sub.period_start),private.granted_units(w,'topic_classification'))));
end $$;
