-- The platform owner's bulk import: one public YouTube channel becomes one
-- workspace named after it, with the channel attached and its first
-- collection requested.
--
-- The admin page reads a CSV of channels, names each one through
-- `channel-lookup` (the owner confirms every match), then calls this once per
-- channel. One call per channel keeps each import its own transaction: a
-- failed row leaves no half-made workspace behind, and the page can show
-- progress and a per-row verdict.
--
-- A channel the owner's account already holds in any workspace (created or
-- joined, retired ones included) is not imported again: the answer is
-- `exists` with the workspace that holds it. An advisory lock per channel
-- makes that check and the insert one step, so two tabs importing the same
-- list cannot both pass it.
--
-- Everything else goes through the same functions a person adding one
-- channel by hand goes through: `create_workspace_impl` (the plan's workspace
-- limit, the billing link to the owner's home workspace),
-- `register_public_channel_impl` (the plan's public-channel rule, the id
-- format) and `request_discovery_impl` (the first catalogue run). From then
-- on the scheduler keeps the channel catalogued like any other.
--
-- Comments are collected for selected videos only. An imported channel also
-- gets an automatic selection (owner decision, 2026-10-09): once its first
-- catalogue run is done, its latest 20 videos are selected; after that,
-- videos it publishes later are selected as they are catalogued, at most 5
-- a day. Never the whole back catalogue at once. Both numbers are the
-- import's arguments, kept per channel in `private.channel_auto_selection`.

create table private.channel_auto_selection (
  workspace_id uuid not null,
  channel_id uuid not null,
  initial_count integer not null check (initial_count between 0 and 200),
  daily_cap integer not null check (daily_cap between 0 and 100),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  -- When the first selection ran, and the newest publish time it saw: a
  -- later video is one published after this mark.
  initial_done_at timestamptz,
  watermark timestamptz,
  primary key (workspace_id, channel_id),
  foreign key (workspace_id, channel_id)
    references public.channels(workspace_id, id) on delete cascade
);

-- Every video the automatic selection chose, so the daily cap can be counted
-- and a video a person later deselects is never chosen again.
create table private.auto_selected_videos (
  workspace_id uuid not null,
  video_id uuid not null,
  channel_id uuid not null,
  -- The first selection does not count against the daily cap.
  initial boolean not null default false,
  selected_at timestamptz not null default now(),
  primary key (workspace_id, video_id),
  foreign key (workspace_id, video_id)
    references public.videos(workspace_id, id) on delete cascade
);
create index auto_selected_videos_recent
  on private.auto_selected_videos (workspace_id, channel_id, selected_at);

revoke all on table private.channel_auto_selection from public, anon, authenticated;
revoke all on table private.auto_selected_videos from public, anon, authenticated;

-- One channel's automatic selection, run by the scheduler before it decides
-- whether a collection is due. Selects nothing while the channel's catalogue
-- run is still queued or running (the catalogue arrives in batches), nor when
-- the plan's analysis allowance is spent. Returns how many it selected.
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
                  where workspace_id = w and id = c and catalogued_at is not null)
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

revoke all on function private.auto_select_videos(uuid, uuid) from public, anon, authenticated;
-- The worker gateway runs the scheduler as service_role, like its other helpers.
grant execute on function private.auto_select_videos(uuid, uuid) to service_role;

-- The scheduler, as it was, with the automatic selection run first for each
-- channel so a video it selects is collected in the same tick.
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
             where workspace_id = w and status in ('connected', 'public_unverified') loop
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

create or replace function public.admin_import_channel(
  p_external text,
  p_title text default null,
  p_handle text default null,
  p_platform text default 'youtube',
  p_initial_videos integer default 20,
  p_daily_new_videos integer default 5
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
  v_platform text := coalesce(nullif(trim(p_platform), ''), 'youtube');
  v_external text := trim(coalesce(p_external, ''));
  v_name text;
  held record;
  w uuid;
  c uuid;
  ch public.channels;
  j uuid;
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  -- YouTube only: the lookup names YouTube channels by id; the other
  -- platforms have no id this import could confirm.
  if v_platform <> 'youtube' then
    raise exception 'invalid_platform' using errcode='22023';
  end if;
  if v_external !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise exception 'invalid_channel_id' using errcode='22023';
  end if;

  -- The workspace is named after the channel: its title, else its handle,
  -- else its id. Cut to the 120 characters a workspace name may hold.
  v_name := left(coalesce(nullif(trim(coalesce(p_title, '')), ''),
                          nullif(trim(coalesce(p_handle, '')), ''),
                          v_external), 120);

  perform pg_advisory_xact_lock(
    hashtext('admin_import_channel:' || v_platform || ':' || v_external));

  select ws.id, ws.name into held
    from public.channels chn
    join public.workspaces ws on ws.id = chn.workspace_id
   where chn.platform = v_platform
     and chn.external_channel_id = v_external
     and (ws.created_by = uid
          or exists (select 1 from public.memberships m
                      where m.workspace_id = ws.id and m.user_id = uid))
   order by ws.created_at
   limit 1;
  if found then
    return jsonb_build_object('status', 'exists',
                              'workspace_id', held.id,
                              'workspace_name', held.name);
  end if;

  w := private.create_workspace_impl(v_name);
  select id into c from public.clients where workspace_id = w limit 1;
  ch := private.register_public_channel_impl(w, c, v_external, p_handle, p_title, v_platform);
  j := private.request_discovery_impl(w, ch.id);
  insert into private.channel_auto_selection(workspace_id, channel_id, initial_count, daily_cap, created_by)
  values (w, ch.id, p_initial_videos, p_daily_new_videos, uid);

  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, uid, 'channel_imported', 'channel', ch.id::text);

  return jsonb_build_object('status', 'created',
                            'workspace_id', w,
                            'workspace_name', v_name,
                            'channel_id', ch.id,
                            'job_id', j);
end $$;

revoke all on function public.admin_import_channel(text, text, text, text, integer, integer) from public, anon;
grant execute on function public.admin_import_channel(text, text, text, text, integer, integer) to authenticated;
