-- The ladder in docs/pricing-v2-draft.md becomes rows. Plans stay operator-owned:
-- no tenant grant exists on this table and none is added here.

alter table public.plans
  add column segment text not null default 'individual'
    check (segment in ('individual','business','internal')),
  add column price_monthly_cents integer not null default 0 check (price_monthly_cents >= 0),
  add column price_yearly_cents integer not null default 0 check (price_yearly_cents >= 0),
  -- Defaults to one like channels_limit and members_limit do: a plan that does
  -- not say otherwise is a single workspace, and unlimited must be spelled.
  add column workspaces_limit integer default 1 check (workspaces_limit is null or workspaces_limit >= 1),
  add column insight_reports integer not null default 0 check (insight_reports >= 0),
  add column internal boolean not null default false,
  add column self_serve boolean not null default false,
  add column sort_order integer not null default 100,
  add column provider_prices jsonb not null default '{}'::jsonb,
  add column title_ar text not null default '',
  add column title_en text not null default '';

-- Unlimited is spelled null, and only an internal plan may spell it.
alter table public.plans
  alter column analysis_units drop not null,
  alter column backfill_units drop not null,
  alter column topic_units drop not null,
  alter column channels_limit drop not null,
  alter column members_limit drop not null;

-- The ladder. Prices in USD cents; yearly is ten months for twelve.
insert into public.plans
  (key, segment, title_ar, title_en, price_monthly_cents, price_yearly_cents, self_serve, sort_order,
   analysis_units, backfill_units, topic_units, insight_reports,
   channels_limit, members_limit, workspaces_limit,
   min_sync_interval_minutes, live_interval_minutes, catalogue_interval_minutes)
values
  ('free',        'individual', 'مجاني',   'Free',         0,     0,     true,  10,
      100,     0,      100,    1,    0,  1,  1,  0,    0,    0),
  ('creator',     'individual', 'منشئ',    'Creator',      1200,  12000, true,  20,
      10000,   40000,  4000,   10,   1,  1,  1,  60,   1440, 1440),
  ('creator_plus','individual', 'منشئ بلس','Creator Plus', 2900,  29000, true,  30,
      30000,   120000, 12000,  50,   2,  2,  1,  30,   720,  1440),
  ('agency',      'business',   'وكالة',   'Agency',       9900,  99000, true,  40,
      150000,  600000, 60000,  200,  10, 10, 5,  15,   360,  720),
  ('media',       'business',   'ميديا',   'Media',        24900, 249000,false, 50,
      500000,  2000000,200000, 600,  30, 25, 15, 10,   120,  360),
  ('enterprise',  'business',   'مؤسسات',  'Enterprise',   0,     0,     false, 60,
      1000000, 4000000,400000, 2000, 100,100,50, 5,    60,   360),
  ('owner',       'internal',   'المالك',  'Owner',        0,     0,     false, 90,
      null,    null,   null,   0,    null,null,null,0,  60,   360);
update public.plans set internal = true where key = 'owner';
update public.plans set segment='internal', internal=true, sort_order=99, title_ar='تجريبي', title_en='Pilot'
  where key = 'pilot';

-- The finiteness rule is added once the two internal rows are marked, because
-- Postgres validates a new check against every row already in the table: the
-- owner row carries nulls and the pilot row has no workspaces_limit.
alter table public.plans add constraint plans_limits_finite_unless_internal check (
  internal or (analysis_units is not null and backfill_units is not null and topic_units is not null
               and channels_limit is not null and members_limit is not null and workspaces_limit is not null));

-- A subscription whose payment failed is neither active nor cancelled.
alter table public.subscriptions drop constraint subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check
  check (status in ('active','past_due','paused','cancelled'));
alter table public.subscriptions
  add column cancel_at_period_end boolean not null default false,
  add column provider_customer_ref text,
  add column billing_interval text check (billing_interval is null or billing_interval in ('month','year'));

-- A client workspace does not carry an allowance of its own. Its subscription
-- row points at the workspace that pays — the owner's home workspace — and
-- every limit is read through that root. Null means the workspace bills itself.
alter table public.subscriptions add column billing_workspace_id uuid references public.workspaces(id);

create function private.billing_root(w uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select coalesce(s.billing_workspace_id, s.workspace_id) from public.subscriptions s where s.workspace_id = w
$$;
revoke all on function private.billing_root(uuid) from public, anon, authenticated;

-- plan_limit, rebuilt from 20260915130000 with the sixth name, resolved through
-- the billing root so a client workspace reads its owner's plan. A past_due
-- subscription still answers: the limits stand while the payment is retried.
create or replace function private.plan_limit(w uuid, which text) returns integer
language sql stable security definer set search_path='' as $$
  select case which
           when 'channels' then p.channels_limit
           when 'members' then p.members_limit
           when 'workspaces' then p.workspaces_limit
           when 'sync_interval' then p.min_sync_interval_minutes
           when 'live_interval' then p.live_interval_minutes
           when 'catalogue_interval' then p.catalogue_interval_minutes
         end
  from public.subscriptions s join public.plans p on p.key = s.plan_key
  where s.workspace_id = private.billing_root(w) and s.status in ('active','past_due');
$$;
revoke all on function private.plan_limit(uuid,text) from public, anon, authenticated;

-- The workspace limit counts the workspaces the caller owns. The plan that
-- governs is the one on the caller's first (personal) workspace: a person has
-- one plan, and their client workspaces hang off it.
create or replace function private.owner_plan_workspace(u uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select w.id from public.workspaces w
  where w.created_by = u order by w.created_at asc limit 1;
$$;
revoke all on function private.owner_plan_workspace(uuid) from public, anon, authenticated;

-- New workspaces get the free plan, not pilot: pilot was the hand-activated
-- allowance of the pilot phase, and it is now internal.
create or replace function private.grant_default_plan(w uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.plans where key = 'free') then return; end if;
  insert into public.subscriptions(workspace_id, plan_key, status, period_start, period_end)
  values (w, 'free', 'active', now(), now() + interval '100 years')
  on conflict (workspace_id) do nothing;
end $$;
revoke all on function private.grant_default_plan(uuid) from public, anon, authenticated;

-- create_workspace_impl, rebuilt from 20260914090000 with the limit check and
-- the billing root. A client workspace's row copies the home row and points
-- at it, so five client workspaces on agency share one agency allowance rather
-- than each carrying a full one. The free grant remains the fallback for a
-- caller with no home row to copy.
create or replace function private.create_workspace_impl(workspace_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare w uuid; home uuid; allowed int; owned int; begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  home := private.owner_plan_workspace(auth.uid());
  if home is not null then
    allowed := private.plan_limit(home,'workspaces');
    select count(*) into owned from public.workspaces where created_by = auth.uid();
    if allowed is not null and owned >= allowed then
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

create or replace function private.bootstrap_personal_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
declare w uuid; begin
  insert into public.workspaces(name,created_by) values('مساحة العمل الشخصية',new.id) returning id into w;
  insert into public.memberships values(w,new.id,'workspace_owner');
  insert into public.clients(workspace_id,name) values(w,'مساحة العمل الشخصية');
  perform private.grant_default_plan(w);
  return new;
end $$;

-- register_channel_impl, rebuilt from 20260913160000 with one change: the
-- channel count spans every workspace billing through the same root, so an
-- agency's ten channels are ten across its clients and not ten per client.
create or replace function private.register_channel_impl(w uuid,c uuid,external text) returns uuid
language plpgsql security definer set search_path='' as $$
declare ch uuid; allowed int; begin
 if not private.has_role(w,array['workspace_owner','analyst']) then raise exception 'forbidden' using errcode='42501'; end if;
 if not exists(select 1 from public.clients where workspace_id=w and id=c) then raise exception 'invalid_client' using errcode='23503'; end if;
 if external !~ '^UC[A-Za-z0-9_-]{22}$' then raise exception 'invalid_channel_id' using errcode='22023'; end if;
 select id into ch from public.channels
 where workspace_id=w and platform='youtube' and external_channel_id=external and client_id=c;
 if ch is not null then return ch; end if;
 allowed := private.plan_limit(w,'channels');
 if allowed is not null
    and (select count(*) from public.channels chan join public.subscriptions sub on sub.workspace_id = chan.workspace_id
         where coalesce(sub.billing_workspace_id, sub.workspace_id) = private.billing_root(w)) >= allowed then
   raise exception 'channel_limit_reached' using errcode='53400'; end if;
 insert into public.channels(workspace_id,client_id,external_channel_id) values(w,c,external)
 on conflict(workspace_id,platform,external_channel_id) do nothing returning id into ch;
 if ch is null then raise exception 'channel_claimed_by_other_client' using errcode='23505'; end if;
 return ch;
end $$;
