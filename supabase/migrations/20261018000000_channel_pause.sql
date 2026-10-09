-- Pausing a channel's collection (owner console phase 2, owner approval
-- 2026-10-09): the platform owner stops the scheduler from spending anything
-- on a channel, and resumes it later as it was.
--
-- A pause is a mark on the channel (`paused_at`, `paused_by`), not a change
-- of its `status`: the connection's own state (connected, public_unverified,
-- reconnect_required…) is kept, so resuming needs no memory of it.
--
-- While paused:
--   * the scheduler starts nothing for the channel: no catalogue run, no
--     collection, no topic analysis (`schedule_due_work`, rebuilt from
--     20261012000000 with that one filter);
--   * the automatic selection selects nothing (`auto_select_videos`, rebuilt
--     from 20261012000000 with that one guard), including when a catalogue
--     run that started before the pause finishes;
--   * work still queued when the pause lands is cancelled; a job already
--     running finishes.
-- A person in the workspace can still ask for a sync by hand: the pause is
-- the scheduler's, not a lock on the workspace.
--
-- `private.admin_channel_states()` names a paused channel `paused` before
-- anything else, so the home and the channels console count it apart.

alter table public.channels
  add column paused_at timestamptz,
  add column paused_by uuid references auth.users(id) on delete set null;

create or replace function public.admin_set_channels_paused(
  p_channels uuid[],
  p_paused boolean
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
  changed integer := 0;
  cancelled integer := 0;
  ch record;
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_channels is null or cardinality(p_channels) = 0
     or cardinality(p_channels) > 500 or p_paused is null then
    raise exception 'invalid_request' using errcode='22023';
  end if;

  for ch in
    select c.id, c.workspace_id from public.channels c
     where c.id = any(p_channels)
       and (c.paused_at is null) = p_paused
     for update
  loop
    update public.channels
       set paused_at = case when p_paused then now() end,
           paused_by = case when p_paused then uid end
     where id = ch.id;
    changed := changed + 1;
    if p_paused then
      with gone as (
        update public.jobs set status = 'cancelled', error_code = 'channel_paused'
         where workspace_id = ch.workspace_id and channel_id = ch.id
           and status = 'queued'
        returning 1)
      select cancelled + count(*) into cancelled from gone;
    end if;
    insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
    values (ch.workspace_id, uid,
            case when p_paused then 'channel_paused' else 'channel_resumed' end,
            'channel', ch.id::text);
  end loop;

  return jsonb_build_object('changed', changed, 'cancelled_jobs', cancelled);
end $$;

revoke all on function public.admin_set_channels_paused(uuid[], boolean) from public, anon;
grant execute on function public.admin_set_channels_paused(uuid[], boolean) to authenticated;

-- The scheduler, as 20261012000000 left it, skipping paused channels.
create or replace function private.schedule_due_work(w uuid)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare ch record; d int := 0; k int := 0; a int := 0; cat int; begin
  -- Automatically unblock any blocked jobs whose wait duration elapsed
  perform private.unblock_due_jobs();

  cat := coalesce(private.plan_limit(w, 'catalogue_interval'), 1440);
  for ch in select id, catalogued_at from public.channels
             where workspace_id = w and status in ('connected', 'public_unverified')
               and paused_at is null loop
    if ch.catalogued_at is null
       or ch.catalogued_at < now() - make_interval(mins => cat) then
      if private.enqueue_scheduled(w, ch.id, 'discover') is not null then d := d + 1; end if;
    end if;

    perform private.auto_select_videos(w, ch.id);

    if private.has_due_videos(w, ch.id) then
      if private.enqueue_scheduled(w, ch.id, 'collect') is not null then k := k + 1; end if;
    end if;

    if private.topics_pending(w, ch.id) then
      if private.enqueue_scheduled(w, ch.id, 'analyse') is not null then a := a + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('discover', d, 'collect', k, 'analyse', a);
end $function$;

-- The automatic selection, as 20261012000000 left it, selecting nothing for
-- a paused channel.
create or replace function private.auto_select_videos(w uuid, c uuid)
returns integer
language plpgsql security definer set search_path='' as $$
declare
  cfg private.channel_auto_selection;
  remaining bigint;
  room integer;
  picked uuid[];
  v uuid;
begin
  select * into cfg from private.channel_auto_selection
   where workspace_id = w and channel_id = c
   for update skip locked;
  if not found then return 0; end if;

  if not exists (select 1 from public.channels
                  where workspace_id = w and id = c and catalogued_at is not null
                    and paused_at is null)
     or exists (select 1 from public.jobs
                 where workspace_id = w and channel_id = c and type = 'discover'
                   and status in ('queued', 'running')) then
    return 0;
  end if;

  remaining := private.analysis_remaining(w);
  if remaining is not null and remaining <= 0 then return 0; end if;

  if cfg.initial_done_at is null then
    select coalesce(array_agg(x.id), '{}') into picked from (
      select vd.id from public.videos vd
       where vd.workspace_id = w and vd.channel_id = c
         and vd.kind in ('video', 'short', 'stream')
         and vd.comments_state <> 'disabled'
         and not exists (select 1 from public.video_selections s
                          where s.workspace_id = w and s.video_id = vd.id)
       order by vd.published_at desc nulls last, vd.id
       limit cfg.initial_count) x;
    update private.channel_auto_selection
       set initial_done_at = now(),
           watermark = coalesce(
             (select max(vd.published_at) from public.videos vd
               where vd.workspace_id = w and vd.channel_id = c), now())
     where workspace_id = w and channel_id = c;
  else
    room := cfg.daily_cap - (
      select count(*) from private.auto_selected_videos a
       where a.workspace_id = w and a.channel_id = c and not a.initial
         and a.selected_at > now() - interval '24 hours');
    if room <= 0 then return 0; end if;
    select coalesce(array_agg(x.id), '{}') into picked from (
      select vd.id from public.videos vd
       where vd.workspace_id = w and vd.channel_id = c
         and vd.kind in ('video', 'short', 'stream')
         and vd.comments_state <> 'disabled'
         and vd.published_at > cfg.watermark
         and not exists (select 1 from public.video_selections s
                          where s.workspace_id = w and s.video_id = vd.id)
         and not exists (select 1 from private.auto_selected_videos a
                          where a.workspace_id = w and a.video_id = vd.id)
       order by vd.published_at desc, vd.id
       limit room) x;
  end if;

  foreach v in array picked loop
    insert into public.video_selections(workspace_id, channel_id, video_id, selected_by)
    values (w, c, v, cfg.created_by)
    on conflict (workspace_id, video_id) do nothing;
    insert into private.auto_selected_videos(workspace_id, video_id, channel_id, initial)
    values (w, v, c, cfg.initial_done_at is null)
    on conflict (workspace_id, video_id) do nothing;
    perform private.adopt_video_comments_and_predictions(w, v);
  end loop;
  return cardinality(picked);
end $$;

-- The states, as 20261016000000 left them, with `paused` first.
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
           when c.paused_at is not null then 'paused'
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

-- The home counts the new state with the others.
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
      'paused', (select count(*) from st where state = 'paused'),
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
