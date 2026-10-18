-- Per-video comment counts are recounted in the background, and two refusals
-- stop being serialization failures.
--
-- 1. Counts. 20261003120000's statement triggers recounted a whole video inside
--    every write that touched it: commit_batch paid for it twice per batch
--    (after the comments insert and after the predictions insert), each time
--    counting every comment of the video with an EXISTS on its predictions.
--    Measured read-only in production on 2026-10-18, one recount takes 36.1 s
--    and 14.1 s on the two ~97.5k-comment videos and 2.2-5.4 s on the ~20k
--    ones (62 videos are over 5k). Every gateway RPC has 8 s (the
--    authenticator role's statement_timeout), so from 15:10 to 20:40 UTC 52 of
--    463 commit_batch calls ended in 57014, and a batch on the largest videos
--    could never commit at all.
--
--    Now the triggers only mark the video in `private.video_comment_stats_dirty`
--    (a statement trigger, one row per video per statement, no unique key, so a
--    writer never waits on a recount), and `private.drain_video_comment_stats()`
--    recounts marked videos every minute, oldest mark first, with the same
--    `private.refresh_video_comment_stats` the triggers called, so the numbers
--    are the ones the inline recount gave. The nightly reconcile
--    (20261004010000 / 20261025000000) stays as the safety net.
--
--    Staleness: a change shows in `private.video_comment_stats` after the next
--    drain run that reaches its video, normally within a minute plus the run's
--    own time (a run stops starting new videos after 30 s). Every reader is a
--    display or an estimate: workspace_ops_snapshot (per-video and catalogue
--    totals), admin_channels, admin_channels_console, admin_console_overview,
--    build_admin_digest, and select_videos_impl's cost estimate (reported count
--    minus stored count, which a lagging stored count can only overstate). None
--    acts on a count the same transaction wrote. A video with no stats row yet
--    reads as it always has (no row); the drain creates the row, it never
--    writes 0 for a count it has not computed.
--
-- 2. Refusals. `lease_lost` (commit_batch, commit_checkpoint, heartbeat,
--    worker_job) and `stale_comment_text` (submit_comment_review_impl,
--    submit_topic_review_impl) were raised as SQLSTATE 40001,
--    serialization_failure. PostgREST treats 40001 as transient and retries
--    the transaction, so a deterministic refusal is retried for ever. In
--    production on 2026-10-18 that was about 1,550 rolled-back transactions a
--    second, on ten pool connections looping since 10-13..10-16. Both are now
--    P0001, which PostgREST answers once. The messages are unchanged, and the
--    worker gateway (worker-gateway.ts refusalCode) and the web app
--    (ReviewDialog) read the message, not the SQLSTATE.

-- 1. Counts -------------------------------------------------------------------

create table private.video_comment_stats_dirty (
  workspace_id uuid not null,
  video_id uuid not null,
  marked_at timestamptz not null default now()
);
-- No foreign key: a mark for a video deleted in the same statement must not
-- fail the delete. The drain clears marks whose video is gone.
create index video_comment_stats_dirty_video
  on private.video_comment_stats_dirty(workspace_id, video_id);
create index video_comment_stats_dirty_marked
  on private.video_comment_stats_dirty(marked_at);

alter table private.video_comment_stats_dirty enable row level security;
revoke all on table private.video_comment_stats_dirty from public, anon, authenticated;

-- The trigger functions keep their names, so the five triggers of
-- 20261003120000 now mark instead of recounting. A workspace being deleted is
-- skipped, as refresh_video_comment_stats skipped it: its stats go with it.
create or replace function private.refresh_video_comment_stats_after_comment_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.video_comment_stats_dirty(workspace_id, video_id)
  select distinct n.workspace_id, n.video_id
    from new_comments n
   where n.workspace_id::text is distinct from
         nullif(current_setting('app.deleting_workspace', true), '');
  return null;
end;
$$;

create or replace function private.refresh_video_comment_stats_after_comment_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.video_comment_stats_dirty(workspace_id, video_id)
  select distinct o.workspace_id, o.video_id
    from old_comments o
   where o.workspace_id::text is distinct from
         nullif(current_setting('app.deleting_workspace', true), '');
  return null;
end;
$$;

create or replace function private.refresh_video_comment_stats_after_prediction_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.video_comment_stats_dirty(workspace_id, video_id)
  select distinct p.workspace_id, c.video_id
    from new_predictions p
    join public.comments c
      on c.workspace_id = p.workspace_id
     and c.id = p.comment_id
   where p.workspace_id::text is distinct from
         nullif(current_setting('app.deleting_workspace', true), '');
  return null;
end;
$$;

-- Only a status change can move `analysed`, as before.
create or replace function private.refresh_video_comment_stats_after_prediction_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.video_comment_stats_dirty(workspace_id, video_id)
  select distinct c.workspace_id, c.video_id
    from old_predictions old_p
    join new_predictions new_p on new_p.id = old_p.id
    join public.comments c
      on c.workspace_id = new_p.workspace_id
     and c.id = new_p.comment_id
   where old_p.status is distinct from new_p.status
     and new_p.workspace_id::text is distinct from
         nullif(current_setting('app.deleting_workspace', true), '');
  return null;
end;
$$;

create or replace function private.refresh_video_comment_stats_after_prediction_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.video_comment_stats_dirty(workspace_id, video_id)
  select distinct p.workspace_id, c.video_id
    from old_predictions p
    join public.comments c
      on c.workspace_id = p.workspace_id
     and c.id = p.comment_id
   where p.workspace_id::text is distinct from
         nullif(current_setting('app.deleting_workspace', true), '');
  return null;
end;
$$;

-- Recount up to `max_videos` marked videos, oldest mark first.
--
-- Each video clears its marks and then recounts, in that order: a mark a writer
-- commits after the clear is not visible to it and stays for the next run,
-- whether or not the recount already saw that writer's rows. A video whose
-- recount fails keeps its marks and its old counts (the subtransaction rolls
-- back) and the others go on. No new video is started once `budget` has
-- passed: a statement timeout cancels the whole run, which no handler can
-- catch, and the cron command gives the run 5 minutes against a budget of 30 s
-- plus one video (the slowest measured is 36 s). One run at a time; a run that
-- finds another going returns 0.
create function private.drain_video_comment_stats(
  max_videos int default 1000,
  budget interval default '30 seconds'
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  done int := 0;
  started timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_xact_lock(hashtextextended('video_comment_stats_drain', 0)) then
    return 0;
  end if;

  for target in
    select d.workspace_id, d.video_id
      from private.video_comment_stats_dirty d
     group by d.workspace_id, d.video_id
     order by min(d.marked_at), d.workspace_id, d.video_id
     limit greatest(max_videos, 0)
  loop
    exit when clock_timestamp() - started > budget;
    begin
      delete from private.video_comment_stats_dirty
       where workspace_id = target.workspace_id and video_id = target.video_id;
      if exists (select 1 from public.videos v
                  where v.workspace_id = target.workspace_id and v.id = target.video_id) then
        perform private.refresh_video_comment_stats(jsonb_build_array(jsonb_build_object(
          'workspace_id', target.workspace_id, 'video_id', target.video_id)));
      end if;
      done := done + 1;
    exception when others then
      raise warning 'video_comment_stats drain failed for %/%: %',
        target.workspace_id, target.video_id, sqlerrm;
    end;
  end loop;
  return done;
end;
$$;

revoke all on function private.drain_video_comment_stats(int, interval) from public, anon, authenticated;
grant execute on function private.drain_video_comment_stats(int, interval) to service_role;

-- Skipped where pg_cron does not exist (every PGlite test database).
do $schedule$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; skipping the video comment stats drain';
    return;
  end if;

  create extension if not exists pg_cron with schema extensions;

  perform cron.unschedule(jobid) from cron.job where jobname = 'video-comment-stats-drain';

  -- One transaction, so SET LOCAL holds for the drain: 5 minutes, not the cron
  -- session's 2.
  perform cron.schedule(
    'video-comment-stats-drain',
    '* * * * *',
    $job$set local statement_timeout = '5min'; select private.drain_video_comment_stats()$job$
  );
end;
$schedule$;

-- 2. Refusals -----------------------------------------------------------------

-- The six live definitions, re-created with the one change. Rewriting the
-- definition the database holds (rather than a copy pasted here) leaves every
-- other line exactly as the latest migration left it.
do $refusals$
declare
  fn regprocedure;
  def text;
begin
  foreach fn in array array[
    'private.commit_batch(uuid, uuid, text, text, jsonb)'::regprocedure,
    'private.commit_checkpoint(uuid, uuid, jsonb, text, text[])'::regprocedure,
    'private.heartbeat(uuid, uuid)'::regprocedure,
    'private.worker_job(text, uuid, uuid)'::regprocedure,
    'private.submit_comment_review_impl(uuid, uuid, text, text, text)'::regprocedure,
    'private.submit_topic_review_impl(uuid, uuid, text, text, text)'::regprocedure]
  loop
    def := pg_get_functiondef(fn);
    if def !~* $re$errcode\s*=\s*'40001'$re$ then
      raise exception '% raises no 40001; this migration no longer matches the schema', fn;
    end if;
    execute regexp_replace(def, $re$(errcode\s*=\s*)'40001'$re$, $r$\1'P0001'$r$, 'gi');
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prosrc ~* $re$errcode\s*=\s*'40(001|P01)'$re$) then
    raise exception 'a function still raises a SQLSTATE PostgREST retries';
  end if;
end;
$refusals$;
