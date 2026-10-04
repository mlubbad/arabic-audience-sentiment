-- Show operators when each channel last collected comments successfully.

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
      'last_sync_status', ls.status, 'last_sync_error', ls.error_code,
      'last_collect_ok_at', to_jsonb(lc.collected_at))
    from public.channels c
    join public.workspaces w on w.id = c.workspace_id
    left join lateral (
      select sr.started_at, sr.status, sr.error_code
      from public.sync_runs sr
      where sr.channel_id = c.id
      order by sr.started_at desc
      limit 1) ls on true
    left join lateral (
      select coalesce(sr.ended_at, sr.started_at) as collected_at
      from public.sync_runs sr
      where sr.channel_id = c.id
        and sr.mode = 'collect'
        and sr.status in ('succeeded', 'partial')
      order by sr.started_at desc
      limit 1) lc on true
    order by w.created_at desc, c.external_channel_id;
end $$;
revoke all on function public.admin_channels() from public, anon;
grant execute on function public.admin_channels() to authenticated;
