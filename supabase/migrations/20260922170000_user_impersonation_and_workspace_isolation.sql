-- Migration: 20260922170000_user_impersonation_and_workspace_isolation.sql
-- 1. Isolate workspace listings for personal accounts (so platform admins do not see all tenant workspaces in their switcher).
-- 2. Enable User Impersonation ("الدخول كـ") for platform admins to inspect any user's workspace through their perspective.
-- 3. Audit logging for impersonation start/stop events.

-- Make workspace_id optional in public.audit_events for platform/system-level events (e.g. impersonation)
alter table public.audit_events alter column workspace_id drop not null;

-- Update public.admin_audit to use LEFT JOIN so platform-level events without workspace_id are included
create or replace function public.admin_audit(p_limit int default 100) returns setof jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_limit < 1 or p_limit > 500 then raise exception 'invalid_limit' using errcode='22023'; end if;
  return query
    select jsonb_build_object(
      'id', a.id, 'workspace_id', a.workspace_id, 'workspace_name', coalesce(w.name, 'Platform'),
      'actor_id', a.actor_id, 'actor_email', u.email,
      'action', a.action, 'target_type', a.target_type, 'target_id', a.target_id,
      'created_at', to_jsonb(a.created_at))
    from public.audit_events a
    left join public.workspaces w on w.id = a.workspace_id
    left join auth.users u on u.id = a.actor_id
    order by a.created_at desc
    limit p_limit;
end $$;
revoke all on function public.admin_audit(int) from public, anon;
grant execute on function public.admin_audit(int) to authenticated;

-- Function: public.my_workspaces(target_user_id uuid default null)
-- Returns the workspaces belonging to the caller (or to target_user_id if called by platform admin)
create or replace function public.my_workspaces(target_user_id uuid default null)
returns table (id uuid, name text, created_by uuid)
language plpgsql stable security definer set search_path='' as $$
declare
  v_target uuid;
begin
  if target_user_id is not null then
    if not public.is_platform_admin() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_target := target_user_id;
  else
    v_target := auth.uid();
  end if;

  if v_target is null then
    return;
  end if;

  return query
  select distinct w.id, w.name, w.created_by
  from public.workspaces w
  left join public.memberships m on m.workspace_id = w.id
  where m.user_id = v_target or w.created_by = v_target
  order by w.name asc;
end $$;
revoke all on function public.my_workspaces(uuid) from public, anon;
grant execute on function public.my_workspaces(uuid) to authenticated;

-- Function: public.admin_start_impersonation(p_target_user_id uuid)
-- Gated to platform admins. Audits and returns target user details.
create or replace function public.admin_start_impersonation(p_target_user_id uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_user record;
  v_ws_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_target_user_id = auth.uid() then
    raise exception 'cannot_impersonate_self' using errcode = '22023';
  end if;

  select id, email into v_user
  from auth.users
  where id = p_target_user_id;

  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  -- Pick target user's first workspace if any (optional)
  select workspace_id into v_ws_id
  from public.memberships
  where user_id = p_target_user_id
  limit 1;

  insert into public.audit_events (workspace_id, actor_id, action, target_type, target_id)
  values (v_ws_id, auth.uid(), 'impersonation_started', 'user', p_target_user_id::text);

  return jsonb_build_object(
    'target_user_id', v_user.id,
    'target_email', v_user.email,
    'started_at', now()
  );
end $$;
revoke all on function public.admin_start_impersonation(uuid) from public, anon;
grant execute on function public.admin_start_impersonation(uuid) to authenticated;

-- Function: public.admin_stop_impersonation(p_target_user_id uuid)
-- Gated to platform admins. Audits the end of impersonation.
create or replace function public.admin_stop_impersonation(p_target_user_id uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_ws_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select workspace_id into v_ws_id
  from public.memberships
  where user_id = p_target_user_id
  limit 1;

  insert into public.audit_events (workspace_id, actor_id, action, target_type, target_id)
  values (v_ws_id, auth.uid(), 'impersonation_ended', 'user', p_target_user_id::text);

  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_stop_impersonation(uuid) from public, anon;
grant execute on function public.admin_stop_impersonation(uuid) to authenticated;
