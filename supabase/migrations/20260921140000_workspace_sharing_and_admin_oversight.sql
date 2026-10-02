-- 20260921140000_workspace_sharing_and_admin_oversight.sql
--
-- Enables workspace sharing between accounts (public.memberships) with roles
-- 'analyst' and 'viewer' under plan limits (plans.members_limit), and grants
-- platform admins (private.platform_admins) view and access rights to all
-- member workspaces across RLS and analytical RPCs.

-- 1. Track when membership was added
alter table public.memberships add column if not exists added_at timestamptz not null default now();

-- 2. Update private.has_role to include platform_admins oversight
create or replace function private.has_role(
  w uuid,
  allowed text[] default array['workspace_owner','analyst','viewer']
)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (
    exists(
      select 1 from public.memberships m
      where m.workspace_id = w
        and m.user_id = (select auth.uid())
        and m.role = any(allowed)
    )
    or exists(
      select 1 from private.platform_admins
      where user_id = (select auth.uid())
    )
  );
$$;

revoke all on function private.has_role(uuid, text[]) from public;
grant execute on function private.has_role(uuid, text[]) to authenticated;

-- 3. RPC to list workspace accounts with roles, added_at, and plan limits
create or replace function public.list_workspace_accounts(w uuid)
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  accounts jsonb;
  mem_limit integer;
  total_count integer;
begin
  if not private.has_role(w) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select private.plan_limit(w, 'members') into mem_limit;

  select count(*) into total_count
  from public.memberships
  where workspace_id = w;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', m.user_id,
      'email', coalesce(u.email, ''),
      'role', m.role,
      'is_owner', (m.role = 'workspace_owner'),
      'added_at', to_jsonb(m.added_at)
    ) order by (m.role = 'workspace_owner') desc, m.added_at asc
  ), '[]'::jsonb)
  into accounts
  from public.memberships m
  left join auth.users u on u.id = m.user_id
  where m.workspace_id = w;

  return jsonb_build_object(
    'workspace_id', w,
    'members_limit', mem_limit,
    'total_members', total_count,
    'accounts', accounts
  );
end $$;

revoke all on function public.list_workspace_accounts(uuid) from public, anon;
grant execute on function public.list_workspace_accounts(uuid) to authenticated;

-- 4. RPC to share workspace with a registered account email
create or replace function public.share_workspace(w uuid, account_email text, account_role text)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  normalized_email text;
  target_user_id uuid;
  current_count integer;
  limit_count integer;
  existing_role text;
  is_admin boolean;
begin
  select exists(select 1 from private.platform_admins where user_id = auth.uid()) into is_admin;
  if not (is_admin or private.has_role(w, array['workspace_owner'])) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if account_role not in ('analyst', 'viewer') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  normalized_email := lower(trim(account_email));
  if normalized_email = '' or normalized_email is null then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  select id into target_user_id
  from auth.users
  where lower(email) = normalized_email
  limit 1;

  if target_user_id is null then
    raise exception 'user_not_found' using errcode = '42704';
  end if;

  select role into existing_role
  from public.memberships
  where workspace_id = w and user_id = target_user_id;

  if existing_role = 'workspace_owner' then
    raise exception 'cannot_modify_owner' using errcode = '42501';
  end if;

  if existing_role is not null then
    update public.memberships
    set role = account_role
    where workspace_id = w and user_id = target_user_id;

    insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
    values (w, auth.uid(), 'workspace_account_role_updated', 'membership', target_user_id::text);

    return jsonb_build_object('ok', true, 'action', 'updated', 'user_id', target_user_id, 'role', account_role);
  end if;

  select private.plan_limit(w, 'members') into limit_count;
  select count(*) into current_count from public.memberships where workspace_id = w;

  if limit_count is not null and current_count >= limit_count then
    raise exception 'members_limit_reached' using errcode = 'EXMEM';
  end if;

  insert into public.memberships(workspace_id, user_id, role, added_at)
  values (w, target_user_id, account_role, now());

  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, auth.uid(), 'workspace_shared', 'membership', target_user_id::text);

  return jsonb_build_object('ok', true, 'action', 'added', 'user_id', target_user_id, 'role', account_role);
end $$;

revoke all on function public.share_workspace(uuid, text, text) from public, anon;
grant execute on function public.share_workspace(uuid, text, text) to authenticated;

-- 5. RPC to unshare workspace with an account
create or replace function public.unshare_workspace(w uuid, target_user_id uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  target_role text;
  is_admin boolean;
begin
  select exists(select 1 from private.platform_admins where user_id = auth.uid()) into is_admin;
  if not (is_admin or private.has_role(w, array['workspace_owner'])) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select role into target_role
  from public.memberships
  where workspace_id = w and user_id = target_user_id;

  if target_role is null then
    raise exception 'not_found' using errcode = '42704';
  end if;

  if target_role = 'workspace_owner' then
    raise exception 'cannot_remove_owner' using errcode = '42501';
  end if;

  delete from public.memberships
  where workspace_id = w and user_id = target_user_id;

  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, auth.uid(), 'workspace_unshared', 'membership', target_user_id::text);

  return jsonb_build_object('ok', true, 'user_id', target_user_id);
end $$;

revoke all on function public.unshare_workspace(uuid, uuid) from public, anon;
grant execute on function public.unshare_workspace(uuid, uuid) to authenticated;

-- 6. RPC to update account role in workspace
create or replace function public.update_workspace_account_role(w uuid, target_user_id uuid, new_role text)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  target_role text;
  is_admin boolean;
begin
  select exists(select 1 from private.platform_admins where user_id = auth.uid()) into is_admin;
  if not (is_admin or private.has_role(w, array['workspace_owner'])) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if new_role not in ('analyst', 'viewer') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  select role into target_role
  from public.memberships
  where workspace_id = w and user_id = target_user_id;

  if target_role is null then
    raise exception 'not_found' using errcode = '42704';
  end if;

  if target_role = 'workspace_owner' then
    raise exception 'cannot_modify_owner' using errcode = '42501';
  end if;

  update public.memberships
  set role = new_role
  where workspace_id = w and user_id = target_user_id;

  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, auth.uid(), 'workspace_account_role_updated', 'membership', target_user_id::text);

  return jsonb_build_object('ok', true, 'user_id', target_user_id, 'role', new_role);
end $$;

revoke all on function public.update_workspace_account_role(uuid, uuid, text) from public, anon;
grant execute on function public.update_workspace_account_role(uuid, uuid, text) to authenticated;
