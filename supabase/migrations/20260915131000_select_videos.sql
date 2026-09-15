-- The tenant chooses videos; the plan's remaining analysis units say how many.
-- This is the earlier layer. reserve_usage inside commit_batch stays the one
-- that spends, so a rule that meters is still enforced where the metering is.

create function private.analysis_remaining(w uuid) returns integer
language plpgsql stable security definer set search_path='' as $$
declare sub record; begin
  select s.period_start, pl.analysis_units into sub
    from public.subscriptions s join public.plans pl on pl.key = s.plan_key
   where s.workspace_id = w and s.status = 'active';
  if not found then raise exception 'no_active_plan' using errcode='53400'; end if;
  return greatest(0, sub.analysis_units
                     - private.used_units(w, 'comment_analysis', sub.period_start));
end $$;
revoke all on function private.analysis_remaining(uuid) from public, anon, authenticated;

create function private.select_videos_impl(w uuid, c uuid, add uuid[], remove uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare estimate int := 0; unknowns int := 0; remaining int; j uuid;
        queued boolean := false; deferred boolean := false; begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.channels where workspace_id=w and id=c) then
    raise exception 'invalid_channel' using errcode='23503'; end if;
  add := coalesce(add, '{}'::uuid[]); remove := coalesce(remove, '{}'::uuid[]);
  if exists(select 1 from unnest(add || remove) x(id)
             where not exists(select 1 from public.videos v
                               where v.workspace_id=w and v.channel_id=c and v.id=x.id)) then
    raise exception 'invalid_video' using errcode='23503'; end if;
  if exists(select 1 from public.videos v
             where v.workspace_id=w and v.id = any(add) and v.comments_state='disabled') then
    raise exception 'comments_disabled' using errcode='22023'; end if;

  -- Comments already in the database were already metered. A null count adds
  -- nothing to the sum and is reported apart, never as zero.
  select coalesce(sum(greatest(0, v.reported_comment_count
           - (select count(*) from public.comments cm
               where cm.workspace_id=w and cm.video_id=v.id))), 0)::int,
         count(*) filter (where v.reported_comment_count is null)::int
    into estimate, unknowns
    from public.videos v
   where v.workspace_id=w and v.id = any(add)
     and not exists(select 1 from public.video_selections s
                     where s.workspace_id=w and s.video_id=v.id);
  remaining := private.analysis_remaining(w);
  if estimate > remaining then
    raise exception 'quota_exceeded' using errcode='53400'; end if;

  delete from public.video_selections where workspace_id=w and video_id = any(remove);
  insert into public.video_selections(workspace_id, channel_id, video_id, selected_by)
  select w, c, x.id, (select auth.uid()) from unnest(add) x(id)
  on conflict (workspace_id, video_id) do nothing;

  if cardinality(add) > 0 then
    begin
      j := private.enqueue_sync_impl(w, c, 'selection-' || gen_random_uuid()::text);
      queued := true;
    exception when sqlstate '53400' then
      -- sync_too_soon. The selection is written; the tick picks it up.
      deferred := true;
    end;
  end if;
  return jsonb_build_object('job_id', j, 'queued', queued, 'deferred', deferred,
                            'estimate', estimate, 'unknown_count', unknowns,
                            'remaining_after', remaining - estimate);
end $$;
create function public.select_videos(w uuid, c uuid, add uuid[], remove uuid[]) returns jsonb
language sql security invoker set search_path='' as $$
  select private.select_videos_impl(w, c, add, remove) $$;

create function private.request_discovery_impl(w uuid, c uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j uuid; gap int; begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.channels where workspace_id=w and id=c) then
    raise exception 'invalid_channel' using errcode='23503'; end if;
  select id into j from public.jobs
   where workspace_id=w and channel_id=c and type='discover'
     and status in ('queued','running') order by created_at limit 1;
  if j is not null then return j; end if;
  gap := private.plan_limit(w, 'sync_interval');
  if gap is not null and gap > 0 and exists(
       select 1 from public.jobs where workspace_id=w and channel_id=c and type='discover'
         and created_at > now() - make_interval(mins => gap)) then
    raise exception 'sync_too_soon' using errcode='53400'; end if;
  begin
    insert into public.jobs(workspace_id, channel_id, type, dedupe_key)
    values (w, c, 'discover', 'discover-' || gen_random_uuid()::text) returning id into j;
  exception when unique_violation then
    select id into j from public.jobs
     where workspace_id=w and channel_id=c and type='discover'
       and status in ('queued','running') order by created_at limit 1;
  end;
  return j;
end $$;
create function public.request_discovery(w uuid, c uuid) returns uuid
language sql security invoker set search_path='' as $$
  select private.request_discovery_impl(w, c) $$;

revoke all on function private.select_videos_impl(uuid,uuid,uuid[],uuid[]),
  private.request_discovery_impl(uuid,uuid) from public;
grant execute on function private.select_videos_impl(uuid,uuid,uuid[],uuid[]),
  private.request_discovery_impl(uuid,uuid) to authenticated;
revoke all on function public.select_videos(uuid,uuid,uuid[],uuid[]),
  public.request_discovery(uuid,uuid) from public, anon;
grant execute on function public.select_videos(uuid,uuid,uuid[],uuid[]),
  public.request_discovery(uuid,uuid) to authenticated;
