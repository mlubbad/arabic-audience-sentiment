-- Health inspection RPC for the Platform Administrator.
-- Returns telemetry, health indicators, database storage, worker status,
-- and sync/quota statistics for system services.

create function public.admin_services_health() returns jsonb
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
  select count(*) into v_yt_runs_24h from public.sync_runs where started_at >= now() - interval '24 hours' and source = 'youtube';

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
    )
  ) into report;

  return report;
end $$;

revoke all on function public.admin_services_health() from public, anon;
grant execute on function public.admin_services_health() to authenticated;
