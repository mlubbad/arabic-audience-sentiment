-- Migration: 20260922160000_plan_public_channels_access.sql
-- Goal: Control access to "لا أملك القناة" (public channel selection & monitoring).
-- By default, only the platform owner (owner plan & platform admins) has access.
-- The platform administrator can grant access to specific account types (plans)
-- through the admin control panel (/admin/plans).

-- 1. Add allow_public_channels column to public.plans
alter table public.plans
  add column if not exists allow_public_channels boolean not null default false;

-- 2. By default, only 'owner' plan has allow_public_channels = true
update public.plans
   set allow_public_channels = true
 where key = 'owner';

-- 3. Update private.plan_json to include allow_public_channels
create or replace function private.plan_json(p public.plans) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'key', p.key, 'segment', p.segment, 'title_ar', p.title_ar, 'title_en', p.title_en,
    'price_monthly_cents', p.price_monthly_cents, 'price_yearly_cents', p.price_yearly_cents,
    'self_serve', p.self_serve, 'provider_prices', p.provider_prices,
    'allow_public_channels', coalesce(p.allow_public_channels, false),
    'limits', jsonb_build_object(
      'analysis_units', coalesce(p.analysis_units, -1), 'topic_units', coalesce(p.topic_units, -1),
      'insight_reports', p.insight_reports, 'channels', coalesce(p.channels_limit, -1),
      'members', coalesce(p.members_limit, -1), 'workspaces', coalesce(p.workspaces_limit, -1),
      'live_interval_minutes', p.live_interval_minutes));
$$;

-- 4. Admin RPC to toggle allow_public_channels for an account type (plan)
create or replace function public.set_plan_public_channels(p_plan_key text, p_allowed boolean)
returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if not exists (select 1 from public.plans where key = p_plan_key) then
    raise exception 'unknown_plan' using errcode='22023';
  end if;

  update public.plans
     set allow_public_channels = p_allowed
   where key = p_plan_key;

  return jsonb_build_object('ok', true, 'plan_key', p_plan_key, 'allow_public_channels', p_allowed);
end $$;
revoke all on function public.set_plan_public_channels(text, boolean) from public, anon;
grant execute on function public.set_plan_public_channels(text, boolean) to authenticated;
