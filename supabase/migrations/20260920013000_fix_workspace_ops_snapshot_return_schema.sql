-- Fix workspace_ops_snapshot_impl return schema and worker liveness check

create or replace function private.workspace_ops_snapshot_impl(w uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  state jsonb;
  plan_summary jsonb;
  video_counts jsonb;
begin
  if auth.role() <> 'service_role' and not private.has_role(w) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  -- Collection health and worker status
  select jsonb_build_object(
    'worker', jsonb_build_object(
      'connected', coalesce(
        (select s.last_seen_at > now() - interval '3 minutes'
           from public.worker_seen s
          where s.workspace_id = w),
        (select max(s.last_seen_at) > now() - interval '3 minutes'
           from public.worker_seen s),
        (select count(*) > 0
           from public.jobs
          where status = 'running' and lease_expires_at > now()),
        false),
      'last_heartbeat_at', coalesce(
        (select s.last_seen_at from public.worker_seen s
          where s.workspace_id = w),
        (select max(s.last_seen_at) from public.worker_seen s),
        (select max(lease_expires_at) - interval '5 minutes'
           from public.jobs
          where status = 'running' and lease_expires_at > now())),
      'busy', coalesce((select count(*) > 0 from public.jobs j
                         where j.workspace_id = w
                           and j.status = 'running'
                           and j.lease_expires_at > now()), false)),
    'queued_jobs', (select count(*) from public.jobs j
                     where j.workspace_id=w and j.status='queued'),
    'last_run', (
      select jsonb_build_object(
        'started_at', s.started_at, 'ended_at', s.ended_at, 'status', s.status,
        'source', s.source, 'error_code', s.error_code,
        'coverage', jsonb_build_object(
          'videos_seen', coalesce((s.coverage_summary->>'videos_seen')::int, 0),
          'comments_collected', coalesce((s.coverage_summary->>'comments_collected')::int, 0),
          'complete', coalesce((s.coverage_summary->>'complete')::boolean, false)))
      from public.sync_runs s where s.workspace_id=w and s.mode = 'collect'
      order by s.started_at desc limit 1))
  into state;

  -- Usage summary (plan, budgets, quotas)
  select private.usage_summary_impl(w) into plan_summary;

  -- Stored comments count per video, directly aggregated from comments index
  select coalesce(json_agg(json_build_object('id', v.id::text, 'total', coalesce(c.total, 0))), '[]'::json)::jsonb
  into video_counts
  from public.videos v
  left join (
    select video_id, count(*)::int as total
    from public.comments
    where workspace_id = w
    group by video_id
  ) c on c.video_id = v.id
  where v.workspace_id = w;

  return jsonb_build_object(
    'sync', state,
    'plan', plan_summary,
    'video_counts', video_counts
  );
end $$;

drop function if exists public.workspace_ops_snapshot_impl(uuid);

create or replace function public.workspace_ops_snapshot(w uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.workspace_ops_snapshot_impl(w);
$$;

revoke all on function private.workspace_ops_snapshot_impl(uuid), public.workspace_ops_snapshot(uuid) from public;
grant execute on function private.workspace_ops_snapshot_impl(uuid) to authenticated, service_role;
grant execute on function public.workspace_ops_snapshot(uuid) to authenticated, service_role;
