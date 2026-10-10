-- The owner console's comparison page (phase 3, owner approval 2026-10-09):
-- every channel on the platform ranked by how its audience speaks, in one
-- read that never scans comments.
--
-- Counting sentiment live across a hundred workspaces is what timed out as
-- 57014 before (20261011000000), so the counts are kept ready:
--
-- * `private.channel_compare_cells` holds, per channel, the audience's
--   comments grouped by day and topic with their sentiment counts. Days are
--   kept for the last 35 days (older comments, and comments with no known
--   date, share one row with a null day): enough for "this week against the
--   week before" and small whatever the history.
-- * A comment counts as the workspace dashboard counts it
--   (20261007000000): the channel's own comments are left out; the latest
--   human review wins when it judged the same text, otherwise the verdict of
--   the channel's active analysis; the topic likewise, under the
--   workspace's active topic classification. Replies count, as on the
--   dashboard by default.
-- * Any new verdict, review or topic marks its workspace in
--   `private.channel_compare_dirty` (a statement trigger, one row per
--   workspace per statement, no unique key so a writer never waits on the
--   refresh). Every 10 minutes `private.drain_channel_compare()` recounts up
--   to 15 marked workspaces, oldest mark first; nightly every workspace is
--   marked, which also catches a changed active analysis or topic key.
--
-- `public.admin_channels_compare()` reads the cells: one row per channel,
-- the copies of one YouTube channel across workspaces (20260922010000)
-- shown once, through the copy with the most analysed comments.

create table private.channel_compare_cells (
  workspace_id uuid not null,
  channel_id uuid not null,
  day date null,
  topic_key text null,
  comments int not null check (comments >= 0),
  analysed int not null check (analysed >= 0),
  positive int not null check (positive >= 0),
  negative int not null check (negative >= 0),
  neutral int not null check (neutral >= 0),
  mixed int not null check (mixed >= 0),
  foreign key (workspace_id, channel_id)
    references public.channels(workspace_id, id) on delete cascade
);
create index channel_compare_cells_channel
  on private.channel_compare_cells(workspace_id, channel_id);

create table private.channel_compare_dirty (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  marked_at timestamptz not null default now()
);
create index channel_compare_dirty_workspace
  on private.channel_compare_dirty(workspace_id);

create table private.channel_compare_refreshed (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  refreshed_at timestamptz not null
);

alter table private.channel_compare_cells enable row level security;
alter table private.channel_compare_dirty enable row level security;
alter table private.channel_compare_refreshed enable row level security;
revoke all on table private.channel_compare_cells from public, anon, authenticated;
revoke all on table private.channel_compare_dirty from public, anon, authenticated;
revoke all on table private.channel_compare_refreshed from public, anon, authenticated;

-- Recount one workspace's channels from scratch.
create function private.refresh_channel_compare(w uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  topic_active text;
  since date := (now() at time zone 'UTC')::date - 35;
begin
  -- One recount of a workspace at a time; a second waits and recounts after.
  perform pg_advisory_xact_lock(hashtextextended('channel_compare:' || w::text, 0));

  -- Marks visible now are answered by this recount. A mark committed after
  -- it started stays and brings the workspace back.
  delete from private.channel_compare_dirty where workspace_id = w;

  select ws.active_topic_key into topic_active
    from public.workspaces ws where ws.id = w;

  delete from private.channel_compare_cells where workspace_id = w;

  insert into private.channel_compare_cells(
    workspace_id, channel_id, day, topic_key,
    comments, analysed, positive, negative, neutral, mixed)
  with ch as (
    select c.id, c.external_channel_id, c.active_analysis_key
      from public.channels c
     where c.workspace_id = w
  ),
  audience as (
    select v.channel_id, cm.id, cm.content_hash, ch.active_analysis_key,
           case when cm.published_at >= since
                then (cm.published_at at time zone 'UTC')::date end as day
      from public.comments cm
      join public.videos v on v.workspace_id = cm.workspace_id and v.id = cm.video_id
      join ch on ch.id = v.channel_id
     where cm.workspace_id = w
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

  insert into private.channel_compare_refreshed(workspace_id, refreshed_at)
  values (w, now())
  on conflict (workspace_id) do update set refreshed_at = excluded.refreshed_at;
end;
$$;

-- Recount up to `max_workspaces` marked workspaces, oldest mark first. A
-- workspace whose recount fails keeps its mark and its old counts, and the
-- others go on. No new workspace is started after two minutes: a statement
-- timeout cancels the whole run (it is not an error the loop can catch), so
-- the budget keeps a slow batch from being undone and repeated forever.
create function private.drain_channel_compare(max_workspaces int default 15)
returns int
language plpgsql
security definer
set search_path = ''
set statement_timeout = '300s'
as $$
declare
  target uuid;
  done int := 0;
  started timestamptz := clock_timestamp();
begin
  for target in
    select d.workspace_id
      from private.channel_compare_dirty d
     group by d.workspace_id
     order by min(d.marked_at), d.workspace_id
     limit greatest(max_workspaces, 0)
  loop
    exit when clock_timestamp() - started > interval '2 minutes';
    begin
      perform private.refresh_channel_compare(target);
      done := done + 1;
    exception when others then
      raise warning 'channel_compare refresh failed for %: %', target, sqlerrm;
    end;
  end loop;
  return done;
end;
$$;

-- Mark every workspace that has a channel: the nightly sweep, and the
-- first count after this migration.
create function private.mark_all_channel_compare()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.channel_compare_dirty(workspace_id)
  select distinct c.workspace_id from public.channels c;
$$;

create function private.mark_channel_compare_dirty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.channel_compare_dirty(workspace_id)
  select distinct n.workspace_id from new_rows n;
  return null;
end;
$$;

revoke all on function private.refresh_channel_compare(uuid) from public, anon, authenticated;
revoke all on function private.drain_channel_compare(int) from public, anon, authenticated;
revoke all on function private.mark_all_channel_compare() from public, anon, authenticated;
revoke all on function private.mark_channel_compare_dirty() from public, anon, authenticated;

-- A transition table allows one event per trigger, so each event has its own.
create trigger channel_compare_after_prediction_insert
after insert on public.sentiment_predictions
referencing new table as new_rows
for each statement execute function private.mark_channel_compare_dirty();

create trigger channel_compare_after_prediction_update
after update on public.sentiment_predictions
referencing new table as new_rows
for each statement execute function private.mark_channel_compare_dirty();

create trigger channel_compare_after_topic_insert
after insert on public.topic_predictions
referencing new table as new_rows
for each statement execute function private.mark_channel_compare_dirty();

create trigger channel_compare_after_topic_update
after update on public.topic_predictions
referencing new table as new_rows
for each statement execute function private.mark_channel_compare_dirty();

create trigger channel_compare_after_review_insert
after insert on public.comment_reviews
referencing new table as new_rows
for each statement execute function private.mark_channel_compare_dirty();

create trigger channel_compare_after_topic_review_insert
after insert on public.topic_reviews
referencing new table as new_rows
for each statement execute function private.mark_channel_compare_dirty();

-- The first count happens through the schedule, not inside this migration:
-- recounting every workspace here would make the deploy wait on it.
select private.mark_all_channel_compare();

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
  -- The most discussed topic; "other" names nothing, so it is never the one.
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
           rf.refreshed_at,
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
      left join private.channel_compare_refreshed rf on rf.workspace_id = c.workspace_id
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
           'refreshed_at', r.refreshed_at)
         order by r.workspace_id, r.id), '[]'::jsonb)
    into result
    from ranked r
   where r.rn = 1;
  return result;
end $$;

revoke all on function public.admin_channels_compare() from public, anon;
grant execute on function public.admin_channels_compare() to authenticated;

do $schedule$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; skipping channel-compare schedules';
    return;
  end if;

  create extension if not exists pg_cron with schema extensions;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname in ('channel-compare-drain', 'channel-compare-nightly');

  perform cron.schedule(
    'channel-compare-drain',
    '*/10 * * * *',
    $job$select private.drain_channel_compare(15)$job$
  );
  perform cron.schedule(
    'channel-compare-nightly',
    '47 2 * * *',
    $job$select private.mark_all_channel_compare()$job$
  );
end;
$schedule$;
