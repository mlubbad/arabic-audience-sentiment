-- The platform owner's account file: one person's details, the workspaces
-- they stand in, and what was done to their account, read and edited from
-- the admin users page (owner request, 2026-10-09).
--
-- The platform kept only the email a person signed up with. The owner asked
-- to keep their name, organisation and phone as well, and a note only the
-- owner reads. They live in `private.user_profiles`, out of reach of the
-- browser: the admin functions below are the only way in, each gated on
-- `is_platform_admin()` and each change written to the audit trail.
--
-- Plans, packs and roles keep their own functions (`set_workspace_plan`,
-- `grant_pack`, `update_workspace_account_role`); the account file calls
-- them. Password help is a reset link the person follows themselves: no one,
-- the owner included, sees or sets a password here.

create table private.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  organization text check (char_length(organization) <= 120),
  phone text check (char_length(phone) <= 40),
  admin_note text check (char_length(admin_note) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

revoke all on table private.user_profiles from public, anon, authenticated;

-- One person, as the account file shows them. `history` is the audit trail
-- that names them: what was done to their account or their seat in a
-- workspace (`update_workspace_account_role` files those under
-- `membership`), and what they did.
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

revoke all on function public.admin_user_detail(uuid) from public, anon;
grant execute on function public.admin_user_detail(uuid) to authenticated;

-- The owner edits a person's details. Blank fields are cleared; the row is
-- made on the first edit.
create or replace function public.admin_update_user_profile(
  p_user uuid,
  p_display_name text,
  p_organization text,
  p_phone text,
  p_admin_note text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'user_not_found' using errcode='P0002';
  end if;

  insert into private.user_profiles as up
         (user_id, display_name, organization, phone, admin_note, updated_at, updated_by)
  values (p_user,
          nullif(trim(p_display_name), ''),
          nullif(trim(p_organization), ''),
          nullif(trim(p_phone), ''),
          nullif(trim(p_admin_note), ''),
          now(), uid)
  on conflict (user_id) do update
     set display_name = excluded.display_name,
         organization = excluded.organization,
         phone = excluded.phone,
         admin_note = excluded.admin_note,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by;

  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (null, uid, 'user_profile_updated', 'user', p_user::text);

  return jsonb_build_object('ok', true);
exception when check_violation then
  raise exception 'profile_too_long' using errcode='22023';
end $$;

revoke all on function public.admin_update_user_profile(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_update_user_profile(uuid, text, text, text, text) to authenticated;

-- What the owner did for a person outside the database, recorded in the
-- trail beside everything else: today, a password reset link sent to them.
create or replace function public.admin_record_user_action(p_user uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_action not in ('password_reset_sent') then
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
