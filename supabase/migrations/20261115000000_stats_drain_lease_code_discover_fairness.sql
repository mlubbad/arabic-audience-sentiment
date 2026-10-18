-- Per-video comment counts are recounted in the background, two refusals stop
-- being serialization failures, and an overdue refresh discover is claimed
-- before collects (section 3).
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

-- 3. Fairness for refresh discovers ---------------------------------------------
--
-- 20261031000000 claimed every refresh discover (the channel is already
-- catalogued) after every collect and analyse: re-reading 107 whole catalogues
-- had spent the day's YouTube quota before any comment was read. Since #143 a
-- refresh reads only down to its first page of known videos: 4 units for a
-- channel with nothing new (the channel and one page per tab), 2 more per 50
-- new videos, plus 1 for the weekly featured-channels check. But with collects
-- that never run out, a refresh discover was never claimed at all: on
-- 2026-10-18 21:35 UTC, 116 refresh discovers were queued and eligible, 7-41
-- hours old (median 40), none claimed since 10-17, so no channel had a profile
-- or daily statistics (WO-20/21) and no catalogue was refreshed.
--
-- Now a refresh discover that has existed for more than 6 hours is claimed
-- after first discovers and before collects and analyses. Order: first
-- discover, overdue refresh discover, collect and analyse, other refresh
-- discover.
--
-- Why 6 hours, and why from created_at:
--  * 6 hours is the catalogue_interval of 113 of the 121 active subscriptions
--    (360 minutes; 4 have 1440, 4 have 0). A refresh discover older than that
--    has missed a whole cadence of its channel's plan.
--  * At most one discover per channel is outstanding (jobs_one_outstanding_
--    discover), and a refresh is enqueued at most once per catalogue_interval
--    after the last catalogue, so the rule promotes at most about two per
--    channel a day even when collects saturate: for 116 channels about 1,200
--    units of the project's daily quota (10,000 by default), and about 600 once
--    for today's backlog. Collects keep the rest.
--  * created_at, not not_before: unblock_due_jobs requeues the same job at the
--    quota reset with not_before = now(), so a clock started from not_before
--    would restart at every reset and the discover would lose to collects for
--    ever. A quota-blocked discover is still not claimable before its
--    not_before (the status and not_before filters are unchanged).

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
          when q.type = 'discover' and q.created_at <= now() - interval '6 hours'
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
