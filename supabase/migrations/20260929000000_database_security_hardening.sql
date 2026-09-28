-- WO-2: keep public-channel reuse inside the public-data boundary.

create or replace function private.has_role(
  w uuid,
  allowed text[] default array['workspace_owner','analyst','viewer']
)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (
    exists(
      select 1 from public.memberships m
      where m.workspace_id = w
        and m.user_id = (select auth.uid())
        and m.role = any(allowed)
    )
    or (
      'viewer' = any(allowed)
      and exists(
        select 1 from private.platform_admins pa
        where pa.user_id = (select auth.uid())
      )
    )
  );
$$;

revoke all on function private.has_role(uuid, text[]) from public, anon;
grant execute on function private.has_role(uuid, text[]) to authenticated;

create or replace function private.adopt_channel_catalogue(w uuid, c uuid)
returns int language plpgsql security definer set search_path='' as $$
declare
  ch public.channels;
  adopted_count int := 0;
begin
  select * into ch from public.channels
   where workspace_id = w and id = c;
  if ch.id is null then return 0; end if;

  insert into public.videos (
    workspace_id, channel_id, platform, external_video_id, title, kind,
    published_at, duration_sec, thumbnail_url, reported_comment_count,
    reported_comment_count_at, comments_state, view_count, like_count, favorite_count,
    tags, description, category_id, catalogued_at, last_observed_at,
    field_provenance
  )
  select distinct on (v.external_video_id)
    w, c, v.platform, v.external_video_id, v.title, v.kind,
    v.published_at, v.duration_sec, v.thumbnail_url, v.reported_comment_count,
    v.reported_comment_count_at, v.comments_state, v.view_count, v.like_count, v.favorite_count,
    v.tags, v.description, v.category_id, v.catalogued_at, now(),
    coalesce(v.field_provenance, '{}'::jsonb)
  from public.channels donor_ch
  join public.videos v
    on v.workspace_id = donor_ch.workspace_id and v.channel_id = donor_ch.id
  where donor_ch.platform = ch.platform
    and donor_ch.external_channel_id = ch.external_channel_id
    and donor_ch.workspace_id <> w
    and donor_ch.status <> 'disconnected'
  order by v.external_video_id, donor_ch.id, v.id
  on conflict (workspace_id, platform, external_video_id) do update set
    title = case when excluded.title <> excluded.external_video_id
                 then excluded.title else public.videos.title end,
    kind = excluded.kind,
    thumbnail_url = coalesce(excluded.thumbnail_url, public.videos.thumbnail_url),
    reported_comment_count = coalesce(excluded.reported_comment_count, public.videos.reported_comment_count),
    reported_comment_count_at = coalesce(excluded.reported_comment_count_at, public.videos.reported_comment_count_at),
    comments_state = excluded.comments_state,
    view_count = coalesce(excluded.view_count, public.videos.view_count),
    like_count = coalesce(excluded.like_count, public.videos.like_count),
    favorite_count = coalesce(excluded.favorite_count, public.videos.favorite_count),
    tags = case when excluded.tags <> '{}'::text[] then excluded.tags else public.videos.tags end,
    description = coalesce(nullif(excluded.description, ''), public.videos.description),
    category_id = coalesce(excluded.category_id, public.videos.category_id),
    last_observed_at = now();

  get diagnostics adopted_count = row_count;
  if adopted_count > 0 and ch.catalogued_at is null then
    update public.channels set catalogued_at = now()
     where workspace_id = w and id = c;
  end if;
  return adopted_count;
end $$;

revoke all on function private.adopt_channel_catalogue(uuid, uuid) from public, anon, authenticated;
grant execute on function private.adopt_channel_catalogue(uuid, uuid) to service_role;

create or replace function private.adopt_video_comments_and_predictions(w uuid, v uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  vid public.videos;
  donor_vid uuid;
  donor_ws uuid;
  donor_complete boolean := false;
  adopted_comments int := 0;
  total_stored int := 0;
begin
  select * into vid from public.videos
   where workspace_id = w and id = v;
  if vid.id is null then
    return jsonb_build_object('comments', 0, 'sentiment', 0, 'topics', 0);
  end if;

  select donor_v.id, donor_v.workspace_id,
         coalesce(donor_s.last_outcome in ('exhausted', 'unchanged'), false)
    into donor_vid, donor_ws, donor_complete
  from public.channels target_ch
  join public.channels donor_ch
    on donor_ch.platform = target_ch.platform
   and donor_ch.external_channel_id = target_ch.external_channel_id
   and donor_ch.workspace_id <> w
   and donor_ch.status <> 'disconnected'
  join public.videos donor_v
    on donor_v.workspace_id = donor_ch.workspace_id
   and donor_v.channel_id = donor_ch.id
   and donor_v.platform = vid.platform
   and donor_v.external_video_id = vid.external_video_id
  join public.comments donor_comment
    on donor_comment.workspace_id = donor_v.workspace_id
   and donor_comment.video_id = donor_v.id
  left join public.video_selections donor_s
    on donor_s.workspace_id = donor_v.workspace_id
   and donor_s.video_id = donor_v.id
  where target_ch.workspace_id = w and target_ch.id = vid.channel_id
  order by donor_ch.id, donor_v.id
  limit 1;

  if donor_vid is null then
    return jsonb_build_object('comments', 0, 'sentiment', 0, 'topics', 0);
  end if;

  -- Platform collection is the explicit allowlist below. external_import and
  -- sanitized_fixture are excluded, and file_upload provenance is refused even
  -- if a malformed row carries an allowed source. New collectors must opt in.
  insert into public.comments (
    workspace_id, video_id, platform, external_comment_id, external_parent_id,
    is_reply, parent_source, author_channel_id, author_name, text_raw, text_plain,
    content_hash, published_time_raw, published_at, timestamp_precision,
    likes_raw, likes_value, source, field_provenance,
    author_profile_image_url, author_channel_url, reply_count, updated_at
  )
  select
    w, v, c.platform, c.external_comment_id, c.external_parent_id,
    c.is_reply, c.parent_source, c.author_channel_id, c.author_name, c.text_raw, c.text_plain,
    c.content_hash, c.published_time_raw, c.published_at, c.timestamp_precision,
    c.likes_raw, c.likes_value, c.source, c.field_provenance,
    c.author_profile_image_url, c.author_channel_url, coalesce(c.reply_count, 0), c.updated_at
  from public.comments c
  where c.workspace_id = donor_ws
    and c.video_id = donor_vid
    and c.source in (
      'youtube_data_api_public', 'youtube_oauth', 'telegram_mtproto',
      'x_api', 'tiktok_display_api', 'apify', 'brightdata'
    )
    and coalesce(c.field_provenance->>'source', '') <> 'file_upload'
  on conflict (workspace_id, platform, external_comment_id) do nothing;

  get diagnostics adopted_comments = row_count;

  if donor_complete and adopted_comments > 0 then
    select count(*)::int into total_stored from public.comments
     where workspace_id = w and video_id = v;
    update public.video_selections
       set last_seen_comment_count = total_stored,
           last_collected_at = (select max(last_seen_at) from public.comments
                                where workspace_id = w and video_id = v),
           last_outcome = 'exhausted',
           next_check_at = now() + make_interval(
             mins => coalesce(private.plan_limit(w, 'live_interval'), 1440))
     where workspace_id = w and video_id = v;
  end if;

  return jsonb_build_object(
    'comments', adopted_comments, 'sentiment', 0, 'topics', 0
  );
end $$;

revoke all on function private.adopt_video_comments_and_predictions(uuid, uuid) from public, anon, authenticated;
grant execute on function private.adopt_video_comments_and_predictions(uuid, uuid) to service_role;

create or replace function private.adopt_channel_content(w uuid, c uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  ch public.channels;
  target_video record;
  adopted jsonb;
  vids_adopted int := 0;
  comments_adopted int := 0;
begin
  select * into ch from public.channels
   where workspace_id = w and id = c;
  if ch.id is null then
    return jsonb_build_object('videos', 0, 'comments', 0, 'sentiment', 0, 'topics', 0);
  end if;

  vids_adopted := private.adopt_channel_catalogue(w, c);
  for target_video in
    select v.id from public.videos v
     where v.workspace_id = w and v.channel_id = c
     order by v.id
  loop
    adopted := private.adopt_video_comments_and_predictions(w, target_video.id);
    comments_adopted := comments_adopted + coalesce((adopted->>'comments')::int, 0);
  end loop;

  return jsonb_build_object(
    'videos', vids_adopted, 'comments', comments_adopted,
    'sentiment', 0, 'topics', 0
  );
end $$;

revoke all on function private.adopt_channel_content(uuid, uuid) from public, anon, authenticated;
grant execute on function private.adopt_channel_content(uuid, uuid) to service_role;

create or replace function private.register_public_channel_impl(
  w uuid, c uuid, external text, handle text, title text, p_platform text default 'youtube'
) returns public.channels
language plpgsql security definer set search_path='' as $$
declare
  ch public.channels;
begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if not exists (
    select 1
    from public.subscriptions s
    join public.plans p on p.key = s.plan_key
    where s.workspace_id = private.billing_root(w)
      and private.subscription_open(s)
      and (p.allow_public_channels or p.internal)
  ) then
    raise exception 'public_channels_not_allowed_on_plan' using errcode='53400';
  end if;
  if not exists(select 1 from public.clients where workspace_id=w and id=c) then
    raise exception 'invalid_client' using errcode='23503';
  end if;
  if p_platform not in ('youtube', 'telegram', 'x', 'tiktok', 'facebook', 'instagram') then
    raise exception 'invalid_platform' using errcode='22023';
  end if;
  if p_platform = 'youtube' then
    if external !~ '^UC[A-Za-z0-9_-]{22}$' then
      raise exception 'invalid_channel_id' using errcode='22023'; end if;
  elsif p_platform = 'telegram' then
    if external !~ '^(@?[A-Za-z0-9_]{4,64}|-?[0-9]+)$' then
      raise exception 'invalid_channel_id' using errcode='22023'; end if;
  elsif length(trim(external)) < 1 or length(external) > 100 then
    raise exception 'invalid_channel_id' using errcode='22023';
  end if;

  handle := nullif(trim(coalesce(handle, '')), '');
  title := nullif(trim(coalesce(title, '')), '');
  if handle is not null and length(handle) > 50 then
    raise exception 'invalid_channel_handle' using errcode='22023'; end if;
  if title is not null and length(title) > 200 then
    raise exception 'invalid_channel_title' using errcode='22023'; end if;

  insert into public.channels(workspace_id, client_id, external_channel_id, handle, title, platform)
  values (w, c, external, handle, title, p_platform)
  on conflict (workspace_id, platform, external_channel_id) do nothing
  returning * into ch;
  if ch.id is null then
    select * into ch from public.channels
     where workspace_id = w and platform = p_platform
       and external_channel_id = external and client_id = c;
    if ch.id is null then
      raise exception 'channel_claimed_by_other_client' using errcode='23505';
    end if;
  end if;

  perform private.adopt_channel_content(w, ch.id);
  return ch;
end $$;

revoke all on function private.register_public_channel_impl(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function private.register_public_channel_impl(uuid, uuid, text, text, text, text) to authenticated;

revoke all on function public.channel_lookup_reader_grant() from public, anon, authenticated;
grant execute on function public.channel_lookup_reader_grant() to service_role;
