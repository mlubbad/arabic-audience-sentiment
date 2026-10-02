-- Expose last_collected_at on private.due_videos so workers can perform
-- watermark-based incremental early stopping for comment collection.

create or replace function private.due_videos(w uuid, c uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('video_id', v.id, 'external_video_id', v.external_video_id,
                              'title', v.title,
                              'last_seen_comment_count', s.last_seen_comment_count,
                              'reported_comment_count', v.reported_comment_count,
                              'last_collected_at', s.last_collected_at)
           order by s.next_check_at, v.id), '[]'::jsonb)
    from public.video_selections s
    join public.videos v on v.workspace_id = s.workspace_id and v.id = s.video_id
   where s.workspace_id = w and s.channel_id = c
     and s.next_check_at <= now()
     and v.comments_state <> 'disabled';
$$;

revoke all on function private.due_videos(uuid,uuid) from public, anon, authenticated;
grant execute on function private.due_videos(uuid,uuid) to service_role;
