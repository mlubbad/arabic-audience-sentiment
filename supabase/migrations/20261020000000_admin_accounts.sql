-- The owner console's accounts page (phase 2, step 3, owner approval
-- 2026-10-09): every account with what it holds, in one read, and a way to
-- set test accounts apart from customers.
--
-- `private.user_profiles.is_test` marks an account the owner made to try
-- the product (the probe accounts of the isolation checks, say). It changes
-- nothing an account can do; it only lets the owner's lists keep customers
-- apart from noise. Set through `admin_set_user_test`, audited.
--
-- `admin_accounts()` answers one row per account: who it is (email, the
-- name and organisation the owner keeps), when it came and was last here,
-- whether it is suspended, a platform admin or a test account, how many
-- workspaces it stands in and created, how many channels those it created
-- hold, and the plan of its home workspace (the first it created, read
-- through its billing root, as every plan is). Counts are aggregated once
-- per table; its own 30 s timeout, the 20261011000000 lesson.
--
-- `admin_user_detail` (20261014000000) also says whether the account is a
-- test account, for the account file's switch.

alter table private.user_profiles
  add column is_test boolean not null default false;

create or replace function public.admin_set_user_test(p_user uuid, p_test boolean)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_test is null then
    raise exception 'invalid_request' using errcode='22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'user_not_found' using errcode='P0002';
  end if;
  insert into private.user_profiles as up (user_id, is_test, updated_at, updated_by)
  values (p_user, p_test, now(), uid)
  on conflict (user_id) do update
     set is_test = excluded.is_test,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (null, uid, case when p_test then 'user_marked_test' else 'user_unmarked_test' end,
          'user', p_user::text);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_set_user_test(uuid, boolean) from public, anon;
grant execute on function public.admin_set_user_test(uuid, boolean) to authenticated;

create or replace function public.admin_accounts()
returns jsonb
language plpgsql stable security definer
set search_path=''
set statement_timeout = '30s'
as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  with seats as (
    select user_id, count(*) as workspaces
      from public.memberships group by user_id),
  owned as (
    select created_by as user_id, count(*) as owned
      from public.workspaces group by created_by),
  chans as (
    select w.created_by as user_id, count(c.id) as channels
      from public.workspaces w
      join public.channels c on c.workspace_id = w.id
     group by w.created_by),
  home as (
    select distinct on (w.created_by) w.created_by as user_id, w.id as workspace_id
      from public.workspaces w
     order by w.created_by, w.created_at, w.id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id,
           'email', u.email,
           'display_name', p.display_name,
           'organization', p.organization,
           'created_at', u.created_at,
           'last_sign_in_at', u.last_sign_in_at,
           'suspended', coalesce(u.banned_until > now(), false),
           'is_admin', exists (select 1 from private.platform_admins a where a.user_id = u.id),
           'is_test', coalesce(p.is_test, false),
           'workspaces', coalesce(seats.workspaces, 0),
           'owned', coalesce(owned.owned, 0),
           'channels', coalesce(chans.channels, 0),
           'plan_key', s.plan_key,
           'plan_status', s.status,
           'period_end', s.period_end,
           'provider', s.provider)
         order by u.created_at desc, u.id), '[]'::jsonb)
    into result
    from auth.users u
    left join private.user_profiles p on p.user_id = u.id
    left join seats on seats.user_id = u.id
    left join owned on owned.user_id = u.id
    left join chans on chans.user_id = u.id
    left join home on home.user_id = u.id
    left join public.subscriptions s
      on s.workspace_id = coalesce(private.billing_root(home.workspace_id), home.workspace_id);
  return result;
end $$;

revoke all on function public.admin_accounts() from public, anon;
grant execute on function public.admin_accounts() to authenticated;

-- The account file's detail, as 20261014000000 left it, saying whether the
-- account is a test account.
create or replace function public.admin_user_detail(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  u record;
  p private.user_profiles;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  select id, email, created_at, last_sign_in_at, email_confirmed_at, banned_until
    into u from auth.users where id = p_user;
  if not found then
    raise exception 'user_not_found' using errcode='P0002';
  end if;
  select * into p from private.user_profiles where user_id = p_user;

  return jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'created_at', u.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'email_confirmed_at', u.email_confirmed_at,
    'banned_until', u.banned_until,
    'is_test', coalesce(p.is_test, false),
    'profile', jsonb_build_object(
      'display_name', p.display_name,
      'organization', p.organization,
      'phone', p.phone,
      'admin_note', p.admin_note,
      'updated_at', p.updated_at),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
               'workspace_id', ws.id,
               'workspace_name', ws.name,
               'role', m.role,
               'created_by_user', ws.created_by = p_user)
             order by ws.created_at, ws.id)
        from public.memberships m
        join public.workspaces ws on ws.id = m.workspace_id
       where m.user_id = p_user), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', h.created_at,
               'action', h.action,
               'actor_email', h.actor_email,
               'by_self', h.actor_id = p_user,
               'workspace_name', h.workspace_name)
             order by h.created_at desc)
        from (
          select e.created_at, e.action, e.actor_id, a.email as actor_email,
                 ws.name as workspace_name
            from public.audit_events e
            left join auth.users a on a.id = e.actor_id
            left join public.workspaces ws on ws.id = e.workspace_id
           where (e.target_type in ('user', 'membership') and e.target_id = p_user::text)
              or e.actor_id = p_user
           order by e.created_at desc
           limit 50) h), '[]'::jsonb));
end $$;
