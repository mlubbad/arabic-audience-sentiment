-- Channel indexing & comment ingestion hardening (ADR-0007):
-- 1. `private.worker_video_counts`: when a selected video's reported comment count
--    is verified unchanged on the source (`last_outcome` -> `'unchanged'`), refresh
--    `last_seen_at = now()` on its non-purged comments so active monitored videos
--    with stable comment counts do not have their comment text prematurely purged
--    after 30 days by `private.purge_comment_text`.
-- 2. `private.worker_known_videos`: guarantee that the 200 most recent videos of
--    every `kind` (`video`, `short`, `stream`) are always retained within the
--    5,000-video known list, so a channel with >5,000 items in one tab (e.g.
--    Shorts or regular uploads) never evicts the head of a less-frequent tab
--    (e.g. Livestreams) and never triggers a full-tab re-crawl on refresh.
-- 3. `private.adopt_video_comments_and_predictions` & `private.adopt_channel_content`:
--    include Facebook and Instagram collector sources in the public-collection
--    allowlist, and replace the row-by-row per-video loop in `adopt_channel_content`
--    with a single set-based bulk `INSERT INTO public.comments ... SELECT ...` and
--    set-based `UPDATE public.video_selections`.

CREATE OR REPLACE FUNCTION private.worker_video_counts(token_hash text, j uuid, t uuid, payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
declare w uuid; c uuid; iv int; updated int; unchanged int; begin
  w := private.worker_job(token_hash, j, t);
  select channel_id into c from public.jobs where id = j;
  if payload is null or jsonb_typeof(payload) <> 'array' then
    raise exception 'invalid_counts' using errcode='22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(payload) i
     where jsonb_typeof(i) <> 'object'
        or coalesce(i->>'external_video_id','') !~ '^[A-Za-z0-9_-]{11}$'
        or not (i ? 'comment_count')
        or jsonb_typeof(i->'comment_count') not in ('number','null')
        or (jsonb_typeof(i->'comment_count') = 'number'
            and (i->>'comment_count') !~ '^[0-9]+$')) then
    raise exception 'invalid_counts' using errcode='22023'; end if;

  update public.videos v
     set reported_comment_count = coalesce(p.cnt, v.reported_comment_count),
         reported_comment_count_at = now()
    from (select distinct on (i->>'external_video_id')
                 i->>'external_video_id' as ext, (i->>'comment_count')::int as cnt
            from jsonb_array_elements(payload) with ordinality as x(i, ord)
           order by i->>'external_video_id', ord desc) p
   where v.workspace_id = w and v.channel_id = c and v.external_video_id = p.ext;
  get diagnostics updated = row_count;

  iv := coalesce(private.plan_limit(w, 'live_interval'), 1440);
  with deferred as (
    update public.video_selections s
       set next_check_at = now() + make_interval(mins => iv),
           last_outcome = 'unchanged'
      from public.videos v
      join (select distinct on (i->>'external_video_id')
                   i->>'external_video_id' as ext, (i->>'comment_count')::int as cnt
              from jsonb_array_elements(payload) with ordinality as x(i, ord)
             order by i->>'external_video_id', ord desc) p on p.ext = v.external_video_id
     where s.workspace_id = w and s.channel_id = c and s.video_id = v.id
       and v.workspace_id = w and v.channel_id = c
       and p.cnt is not null and s.last_seen_comment_count = p.cnt
       and s.last_outcome in ('exhausted', 'unchanged')
     returning s.video_id
  ), touched_comments as (
    update public.comments cm
       set last_seen_at = now()
      from deferred d
     where cm.workspace_id = w
       and cm.video_id = d.video_id
       and cm.content_purged_at is null
  )
  select count(*)::int into unchanged from deferred;

  return jsonb_build_object(
    'read', coalesce((select jsonb_agg(d->'external_video_id')
                        from jsonb_array_elements(private.due_videos(w, c)) d), '[]'::jsonb),
    'unchanged', unchanged, 'updated', updated);
end $function$;

CREATE OR REPLACE FUNCTION private.worker_known_videos(token_hash text, j uuid, t uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE w uuid; c uuid; job_type text; c_platform text; c_catalogued timestamptz; BEGIN
  w := private.worker_job(token_hash, j, t);
  SELECT channel_id, type INTO c, job_type FROM public.jobs WHERE id = j;
  SELECT coalesce(platform, 'youtube'), catalogued_at
    INTO c_platform, c_catalogued
    FROM public.channels WHERE workspace_id = w AND id = c;
  IF job_type <> 'discover' OR c_platform <> 'youtube' OR c_catalogued IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(k.external_video_id ORDER BY k.published_at DESC NULLS LAST, k.external_video_id)
      FROM (SELECT v.external_video_id, v.published_at
              FROM (
                SELECT v.external_video_id, v.published_at,
                       row_number() OVER (
                         PARTITION BY v.kind
                         ORDER BY v.published_at DESC NULLS LAST, v.external_video_id
                       ) AS kind_rn
                  FROM public.videos v
                 WHERE v.workspace_id = w AND v.channel_id = c AND v.platform = 'youtube'
              ) v
             ORDER BY (v.kind_rn <= 200) DESC, v.published_at DESC NULLS LAST, v.external_video_id
             LIMIT 5000) k), '[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION private.adopt_video_comments_and_predictions(w uuid, v uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
      'x_api', 'tiktok_display_api', 'apify', 'brightdata',
      'facebook_graph_api', 'facebook_apify', 'facebook_brightdata',
      'instagram_graph_api', 'instagram_apify', 'instagram_brightdata'
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
end $function$;

CREATE OR REPLACE FUNCTION private.adopt_channel_content(w uuid, c uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  ch public.channels;
  vids_adopted int := 0;
  comments_adopted int := 0;
  iv int;
begin
  select * into ch from public.channels
   where workspace_id = w and id = c;
  if ch.id is null then
    return jsonb_build_object('videos', 0, 'comments', 0, 'sentiment', 0, 'topics', 0);
  end if;

  vids_adopted := private.adopt_channel_catalogue(w, c);
  iv := coalesce(private.plan_limit(w, 'live_interval'), 1440);

  with donor_map as (
    select distinct on (target_v.id)
      target_v.id as target_vid,
      donor_v.id as donor_vid,
      donor_v.workspace_id as donor_ws,
      coalesce(donor_s.last_outcome in ('exhausted', 'unchanged'), false) as donor_complete
    from public.videos target_v
    join public.channels donor_ch
      on donor_ch.platform = ch.platform
     and donor_ch.external_channel_id = ch.external_channel_id
     and donor_ch.workspace_id <> w
     and donor_ch.status <> 'disconnected'
    join public.videos donor_v
      on donor_v.workspace_id = donor_ch.workspace_id
     and donor_v.channel_id = donor_ch.id
     and donor_v.platform = target_v.platform
     and donor_v.external_video_id = target_v.external_video_id
    left join public.video_selections donor_s
      on donor_s.workspace_id = donor_v.workspace_id
     and donor_s.video_id = donor_v.id
    where target_v.workspace_id = w
      and target_v.channel_id = c
      and exists (
        select 1 from public.comments dc
         where dc.workspace_id = donor_v.workspace_id
           and dc.video_id = donor_v.id
      )
    order by target_v.id, donor_ch.id, donor_v.id
  ), inserted_comments as (
    insert into public.comments (
      workspace_id, video_id, platform, external_comment_id, external_parent_id,
      is_reply, parent_source, author_channel_id, author_name, text_raw, text_plain,
      content_hash, published_time_raw, published_at, timestamp_precision,
      likes_raw, likes_value, source, field_provenance,
      author_profile_image_url, author_channel_url, reply_count, updated_at
    )
    select
      w, dm.target_vid, cm.platform, cm.external_comment_id, cm.external_parent_id,
      cm.is_reply, cm.parent_source, cm.author_channel_id, cm.author_name, cm.text_raw, cm.text_plain,
      cm.content_hash, cm.published_time_raw, cm.published_at, cm.timestamp_precision,
      cm.likes_raw, cm.likes_value, cm.source, cm.field_provenance,
      cm.author_profile_image_url, cm.author_channel_url, coalesce(cm.reply_count, 0), cm.updated_at
    from donor_map dm
    join public.comments cm
      on cm.workspace_id = dm.donor_ws
     and cm.video_id = dm.donor_vid
    where cm.source in (
      'youtube_data_api_public', 'youtube_oauth', 'telegram_mtproto',
      'x_api', 'tiktok_display_api', 'apify', 'brightdata',
      'facebook_graph_api', 'facebook_apify', 'facebook_brightdata',
      'instagram_graph_api', 'instagram_apify', 'instagram_brightdata'
    )
      and coalesce(cm.field_provenance->>'source', '') <> 'file_upload'
    on conflict (workspace_id, platform, external_comment_id) do nothing
    returning video_id
  ), completed_targets as (
    select distinct ic.video_id
      from inserted_comments ic
      join donor_map dm on dm.target_vid = ic.video_id
     where dm.donor_complete
  ), updated_selections as (
    update public.video_selections s
       set last_seen_comment_count = (
             select count(*)::int from public.comments c_cnt
              where c_cnt.workspace_id = w and c_cnt.video_id = s.video_id
           ),
           last_collected_at = (
             select max(c_max.last_seen_at) from public.comments c_max
              where c_max.workspace_id = w and c_max.video_id = s.video_id
           ),
           last_outcome = 'exhausted',
           next_check_at = now() + make_interval(mins => iv)
      from completed_targets ct
     where s.workspace_id = w
       and s.video_id = ct.video_id
  )
  select count(*)::int into comments_adopted from inserted_comments;

  return jsonb_build_object(
    'videos', vids_adopted, 'comments', comments_adopted,
    'sentiment', 0, 'topics', 0
  );
end $function$;

REVOKE ALL ON FUNCTION
  private.worker_video_counts(text,uuid,uuid,jsonb),
  private.worker_known_videos(text,uuid,uuid),
  private.adopt_video_comments_and_predictions(uuid,uuid),
  private.adopt_channel_content(uuid,uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  private.worker_video_counts(text,uuid,uuid,jsonb),
  private.worker_known_videos(text,uuid,uuid),
  private.adopt_video_comments_and_predictions(uuid,uuid),
  private.adopt_channel_content(uuid,uuid)
  TO service_role;
