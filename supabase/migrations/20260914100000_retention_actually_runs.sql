-- Two retention routines were written, tested, revoked from tenants, granted to
-- service_role — and never called by anything. The comment text this product
-- stores was written by people who are not the customer, and keeping it
-- indefinitely is not a defensible default just because the function that
-- deletes it exists somewhere.
--
-- Scheduled inside the database rather than from a host. The alternative was a
-- machine holding the service key and a crontab, which puts the key on a shared
-- box to run two statements a day. pg_cron keeps both where they already are.
--
-- The times are staggered and off the hour: two jobs firing together on a
-- shared instance is a self-inflicted spike, and every scheduler in the world
-- fires at :00.
-- Skipped where pg_cron does not exist, which is every test database: PGlite
-- has no such extension, and failing here would take the whole schema down with
-- it. The consequence is stated rather than hidden — the test suite proves what
-- the retention functions do and cannot prove that anything calls them, so this
-- schedule is verified against the deployed project instead.
do $$ begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
  then
    raise notice 'pg_cron unavailable here; retention is not scheduled';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  -- Unscheduled first so this migration is safe to run twice and so the
  -- schedule is whatever the latest migration says, not an accumulation.
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('purge-comment-text', 'prune-oauth-states');

  -- Comment text older than the retention window. The row, its labels and its
  -- coverage stay: what a purge removes is the text, and the dashboard already
  -- distinguishes "no text" from "text deleted under the retention rule".
  perform cron.schedule(
    'purge-comment-text', '17 3 * * *',
    $job$select private.purge_comment_text()$job$);

  -- Half-finished OAuth handshakes. A state nobody completed in a week is not
  -- going to be completed, and it is a credential-shaped row until it is gone.
  perform cron.schedule(
    'prune-oauth-states', '43 4 * * *',
    $job$select private.prune_oauth_states()$job$);
end $$;
