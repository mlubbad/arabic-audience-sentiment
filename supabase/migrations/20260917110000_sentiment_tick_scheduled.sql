-- The worker's own idle-loop tick() has been the only thing calling
-- private.schedule_all() so far, and only while a worker process happens to be
-- up. This is the pg_cron schedule that 20260915132000 left as a comment
-- (`select cron.schedule('sentiment-tick', '17 * * * *', ...)`) rather than
-- code: scheduling due work no longer depends on a worker being alive to ask
-- for it.
--
-- 17 minutes past the hour, not the hour itself, for the same reason
-- 20260914100000's two retention jobs are staggered off :00 — every scheduler
-- in the world fires on the hour, and this project already has jobs there.
--
-- Skipped where pg_cron does not exist (every PGlite test database): the test
-- suite proves what schedule_all does, not that anything calls it on a
-- schedule, so this is verified against the deployed project instead.
do $$ begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
  then
    raise notice 'pg_cron unavailable here; the sentiment tick is not scheduled';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  -- Unscheduled first so this migration is safe to run twice and so the
  -- schedule is whatever the latest migration says, not an accumulation.
  perform cron.unschedule(jobid) from cron.job where jobname = 'sentiment-tick';
  perform cron.schedule(
    'sentiment-tick', '17 * * * *',
    $job$select private.schedule_all()$job$);
end $$;
