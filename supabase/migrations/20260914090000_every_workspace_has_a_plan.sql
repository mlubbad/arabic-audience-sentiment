-- A new workspace could collect and never analyse.
--
-- Metering refuses a batch of predictions for a workspace with no subscription,
-- correctly — an entitlement it was never granted is not one it has. But
-- nothing granted one. A client could sign up, connect a channel, collect
-- comments, and then watch every analysis fail on no_active_plan, with the
-- collected rows sitting unlabelled and no way from inside the product to fix
-- it. The two workspaces that exist today were only usable because an operator
-- inserted their rows by hand.
--
-- The pilot plan is activated with the workspace. It is a row in this database
-- and not a payment: no provider, no reference, nothing charged. When real
-- billing exists it will set provider and provider_ref on this same row, and
-- deciding what happens at the end of a period is that work, not this.
--
-- The period is generous rather than indefinite, because a subscription with no
-- end cannot be distinguished from one nobody has reviewed.

create or replace function private.grant_pilot_plan(w uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  -- Nothing to grant if the operator has not defined the plan. A missing plan
  -- row is a deployment that is not finished, and inventing allowances here
  -- would hide that.
  if not exists (select 1 from public.plans where key = 'pilot') then return; end if;
  insert into public.subscriptions(workspace_id, plan_key, status, period_start, period_end)
  values (w, 'pilot', 'active', now(), now() + interval '90 days')
  on conflict (workspace_id) do nothing;
end $$;

revoke all on function private.grant_pilot_plan(uuid) from public, anon, authenticated;

create or replace function private.create_workspace_impl(workspace_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare w uuid; begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  insert into public.workspaces(name,created_by) values(workspace_name,auth.uid()) returning id into w;
  insert into public.memberships values(w,auth.uid(),'workspace_owner');
  insert into public.clients(workspace_id,name) values(w,workspace_name);
  perform private.grant_pilot_plan(w);
  return w;
end $$;

create or replace function private.bootstrap_personal_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
declare w uuid; begin
  insert into public.workspaces(name,created_by) values('مساحة العمل الشخصية',new.id) returning id into w;
  insert into public.memberships values(w,new.id,'workspace_owner');
  insert into public.clients(workspace_id,name) values(w,'مساحة العمل الشخصية');
  perform private.grant_pilot_plan(w);
  return new;
end $$;

-- Workspaces created before this would otherwise stay permanently unable to
-- analyse anything they collect.
do $$ declare r record; begin
  for r in select id from public.workspaces loop
    perform private.grant_pilot_plan(r.id);
  end loop;
end $$;
