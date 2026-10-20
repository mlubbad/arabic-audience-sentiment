-- A collect that stands down at its time budget is a yield: it goes back to
-- the queue at once, keeps its checkpoint, and does not use up an attempt.
--
-- Production, 2026-10-19/20 (read-only): the single Oracle worker sat in one
-- collect from 22:39 to 01:54 UTC; that run ended only because a commit hit
-- 57014. 94 refresh discovers, overdue (catalogue interval + 6 h, as
-- 20261116000000 defines it) from 01:16-01:24, waited 31-44 minutes behind it
-- (avg 38), and their candidate-profile pass filled nothing until 01:55.
-- claim_job already puts an overdue discover ahead of every collect, but only
-- at the next claim, and nothing bounded how long a collect held the worker.
--
-- The worker now finishes a collect `partial` with reason `time_budget` after
-- 30 minutes (workers/python/src/server/runner.py, COLLECT_BUDGET_SECONDS),
-- having committed the batch in hand. Under the old worker_finish that run
-- was an ordinary partial: it counted an attempt, so the third yield ended the
-- job `partial retry_exhausted:time_budget`, and it waited a 60-120 s backoff.
--
-- The yield branch applies only when all of these hold, otherwise the old
-- partial path runs unchanged:
--   * the job is a collect or an import (the two kinds the worker's budget
--     covers);
--   * the run heartbeat at least once since its claim. The worker heartbeats
--     before every commit, so a yield without one committed nothing, and a
--     free requeue with no progress could repeat forever.
-- The attempt the claim took is given back (as unblock_due_jobs does for a
-- quota wait), not_before is now, and last_error is left as it was: a yield is
-- not an error. The run is recorded `partial` with `time_budget`, never
-- succeeded. The checkpoint is untouched: it is what the last commit wrote.
-- The requeued collect sorts behind older queued collects (not_before = now),
-- so collects also take turns rather than one channel holding the worker.

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
  j_heartbeats integer;
  blocked_not_before timestamptz;
begin
  perform private.worker_job(token_hash, j, t);
  if outcome not in ('succeeded','partial','failed','blocked','cancelled') then
    raise exception 'invalid_outcome' using errcode='22023'; end if;

  select created_at, attempt, workspace_id, channel_id, type, heartbeats
    into start_time, j_attempt, w, ch, j_type, j_heartbeats
    from public.jobs
   where id = j;
  dur_sec := greatest(1, round(extract(epoch from (now() - coalesce(start_time, now())))))::int;

  -- A collect that stood down at its time budget after committing: back in
  -- the queue now, with its checkpoint and the attempt its claim took.
  if outcome = 'partial' and reason = 'time_budget'
     and j_type in ('collect', 'import') and coalesce(j_heartbeats, 0) > 0 then
    update public.jobs
       set status = 'queued',
           attempt = greatest(attempt - 1, 0),
           not_before = now(),
           lease_token = null,
           lease_expires_at = null,
           error_code = reason,
           counters = jsonb_set(
             coalesce(counters, '{}'::jsonb),
             '{duration_seconds}',
             to_jsonb(dur_sec)
           )
     where id = j;

    insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source,
                                 status, ended_at, error_code)
    values (w, ch, j, 'collect', 'unknown', 'partial', now(), reason)
    on conflict (workspace_id, job_id) do update
      set status = excluded.status,
          ended_at = excluded.ended_at,
          error_code = excluded.error_code;
    return;
  end if;

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
