-- Multi-tenant fair scheduling for claim_job.
--
-- When a platform worker polls without a specific workspace (w is null),
-- ordering purely by not_before lets an active tenant with many queued jobs
-- monopolize the worker and starve other tenants who just queued a job.
--
-- Interleaving ensures fairness:
-- 1. Discover jobs (urgent channel discovery / onboarding) remain top priority.
-- 2. Workspaces with fewer actively running jobs are prioritized over workspaces
--    that already have running jobs.
-- 3. Older due times (not_before) break ties within the same running count.
-- 4. Single-tenant claims (w is not null) preserve identical semantics.

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
      order by
        case when q.type = 'discover' then 0 else 1 end,
        case when w is null then (
          select count(*) from public.jobs r
           where r.workspace_id = q.workspace_id
             and r.status = 'running'
             and r.lease_expires_at > now()
        ) else 0 end,
        q.not_before,
        q.id
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

grant execute on function private.claim_job(uuid, text[]) to service_role;
