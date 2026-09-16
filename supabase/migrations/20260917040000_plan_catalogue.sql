-- The pricing page reads this signed out. It never exposes an internal plan,
-- and it is the one place the web app learns prices from — not a copy in code.
create function private.plan_json(p public.plans) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'key', p.key, 'segment', p.segment, 'title_ar', p.title_ar, 'title_en', p.title_en,
    'price_monthly_cents', p.price_monthly_cents, 'price_yearly_cents', p.price_yearly_cents,
    'self_serve', p.self_serve, 'provider_prices', p.provider_prices,
    'limits', jsonb_build_object(
      'analysis_units', coalesce(p.analysis_units, -1), 'topic_units', coalesce(p.topic_units, -1),
      'insight_reports', p.insight_reports, 'channels', coalesce(p.channels_limit, -1),
      'members', coalesce(p.members_limit, -1), 'workspaces', coalesce(p.workspaces_limit, -1),
      'live_interval_minutes', p.live_interval_minutes));
$$;
revoke all on function private.plan_json(public.plans) from public, anon, authenticated;

create function public.plan_catalogue() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(private.plan_json(p) order by p.sort_order), '[]'::jsonb)
  from public.plans p where not p.internal;
$$;
revoke all on function public.plan_catalogue() from public;
grant execute on function public.plan_catalogue() to anon, authenticated;

-- usage_summary_unchecked and usage_summary_impl, rebuilt from 20260917030000
-- with the plan block and the billing fields the brief asks for. The
-- subscription read stays on the ROOT (private.billing_root, 20260917010000)
-- so a client workspace still reads its owner's plan and period, and the
-- budget lines still carry what packs added via the four-arg budget_entry
-- (20260917020000); only the two new fields (the plan row, cancel/interval/
-- provider) are added to the jsonb this returns.
create or replace function private.usage_summary_unchecked(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sub record; pl public.plans; begin
 select s.* into sub from public.subscriptions s where s.workspace_id=private.billing_root(w);
 if not found then return null; end if;
 select * into pl from public.plans where key = sub.plan_key;
 return jsonb_build_object('plan_key',sub.plan_key,'status',sub.status,
 'period_start',to_jsonb(sub.period_start),'period_end',to_jsonb(sub.period_end),
 'cancel_at_period_end', sub.cancel_at_period_end, 'billing_interval', sub.billing_interval, 'provider', sub.provider,
 'plan', private.plan_json(pl),
 'budgets',jsonb_build_array(
 private.budget_entry('comment_analysis',pl.analysis_units,private.used_units(w,'comment_analysis',sub.period_start),private.granted_units(w,'comment_analysis')),
 private.budget_entry('historical_backfill',pl.backfill_units,private.used_units(w,'historical_backfill',sub.period_start),private.granted_units(w,'historical_backfill')),
 private.budget_entry('topic_classification',pl.topic_units,private.used_units(w,'topic_classification',sub.period_start),private.granted_units(w,'topic_classification'))));
end $$;
revoke all on function private.usage_summary_unchecked(uuid) from public, anon, authenticated;

create or replace function private.usage_summary_impl(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role(w) then raise exception 'forbidden' using errcode='42501'; end if;
 return private.usage_summary_unchecked(w);
end $$;
