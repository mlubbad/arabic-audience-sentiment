-- The owner console's home (phase 1, owner approval 2026-10-09): the whole
-- platform in one read.
--
-- `private.admin_channel_states()` names each channel's state once, so the
-- home's counts and the channels console (next) agree:
--   cataloguing  a catalogue run is queued or running;
--   collecting   a collection is queued or running;
--   failing      the channel's latest run failed;
--   new          never catalogued;
--   waiting      catalogued, no video selected for collection;
--   stale        selected videos, but no successful collection in 48 hours;
--   healthy      everything else.
-- The first that applies wins, in that order.
--
-- `admin_console_overview()` counts them, sums the data funnel from the
-- precomputed `private.video_comment_stats` (never the comments table), and
-- lists what needs the owner and what happened lately. One RPC with its own
-- 30 s statement timeout, set on the function PostgREST names, the lesson of
-- 20261011000000 (57014).

create or replace function private.admin_channel_states()
returns table (
  workspace_id uuid,
  channel_id uuid,
  state text,
  last_ok_at timestamptz,
  last_error text,
  last_run_at timestamptz
)
language sql stable security definer set search_path='' as $$
  select c.workspace_id, c.id,
         case
           when exists (select 1 from public.jobs j
                         where j.workspace_id = c.workspace_id and j.channel_id = c.id
                           and j.type = 'discover' and j.status in ('queued', 'running'))
             then 'cataloguing'
           when exists (select 1 from public.jobs j
                         where j.workspace_id = c.workspace_id and j.channel_id = c.id
                           and j.type = 'collect' and j.status in ('queued', 'running'))
             then 'collecting'
           when lr.status = 'failed' then 'failing'
           when c.catalogued_at is null then 'new'
           when not exists (select 1 from public.video_selections s
                             where s.workspace_id = c.workspace_id and s.channel_id = c.id)
             then 'waiting'
           when lc.ok_at is null or lc.ok_at < now() - interval '48 hours' then 'stale'
           else 'healthy'
         end,
         lc.ok_at,
         case when lr.status = 'failed' then lr.error_code end,
         lr.started_at
    from public.channels c
    left join lateral (
      select sr.status, sr.error_code, sr.started_at
        from public.sync_runs sr
       where sr.channel_id = c.id
       order by sr.started_at desc
       limit 1) lr on true
    left join lateral (
      select coalesce(sr.ended_at, sr.started_at) as ok_at
        from public.sync_runs sr
       where sr.channel_id = c.id
         and sr.mode = 'collect'
         and sr.status in ('succeeded', 'partial')
       order by sr.started_at desc
       limit 1) lc on true
$$;

revoke all on function private.admin_channel_states() from public, anon, authenticated;

create or replace function public.admin_console_overview()
returns jsonb
language plpgsql stable security definer
set search_path=''
set statement_timeout = '30s'
as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  with st as (select * from private.admin_channel_states())
  select jsonb_build_object(
    'workspaces', (select count(*) from public.workspaces),
    'users', (select count(*) from auth.users),
    'channels', (select count(*) from st),
    'states', jsonb_build_object(
      'cataloguing', (select count(*) from st where state = 'cataloguing'),
      'collecting', (select count(*) from st where state = 'collecting'),
      'failing', (select count(*) from st where state = 'failing'),
      'new', (select count(*) from st where state = 'new'),
      'waiting', (select count(*) from st where state = 'waiting'),
      'stale', (select count(*) from st where state = 'stale'),
      'healthy', (select count(*) from st where state = 'healthy')),
    'funnel', jsonb_build_object(
      'videos', (select count(*) from public.videos),
      'selected', (select count(*) from public.video_selections),
      'comments', (select coalesce(sum(total), 0) from private.video_comment_stats),
      'analysed', (select coalesce(sum(analysed), 0) from private.video_comment_stats)),
    'worker', jsonb_build_object(
      'fresh', coalesce((select max(last_seen_at) >= now() - interval '3 minutes'
                           from public.worker_seen), false),
      'last_seen', (select max(last_seen_at) from public.worker_seen),
      'queued', (select count(*) from public.jobs where status = 'queued'),
      'running', (select count(*) from public.jobs where status = 'running')),
    'attention', coalesce((
      select jsonb_agg(jsonb_build_object(
               'channel_id', a.channel_id,
               'workspace_id', a.workspace_id,
               'workspace_name', w.name,
               'title', c.title,
               'handle', c.handle,
               'state', a.state,
               'error_code', a.last_error,
               'last_ok_at', a.last_ok_at,
               'last_run_at', a.last_run_at)
             order by (a.state = 'failing') desc, a.last_run_at desc nulls last)
        from (select * from st where state in ('failing', 'stale')
               order by (state = 'failing') desc, last_run_at desc nulls last
               limit 20) a
        join public.channels c on c.id = a.channel_id
        join public.workspaces w on w.id = a.workspace_id), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', e.created_at,
               'action', e.action,
               'actor_email', u.email,
               'workspace_name', w.name)
             order by e.created_at desc)
        from (select * from public.audit_events order by created_at desc limit 10) e
        left join auth.users u on u.id = e.actor_id
        left join public.workspaces w on w.id = e.workspace_id), '[]'::jsonb))
  into result;
  return result;
end $$;

revoke all on function public.admin_console_overview() from public, anon;
grant execute on function public.admin_console_overview() to authenticated;
