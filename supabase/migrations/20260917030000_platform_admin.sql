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

-- usage_summary_impl (20260917020000) refuses a caller who is not a member of
-- w, which an admin acting on someone else's workspace is not. This twin
-- reads the same shape without that gate; copied from usage_summary_impl's
-- current body minus the has_role check, so it stays exactly what a member
-- would see. Never granted to anyone — only set_workspace_plan, itself
-- admin-gated and security definer, may call it.
create function private.usage_summary_unchecked(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sub record; begin
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
revoke all on function private.usage_summary_unchecked(uuid) from public, anon, authenticated;

-- The hand activation itself. Writes the ROOT's subscription row (a client
-- workspace has none of its own to speak of; if w has no row yet, root=w)
-- and propagates the same terms to every workspace billing through that
-- root, so a client's copied row never disagrees with the home it follows.
-- Audited against w, the workspace named in the call, not the root.
create function public.set_workspace_plan(w uuid, plan text, months int default 1, note text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  root uuid;
  p_start timestamptz := now();
  p_end timestamptz;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.plans where key = plan) then raise exception 'unknown_plan' using errcode='22023'; end if;
  if months < 1 or months > 1200 then raise exception 'invalid_months' using errcode='22023'; end if;
  p_end := p_start + make_interval(months => months);
  root := coalesce(private.billing_root(w), w);
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
revoke all on function public.set_workspace_plan(uuid,text,int,text) from public, anon;
grant execute on function public.set_workspace_plan(uuid,text,int,text) to authenticated;

-- One row per workspace for the operator's own screen; plpgsql so it can
-- raise before returning rather than smuggling an error value through a set
-- of jsonb, the way a plain sql function would have to.
create function public.admin_workspaces() returns setof jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return query
    select jsonb_build_object(
      'id', w.id, 'name', w.name, 'created_by', w.created_by,
      'plan_key', s.plan_key, 'status', s.status, 'period_end', s.period_end, 'provider', s.provider)
    from public.workspaces w left join public.subscriptions s on s.workspace_id = w.id
    order by w.created_at desc;
end $$;
revoke all on function public.admin_workspaces() from public, anon;
grant execute on function public.admin_workspaces() to authenticated;

-- A gift pack, admin-only, riding the same idempotent grant_units the paddle
-- webhook uses (20260917020000) so a replayed note never double-grants.
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
