-- Update worker liveness tracking, heartbeat seen touch, and prioritize discover jobs

-- 1. Helper to update worker_seen on any worker activity (claim, heartbeat, batch commit)
create or replace function private.touch_worker_seen(token_hash text) returns void
language plpgsql security invoker set search_path='' as $$
declare w uuid; begin
  w := private.worker_workspace(token_hash);
  if w is null then
    insert into public.worker_seen(workspace_id, last_seen_at)
    select ws.id, now() from public.workspaces ws
    on conflict (workspace_id) do update set last_seen_at = now();
  else
    insert into public.worker_seen(workspace_id, last_seen_at)
    values (w, now())
    on conflict (workspace_id) do update set last_seen_at = now();
  end if;
end $$;

-- 2. Update worker_heartbeat to touch worker_seen so long running jobs maintain connected status
create or replace function private.worker_heartbeat(token_hash text, j uuid, t uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  perform private.worker_job(token_hash, j, t);
  perform private.heartbeat(j, t);
  perform private.touch_worker_seen(token_hash);
end $$;

-- 3. Update worker_commit_batch to touch worker_seen
create or replace function private.worker_commit_batch(
  token_hash text, j uuid, t uuid, b text, hash text, payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform private.worker_job(token_hash, j, t);
  perform private.touch_worker_seen(token_hash);
  return private.commit_batch(j, t, b, hash, payload);
end $$;

-- 4. Prioritize discover jobs in claim_job so channel additions complete immediately
create or replace function private.claim_job(w uuid, job_types text[])
returns setof public.jobs
language plpgsql security invoker set search_path='' as $$
declare claimed public.jobs;
begin
  if w is null then
    insert into public.worker_seen(workspace_id, last_seen_at)
    select ws.id, now() from public.workspaces ws
    on conflict (workspace_id) do update set last_seen_at = now();
  else
    insert into public.worker_seen(workspace_id, last_seen_at)
    values (w, now())
    on conflict (workspace_id) do update set last_seen_at = now();
  end if;

  update public.jobs set
      status = 'failed',
      error_code = case
        when reclaims >= 20
          then 'lease_thrashing:' || reclaims::text
        else 'retry_exhausted:' || coalesce(last_error, 'no_error_recorded')
      end,
      lease_token = null,
      lease_expires_at = null
   where (w is null or workspace_id = w)
     and status in ('queued', 'running')
     and (attempt >= 3 or reclaims >= 20)
     and (lease_expires_at is null or lease_expires_at <= now());

  update public.jobs j set
      status = 'running',
      attempt = j.attempt + case when j.status = 'queued' then 1 else 0 end,
      reclaims = j.reclaims + case
        when j.status = 'running' and j.heartbeats > 0 then 1 else 0 end,
      not_before = case
        when j.status = 'running' and j.heartbeats > 0 and j.reclaims >= 1
          then now() + least(interval '30 seconds' * (2 ^ least(j.reclaims, 5)),
                             interval '10 minutes')
        else j.not_before end,
      heartbeats = 0,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '5 minutes'
   where j.id = (
     select q.id from public.jobs q
      where (w is null or q.workspace_id = w)
        and (job_types is null or cardinality(job_types) = 0
             or q.type = any(job_types))
        and q.attempt < 3
        and q.reclaims < 20
        and q.not_before <= now()
        and (q.status = 'queued'
             or (q.status = 'running' and q.lease_expires_at <= now()))
      order by case when q.type = 'discover' then 0 else 1 end, q.not_before, q.id
      for update skip locked limit 1)
  returning j.* into claimed;

  if claimed.id is null then return; end if;

  insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source,
                               status)
  values (claimed.workspace_id, claimed.channel_id, claimed.id,
          case when claimed.type in ('discover','collect','analyse','import')
               then claimed.type else 'collect' end,
          'unknown', 'running')
  on conflict (workspace_id, job_id) do update
    set status = 'running', ended_at = null, error_code = null;

  return next claimed;
end $$;

-- 5. Update workspace_ops_snapshot_impl to check system-wide worker liveness
create or replace function public.workspace_ops_snapshot_impl(w uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  state jsonb;
  plan_summary jsonb;
  top_channels jsonb;
  res jsonb;
begin
  -- Validate caller has access to workspace w
  if not exists (
    select 1 from public.workspace_memberships
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
