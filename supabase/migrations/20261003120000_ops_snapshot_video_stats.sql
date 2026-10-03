-- Keep the lightweight ops snapshot independent of workspace comment volume.

create table private.video_comment_stats (
  workspace_id uuid not null,
  video_id uuid not null,
  total int not null check (total >= 0),
  analysed int not null check (analysed >= 0 and analysed <= total),
  primary key (workspace_id, video_id),
  foreign key (workspace_id, video_id)
    references public.videos(workspace_id, id) on delete cascade
);

alter table private.video_comment_stats enable row level security;

revoke all on table private.video_comment_stats from public, anon, authenticated;

create function private.refresh_video_comment_stats(pairs jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  with affected as (
    select distinct p.workspace_id, p.video_id
    from jsonb_to_recordset(coalesce(pairs, '[]'::jsonb))
      as p(workspace_id uuid, video_id uuid)
  ), counts as (
    select
      p.workspace_id,
      p.video_id,
      count(c.id)::int as total,
      count(c.id) filter (
        where exists (
          select 1
          from public.sentiment_predictions sp
          where sp.workspace_id = c.workspace_id
            and sp.comment_id = c.id
            and sp.status = 'succeeded'
        )
      )::int as analysed
    from affected p
    left join public.comments c
      on c.workspace_id = p.workspace_id
     and c.video_id = p.video_id
    group by p.workspace_id, p.video_id
  )
  insert into private.video_comment_stats(workspace_id, video_id, total, analysed)
  select workspace_id, video_id, total, analysed
  from counts
  on conflict (workspace_id, video_id) do update
  set total = excluded.total,
      analysed = excluded.analysed;
$$;

revoke all on function private.refresh_video_comment_stats(jsonb)
  from public, anon, authenticated;

create function private.refresh_video_comment_stats_after_comment_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pairs jsonb;
begin
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'workspace_id', touched.workspace_id,
      'video_id', touched.video_id
    )),
    '[]'::jsonb
  )
  into pairs
  from (
    select distinct workspace_id, video_id
    from new_comments
  ) touched;

  perform private.refresh_video_comment_stats(pairs);
  return null;
end;
$$;

create function private.refresh_video_comment_stats_after_comment_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pairs jsonb;
begin
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'workspace_id', touched.workspace_id,
      'video_id', touched.video_id
    )),
    '[]'::jsonb
  )
  into pairs
  from (
    select distinct workspace_id, video_id
    from old_comments
  ) touched;

  perform private.refresh_video_comment_stats(pairs);
  return null;
end;
$$;

create function private.refresh_video_comment_stats_after_prediction_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pairs jsonb;
begin
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'workspace_id', touched.workspace_id,
      'video_id', touched.video_id
    )),
    '[]'::jsonb
  )
  into pairs
  from (
    select distinct p.workspace_id, c.video_id
    from new_predictions p
    join public.comments c
      on c.workspace_id = p.workspace_id
     and c.id = p.comment_id
  ) touched;

  perform private.refresh_video_comment_stats(pairs);
  return null;
end;
$$;

create function private.refresh_video_comment_stats_after_prediction_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pairs jsonb;
begin
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'workspace_id', touched.workspace_id,
      'video_id', touched.video_id
    )),
    '[]'::jsonb
  )
  into pairs
  from (
    select distinct changed.workspace_id, c.video_id
    from (
      select old_p.workspace_id, old_p.comment_id
      from old_predictions old_p
      join new_predictions new_p on new_p.id = old_p.id
      where old_p.status is distinct from new_p.status
      union
      select new_p.workspace_id, new_p.comment_id
      from new_predictions new_p
      join old_predictions old_p on old_p.id = new_p.id
      where old_p.status is distinct from new_p.status
    ) changed
    join public.comments c
      on c.workspace_id = changed.workspace_id
     and c.id = changed.comment_id
  ) touched;

  perform private.refresh_video_comment_stats(pairs);
  return null;
end;
$$;

create function private.refresh_video_comment_stats_after_prediction_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pairs jsonb;
begin
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'workspace_id', touched.workspace_id,
      'video_id', touched.video_id
    )),
    '[]'::jsonb
  )
  into pairs
  from (
    select distinct p.workspace_id, c.video_id
    from old_predictions p
    join public.comments c
      on c.workspace_id = p.workspace_id
     and c.id = p.comment_id
  ) touched;

  perform private.refresh_video_comment_stats(pairs);
  return null;
end;
$$;

revoke all on function private.refresh_video_comment_stats_after_comment_insert()
  from public, anon, authenticated;
revoke all on function private.refresh_video_comment_stats_after_comment_delete()
  from public, anon, authenticated;
revoke all on function private.refresh_video_comment_stats_after_prediction_insert()
  from public, anon, authenticated;
revoke all on function private.refresh_video_comment_stats_after_prediction_update()
  from public, anon, authenticated;
revoke all on function private.refresh_video_comment_stats_after_prediction_delete()
  from public, anon, authenticated;

create trigger refresh_video_comment_stats_after_comment_insert
after insert on public.comments
referencing new table as new_comments
for each statement
execute function private.refresh_video_comment_stats_after_comment_insert();

create trigger refresh_video_comment_stats_after_comment_delete
after delete on public.comments
referencing old table as old_comments
for each statement
execute function private.refresh_video_comment_stats_after_comment_delete();

create trigger refresh_video_comment_stats_after_prediction_insert
after insert on public.sentiment_predictions
referencing new table as new_predictions
for each statement
execute function private.refresh_video_comment_stats_after_prediction_insert();

-- PostgreSQL does not allow transition tables on an UPDATE OF trigger. This
-- statement trigger therefore filters the transition rows to status changes.
create trigger refresh_video_comment_stats_after_prediction_update
after update on public.sentiment_predictions
referencing old table as old_predictions new table as new_predictions
for each statement
execute function private.refresh_video_comment_stats_after_prediction_update();

create trigger refresh_video_comment_stats_after_prediction_delete
after delete on public.sentiment_predictions
referencing old table as old_predictions
for each statement
execute function private.refresh_video_comment_stats_after_prediction_delete();

-- Seed one exact row per existing video in a single set-based statement.
insert into private.video_comment_stats(workspace_id, video_id, total, analysed)
select
  v.workspace_id,
  v.id,
  count(c.id)::int,
  count(c.id) filter (
    where exists (
      select 1
      from public.sentiment_predictions sp
      where sp.workspace_id = c.workspace_id
        and sp.comment_id = c.id
        and sp.status = 'succeeded'
    )
  )::int
from public.videos v
left join public.comments c
  on c.workspace_id = v.workspace_id
 and c.video_id = v.id
group by v.workspace_id, v.id;

create or replace function private.workspace_ops_snapshot_impl(w uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  state jsonb;
  plan_summary jsonb;
  video_counts jsonb;
  cat_summary jsonb;
begin
  if not (coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' or private.has_role(w)) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select jsonb_build_object(
    'worker', jsonb_build_object(
      'connected', coalesce(
        (select s.last_seen_at > now() - interval '3 minutes'
           from public.worker_seen s
          where s.workspace_id = w),
        (select max(s.last_seen_at) > now() - interval '3 minutes'
           from public.worker_seen s),
        (select count(*) > 0
           from public.jobs
          where status = 'running' and lease_expires_at > now()),
        false),
      'last_heartbeat_at', coalesce(
        (select s.last_seen_at from public.worker_seen s
          where s.workspace_id = w),
        (select max(s.last_seen_at) from public.worker_seen s),
        (select max(lease_expires_at) - interval '5 minutes'
           from public.jobs
          where status = 'running' and lease_expires_at > now())),
      'busy', coalesce((select count(*) > 0 from public.jobs j
                         where j.workspace_id = w
                           and j.status = 'running'
                           and j.lease_expires_at > now()), false)),
    'queued_jobs', (select count(*) from public.jobs j
                     where j.workspace_id=w and j.status='queued'),
    'last_run', (
      select jsonb_build_object(
        'started_at', s.started_at, 'ended_at', s.ended_at, 'status', s.status,
        'source', s.source, 'error_code', s.error_code,
        'coverage', jsonb_build_object(
          'videos_seen', coalesce((s.coverage_summary->>'videos_seen')::int, 0),
          'comments_collected', coalesce((s.coverage_summary->>'comments_collected')::int, 0),
          'complete', coalesce((s.coverage_summary->>'complete')::boolean, false)))
      from public.sync_runs s where s.workspace_id=w and s.mode = 'collect'
      order by s.started_at desc limit 1))
  into state;

  select private.usage_summary_impl(w) into plan_summary;

  select
    coalesce(json_agg(json_build_object(
      'id', v.id::text,
      'total', coalesce(s.total, 0),
      'analysed', coalesce(s.analysed, 0)
    )), '[]'::json)::jsonb,
    jsonb_build_object(
      'total_comments_collected', coalesce(sum(s.total), 0)::int,
      'total_comments_analysed', coalesce(sum(s.analysed), 0)::int,
      'videos_with_comments', count(s.video_id) filter (where s.total > 0)::int
    )
  into video_counts, cat_summary
  from public.videos v
  left join private.video_comment_stats s
    on s.workspace_id = v.workspace_id
   and s.video_id = v.id
  where v.workspace_id = w;

  return jsonb_build_object(
    'sync', state,
    'plan', plan_summary,
    'video_counts', coalesce(video_counts, '[]'::jsonb),
    'catalogue_summary', coalesce(cat_summary, jsonb_build_object(
      'total_comments_collected', 0,
      'total_comments_analysed', 0,
      'videos_with_comments', 0
    ))
  );
end $$;
