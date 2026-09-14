-- A lapsed lease is a recovery, not a failed attempt.
--
-- Observed on production on 2026-09-14, by watching one job across eight
-- samples two minutes apart: it went from attempt 2 to attempt 3 with no error
-- code recorded at any point, and then sat with a dead lease for twenty-five
-- minutes. Three jobs had already been buried that day as `retry_exhausted`,
-- and `sync_runs` held three rows, all successful, all from the day before.
-- Nothing had failed. The work was simply slower than its lease.
--
-- The mechanism, in the two statements this migration replaces:
--
--   * `claim_job` granted a 60-second lease and incremented `attempt` on every
--     claim, including a re-claim of a job whose lease had lapsed.
--   * the worker heartbeats once per batch, immediately before the commit, so
--     the 60 seconds had to cover a channel survey, a YouTube page fetch and a
--     transformer pass over the batch — on one thread, because the deployment
--     notes record that torch fails outright on a shared account otherwise.
--
-- So a job that took longer than a minute between heartbeats was re-claimed,
-- counted as a failure, and after three of those was buried with a code that
-- names a retry policy nobody had exercised.
--
-- Which is the sharper point, and the reason this is a semantic fix and not a
-- tuning change: **`worker_finish` makes a failed job terminal.** `claim_job`
-- only ever selects `queued`, or `running` with a lapsed lease. A failed job is
-- therefore never re-claimed, `attempt` can only ever be incremented by a
-- claim, and `attempt >= 3` is unreachable except through lease lapses. The
-- guard that produced `retry_exhausted` could not, by construction, be counting
-- retries. It was counting thefts and calling them attempts.
--
-- Three changes, which are one change:
--
--   1. `attempt` counts claims of queued work. A re-claim increments `reclaims`
--      instead, because taking over an abandoned lease is recovery.
--   2. The lease is five minutes — an order of magnitude above the slowest
--      plausible batch. A long lease costs delay before recovering from a real
--      crash; a short one costs data, by stealing from a worker that is
--      working. Those prices are not comparable.
--   3. The terminal code carries its cause. `lease_thrashing:<n>` says what
--      happened; `retry_exhausted:<code>` keeps whatever the last worker
--      actually reported, and `:no_error_recorded` where none ever was — which
--      on its own would have identified this bug in a minute rather than a day.

alter table public.jobs
  add column if not exists reclaims integer not null default 0
    check (reclaims >= 0),
  -- What the last worker to report on this job actually said. Null means no
  -- worker ever reported anything, which is itself the finding.
  add column if not exists last_error text;

comment on column public.jobs.reclaims is
  'Times an abandoned lease was taken over. Recovery, not failure.';
comment on column public.jobs.last_error is
  'The last cause a worker reported. Null means none ever did.';

create or replace function private.claim_job(w uuid) returns setof public.jobs
language plpgsql security invoker set search_path='' as $$
begin
  -- Bury what cannot be recovered, saying which of the two it was.
  --
  -- `attempt` is claims of queued work, so reaching the ceiling means the job
  -- was queued and claimed three times without ever being finished. `reclaims`
  -- reaching its ceiling means one job changed hands twenty times — which is
  -- not a slow job, it is a job nothing can hold, and it needs its own name so
  -- that the next person reads the right problem.
  update public.jobs set
      status = 'failed',
      error_code = case
        when reclaims >= 20
          then 'lease_thrashing:' || reclaims::text
        else 'retry_exhausted:' || coalesce(last_error, 'no_error_recorded')
      end,
      lease_token = null,
      lease_expires_at = null
   where workspace_id = w
     and status in ('queued', 'running')
     and (attempt >= 3 or reclaims >= 20)
     and (lease_expires_at is null or lease_expires_at <= now());

  return query
  update public.jobs j set
      status = 'running',
      -- The whole fix, in two lines. Claiming queued work is an attempt at it.
      -- Taking over a lease somebody else dropped is not.
      attempt = j.attempt + case when j.status = 'queued' then 1 else 0 end,
      reclaims = j.reclaims + case when j.status = 'running' then 1 else 0 end,
      lease_token = gen_random_uuid(),
      -- Ten times the slowest batch this worker plausibly runs, rather than a
      -- round number. See the note above on why the two errors cost differently.
      lease_expires_at = now() + interval '5 minutes'
   where j.id = (
     select q.id from public.jobs q
      where q.workspace_id = w
        and q.attempt < 3
        and q.reclaims < 20
        and q.not_before <= now()
        and (q.status = 'queued'
             or (q.status = 'running' and q.lease_expires_at <= now()))
      order by q.not_before, q.id
      for update skip locked limit 1)
  returning j.*;
end $$;

-- What a worker reported, kept where the reaper can still read it later.
-- `worker_finish` already writes the cause into `error_code`; this keeps a copy
-- that a subsequent claim will not overwrite, so the terminal code can name the
-- last real failure instead of replacing it.
--
-- Rebuilt on the version from 20260914070000, not on the original. A
-- `create or replace` is a whole-body rewrite: taking the function as it was
-- first written and adding one line silently reverts every change made to it
-- since. That is what the first draft of this migration did — it dropped the
-- run-closing insert, and two tests in worker_gateway caught it.
create or replace function private.worker_finish(
  token_hash text, j uuid, t uuid, outcome text, reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare w uuid; ch uuid; begin
  perform private.worker_job(token_hash, j, t);
  if outcome not in ('succeeded','partial','failed','blocked','cancelled') then
    raise exception 'invalid_outcome' using errcode='22023'; end if;
  update public.jobs set status = outcome,
    error_code = case when outcome = 'succeeded' then null else reason end,
    last_error = case
      when outcome = 'succeeded' then null
      else coalesce(reason, public.jobs.last_error) end,
    -- Releasing the lease is what makes a finished job unwritable.
    lease_token = null, lease_expires_at = null
  where id = j
  returning workspace_id, channel_id into w, ch;

  insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source,
                               status, ended_at, error_code)
  values (w, ch, j, 'collect', 'unknown', outcome, now(),
          case when outcome = 'succeeded' then null else reason end)
  on conflict (workspace_id, job_id) do update
    set status = excluded.status,
        ended_at = excluded.ended_at,
        error_code = excluded.error_code;
end $$;

grant execute on function private.claim_job(uuid) to service_role;
grant execute on function private.worker_finish(text,uuid,uuid,text,text)
  to service_role;

-- The new columns are readable by the operator alongside the rest of the row.
grant select(reclaims, last_error) on public.jobs to authenticated;
