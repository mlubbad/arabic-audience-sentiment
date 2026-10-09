-- The account file's actions that need the auth admin API: a reset link the
-- owner hands over, suspension and its lifting, a manual email confirmation,
-- and an email change (owner decision, 2026-10-09). They run in the
-- `admin-users` Edge Function, which holds the service key a browser never
-- does; the database decides who may ask and records what was done.
--
-- `admin_user_target` is the function's gate: it answers only a platform
-- admin, and names what the function must know before touching the account:
-- the person's email, whether they are a platform admin themselves, and
-- whether they are the caller. The function refuses to suspend either.
--
-- `admin_record_user_action` (20261014000000) learns the new actions, so
-- each lands in the audit trail and the person's history.

create or replace function public.admin_user_target(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
  u record;
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  select id, email into u from auth.users where id = p_user;
  if not found then
    raise exception 'user_not_found' using errcode='P0002';
  end if;
  return jsonb_build_object(
    'email', u.email,
    'is_admin', exists (select 1 from private.platform_admins where user_id = p_user),
    'is_self', p_user = uid);
end $$;

revoke all on function public.admin_user_target(uuid) from public, anon;
grant execute on function public.admin_user_target(uuid) to authenticated;

create or replace function public.admin_record_user_action(p_user uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_action not in ('password_reset_sent', 'password_link_created',
                      'user_suspended', 'user_unsuspended',
                      'email_confirmed', 'email_changed') then
    raise exception 'invalid_action' using errcode='22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'user_not_found' using errcode='P0002';
  end if;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (null, uid, p_action, 'user', p_user::text);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_record_user_action(uuid, text) from public, anon;
grant execute on function public.admin_record_user_action(uuid, text) to authenticated;
