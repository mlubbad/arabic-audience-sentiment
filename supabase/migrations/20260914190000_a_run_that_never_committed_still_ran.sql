-- A run that never committed a batch still ran.
--
-- The previous migration in this pair made a run survive collecting nothing.
-- This one makes it survive *failing*, which is the case the operations page
-- was silently wrong about.
--
-- `sync_runs` is opened by the first committed batch. A job that dies before it
-- commits anything therefore leaves no row at all — and the panel, having no
-- run for today, shows the most recent run it can find and calls it the last
-- one. On 2026-09-14 that read "آخر تشغيل … اكتمل اجتياز المصدر" from the day
-- before, while three jobs had failed that morning and a fourth was wedged.
-- Every word of it was true and the whole of it was misleading.
--
-- It also made the underlying fault undiagnosable from the product's own
-- screens: the other session reading that same panel concluded the worker
-- process was down and the fix was to restart it, which was the wrong
-- response. Finding what had actually happened took eight samples of the live
-- jobs row two minutes apart — a thing no customer can do.
--
-- So the run opens when the work is claimed. From then on a job is in exactly
-- one of three states the panel can tell apart:
--
--   claimed and still going     run is `running`, lease is live
--   claimed and abandoned       run is `running`, lease has lapsed
--   finished, any outcome       run carries the outcome and an end time
--
-- The second is the one that had no representation, and it is the interesting
-- one: it is what a worker that died, hung, or was taken from mid-batch looks
-- like, and it is now visible without reading the database by hand.

create or replace function private.claim_job(w uuid) returns setof public.jobs
language plpgsql security invoker set search_path='' as $$
declare claimed public.jobs;
begin
  -- Bury what cannot be recovered, saying which of the two it was. `attempt`
  -- counts claims of queued work; `reclaims` counts takeovers of an abandoned
  -- lease. Reaching either ceiling means something different, so each gets its
  -- own name rather than one code standing for both.
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

  update public.jobs j set
      status = 'running',
      attempt = j.attempt + case when j.status = 'queued' then 1 else 0 end,
      reclaims = j.reclaims + case when j.status = 'running' then 1 else 0 end,
      -- Recovery is immediate the first time and then slows down. A worker
      -- that died should be taken over at once; a job being handed round is a
      -- different situation, and re-claiming it as fast as the loop turns
      -- spends the source's quota on a failure that is already decided.
      -- Capped, because an unbounded backoff is a job nobody will look at.
      not_before = case
        when j.status = 'running' and j.reclaims >= 1
          then now() + least(interval '30 seconds' * (2 ^ least(j.reclaims, 5)),
                             interval '10 minutes')
        else j.not_before end,
      lease_token = gen_random_uuid(),
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
  returning j.* into claimed;

  if claimed.id is null then return; end if;

  -- The run opens here, not at the first batch. Source is unknown until a
  -- comment arrives to say which one it came from; `commit_batch` fills it in.
  -- A re-claim keeps the existing row rather than starting a second run for
  -- one job — the unique constraint on (workspace_id, job_id) says a job has
  -- one run, and a takeover continues that run rather than beginning another.
  insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source,
                               status)
  values (claimed.workspace_id, claimed.channel_id, claimed.id, 'collect',
          'unknown', 'running')
  on conflict (workspace_id, job_id) do update
    set status = 'running', ended_at = null, error_code = null;

  return next claimed;
end $$;

grant execute on function private.claim_job(uuid) to service_role;
