-- Bulk actions in the owner console's channels page (phase 2, step 2, owner
-- approval 2026-10-09). Pausing and resuming already take a list
-- (`admin_set_channels_paused`, 20261018000000); these two add the rest.
--
-- `admin_request_channel_work(channels, kind)` asks for a collection
-- (`collect`) or a fresh catalogue (`discover`) now, for each channel that
-- can take one:
--   * a paused channel is skipped: the pause is the owner's own stop;
--   * a channel with that kind of job already queued or running is skipped:
--     that job is the answer (the one-outstanding indexes say the same);
--   * a collection is skipped for a channel with no selected video, which
--     would have nothing to collect.
-- It answers how many were queued and how many skipped, and audits each
-- one queued. Like a scheduled job, the worker still checks the plan's
-- allowance when it runs it.
--
-- `admin_set_auto_selection(channels, initial, daily)` sets the automatic
-- selection numbers, creating them for a channel that had none (a channel
-- added by hand, or a customer's). The initial number only matters until the
-- first selection has run; the daily one applies from the next tick. The
-- selection is made in the name of the workspace's creator, as an import's
-- is. Audited per channel.

create or replace function public.admin_request_channel_work(
  p_channels uuid[],
  p_kind text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
  queued integer := 0;
  skipped integer := 0;
  ch record;
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_kind not in ('collect', 'discover') or p_channels is null
     or cardinality(p_channels) = 0 or cardinality(p_channels) > 500 then
    raise exception 'invalid_request' using errcode='22023';
  end if;

  for ch in
    select c.id, c.workspace_id, c.paused_at from public.channels c
     where c.id = any(p_channels)
  loop
    if ch.paused_at is not null
       or exists (select 1 from public.jobs j
                   where j.workspace_id = ch.workspace_id and j.channel_id = ch.id
                     and j.type = p_kind and j.status in ('queued', 'running'))
       or (p_kind = 'collect' and not exists (
             select 1 from public.video_selections s
              where s.workspace_id = ch.workspace_id and s.channel_id = ch.id)) then
      skipped := skipped + 1;
      continue;
    end if;
    begin
      insert into public.jobs(workspace_id, channel_id, type, dedupe_key)
      values (ch.workspace_id, ch.id, p_kind, p_kind || '-admin-' || gen_random_uuid()::text);
    exception when unique_violation then
      skipped := skipped + 1;
      continue;
    end;
    queued := queued + 1;
    insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
    values (ch.workspace_id, uid,
            case p_kind when 'collect' then 'channel_collect_requested'
                        else 'channel_catalogue_requested' end,
            'channel', ch.id::text);
  end loop;

  return jsonb_build_object('queued', queued, 'skipped', skipped);
end $$;

revoke all on function public.admin_request_channel_work(uuid[], text) from public, anon;
grant execute on function public.admin_request_channel_work(uuid[], text) to authenticated;

create or replace function public.admin_set_auto_selection(
  p_channels uuid[],
  p_initial integer,
  p_daily integer
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
  changed integer := 0;
  ch record;
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_channels is null or cardinality(p_channels) = 0
     or cardinality(p_channels) > 500
     or p_initial is null or p_initial not between 0 and 200
     or p_daily is null or p_daily not between 0 and 100 then
    raise exception 'invalid_request' using errcode='22023';
  end if;

  for ch in
    select c.id, c.workspace_id, w.created_by
      from public.channels c
      join public.workspaces w on w.id = c.workspace_id
     where c.id = any(p_channels)
  loop
    insert into private.channel_auto_selection as a
           (workspace_id, channel_id, initial_count, daily_cap, created_by)
    values (ch.workspace_id, ch.id, p_initial, p_daily, ch.created_by)
    on conflict (workspace_id, channel_id) do update
       set initial_count = excluded.initial_count,
           daily_cap = excluded.daily_cap;
    changed := changed + 1;
    insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
    values (ch.workspace_id, uid, 'auto_selection_set', 'channel', ch.id::text);
  end loop;

  return jsonb_build_object('changed', changed);
end $$;

revoke all on function public.admin_set_auto_selection(uuid[], integer, integer) from public, anon;
grant execute on function public.admin_set_auto_selection(uuid[], integer, integer) to authenticated;
