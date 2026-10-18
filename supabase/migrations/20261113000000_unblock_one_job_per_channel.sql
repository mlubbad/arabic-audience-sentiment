-- unblock_due_jobs requeues at most one blocked job per channel and kind.
--
-- Why: the second update below requeued every due blocked job that had no
-- queued or running sibling. Its `not exists` reads the statement's snapshot,
-- so two due blocks of one channel and kind both pass it, both turn queued,
-- and `jobs_one_outstanding_collect` (or `_discover`) refuses the second with
-- 23505. The refusal rolls back the whole caller: schedule_due_work runs this
-- first, for every workspace, from both the pg_cron `sentiment-tick` and the
-- worker's `tick`. So one such channel stops the scheduler for the platform.
--
-- Measured read-only in production on 2026-10-17:
--  - cron.job_run_details for `sentiment-tick`: 357 consecutive hourly
--    failures with that error from 2026-09-24 10:17 to 2026-10-09 06:17
--    (the day 20260924171000 brought this function in), 62 more
--    to 10-11 20:17, then every run from 10-17 07:17.
--  - The Mac worker logged `tick refused: control_plane_error:23505` on
--    exactly those days and on none of 10-12 to 10-16, when the cron tick
--    succeeded too. The Oracle worker fails the same way. It is the database's
--    state, not two workers racing.
--  - From 10-17 07:00 one channel (7153b08f…) held six blocked collects,
--    written an hour apart under the old quota rule and given one not_before
--    (07:00) by 20261031000000's repair. 207 blocked jobs across the platform
--    were due and none could be requeued.
--
-- Now: of the due blocks of one channel and kind, the newest is requeued and
-- the older ones are cancelled as superseded by it, the same outcome the first
-- update gives a block that already has an active sibling.

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

  -- Unblock due jobs that have no outstanding active job without resetting attempt/reclaims
  update public.jobs j
     set status = 'queued',
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
