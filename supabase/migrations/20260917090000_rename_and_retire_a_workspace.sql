-- Two doors on the account page: rename a workspace, and hand one over.
--
-- "Delete" is deliberately not a deletion. The owner of this product asked that
-- nothing collected is ever dropped: a workspace its owner is done with loses
-- its members and its Google grant — that grant belonged to the person leaving
-- and is withdrawn with them — and moves under the platform owner's own root,
-- rows, labels and history untouched, with a record of whose it was. Actual
-- deletion of a person's data stays the request-by-email path the privacy
-- policy names.
alter table public.workspaces
  add column retired_from uuid references auth.users(id),
  add column retired_at timestamptz;

create function public.rename_workspace(w uuid, new_name text) returns void
language plpgsql security definer set search_path='' as $$
declare cleaned text; begin
  if not private.has_role(w, array['workspace_owner']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  cleaned := trim(new_name);
  if cleaned is null or length(cleaned) < 1 or length(cleaned) > 120 then
    raise exception 'invalid_name' using errcode='22023'; end if;
  update public.workspaces set name = cleaned where id = w;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, auth.uid(), 'workspace_renamed', 'workspace', cleaned);
end $$;
revoke all on function public.rename_workspace(uuid,text) from public, anon;
grant execute on function public.rename_workspace(uuid,text) to authenticated;

-- The platform owner is the oldest platform admin: one person, by design.
create function private.platform_owner() returns uuid
language sql stable security definer set search_path='' as $$
  select user_id from private.platform_admins order by added_at limit 1;
$$;
revoke all on function private.platform_owner() from public, anon, authenticated;

create function public.retire_workspace(w uuid) returns void
language plpgsql security definer set search_path='' as $$
declare me uuid; keeper uuid; keeper_home uuid; ch record; begin
  me := auth.uid();
  if not private.has_role(w, array['workspace_owner']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  -- A person always keeps one workspace to stand in; the product has no
  -- signed-in state without one.
  if (select count(*) from public.memberships m
       where m.user_id = me and m.role = 'workspace_owner') <= 1 then
    raise exception 'last_workspace' using errcode='55000'; end if;
  keeper := private.platform_owner();
  if keeper is null then raise exception 'no_platform_owner' using errcode='55000'; end if;
  keeper_home := private.owner_plan_workspace(keeper);

  -- The grant leaves with the person who gave it; scheduled work stops.
  for ch in select id from public.channels where workspace_id = w loop
    update public.channels set status = 'disconnected' where id = ch.id;
    update private.oauth_connections set status = 'revoked' where channel_id = ch.id;
    update public.jobs set status = 'cancelled', error_code = 'disconnected'
     where channel_id = ch.id and status in ('queued','running');
  end loop;

  -- Membership moves whole: everyone out, the keeper in as owner.
  delete from public.memberships where workspace_id = w;
  insert into public.memberships(workspace_id, user_id, role) values (w, keeper, 'workspace_owner');

  -- Billing follows the keeper's root; the rows stay where they are.
  update public.subscriptions s
     set plan_key = k.plan_key, status = k.status, period_start = k.period_start,
         period_end = k.period_end, provider = k.provider, provider_ref = k.provider_ref,
         provider_customer_ref = k.provider_customer_ref, billing_interval = k.billing_interval,
         cancel_at_period_end = false, billing_workspace_id = keeper_home
    from public.subscriptions k
   where s.workspace_id = w and k.workspace_id = keeper_home;

  update public.workspaces
     set created_by = keeper, retired_from = me, retired_at = now()
   where id = w;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, me, 'workspace_retired', 'workspace', me::text);
end $$;
revoke all on function public.retire_workspace(uuid) from public, anon;
grant execute on function public.retire_workspace(uuid) to authenticated;
