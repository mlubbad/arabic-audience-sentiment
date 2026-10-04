-- Reconcile derived per-video comment statistics and prevent comment identity moves.

create or replace function private.reconcile_video_comment_stats(w uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pairs jsonb := '[]'::jsonb;
  videos_checked integer := 0;
  rows_corrected integer := 0;
begin
  with exact_counts as (
    select
      v.id as video_id,
      v.workspace_id,
      count(c.id)::integer as total_comments,
      count(c.id) filter (
        where exists (
          select 1
          from public.sentiment_predictions sp
          where sp.comment_id = c.id
            and sp.workspace_id = c.workspace_id
            and sp.status = 'succeeded'
        )
      )::integer as analysed_comments
    from public.videos v
    left join public.comments c
      on c.video_id = v.id
     and c.workspace_id = v.workspace_id
    where v.workspace_id = w
    group by v.id, v.workspace_id
  ), drift as (
    select
      e.video_id,
      e.workspace_id,
      e.total_comments,
      e.analysed_comments,
      coalesce(s.total, 0) as stored_total_comments,
      coalesce(s.analysed, 0) as stored_analysed_comments
    from exact_counts e
    left join private.video_comment_stats s
      on s.video_id = e.video_id
     and s.workspace_id = e.workspace_id
  )
  select
    count(*)::integer,
    count(*) filter (
      where stored_total_comments is distinct from total_comments
         or stored_analysed_comments is distinct from analysed_comments
    )::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'video_id', video_id,
          'workspace_id', workspace_id
        )
      ) filter (
        where stored_total_comments is distinct from total_comments
           or stored_analysed_comments is distinct from analysed_comments
      ),
      '[]'::jsonb
    )
  into videos_checked, rows_corrected, pairs
  from drift;

  if rows_corrected > 0 then
    perform private.refresh_video_comment_stats(pairs);
  end if;

  return jsonb_build_object(
    'workspace_id', w,
    'videos_checked', videos_checked,
    'rows_corrected', rows_corrected
  );
end;
$$;

revoke all on function private.reconcile_video_comment_stats(uuid) from public, anon, authenticated;
grant execute on function private.reconcile_video_comment_stats(uuid) to service_role;

create or replace function private.reconcile_all_video_comment_stats()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace record;
  result jsonb;
  workspaces_checked integer := 0;
  videos_checked integer := 0;
  rows_corrected integer := 0;
  drifted jsonb := '[]'::jsonb;
begin
  for workspace in
    select id
    from public.workspaces
    order by id
  loop
    result := private.reconcile_video_comment_stats(workspace.id);
    workspaces_checked := workspaces_checked + 1;
    videos_checked := videos_checked + (result ->> 'videos_checked')::integer;
    rows_corrected := rows_corrected + (result ->> 'rows_corrected')::integer;

    if (result ->> 'rows_corrected')::integer > 0 then
      drifted := drifted || jsonb_build_array(result);
    end if;
  end loop;

  return jsonb_build_object(
    'workspaces_checked', workspaces_checked,
    'videos_checked', videos_checked,
    'rows_corrected', rows_corrected,
    'drifted', drifted
  );
end;
$$;

revoke all on function private.reconcile_all_video_comment_stats() from public, anon, authenticated;
grant execute on function private.reconcile_all_video_comment_stats() to service_role;

create or replace function private.prevent_comment_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.video_id is distinct from old.video_id
     or new.workspace_id is distinct from old.workspace_id then
    raise exception 'comments do not move between videos'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_comment_move() from public, anon, authenticated;

drop trigger if exists comments_prevent_move on public.comments;
create trigger comments_prevent_move
before update of video_id, workspace_id on public.comments
for each row
execute function private.prevent_comment_move();

do $schedule$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; skipping reconcile-video-comment-stats schedule';
    return;
  end if;

  create extension if not exists pg_cron with schema extensions;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'reconcile-video-comment-stats';

  perform cron.schedule(
    'reconcile-video-comment-stats',
    '37 2 * * *',
    $job$select private.reconcile_all_video_comment_stats()$job$
  );
end;
$schedule$;
