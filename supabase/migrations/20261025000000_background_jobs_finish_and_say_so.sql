-- Background jobs that finish, one unit at a time, and say when they fail.
--
-- Two cron jobs looped over every workspace in one statement under the cron
-- session's 2-minute limit (owner's SQL editor, 2026-10-13):
-- * `channel-compare-drain` (20261021000000) was cancelled at exactly 2:00 on
--   every run; 0 of 115 workspaces were ever counted, so the comparison page
--   showed every channel as pending. The `statement_timeout = '300s'` on the
--   function cannot extend the caller's limit, a cancel rolls the whole run
--   back, and the oldest-first queue put the same workspace first again.
-- * `reconcile-video-comment-stats` (20261004010000) failed on 3 of the last 5
--   nights the same way, so the comment counts on Home and Channels were not
--   corrected on those nights.
-- Nothing in the console showed either failure.
--
-- What changes:
-- 1. Units. `private.channel_compare_units` holds one row per channel (dirty
--    since, last counted, attempts, back-off, last error);
--    `private.video_stats_reconcile_units` one row per workspace. The existing
--    `channel_compare_dirty` stays as the inbox the triggers write to.
-- 2. One unit per run, every minute. `private.channel_compare_step()` counts
--    one channel; `private.video_stats_reconcile_step()` reconciles one
--    workspace (every minute from 02:00 to 04:59 UTC, each workspace once a
--    day). A run that finishes commits its unit; a slow unit cannot hold the
--    others back.
-- 3. A failure is recorded even when it cannot be caught. A statement timeout
--    cancels the run and rolls back anything it wrote, so the next run reads
--    `cron.job_run_details`: if the job's last finished run failed and has not
--    been accounted for, the unit the same order puts first now is the one it
--    was counting (the rollback restored the queue). That unit gets the error,
--    one more attempt and a back-off (10 minutes doubling, at most a day), and
--    the run ends there. Ordinary errors are caught and recorded the same way.
-- 4. `public.admin_background_jobs()` reports each cron job's last run,
--    failures in the last 24 hours, and the state of both unit tables, for the
--    System page. `public.admin_channels_compare()` reports each channel's own
--    count state, so a channel that was never counted or keeps failing is
--    shown as such instead of as a small sample.
--
-- Counting one channel is the 20261021000000 query restricted to that
-- channel. Locally (PostgreSQL 16.13) the largest production-shaped channel,
-- 155,822 comments with predictions, takes 0.47 s; production's time for it
-- is not known yet, and a unit that cannot finish is now visible with its
-- error rather than silent.

-- 1. Units -----------------------------------------------------------------

create table private.channel_compare_units (
  workspace_id uuid not null,
  channel_id uuid not null,
  dirty_since timestamptz,
  refreshed_at timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  primary key (workspace_id, channel_id),
  foreign key (workspace_id, channel_id)
    references public.channels(workspace_id, id) on delete cascade
);
create index channel_compare_units_due
  on private.channel_compare_units(attempts, dirty_since)
  where dirty_since is not null;

create table private.video_stats_reconcile_units (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  reconciled_at timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  last_error text,
  last_error_at timestamptz
);

-- The newest failed run of each job already charged to a unit.
create table private.background_job_failures_seen (
  jobname text primary key,
  last_runid bigint not null
);

alter table private.channel_compare_units enable row level security;
alter table private.video_stats_reconcile_units enable row level security;
alter table private.background_job_failures_seen enable row level security;
revoke all on table private.channel_compare_units from public, anon, authenticated;
revoke all on table private.video_stats_reconcile_units from public, anon, authenticated;
revoke all on table private.background_job_failures_seen from public, anon, authenticated;

-- Every channel starts dirty; what was counted before keeps its time.
insert into private.channel_compare_units(workspace_id, channel_id, dirty_since, refreshed_at)
select c.workspace_id, c.id, now(), r.refreshed_at
  from public.channels c
  left join private.channel_compare_refreshed r on r.workspace_id = c.workspace_id;

insert into private.video_stats_reconcile_units(workspace_id)
select w.id from public.workspaces w;

-- 2. Counting one channel ---------------------------------------------------

-- The 20261021000000 recount, restricted to one channel.
create function private.refresh_channel_compare_channel(w uuid, p_channel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  topic_active text;
  since date := (now() at time zone 'UTC')::date - 35;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('channel_compare:' || w::text || ':' || p_channel::text, 0));

  select ws.active_topic_key into topic_active
    from public.workspaces ws where ws.id = w;

  delete from private.channel_compare_cells
   where workspace_id = w and channel_id = p_channel;

  insert into private.channel_compare_cells(
    workspace_id, channel_id, day, topic_key,
    comments, analysed, positive, negative, neutral, mixed)
  with ch as (
    select c.id, c.external_channel_id, c.active_analysis_key
      from public.channels c
     where c.workspace_id = w and c.id = p_channel
  ),
  audience as (
    select v.channel_id, cm.id, cm.content_hash, ch.active_analysis_key,
           case when cm.published_at >= since
                then (cm.published_at at time zone 'UTC')::date end as day
      from public.videos v
      join ch on ch.id = v.channel_id
      join public.comments cm on cm.workspace_id = v.workspace_id and cm.video_id = v.id
     where v.workspace_id = w and v.channel_id = p_channel
       and not coalesce(cm.author_channel_id = ch.external_channel_id, false)
  ),
  rev as (
    select distinct on (r.comment_id) r.comment_id, r.content_hash, r.label
      from public.comment_reviews r
     where r.workspace_id = w and r.origin = 'human'
     order by r.comment_id, r.created_at desc
  ),
  trev as (
    select distinct on (r.comment_id) r.comment_id, r.content_hash, r.topic_key
      from public.topic_reviews r
     where r.workspace_id = w and r.origin = 'human'
     order by r.comment_id, r.created_at desc
  ),
  ev as (
    select a.channel_id, a.day,
           case when r.content_hash = a.content_hash then r.label else p.label end as label,
           case when t.content_hash = a.content_hash then t.topic_key else tp.topic_key end as topic
      from audience a
      left join rev r on r.comment_id = a.id
      left join public.sentiment_predictions p
        on p.workspace_id = w and p.comment_id = a.id
       and p.content_hash = a.content_hash
       and p.analysis_key = a.active_analysis_key
       and p.status = 'succeeded'
      left join trev t on t.comment_id = a.id
      left join public.topic_predictions tp
        on tp.workspace_id = w and tp.comment_id = a.id
       and tp.content_hash = a.content_hash
       and tp.classification_key = topic_active
       and tp.status = 'succeeded'
  )
  select w, ev.channel_id, ev.day, ev.topic,
         count(*), count(ev.label),
         count(*) filter (where ev.label = 'positive'),
         count(*) filter (where ev.label = 'negative'),
         count(*) filter (where ev.label = 'neutral'),
         count(*) filter (where ev.label = 'mixed')
    from ev
   group by ev.channel_id, ev.day, ev.topic;

  insert into private.channel_compare_units as u(workspace_id, channel_id, refreshed_at)
  values (w, p_channel, now())
  on conflict (workspace_id, channel_id) do update
    set refreshed_at = now(), dirty_since = null, attempts = 0,
        next_attempt_at = null, last_error = null, last_error_at = null;
end;
$$;

-- The workspace recount (still what the tests and a manual drain call) is now
-- the channel recount for each of its channels.
create or replace function private.refresh_channel_compare(w uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch record;
begin
  perform pg_advisory_xact_lock(hashtextextended('channel_compare:' || w::text, 0));
  delete from private.channel_compare_dirty where workspace_id = w;
  for ch in select c.id from public.channels c where c.workspace_id = w order by c.id loop
    perform private.refresh_channel_compare_channel(w, ch.id);
  end loop;
  insert into private.channel_compare_refreshed(workspace_id, refreshed_at)
  values (w, now())
  on conflict (workspace_id) do update set refreshed_at = excluded.refreshed_at;
end;
$$;

-- 3. Failures a cancelled run could not write -------------------------------

-- The first line of the job's newest finished run when it failed and has not
-- been charged to a unit yet; null otherwise, and wherever pg_cron is absent.
create function private.unseen_job_failure(p_job text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if to_regclass('cron.job_run_details') is null then
    return null;
  end if;
  select d.runid, d.status, coalesce(d.return_message, '') as msg into r
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
   where j.jobname = p_job and d.status in ('succeeded', 'failed')
   order by d.runid desc
   limit 1;
  if not found or r.status <> 'failed' then
    return null;
  end if;
  if exists (select 1 from private.background_job_failures_seen s
              where s.jobname = p_job and s.last_runid >= r.runid) then
    return null;
  end if;
  insert into private.background_job_failures_seen(jobname, last_runid)
  values (p_job, r.runid)
  on conflict (jobname) do update set last_runid = excluded.last_runid;
  return left(split_part(r.msg, E'\n', 1), 300);
end;
$$;

create function private.backoff_after(attempts int)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now() + least(interval '10 minutes' * power(2, least(attempts, 8)), interval '24 hours');
$$;

-- 4. One step of each job ---------------------------------------------------

create function private.channel_compare_step()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  u record;
  have_unit boolean;
  failure text;
begin
  -- The triggers' marks become dirty channels; new channels join dirty.
  with marks as (
    delete from private.channel_compare_dirty d
    returning d.workspace_id, d.marked_at
  ),
  per_ws as (
    select m.workspace_id, min(m.marked_at) as since from marks m group by m.workspace_id
  )
  insert into private.channel_compare_units as un(workspace_id, channel_id, dirty_since)
  select c.workspace_id, c.id, p.since
    from per_ws p
    join public.channels c on c.workspace_id = p.workspace_id
  on conflict (workspace_id, channel_id) do update
    set dirty_since = least(coalesce(un.dirty_since, excluded.dirty_since), excluded.dirty_since);

  insert into private.channel_compare_units(workspace_id, channel_id, dirty_since)
  select c.workspace_id, c.id, now()
    from public.channels c
   where not exists (select 1 from private.channel_compare_units x
                      where x.workspace_id = c.workspace_id and x.channel_id = c.id);

  -- Never counted first, then the longest waiting. A unit whose mark is
  -- fresh waits five minutes so a burst of verdicts is counted once.
  select x.workspace_id, x.channel_id, x.attempts into u
    from private.channel_compare_units x
   where x.dirty_since is not null
     and (x.next_attempt_at is null or x.next_attempt_at <= now())
     and (x.refreshed_at is null or x.dirty_since <= now() - interval '5 minutes')
   order by x.attempts, (x.refreshed_at is not null), x.dirty_since, x.workspace_id, x.channel_id
   limit 1;
  have_unit := found;

  failure := private.unseen_job_failure('channel-compare-step');
  if failure is not null then
    if have_unit then
      update private.channel_compare_units
         set attempts = attempts + 1,
             next_attempt_at = private.backoff_after(attempts),
             last_error = failure,
             last_error_at = now()
       where workspace_id = u.workspace_id and channel_id = u.channel_id;
    end if;
    return 'failure recorded';
  end if;

  if not have_unit then
    return 'idle';
  end if;

  begin
    perform private.refresh_channel_compare_channel(u.workspace_id, u.channel_id);
  exception when others then
    update private.channel_compare_units
       set attempts = attempts + 1,
           next_attempt_at = private.backoff_after(attempts),
           last_error = left(sqlerrm, 300),
           last_error_at = now()
     where workspace_id = u.workspace_id and channel_id = u.channel_id;
    return 'error recorded';
  end;
  return 'counted';
end;
$$;

create function private.video_stats_reconcile_step()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  u record;
  have_unit boolean;
  failure text;
begin
  insert into private.video_stats_reconcile_units(workspace_id)
  select w.id from public.workspaces w
   where not exists (select 1 from private.video_stats_reconcile_units x where x.workspace_id = w.id);

  -- Each workspace once a day, the longest unreconciled first.
  select x.workspace_id, x.attempts into u
    from private.video_stats_reconcile_units x
   where (x.reconciled_at is null or x.reconciled_at < now() - interval '20 hours')
     and (x.next_attempt_at is null or x.next_attempt_at <= now())
   order by x.attempts, x.reconciled_at nulls first, x.workspace_id
   limit 1;
  have_unit := found;

  failure := private.unseen_job_failure('reconcile-video-comment-stats-step');
  if failure is not null then
    if have_unit then
      update private.video_stats_reconcile_units
         set attempts = attempts + 1,
             next_attempt_at = private.backoff_after(attempts),
             last_error = failure,
             last_error_at = now()
       where workspace_id = u.workspace_id;
    end if;
    return 'failure recorded';
  end if;

  if not have_unit then
    return 'idle';
  end if;

  begin
    perform private.reconcile_video_comment_stats(u.workspace_id);
    update private.video_stats_reconcile_units
       set reconciled_at = now(), attempts = 0, next_attempt_at = null,
           last_error = null, last_error_at = null
     where workspace_id = u.workspace_id;
  exception when others then
    update private.video_stats_reconcile_units
       set attempts = attempts + 1,
           next_attempt_at = private.backoff_after(attempts),
           last_error = left(sqlerrm, 300),
           last_error_at = now()
     where workspace_id = u.workspace_id;
    return 'error recorded';
  end;
  return 'reconciled';
end;
$$;

revoke all on function private.refresh_channel_compare_channel(uuid, uuid) from public, anon, authenticated;
revoke all on function private.unseen_job_failure(text) from public, anon, authenticated;
revoke all on function private.backoff_after(int) from public, anon, authenticated;
revoke all on function private.channel_compare_step() from public, anon, authenticated;
revoke all on function private.video_stats_reconcile_step() from public, anon, authenticated;

-- 5. What the console reads -------------------------------------------------

create function public.admin_background_jobs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  uid uuid := (select auth.uid());
  jobs jsonb := '[]'::jsonb;
  recent bigint;
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if to_regclass('cron.job_run_details') is not null then
    -- The newest runs only, through the primary key: the history table keeps
    -- every run of every job and is never read whole here.
    select coalesce(max(d.runid), 0) - 20000 into recent from cron.job_run_details d;
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', j.jobname,
             'schedule', j.schedule,
             'active', j.active,
             'last_status', l.status,
             'last_started_at', l.start_time,
             'last_finished_at', l.end_time,
             'last_error', case when l.status = 'failed'
                                then left(split_part(coalesce(l.return_message, ''), E'\n', 1), 300) end,
             'runs_24h', coalesce(f.runs, 0),
             'failures_24h', coalesce(f.failures, 0))
           order by j.jobname), '[]'::jsonb)
      into jobs
      from cron.job j
      left join lateral (
        select d.status, d.start_time, d.end_time, d.return_message
          from cron.job_run_details d
         where d.runid > recent and d.jobid = j.jobid
           and d.status in ('succeeded', 'failed')
         order by d.runid desc
         limit 1) l on true
      left join lateral (
        select count(*) as runs, count(*) filter (where d.status = 'failed') as failures
          from cron.job_run_details d
         where d.runid > recent and d.jobid = j.jobid
           and d.start_time > now() - interval '24 hours') f on true;
  end if;

  return jsonb_build_object(
    'checked_at', now(),
    'cron_available', to_regclass('cron.job_run_details') is not null,
    'jobs', jobs,
    'compare', (
      select jsonb_build_object(
               'channels', count(*),
               'counted', count(*) filter (where x.refreshed_at is not null),
               'never_counted', count(*) filter (where x.refreshed_at is null),
               'waiting', count(*) filter (where x.dirty_since is not null),
               'failing', count(*) filter (where x.attempts > 0),
               'oldest_counted_at', min(x.refreshed_at),
               'last_error', (select y.last_error from private.channel_compare_units y
                               where y.attempts > 0 order by y.last_error_at desc nulls last limit 1))
        from private.channel_compare_units x),
    'stats', (
      select jsonb_build_object(
               'workspaces', count(*),
               'reconciled_24h', count(*) filter (where x.reconciled_at > now() - interval '24 hours'),
               'failing', count(*) filter (where x.attempts > 0),
               'last_error', (select y.last_error from private.video_stats_reconcile_units y
                               where y.attempts > 0 order by y.last_error_at desc nulls last limit 1))
        from private.video_stats_reconcile_units x));
end;
$$;

revoke all on function public.admin_background_jobs() from public, anon;
grant execute on function public.admin_background_jobs() to authenticated;

-- The comparison read, from 20261021000000 with each channel's own count
-- state: `refreshed_at` is the channel's, and `count_state` says whether it was
-- never counted, is waiting for a recount, keeps failing, or is current.
create or replace function public.admin_channels_compare()
returns jsonb
language plpgsql stable security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  uid uuid := (select auth.uid());
  today date := (now() at time zone 'UTC')::date;
  result jsonb;
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with agg as (
    select x.workspace_id, x.channel_id,
           sum(x.analysed) as analysed,
           sum(x.positive) as positive,
           sum(x.negative) as negative,
           sum(x.neutral) as neutral,
           sum(x.mixed) as mixed,
           coalesce(sum(x.analysed) filter (where x.day > today - 7), 0) as w_analysed,
           coalesce(sum(x.positive) filter (where x.day > today - 7), 0) as w_positive,
           coalesce(sum(x.negative) filter (where x.day > today - 7), 0) as w_negative,
           coalesce(sum(x.analysed) filter (where x.day > today - 14 and x.day <= today - 7), 0) as p_analysed,
           coalesce(sum(x.positive) filter (where x.day > today - 14 and x.day <= today - 7), 0) as p_positive,
           coalesce(sum(x.negative) filter (where x.day > today - 14 and x.day <= today - 7), 0) as p_negative
      from private.channel_compare_cells x
     group by x.workspace_id, x.channel_id
  ),
  topics as (
    select distinct on (x.workspace_id, x.channel_id)
           x.workspace_id, x.channel_id, x.topic_key, sum(x.comments) as comments
      from private.channel_compare_cells x
     where x.topic_key is not null and x.topic_key <> 'other'
     group by x.workspace_id, x.channel_id, x.topic_key
     order by x.workspace_id, x.channel_id, sum(x.comments) desc, x.topic_key
  ),
  ranked as (
    select c.id, c.workspace_id, w.name as workspace_name,
           w.created_by = uid as mine, u.email as owner_email,
           c.platform, c.external_channel_id, c.title, c.handle,
           a.analysed, a.positive, a.negative, a.neutral, a.mixed,
           a.w_analysed, a.w_positive, a.w_negative,
           a.p_analysed, a.p_positive, a.p_negative,
           t.topic_key, t.comments as topic_comments,
           tp.name_ar as topic_name_ar, tp.name_en as topic_name_en,
           cu.refreshed_at, cu.dirty_since, cu.attempts, cu.last_error, cu.next_attempt_at,
           count(*) over (partition by c.platform, c.external_channel_id) as copies,
           row_number() over (
             partition by c.platform, c.external_channel_id
             order by coalesce(a.analysed, 0) desc, (w.created_by = uid) desc,
                      w.created_at, c.id) as rn
      from public.channels c
      join public.workspaces w on w.id = c.workspace_id
      left join auth.users u on u.id = w.created_by
      left join agg a on a.workspace_id = c.workspace_id and a.channel_id = c.id
      left join topics t on t.workspace_id = c.workspace_id and t.channel_id = c.id
      left join public.workspace_topics tp
        on tp.workspace_id = c.workspace_id and tp.key = t.topic_key
      left join private.channel_compare_units cu
        on cu.workspace_id = c.workspace_id and cu.channel_id = c.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'workspace_id', r.workspace_id,
           'workspace_name', r.workspace_name,
           'mine', r.mine,
           'owner_email', r.owner_email,
           'platform', r.platform,
           'external_channel_id', r.external_channel_id,
           'title', r.title,
           'handle', r.handle,
           'copies', r.copies,
           'analysed', coalesce(r.analysed, 0),
           'positive', coalesce(r.positive, 0),
           'negative', coalesce(r.negative, 0),
           'neutral', coalesce(r.neutral, 0),
           'mixed', coalesce(r.mixed, 0),
           'week', jsonb_build_object(
             'analysed', coalesce(r.w_analysed, 0),
             'positive', coalesce(r.w_positive, 0),
             'negative', coalesce(r.w_negative, 0)),
           'previous_week', jsonb_build_object(
             'analysed', coalesce(r.p_analysed, 0),
             'positive', coalesce(r.p_positive, 0),
             'negative', coalesce(r.p_negative, 0)),
           'top_topic', case when r.topic_key is null then null else jsonb_build_object(
             'key', r.topic_key,
             'name_ar', r.topic_name_ar,
             'name_en', r.topic_name_en,
             'comments', r.topic_comments) end,
           'refreshed_at', r.refreshed_at,
           'count_state', case
             when coalesce(r.attempts, 0) > 0 then 'failing'
             when r.refreshed_at is null then 'never'
             when r.dirty_since is not null then 'waiting'
             else 'current' end,
           'count_error', case when coalesce(r.attempts, 0) > 0 then r.last_error end,
           'next_attempt_at', case when coalesce(r.attempts, 0) > 0 then r.next_attempt_at end)
         order by r.workspace_id, r.id), '[]'::jsonb)
    into result
    from ranked r
   where r.rn = 1;
  return result;
end $$;

-- 6. The schedules ------------------------------------------------------------

do $schedule$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; skipping the step schedules';
    return;
  end if;

  create extension if not exists pg_cron with schema extensions;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname in ('channel-compare-drain', 'channel-compare-step',
                    'reconcile-video-comment-stats', 'reconcile-video-comment-stats-step');

  perform cron.schedule(
    'channel-compare-step',
    '* * * * *',
    $job$select private.channel_compare_step()$job$
  );
  perform cron.schedule(
    'reconcile-video-comment-stats-step',
    '* 2-4 * * *',
    $job$select private.video_stats_reconcile_step()$job$
  );
end;
$schedule$;
