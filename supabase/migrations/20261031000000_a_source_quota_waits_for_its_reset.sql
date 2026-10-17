-- A job blocked on a quota waits for that quota's reset, and the reset is
-- the right one.
--
-- Why: from 2026-10-14 to 2026-10-16, 16 of the 18 YouTube channels with
-- selected videos collected nothing. The platform's YouTube Data API quota
-- (one Google project behind the reader and every owner grant) reset at
-- 07:00 UTC, midnight Pacific, and was spent by about 08:00 every day, almost
-- all of it on discover jobs re-reading each public channel's whole
-- catalogue. Measured read-only in production, 2026-10-14 00:00 → 10-16
-- 21:36 UTC: 7,072 collect and 6,075 discover attempts ended blocked
-- `quota_exceeded`, about one per channel and kind every hour, across 115
-- channels; the only successes were discovers between 07:00 and 08:30.
--
-- Three things made that so, and this file changes all three:
--
--  1. worker_finish sent every quota block to the workspace's billing
--     period end (2026-11-05 here). That is the reset of the plan's units,
--     not of the source's daily quota, which resets at midnight Pacific.
--  2. Nothing honoured it. enqueue_scheduled backed a channel off for 60
--     minutes after a bad job and then queued a fresh one; unblock_due_jobs
--     cancelled the blocked job as superseded (16,110 such cancellations).
--     So a quota block was retried hourly whatever its not_before said.
--  3. claim_job handed out every discover before any collect, so at the
--     reset the re-catalogues took the quota first.
--
-- Now: a quota block waits for the plan's period end only when the plan's
-- units are spent, and otherwise for the next midnight Pacific; a channel
-- whose latest job of a kind is blocked until a known time gets no new job
-- of that kind before then (unblock_due_jobs requeues the same job when it
-- is due); and a refresh discover of an already catalogued channel is
-- claimed after collects. A first discover still goes first: an
-- uncatalogued channel has nothing to collect without it.

-- The next reset of a Google API daily quota: midnight in America/Los_Angeles,
-- with its daylight-saving changes.
create or replace function private.source_quota_resets_at() returns timestamptz
language sql stable set search_path='' as $$
  select (date_trunc('day', now() at time zone 'America/Los_Angeles') + interval '1 day')
         at time zone 'America/Los_Angeles'
$$;
revoke all on function private.source_quota_resets_at() from public, anon, authenticated;
grant execute on function private.source_quota_resets_at() to service_role;

-- When a job blocked for `reason` may run again, or NULL when the block is not
-- time-based (plan_inactive, source_access_denied, channel_not_connected, …).
-- A quota refusal is the plan's only when the plan's units for this kind of
-- work are spent; anything else that says quota is the source's.
create or replace function private.blocked_until(w uuid, kind text, reason text)
returns timestamptz
language plpgsql stable security invoker set search_path='' as $$
declare
  remaining bigint;
  plan_reset timestamptz;
begin
  if reason = 'rate_limited' then
    return now() + interval '1 hour';
  end if;
  if reason is null or reason not ilike '%quota%' then
    return null;
  end if;

  begin
    remaining := case when kind = 'analyse' then private.topic_units_remaining(w)
                      else private.analysis_remaining(w) end;
  exception when sqlstate '53400' then
    -- no_active_plan: there are no plan units to have spent.
    remaining := null;
  end;

  if remaining is not null and remaining <= 0 then
    select s.period_end into plan_reset
      from public.subscriptions s
     where s.workspace_id = private.billing_root(w);
    if plan_reset is not null and plan_reset > now()
       and plan_reset <= now() + interval '366 days' then
      return plan_reset;
    end if;
  end if;

  return private.source_quota_resets_at();
end $$;
revoke all on function private.blocked_until(uuid, text, text) from public, anon, authenticated;
grant execute on function private.blocked_until(uuid, text, text) to service_role;

-- worker_finish, as 20261001010000 left it, with the blocked not_before
-- taken from blocked_until.
create or replace function private.worker_finish(
  token_hash text, j uuid, t uuid, outcome text, reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare
  w uuid;
  ch uuid;
  j_type text;
  start_time timestamptz;
  dur_sec integer;
  j_attempt integer;
  backoff_seconds integer;
  blocked_not_before timestamptz;
begin
  perform private.worker_job(token_hash, j, t);
  if outcome not in ('succeeded','partial','failed','blocked','cancelled') then
    raise exception 'invalid_outcome' using errcode='22023'; end if;

  select created_at, attempt, workspace_id, channel_id, type
    into start_time, j_attempt, w, ch, j_type
    from public.jobs
   where id = j;
  dur_sec := greatest(1, round(extract(epoch from (now() - coalesce(start_time, now())))))::int;

  -- Exponential backoff retry lifecycle for transient failures on attempts 1 and 2
  if outcome in ('failed', 'partial') and coalesce(j_attempt, 1) < 3 then
    backoff_seconds := least(30 * (2 ^ coalesce(j_attempt, 1)), 600);

    update public.jobs
       set status = 'queued',
           not_before = now() + (backoff_seconds || ' seconds')::interval,
           lease_token = null,
           lease_expires_at = null,
           error_code = reason,
           last_error = coalesce(reason, public.jobs.last_error),
           counters = jsonb_set(
             coalesce(counters, '{}'::jsonb),
             '{duration_seconds}',
             to_jsonb(dur_sec)
           )
     where id = j;

    insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source,
                                 status, ended_at, error_code)
    values (w, ch, j, 'collect', 'unknown', outcome, now(), reason)
    on conflict (workspace_id, job_id) do update
      set status = excluded.status,
          ended_at = excluded.ended_at,
          error_code = excluded.error_code;
    return;
  end if;

  if outcome = 'blocked' then
    blocked_not_before := private.blocked_until(w, j_type, reason);
  end if;

  update public.jobs set status = outcome,
    error_code = case
      when outcome = 'succeeded' then null
      when outcome in ('failed', 'partial') and coalesce(j_attempt, 1) >= 3 then 'retry_exhausted:' || coalesce(reason, 'unknown')
      else reason
    end,
    last_error = case
      when outcome = 'succeeded' then null
      when outcome in ('failed', 'partial') and coalesce(j_attempt, 1) >= 3 then 'retry_exhausted:' || coalesce(reason, 'unknown')
      else coalesce(reason, public.jobs.last_error)
    end,
    not_before = case
      when outcome = 'blocked' then blocked_not_before
      else public.jobs.not_before
    end,
    counters = jsonb_set(
      coalesce(counters, '{}'::jsonb),
      '{duration_seconds}',
      to_jsonb(dur_sec)
    ),
    lease_token = null, lease_expires_at = null
  where id = j;

  insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source,
                               status, ended_at, error_code)
  values (w, ch, j, 'collect', 'unknown', outcome, now(),
          case
            when outcome = 'succeeded' then null
            when outcome in ('failed', 'partial') and coalesce(j_attempt, 1) >= 3 then 'retry_exhausted:' || coalesce(reason, 'unknown')
            else reason
          end)
  on conflict (workspace_id, job_id) do update
    set status = excluded.status,
        ended_at = excluded.ended_at,
        error_code = excluded.error_code;
end $$;
grant execute on function private.worker_finish(text, uuid, uuid, text, text) to service_role;

-- enqueue_scheduled, as 20260915140000 left it, with one addition: the
-- channel's latest job of this kind, blocked until a known time, holds the
-- kind until then.
create or replace function private.enqueue_scheduled(w uuid, c uuid, kind text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare j uuid; gap int; latest public.jobs; begin
  if exists(select 1 from public.jobs where workspace_id=w and channel_id=c and type=kind
             and status in ('queued','running')) then return null; end if;
  select * into latest from public.jobs
   where workspace_id=w and channel_id=c and type=kind
   order by created_at desc limit 1;
  -- Blocked until a reset: unblock_due_jobs requeues this same job then. A
  -- fresh job before it would only ask the source the question it has
  -- already answered, and spend quota to hear it.
  if latest.status = 'blocked' and latest.not_before > now() then
    return null; end if;
  -- A job of this kind that just ended badly is not tried again for an hour,
  -- whatever the plan's rate limit says: on a plan with no rate limit the
  -- idle tick re-enqueued a failing collection every time it ran. Measured
  -- from the run's end where one was recorded, else from the job's creation.
  if latest.id is not null
     and latest.status in ('failed','blocked','partial','cancelled')
     and coalesce((select r.ended_at from public.sync_runs r
                    where r.workspace_id = w and r.job_id = latest.id),
                  latest.created_at) > now() - interval '60 minutes' then
    return null; end if;
  gap := private.plan_limit(w, 'sync_interval');
  if gap is not null and gap > 0 and exists(
       select 1 from public.jobs where workspace_id=w and channel_id=c and type=kind
         and created_at > now() - make_interval(mins => gap)) then return null; end if;
  begin
    insert into public.jobs(workspace_id, channel_id, type, dedupe_key)
    values (w, c, kind, kind || '-' || gen_random_uuid()::text) returning id into j;
  exception when unique_violation then return null;
  end;
  return j;
end $$;

-- claim_job, as 20260920120000 left it, with one change to the order: a
-- refresh discover (the channel is already catalogued) comes after collects
-- and analyses. Re-reading 107 catalogues spent the day's YouTube quota
-- before any comment was read.
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
          when q.type <> 'discover' then 1
          when exists (select 1 from public.channels ch
                        where ch.id = q.channel_id and ch.catalogued_at is not null)
            then 2
          else 0
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

-- The blocks already written under the old rule. Without this the new hold
-- would keep every channel blocked on the source's quota until its billing
-- period ends (2026-11-05 for most of production).
update public.jobs j
   set not_before = private.blocked_until(j.workspace_id, j.type, j.error_code)
 where j.status = 'blocked'
   and (j.error_code ilike '%quota%' or j.error_code = 'rate_limited');
