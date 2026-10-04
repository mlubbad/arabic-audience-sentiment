-- Keep user-triggered channel and selection reads independent of comment volume.

create or replace function public.admin_channels() returns setof jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return query
    select jsonb_build_object(
      'id', c.id, 'workspace_id', c.workspace_id, 'workspace_name', w.name,
      'external_channel_id', c.external_channel_id,
      'handle', c.handle, 'title', c.title, 'status', c.status,
      'video_count', (
        select count(*)
        from public.videos v
        where v.workspace_id = c.workspace_id
          and v.channel_id = c.id),
      'comment_count', (
        select coalesce(sum(s.total), 0)
        from public.videos v
        left join private.video_comment_stats s
          on s.workspace_id = v.workspace_id
         and s.video_id = v.id
        where v.workspace_id = c.workspace_id
          and v.channel_id = c.id),
      'last_sync_at', to_jsonb(ls.started_at),
      'last_sync_status', ls.status, 'last_sync_error', ls.error_code)
    from public.channels c
    join public.workspaces w on w.id = c.workspace_id
    left join lateral (
      select sr.started_at, sr.status, sr.error_code
      from public.sync_runs sr
      where sr.channel_id = c.id
      order by sr.started_at desc
      limit 1) ls on true
    order by w.created_at desc, c.external_channel_id;
end $$;
revoke all on function public.admin_channels() from public, anon;
grant execute on function public.admin_channels() to authenticated;

create or replace function private.select_videos_impl(w uuid, c uuid, add uuid[], remove uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare estimate bigint := 0; unknowns int := 0; outstanding bigint := 0; remaining bigint; j uuid;
        queued boolean := false; deferred boolean := false; running boolean := false;
        rec record;
begin
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
           - coalesce(stats.total, 0))), 0)::bigint,
         count(*) filter (where v.reported_comment_count is null)::int
    into estimate, unknowns
    from public.videos v
    left join private.video_comment_stats stats
      on stats.workspace_id=w and stats.video_id=v.id
   where v.workspace_id=w and v.id = any(add)
     and not exists(select 1 from public.video_selections s
                     where s.workspace_id=w and s.video_id=v.id);

  -- What is already chosen and not yet stored, priced the same way, across
  -- the whole workspace and before this call writes anything.
  select coalesce(sum(greatest(0, v.reported_comment_count
           - coalesce(stats.total, 0))), 0)::bigint
    into outstanding
    from public.video_selections s
    join public.videos v on v.workspace_id=w and v.id=s.video_id
    left join private.video_comment_stats stats
      on stats.workspace_id=w and stats.video_id=v.id
   where s.workspace_id=w and not (s.video_id = any(remove));

  -- A removal alone spends nothing and needs no plan: a paused tenant can still deselect.
  if cardinality(add) > 0 then
    remaining := private.analysis_remaining(w);
    if remaining is not null and estimate + outstanding > remaining then
      raise exception 'quota_exceeded' using errcode='53400'; end if;
  end if;

  delete from public.video_selections where workspace_id=w and video_id = any(remove);
  insert into public.video_selections(workspace_id, channel_id, video_id, selected_by)
  select w, c, x.id, (select auth.uid()) from unnest(add) x(id)
  on conflict (workspace_id, video_id) do nothing;

  -- Adopt comments and predictions from other workspaces for the newly selected videos
  if cardinality(add) > 0 then
    for rec in select x.id as video_id from unnest(add) x(id) loop
      perform private.adopt_video_comments_and_predictions(w, rec.video_id);
    end loop;
  end if;

  if cardinality(add) > 0 then
    select id into j from public.jobs
     where workspace_id=w and channel_id=c and type='collect' and status='running'
     order by created_at limit 1;
    if j is not null then
      running := true;
    else
      begin
        j := private.enqueue_sync_impl(w, c, 'selection-' || gen_random_uuid()::text);
        select status = 'running' into running from public.jobs where id = j;
        queued := not running;
      exception when sqlstate '53400' then
        deferred := true;
      end;
    end if;
  end if;

  return jsonb_build_object('job_id', j, 'queued', queued, 'deferred', deferred,
                            'already_running', running,
                            'estimate', estimate, 'unknown_count', unknowns,
                            'outstanding', outstanding,
                            'remaining_after', case when remaining is null then -1 else remaining - outstanding - estimate end);
end $$;
revoke all on function private.select_videos_impl(uuid, uuid, uuid[], uuid[]) from public, anon;
grant execute on function private.select_videos_impl(uuid, uuid, uuid[], uuid[]) to authenticated;
