-- Fix table name in workspace_ops_snapshot_impl from workspace_memberships to memberships

create or replace function public.workspace_ops_snapshot_impl(w uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  state jsonb;
  plan_summary jsonb;
  top_channels jsonb;
begin
  -- Validate caller has access to workspace w (unless caller is service role)
  if auth.uid() is not null and not exists (
    select 1 from public.memberships
    where workspace_id = w and user_id = auth.uid()
  ) then
    raise exception 'forbidden' using errcode = '42501';
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
                     where j.workspace_id = w and j.status = 'queued'),
    'last_run', (
      select jsonb_build_object(
        'started_at', s.started_at, 'ended_at', s.ended_at, 'status', s.status,
        'source', s.source, 'error_code', s.error_code,
        'coverage', jsonb_build_object(
          'videos_seen', coalesce((s.coverage_summary->>'videos_seen')::int, 0),
          'comments_collected', coalesce((s.coverage_summary->>'comments_collected')::int, 0),
          'complete', coalesce((s.coverage_summary->>'complete')::boolean, false)))
      from public.sync_runs s where s.workspace_id = w and s.mode = 'collect'
      order by s.started_at desc limit 1))
  into state;

  -- Usage summary (plan, budgets, quotas)
  select private.usage_summary_impl(w) into plan_summary;

  -- Active channels and their collection states
  select coalesce(jsonb_agg(c_row), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'channel_id', c.id,
      'title', c.title,
      'handle', c.handle,
      'status', c.status,
      'catalogued_at', c.catalogued_at,
      'selected_videos_count', (
        select count(*) from public.video_selections vs
        where vs.workspace_id = w and vs.channel_id = c.id
      ),
      'due_videos_count', (
        select count(*) from public.video_selections vs
        where vs.workspace_id = w and vs.channel_id = c.id
          and vs.next_check_at <= now()
      )
    ) as c_row
    from public.channels c
    where c.workspace_id = w
    order by c.created_at desc
  ) ch into top_channels;

  return jsonb_build_object(
    'workspace_id', w,
    'state', state,
    'plan', plan_summary,
    'channels', top_channels,
    'cached_at', now()
  );
end $$;
