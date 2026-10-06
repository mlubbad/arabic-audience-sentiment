-- Derive platform and billing health from records already held by the database.

create or replace function public.admin_services_health() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  report jsonb;
  v_worker_last_seen timestamptz;
  v_worker_fresh boolean;
  v_db_size_mb bigint;
  v_active_conn int;
  v_jobs_queued int;
  v_jobs_running int;
  v_sync_24h int;
  v_failed_24h int;
  v_yt_runs_24h int;
  v_active_subs int;
  v_platforms jsonb;
  v_billing_webhooks jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select max(last_seen_at) into v_worker_last_seen from public.worker_seen;
  v_worker_fresh := coalesce(v_worker_last_seen >= now() - interval '3 minutes', false);

  select coalesce(round(pg_database_size(current_database()) / (1024 * 1024)), 0) into v_db_size_mb;
  select count(*) into v_active_conn from pg_stat_activity where datname = current_database();

  select count(*) into v_jobs_queued from public.jobs where status = 'queued';
  select count(*) into v_jobs_running from public.jobs where status = 'running';

  select count(*) into v_sync_24h from public.sync_runs where started_at >= now() - interval '24 hours';
  select count(*) into v_failed_24h from public.sync_runs where started_at >= now() - interval '24 hours' and status in ('failed', 'partial');
  select count(*) into v_yt_runs_24h
  from public.sync_runs sr
  join public.channels c
    on c.workspace_id = sr.workspace_id and c.id = sr.channel_id
  where sr.started_at >= now() - interval '24 hours'
    and c.platform = 'youtube';

  with platform_names(platform) as (
    values ('youtube'::text), ('telegram'::text), ('x'::text), ('tiktok'::text)
  ), eligible as materialized (
    select sr.id, c.platform, sr.status, sr.started_at, sr.ended_at, sr.error_code
    from public.sync_runs sr
    join public.channels c
      on c.workspace_id = sr.workspace_id and c.id = sr.channel_id
    where sr.mode in ('discover', 'collect')
      and sr.status <> 'running'
      and sr.started_at >= now() - interval '7 days'
      and c.platform in ('youtube', 'telegram', 'x', 'tiktok')
  ), platform_health as (
    select p.platform, jsonb_build_object(
      'last_status', (
        select e.status from eligible e where e.platform = p.platform
        order by e.ended_at desc, e.started_at desc, e.id desc limit 1
      ),
      'last_finished_at', (
        select e.ended_at from eligible e where e.platform = p.platform
        order by e.ended_at desc, e.started_at desc, e.id desc limit 1
      ),
      'last_success_at', (
        select max(e.ended_at) from eligible e
        where e.platform = p.platform and e.status = 'succeeded'
      ),
      'last_failure_at', (
        select e.ended_at from eligible e
        where e.platform = p.platform and e.status in ('failed', 'blocked')
        order by e.ended_at desc, e.started_at desc, e.id desc limit 1
      ),
      'last_error_code', (
        select e.error_code from eligible e
        where e.platform = p.platform and e.status in ('failed', 'blocked')
        order by e.ended_at desc, e.started_at desc, e.id desc limit 1
      ),
      'runs_24h', (
        select count(*) from eligible e
        where e.platform = p.platform and e.started_at >= now() - interval '24 hours'
      ),
      'failures_24h', (
        select count(*) from eligible e
        where e.platform = p.platform
          and e.started_at >= now() - interval '24 hours'
          and e.status in ('failed', 'blocked', 'partial')
      ),
      'consecutive_failures', least(10, (
        select count(*) from eligible e
        where e.platform = p.platform
          and e.status in ('failed', 'blocked')
          and e.started_at > coalesce((
            select max(s.started_at) from eligible s
            where s.platform = p.platform and s.status = 'succeeded'
          ), '-infinity'::timestamptz)
      ))
    ) as health
    from platform_names p
  )
  select jsonb_object_agg(platform, health) into v_platforms from platform_health;

  select jsonb_build_object(
    'last_received_at', max(be.applied_at),
    'last_outcome', (
      select latest.outcome from private.billing_events latest
      order by latest.applied_at desc, latest.event_id desc limit 1
    ),
    'received_24h', count(*) filter (where be.applied_at >= now() - interval '24 hours'),
    'problems_7d', count(*) filter (
      where be.applied_at >= now() - interval '7 days'
        and be.outcome in ('unmapped', 'conflict')
    )
  ) into v_billing_webhooks
  from private.billing_events be;

  select count(*) into v_active_subs from public.subscriptions where status in ('active', 'trialing');

  select jsonb_build_object(
    'checked_at', to_jsonb(now()),
    'database', jsonb_build_object(
      'status', 'healthy',
      'size_mb', v_db_size_mb,
      'active_connections', v_active_conn,
      'rls_enforced', true
    ),
    'worker', jsonb_build_object(
      'fresh', v_worker_fresh,
      'last_seen_at', to_jsonb(v_worker_last_seen),
      'jobs_queued', v_jobs_queued,
      'jobs_running', v_jobs_running
    ),
    'sync_24h', jsonb_build_object(
      'total_runs', v_sync_24h,
      'failed_runs', v_failed_24h,
      'youtube_runs', v_yt_runs_24h
    ),
    'billing', jsonb_build_object(
      'active_subscriptions', v_active_subs
    ),
    'platforms', v_platforms,
    'billing_webhooks', v_billing_webhooks
  ) into report;

  return report;
end $$;

revoke all on function public.admin_services_health() from public, anon;
grant execute on function public.admin_services_health() to authenticated;
