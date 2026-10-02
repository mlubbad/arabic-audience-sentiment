-- 20260924140000_dynamic_plan_limits_enhancement.sql
-- Enables platform administrators to dynamically adjust any subscription plan limits,
-- supporting both specific numeric values and unlimited (-1) across all tiers.

-- 1. Update private.plan_json to ensure all nullable or unlimited limits consistently serialize -1
create or replace function private.plan_json(p public.plans) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'key', p.key, 'segment', p.segment, 'title_ar', p.title_ar, 'title_en', p.title_en,
    'price_monthly_cents', p.price_monthly_cents, 'price_yearly_cents', p.price_yearly_cents,
    'self_serve', p.self_serve, 'provider_prices', p.provider_prices,
    'allow_public_channels', coalesce(p.allow_public_channels, false),
    'backfill_units', case when p.backfill_units is null or p.backfill_units >= 2147483647 then -1 else p.backfill_units end,
    'historical_days_limit', coalesce(p.historical_days_limit, -1),
    'limits', jsonb_build_object(
      'analysis_units', case when p.analysis_units is null or p.analysis_units >= 2147483647 then -1 else p.analysis_units end,
      'topic_units', case when p.topic_units is null or p.topic_units >= 2147483647 then -1 else p.topic_units end,
      'insight_reports', coalesce(p.insight_reports, 0),
      'channels', case when p.channels_limit is null or p.channels_limit >= 2147483647 then -1 else p.channels_limit end,
      'members', case when p.members_limit is null or p.members_limit >= 2147483647 then -1 else p.members_limit end,
      'workspaces', case when p.workspaces_limit is null or p.workspaces_limit >= 2147483647 then -1 else p.workspaces_limit end,
      'live_interval_minutes', coalesce(p.live_interval_minutes, 0)));
$$;

-- 2. Enhance public.update_plan_limits to dynamically modify all limits, quotas, and permissions
create or replace function public.update_plan_limits(p_plan_key text, p_limits jsonb)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  target_plan public.plans;
  updated_plan public.plans;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select * into target_plan from public.plans where key = p_plan_key;
  if not found then
    raise exception 'unknown_plan' using errcode='22023';
  end if;

  update public.plans
     set backfill_units = case
           when p_limits ? 'backfill_units' then
             case
               when (p_limits->>'backfill_units')::int = -1 then
                 case when target_plan.internal then null else 2147483647 end
               else (p_limits->>'backfill_units')::int
             end
           else backfill_units end,
         historical_days_limit = case
           when p_limits ? 'historical_days_limit' then
             case when (p_limits->>'historical_days_limit')::int = -1 then null else (p_limits->>'historical_days_limit')::int end
           else historical_days_limit end,
         analysis_units = case
           when p_limits ? 'analysis_units' then
             case
               when (p_limits->>'analysis_units')::int = -1 then
                 case when target_plan.internal then null else 2147483647 end
               else (p_limits->>'analysis_units')::int
             end
           else analysis_units end,
         topic_units = case
           when p_limits ? 'topic_units' then
             case
               when (p_limits->>'topic_units')::int = -1 then
                 case when target_plan.internal then null else 2147483647 end
               else (p_limits->>'topic_units')::int
             end
           else topic_units end,
         channels_limit = case
           when p_limits ? 'channels_limit' then
             case
               when (p_limits->>'channels_limit')::int = -1 then
                 case when target_plan.internal then null else 2147483647 end
               else (p_limits->>'channels_limit')::int
             end
           when p_limits ? 'channels' then
             case
               when (p_limits->>'channels')::int = -1 then
                 case when target_plan.internal then null else 2147483647 end
               else (p_limits->>'channels')::int
             end
           else channels_limit end,
         members_limit = case
           when p_limits ? 'members_limit' then
             case
               when (p_limits->>'members_limit')::int = -1 then
                 case when target_plan.internal then null else 2147483647 end
               else (p_limits->>'members_limit')::int
             end
           when p_limits ? 'members' then
             case
               when (p_limits->>'members')::int = -1 then
                 case when target_plan.internal then null else 2147483647 end
               else (p_limits->>'members')::int
             end
           else members_limit end,
         workspaces_limit = case
           when p_limits ? 'workspaces_limit' then
             case
               when (p_limits->>'workspaces_limit')::int = -1 then
                 case when target_plan.internal then null else 2147483647 end
               else (p_limits->>'workspaces_limit')::int
             end
           when p_limits ? 'workspaces' then
             case
               when (p_limits->>'workspaces')::int = -1 then
                 case when target_plan.internal then null else 2147483647 end
               else (p_limits->>'workspaces')::int
             end
           else workspaces_limit end,
         insight_reports = case
           when p_limits ? 'insight_reports' then
             (p_limits->>'insight_reports')::int
           else insight_reports end,
         live_interval_minutes = case
           when p_limits ? 'live_interval_minutes' then
             (p_limits->>'live_interval_minutes')::int
           else live_interval_minutes end,
         allow_public_channels = case
           when p_limits ? 'allow_public_channels' then
             (p_limits->>'allow_public_channels')::boolean
           else allow_public_channels end
   where key = p_plan_key
   returning * into updated_plan;

  return jsonb_build_object(
    'ok', true,
    'plan_key', p_plan_key,
    'plan', private.plan_json(updated_plan)
  );
end $$;

revoke all on function public.update_plan_limits(text, jsonb) from public, anon;
grant execute on function public.update_plan_limits(text, jsonb) to authenticated;
