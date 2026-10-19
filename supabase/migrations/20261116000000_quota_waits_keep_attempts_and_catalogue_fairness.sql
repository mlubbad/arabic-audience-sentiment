-- A quota wait does not use up a job's attempts, and a refresh discover is
-- overdue by its channel's catalogue age, not by the age of the job.
--
-- Production, 2026-10-19 (read-only), at the 07:00 UTC YouTube quota reset:
-- 94 discovers and 2 collects went `failed retry_exhausted:quota_exceeded` at
-- 07:01:03, all at once. Each had waited for three resets: claim_job adds an
-- attempt on every claim from queued, unblock_due_jobs requeued the same job,
-- and on the fourth claim claim_job's first update failed it for attempt >= 3
-- without running it. The scheduler then created new discovers (07:01-07:17),
-- and 20261115000000's rule (the job created more than 6 hours ago) counted
-- them as young, so they waited behind ~110 collects again. 92 queued collects
-- were at attempt 2 with last_error quota_exceeded: one real failure from
-- exhaustion.
--
-- 1. unblock_due_jobs gives back the attempt the blocked run took when it
--    requeues the job. It requeues only blocks with a not_before, and
--    blocked_until gives one only for a known reset (a source quota, a plan
--    period end, rate_limited), so every requeue is a wait. claim_job and
--    worker_finish are unchanged, and a job still fails after three runs that
--    failed. This was chosen over counting attempts in worker_finish, which
--    would change claim_job, worker_finish and the lease-recovery paths at
--    once.
-- 2. The jobs failed this way are not requeued: each of the 96 already has a
--    queued, running or blocked successor for its channel and kind (measured
--    96 of 96), and requeuing would collide with jobs_one_outstanding_*. A
--    collect loses no data that way (commits are idempotent and the due list
--    skips exhausted videos). The attempts the waits already spent are given
--    back below.
-- 3. A refresh discover is overdue when its channel's catalogue is older than
--    the plan's catalogue_interval plus 6 hours of grace (12 hours on the
--    360-minute interval 113 of 121 subscriptions have; 30 on 1440). The grace
--    keeps the bound 20261115000000 argued: a channel is promoted at most once
--    per interval + grace, about twice a day, at about 4 quota units a refresh
--    since #143. Order unchanged otherwise: first discover, overdue refresh
--    discover, collect and analyse, other refresh discover; not_before and the
--    status filter still hold a quota-blocked discover back.

-- The plan's catalogue interval, as schedule_due_work reads it (1440 minutes
-- when the plan sets none), without plan_limit's no_active_plan exception: a
-- claim must not fail because one workspace in the queue has no plan.
create or replace function private.catalogue_interval_or_default(w uuid)
returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select pl.catalogue_interval_minutes
       from public.subscriptions s
       join public.plans pl on pl.key = s.plan_key
      where s.workspace_id = private.billing_root(w)
        and s.status in ('active', 'past_due')),
    1440)
$$;
revoke all on function private.catalogue_interval_or_default(uuid) from public, anon, authenticated;
grant execute on function private.catalogue_interval_or_default(uuid) to service_role;

-- 1. A quota wait gives its attempt back ---------------------------------------

create or replace function private.unblock_due_jobs() returns integer
language plpgsql security definer set search_path='' as $$
declare count int := 0; begin
  -- Cancel any blocked job that is already superseded by an active queued/running job
  update public.jobs b
     set status = 'cancelled',
         error_code = 'superseded_by_active_job'
   where b.status = 'blocked'
     and exists (
       select 1 from public.jobs a
        where a.workspace_id = b.workspace_id
          and a.channel_id = b.channel_id
          and a.type = b.type
          and a.status in ('queued', 'running')
          and a.id <> b.id
     );

  -- Of several due blocks of one channel and kind, only the newest comes back
  -- (the update below); the rest are superseded by it. Without this the update
  -- below requeues them all at once and the one-outstanding index refuses it.
  update public.jobs b
     set status = 'cancelled',
         error_code = 'superseded_by_active_job'
   where b.status = 'blocked'
     and b.not_before is not null
     and b.not_before <= now()
     and exists (
       select 1 from public.jobs n
        where n.workspace_id = b.workspace_id
          and n.channel_id = b.channel_id
          and n.type = b.type
          and n.status = 'blocked'
          and n.not_before is not null
          and n.not_before <= now()
          and (n.created_at, n.id) > (b.created_at, b.id)
     );

  -- Unblock due jobs that have no outstanding active job. The run that ended in
  -- this block was counted as an attempt when it was claimed; a wait for a
  -- known reset is not a failure, so that one attempt is given back. Real
  -- failures keep counting (20261001010000 stopped resetting attempts here
  -- for that reason; this gives back one, never resets).
  update public.jobs j
     set status = 'queued',
         attempt = greatest(j.attempt - 1, 0),
         error_code = null,
         lease_token = null,
         lease_expires_at = null,
         not_before = now()
   where j.status = 'blocked'
     and j.not_before is not null
     and j.not_before <= now()
     and not exists (
       select 1 from public.jobs a
        where a.workspace_id = j.workspace_id
          and a.channel_id = j.channel_id
          and a.type = j.type
          and a.status in ('queued', 'running')
          and a.id <> j.id
     );
  get diagnostics count = row_count;
  return count;
end $$;
revoke all on function private.unblock_due_jobs() from public, anon, authenticated;
grant execute on function private.unblock_due_jobs() to service_role;

-- The attempts quota waits already took. A queued or blocked job whose last
-- recorded error is a wait (quota or rate limit) is set to attempt 0. That
-- can forgive a real failure from before that wait, at most two runs' worth,
-- once; the alternative leaves 92 collects one failure from exhaustion.
-- Idempotent: a second run finds them at 0.
update public.jobs
   set attempt = 0
 where status in ('queued', 'blocked')
   and attempt > 0
   and (last_error ilike '%quota%' or last_error = 'rate_limited');

-- 3. Fairness by the channel's catalogue age -----------------------------------

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
        case
          when q.type = 'discover' and not exists (
                 select 1 from public.channels ch
                  where ch.id = q.channel_id and ch.catalogued_at is not null)
            then 0
          when q.type = 'discover' and (
                 select ch.catalogued_at from public.channels ch where ch.id = q.channel_id)
               <= now() - make_interval(mins => private.catalogue_interval_or_default(q.workspace_id))
                        - interval '6 hours'
            then 1
          when q.type <> 'discover' then 2
          else 3
        end,
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
