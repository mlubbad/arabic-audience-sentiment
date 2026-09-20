-- Migration: 20260920190000_omnichannel_multi_platform_support.sql
-- Establishes the multi-platform omnichannel foundation across public tables,
-- widening platform and kind check constraints, adding high-performance composite
-- indexes, extending public channel registration, and updating dashboard aggregations.

-- 1. Constraint Widening
alter table public.channels drop constraint if exists channels_platform_check;
alter table public.channels add constraint channels_platform_check
  check (platform in ('youtube', 'telegram', 'x', 'tiktok', 'facebook', 'instagram'));

alter table public.videos drop constraint if exists videos_platform_check;
alter table public.videos add constraint videos_platform_check
  check (platform in ('youtube', 'telegram', 'x', 'tiktok', 'facebook', 'instagram'));

alter table public.videos drop constraint if exists videos_kind_check;
alter table public.videos add constraint videos_kind_check
  check (kind in ('video', 'short', 'stream', 'channel_post', 'tweet', 'status'));

alter table public.comments drop constraint if exists comments_platform_check;
alter table public.comments add constraint comments_platform_check
  check (platform in ('youtube', 'telegram', 'x', 'tiktok', 'facebook', 'instagram'));

-- 2. Performance Indices
create index if not exists comments_platform_workspace_idx 
  on public.comments (workspace_id, platform, published_at desc);

create index if not exists channels_platform_workspace_idx 
  on public.channels (workspace_id, platform);

create index if not exists videos_platform_workspace_idx 
  on public.videos (workspace_id, platform, published_at desc);

-- 2.1 Expose platform in connection_status view
create or replace view public.connection_status
  with (security_invoker = true) as
  select c.workspace_id, c.id as channel_id, c.external_channel_id, c.handle,
         c.status, c.active_analysis_key, c.title, c.catalogued_at, c.platform
  from public.channels c;

-- 3. Public Channel Registration with Platform Support
drop function if exists public.register_public_channel(uuid, uuid, text, text, text);
drop function if exists private.register_public_channel_impl(uuid, uuid, text, text, text);

create or replace function private.register_public_channel_impl(
  w uuid, c uuid, external text, handle text, title text, p_platform text default 'youtube'
) returns public.channels
language plpgsql security definer set search_path='' as $$
declare ch public.channels; begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where workspace_id=w and id=c) then
    raise exception 'invalid_client' using errcode='23503'; end if;
  if p_platform not in ('youtube', 'telegram', 'x', 'tiktok', 'facebook', 'instagram') then
    raise exception 'invalid_platform' using errcode='22023'; end if;
  
  if p_platform = 'youtube' then
    if external !~ '^UC[A-Za-z0-9_-]{22}$' then
      raise exception 'invalid_channel_id' using errcode='22023'; end if;
  elsif p_platform = 'telegram' then
    if external !~ '^(@?[A-Za-z0-9_]{4,64}|-?[0-9]+)$' then
      raise exception 'invalid_channel_id' using errcode='22023'; end if;
  else
    if length(trim(external)) < 1 or length(external) > 100 then
      raise exception 'invalid_channel_id' using errcode='22023'; end if;
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
  return ch;
end $$;

revoke all on function private.register_public_channel_impl(uuid, uuid, text, text, text, text) from public;
grant usage on schema private to authenticated;
grant execute on function private.register_public_channel_impl(uuid, uuid, text, text, text, text) to authenticated;

create or replace function public.register_public_channel(
  w uuid, c uuid, external text, handle text, title text, p_platform text default 'youtube'
) returns public.channels
language sql security invoker set search_path='' as $$
  select private.register_public_channel_impl(w, c, external, handle, title, p_platform) $$;

revoke all on function public.register_public_channel(uuid, uuid, text, text, text, text) from public;
grant execute on function public.register_public_channel(uuid, uuid, text, text, text, text) to authenticated;

-- 4. Server-side Aggregations Implementation (Updated with platform filter & breakdown)
CREATE OR REPLACE FUNCTION private.dashboard_aggregates_impl(w uuid, f jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET statement_timeout = '30s' AS $fn$
DECLARE
  active text;
  topic_active text;
  rev text;
  taxonomy jsonb;
  res jsonb;
  v_platform text := f->>'platform';
  v_video text := f->>'video';
  v_video_kind text := f->>'video_kind';
  v_sentiment text := f->>'sentiment';
  v_topic text := f->>'topic';
  v_replies text := f->>'replies';
  v_comment_type text := f->>'comment_type';
  v_review_status text := f->>'review_status';
  v_from timestamptz := NULLIF(f->>'from', '')::timestamptz;
  v_to timestamptz := NULLIF(f->>'to', '')::timestamptz;
  v_search text := NULLIF(trim(f->>'q'), '');
BEGIN
  IF NOT (coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' OR private.has_role(w)) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT c.active_analysis_key INTO active FROM public.channels c
   WHERE c.workspace_id = w AND c.active_analysis_key IS NOT NULL
   ORDER BY (c.status = 'connected') DESC, c.id LIMIT 1;

  SELECT active_topic_key INTO topic_active FROM public.workspaces WHERE id = w;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'key', tp.key, 'name_ar', tp.name_ar, 'name_en', tp.name_en,
      'description', tp.description, 'position', tp.position,
      'retired', tp.retired_at IS NOT NULL) ORDER BY tp.position), '[]'::jsonb)
    INTO taxonomy FROM public.workspace_topics tp WHERE tp.workspace_id = w;

  SELECT coalesce(max(s.ended_at)::text, max(s.started_at)::text, 'empty') INTO rev
   FROM public.sync_runs s WHERE s.workspace_id = w;

  WITH ch AS (
    SELECT c.id as channel_id, c.client_id, c.external_channel_id, c.active_analysis_key
    FROM public.channels c
    WHERE c.workspace_id = w
    ORDER BY (c.status = 'connected') DESC, c.id LIMIT 1
  ),
  raw_comments AS (
    SELECT
      cm.id,
      cm.video_id,
      cm.platform,
      v.title AS video_title,
      v.kind AS video_kind,
      cm.published_at,
      cm.likes_value,
      cm.is_reply,
      cm.author_name,
      cm.author_channel_id,
      cm.content_hash,
      cm.text_raw,
      (cm.author_channel_id IS NOT NULL AND cm.author_channel_id = ch.external_channel_id) AS by_owner
    FROM public.comments cm
    CROSS JOIN ch
    JOIN public.videos v ON v.workspace_id = w AND v.id = cm.video_id
    WHERE cm.workspace_id = w
  ),
  rev_cte AS (
    SELECT DISTINCT ON (rv.comment_id)
      rv.comment_id, rv.content_hash, rv.label
    FROM public.comment_reviews rv
    WHERE rv.workspace_id = w AND rv.origin = 'human'
    ORDER BY rv.comment_id, rv.created_at DESC
  ),
  pred_cte AS (
    SELECT p.comment_id, p.content_hash, p.label
    FROM public.sentiment_predictions p
    WHERE p.workspace_id = w AND active IS NOT NULL AND p.analysis_key = active AND p.status = 'succeeded'
  ),
  tr_rev AS (
    SELECT DISTINCT ON (tr.comment_id)
      tr.comment_id, tr.content_hash, tr.topic_key
    FROM public.topic_reviews tr
    WHERE tr.workspace_id = w AND tr.origin = 'human'
    ORDER BY tr.comment_id, tr.created_at DESC
  ),
  tp_cte AS (
    SELECT tp.comment_id, tp.content_hash, tp.topic_key
    FROM public.topic_predictions tp
    WHERE tp.workspace_id = w AND topic_active IS NOT NULL AND tp.classification_key = topic_active AND tp.status = 'succeeded'
  ),
  ann_cte AS (
    SELECT DISTINCT ON (a.comment_id) a.comment_id, a.value
    FROM public.comment_annotations a
    WHERE a.workspace_id = w AND a.kind = 'comment_type'
    ORDER BY a.comment_id, a.created_at DESC
  ),
  evaluated AS (
    SELECT
      rc.*,
      ann.value AS comment_type,
      (rev.comment_id IS NOT NULL AND rev.content_hash = rc.content_hash) AS reviewed,
      CASE
        WHEN rev.content_hash = rc.content_hash THEN rev.label
        WHEN pred.content_hash = rc.content_hash THEN pred.label
        ELSE NULL
      END AS eff_label,
      CASE
        WHEN tr.content_hash = rc.content_hash THEN tr.topic_key
        WHEN tp.content_hash = rc.content_hash THEN tp.topic_key
        ELSE NULL
      END AS eff_topic
    FROM raw_comments rc
    LEFT JOIN rev_cte rev ON rev.comment_id = rc.id
    LEFT JOIN pred_cte pred ON pred.comment_id = rc.id
    LEFT JOIN tr_rev tr ON tr.comment_id = rc.id
    LEFT JOIN tp_cte tp ON tp.comment_id = rc.id
    LEFT JOIN ann_cte ann ON ann.comment_id = rc.id
  ),
  filtered AS (
    SELECT * FROM evaluated e
    WHERE (v_platform IS NULL OR e.platform = v_platform)
      AND (v_video IS NULL OR e.video_id::text = v_video)
      AND (v_video_kind IS NULL OR e.video_kind = v_video_kind)
      AND (v_sentiment IS NULL OR e.eff_label = v_sentiment)
      AND (v_topic IS NULL OR (v_topic = '__unclassified' AND e.eff_topic IS NULL) OR (e.eff_topic = v_topic))
      AND (v_replies IS NULL OR v_replies = 'all' OR (v_replies = 'comments' AND NOT e.is_reply) OR (v_replies = 'replies' AND e.is_reply))
      AND (v_comment_type IS NULL OR e.comment_type = v_comment_type)
      AND (v_review_status IS NULL OR v_review_status = 'all' OR (v_review_status = 'reviewed' AND e.reviewed) OR (v_review_status = 'unreviewed' AND NOT e.reviewed))
      AND (v_from IS NULL OR e.published_at >= v_from)
      AND (v_to IS NULL OR e.published_at < v_to)
      AND (v_search IS NULL OR e.text_raw ILIKE '%' || v_search || '%' OR e.author_name ILIKE '%' || v_search || '%')
  ),
  summary_stats AS (
    SELECT
      count(*) AS workspace_total,
      count(*) FILTER (WHERE by_owner) AS channel_own_comments,
      count(*) FILTER (WHERE NOT by_owner) AS total,
      count(*) FILTER (WHERE NOT by_owner AND eff_label IS NOT NULL) AS analysed,
      count(*) FILTER (WHERE NOT by_owner AND eff_label = 'positive') AS positive,
      count(*) FILTER (WHERE NOT by_owner AND eff_label = 'negative') AS negative,
      count(*) FILTER (WHERE NOT by_owner AND eff_label = 'neutral') AS neutral,
      count(*) FILTER (WHERE NOT by_owner AND eff_label = 'mixed') AS mixed,
      count(*) FILTER (WHERE NOT by_owner AND eff_label = 'negative' AND likes_value IS NOT NULL) AS negative_ranked,
      count(*) FILTER (WHERE NOT by_owner AND eff_label = 'negative' AND likes_value IS NULL) AS negative_unranked
    FROM filtered
  ),
  platforms_agg AS (
    SELECT
      platform,
      count(*) AS cnt
    FROM filtered
    WHERE NOT by_owner
    GROUP BY platform
  ),
  timeline_agg AS (
    SELECT
      to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      count(*) AS cnt
    FROM filtered
    WHERE NOT by_owner AND published_at IS NOT NULL
    GROUP BY 1
  ),
  topics_agg AS (
    SELECT
      coalesce(eff_topic, '__unclassified') AS topic_key,
      count(*) AS cnt
    FROM filtered
    WHERE NOT by_owner
    GROUP BY 1
  ),
  videos_agg AS (
    SELECT
      video_id::text AS id,
      max(video_title) AS title,
      count(*) AS total,
      count(*) FILTER (WHERE eff_label IS NOT NULL) AS analysed,
      count(*) FILTER (WHERE is_reply) AS replies,
      jsonb_build_object(
        'positive', count(*) FILTER (WHERE eff_label = 'positive'),
        'negative', count(*) FILTER (WHERE eff_label = 'negative'),
        'neutral', count(*) FILTER (WHERE eff_label = 'neutral'),
        'mixed', count(*) FILTER (WHERE eff_label = 'mixed')
      ) AS sentiments
    FROM filtered
    WHERE NOT by_owner
    GROUP BY video_id
  ),
  hours_agg AS (
    SELECT jsonb_agg(h.cnt ORDER BY h.hour) AS hours
    FROM (
      SELECT gs.h AS hour, count(f.id) AS cnt
      FROM generate_series(0, 23) gs(h)
      LEFT JOIN filtered f ON extract(hour FROM f.published_at AT TIME ZONE 'UTC') = gs.h AND NOT f.by_owner
      GROUP BY gs.h
    ) h
  ),
  weekdays_agg AS (
    SELECT jsonb_agg(w.cnt ORDER BY w.day) AS weekdays
    FROM (
      SELECT gs.d AS day, count(f.id) AS cnt
      FROM generate_series(0, 6) gs(d)
      LEFT JOIN filtered f ON extract(dow FROM f.published_at AT TIME ZONE 'UTC') = gs.d AND NOT f.by_owner
      GROUP BY gs.d
    ) w
  ),
  weeks_agg AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('week', to_char(w.week_date, 'IYYY-"W"IW'), 'count', w.cnt) ORDER BY w.week_date), '[]'::jsonb) AS weeks
    FROM (
      SELECT date_trunc('week', published_at AT TIME ZONE 'UTC') AS week_date, count(*) AS cnt
      FROM filtered
      WHERE NOT by_owner AND published_at IS NOT NULL
      GROUP BY 1
    ) w
  ),
  people_agg AS (
    SELECT coalesce(jsonb_agg(p.*), '[]'::jsonb) AS people
    FROM (
      SELECT
        coalesce(author_name, 'unknown') AS name,
        author_channel_id AS channel_id,
        count(*) AS comments_count,
        coalesce(sum(likes_value), 0) AS likes_count
      FROM filtered
      WHERE NOT by_owner
      GROUP BY 1, 2
      ORDER BY count(*) DESC
      LIMIT 10
    ) p
  ),
  engaged_negatives AS (
    SELECT coalesce(jsonb_agg(r.item), '[]'::jsonb) AS items
    FROM (
      SELECT jsonb_build_object(
        'id', id::text,
        'video_id', video_id::text,
        'video_title', video_title,
        'text_raw', text_raw,
        'author_name', author_name,
        'published_at', published_at,
        'likes_value', likes_value,
        'label', eff_label,
        'topic', eff_topic
      ) AS item
      FROM filtered
      WHERE NOT by_owner AND eff_label = 'negative'
      ORDER BY likes_value DESC NULLS LAST, published_at DESC
      LIMIT 5
    ) r
  ),
  distinct_types AS (
    SELECT coalesce(jsonb_agg(DISTINCT comment_type) FILTER (WHERE comment_type IS NOT NULL), '[]'::jsonb) AS types
    FROM evaluated
  ),
  all_videos AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id::text, 'title', v.title) ORDER BY v.title), '[]'::jsonb) AS opts
    FROM public.videos v
    WHERE v.workspace_id = w
  )
  SELECT jsonb_build_object(
    'workspace_total', (SELECT workspace_total FROM summary_stats),
    'channel_own_comments', (SELECT channel_own_comments FROM summary_stats),
    'total', (SELECT total FROM summary_stats),
    'analysed', (SELECT analysed FROM summary_stats),
    'unanalysed', (SELECT total - analysed FROM summary_stats),
    'sentiments', jsonb_build_object(
      'positive', (SELECT positive FROM summary_stats),
      'negative', (SELECT negative FROM summary_stats),
      'neutral', (SELECT neutral FROM summary_stats),
      'mixed', (SELECT mixed FROM summary_stats)
    ),
    'measurable', ARRAY['positive', 'negative', 'neutral', 'mixed'],
    'negative_ranked', (SELECT negative_ranked FROM summary_stats),
    'negative_unranked', (SELECT negative_unranked FROM summary_stats),
    'timeline', coalesce((SELECT jsonb_object_agg(day, cnt) FROM timeline_agg), '{}'::jsonb),
    'topic_counts', coalesce((SELECT jsonb_object_agg(topic_key, cnt) FROM topics_agg), '{}'::jsonb),
    'platform_breakdown', coalesce((SELECT jsonb_object_agg(platform, cnt) FROM platforms_agg), '{}'::jsonb),
    'videos', coalesce((SELECT jsonb_agg(v.* ORDER BY v.total DESC) FROM videos_agg v), '[]'::jsonb),
    'hours', (SELECT hours FROM hours_agg),
    'weekdays', (SELECT weekdays FROM weekdays_agg),
    'weeks', (SELECT weeks FROM weeks_agg),
    'people', (SELECT people FROM people_agg),
    'most_engaged_negative', (SELECT items FROM engaged_negatives),
    'comment_types', (SELECT types FROM distinct_types),
    'video_options', (SELECT opts FROM all_videos),
    'topics', taxonomy,
    'active_analysis_key', active,
    'active_topic_key', topic_active,
    'revision', rev
  ) INTO res;

  RETURN res;
END;
$fn$;

-- 5. Server-side Paginated Comments Implementation (Updated with platform filter & projection)
CREATE OR REPLACE FUNCTION private.dashboard_comments_impl(w uuid, f jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET statement_timeout = '30s' AS $fn$
DECLARE
  active text;
  topic_active text;
  p_limit int := LEAST(COALESCE((f->>'limit')::int, 25), 100);
  p_offset int := GREATEST(COALESCE((f->>'offset')::int, 0), 0);
  p_sort text := COALESCE(f->>'sort', 'published_desc');
  p_card_tab text := f->>'card_tab';
  v_platform text := f->>'platform';
  v_video text := f->>'video';
  v_video_kind text := f->>'video_kind';
  v_sentiment text := f->>'sentiment';
  v_topic text := f->>'topic';
  v_replies text := f->>'replies';
  v_comment_type text := f->>'comment_type';
  v_review_status text := f->>'review_status';
  v_from timestamptz := NULLIF(f->>'from', '')::timestamptz;
  v_to timestamptz := NULLIF(f->>'to', '')::timestamptz;
  v_search text := NULLIF(trim(f->>'q'), '');
  total_matches int := 0;
  comments_list jsonb := '[]'::jsonb;
  next_cur text := NULL;
  has_more_flag boolean := false;
BEGIN
  IF NOT (coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' OR private.has_role(w)) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT c.active_analysis_key INTO active FROM public.channels c
   WHERE c.workspace_id = w AND c.active_analysis_key IS NOT NULL
   ORDER BY (c.status = 'connected') DESC, c.id LIMIT 1;

  SELECT active_topic_key INTO topic_active FROM public.workspaces WHERE id = w;

  IF p_card_tab = 'critical' THEN
    v_sentiment := 'negative';
    p_sort := 'likes_desc';
  ELSIF p_card_tab = 'recent' THEN
    p_sort := 'published_desc';
  ELSIF p_card_tab = 'liked' THEN
    p_sort := 'likes_desc';
  END IF;

  WITH ch AS (
    SELECT c.id as channel_id, c.client_id, c.external_channel_id, c.active_analysis_key
    FROM public.channels c
    WHERE c.workspace_id = w
    ORDER BY (c.status = 'connected') DESC, c.id LIMIT 1
  ),
  raw_comments AS (
    SELECT
      cm.*,
      v.title AS video_title,
      v.kind AS video_kind,
      ch.client_id,
      ch.channel_id,
      (cm.author_channel_id IS NOT NULL AND cm.author_channel_id = ch.external_channel_id) AS by_owner
    FROM public.comments cm
    CROSS JOIN ch
    JOIN public.videos v ON v.workspace_id = w AND v.id = cm.video_id
    WHERE cm.workspace_id = w
  ),
  rev_cte AS (
    SELECT DISTINCT ON (rv.comment_id)
      rv.comment_id, rv.content_hash, rv.label
    FROM public.comment_reviews rv
    WHERE rv.workspace_id = w AND rv.origin = 'human'
    ORDER BY rv.comment_id, rv.created_at DESC
  ),
  pred_cte AS (
    SELECT p.comment_id, p.content_hash, p.label
    FROM public.sentiment_predictions p
    WHERE p.workspace_id = w AND active IS NOT NULL AND p.analysis_key = active AND p.status = 'succeeded'
  ),
  tr_rev AS (
    SELECT DISTINCT ON (tr.comment_id)
      tr.comment_id, tr.content_hash, tr.topic_key
    FROM public.topic_reviews tr
    WHERE tr.workspace_id = w AND tr.origin = 'human'
    ORDER BY tr.comment_id, tr.created_at DESC
  ),
  tp_cte AS (
    SELECT tp.comment_id, tp.content_hash, tp.topic_key
    FROM public.topic_predictions tp
    WHERE tp.workspace_id = w AND topic_active IS NOT NULL AND tp.classification_key = topic_active AND tp.status = 'succeeded'
  ),
  ann_cte AS (
    SELECT DISTINCT ON (a.comment_id) a.comment_id, a.value
    FROM public.comment_annotations a
    WHERE a.workspace_id = w AND a.kind = 'comment_type'
    ORDER BY a.comment_id, a.created_at DESC
  ),
  evaluated AS (
    SELECT
      rc.*,
      ann.value AS comment_type,
      (rev.comment_id IS NOT NULL AND rev.content_hash = rc.content_hash) AS reviewed,
      CASE
        WHEN rev.content_hash = rc.content_hash THEN rev.label
        WHEN pred.content_hash = rc.content_hash THEN pred.label
        ELSE NULL
      END AS eff_label,
      CASE
        WHEN tr.content_hash = rc.content_hash THEN tr.topic_key
        WHEN tp.content_hash = rc.content_hash THEN tp.topic_key
        ELSE NULL
      END AS eff_topic
    FROM raw_comments rc
    LEFT JOIN rev_cte rev ON rev.comment_id = rc.id
    LEFT JOIN pred_cte pred ON pred.comment_id = rc.id
    LEFT JOIN tr_rev tr ON tr.comment_id = rc.id
    LEFT JOIN tp_cte tp ON tp.comment_id = rc.id
    LEFT JOIN ann_cte ann ON ann.comment_id = rc.id
  ),
  filtered AS (
    SELECT * FROM evaluated e
    WHERE NOT e.by_owner
      AND (v_platform IS NULL OR e.platform = v_platform)
      AND (v_video IS NULL OR e.video_id::text = v_video)
      AND (v_video_kind IS NULL OR e.video_kind = v_video_kind)
      AND (v_sentiment IS NULL OR e.eff_label = v_sentiment)
      AND (v_topic IS NULL OR (v_topic = '__unclassified' AND e.eff_topic IS NULL) OR (e.eff_topic = v_topic))
      AND (v_replies IS NULL OR v_replies = 'all' OR (v_replies = 'comments' AND NOT e.is_reply) OR (v_replies = 'replies' AND e.is_reply))
      AND (v_comment_type IS NULL OR e.comment_type = v_comment_type)
      AND (v_review_status IS NULL OR v_review_status = 'all' OR (v_review_status = 'reviewed' AND e.reviewed) OR (v_review_status = 'unreviewed' AND NOT e.reviewed))
      AND (v_from IS NULL OR e.published_at >= v_from)
      AND (v_to IS NULL OR e.published_at < v_to)
      AND (v_search IS NULL OR e.text_raw ILIKE '%' || v_search || '%' OR e.author_name ILIKE '%' || v_search || '%')
  ),
  counted AS (
    SELECT count(*)::int AS cnt FROM filtered
  ),
  sorted_page AS (
    SELECT f.* FROM filtered f
    ORDER BY
      CASE WHEN p_sort = 'likes_desc' THEN f.likes_value END DESC NULLS LAST,
      CASE WHEN p_sort = 'likes_asc' THEN f.likes_value END ASC NULLS LAST,
      CASE WHEN p_sort = 'published_asc' THEN f.published_at END ASC NULLS LAST,
      f.published_at DESC NULLS LAST,
      f.id DESC
    LIMIT p_limit + 1 OFFSET p_offset
  ),
  page_with_extra AS (
    SELECT sp.*, row_number() OVER () AS rnum FROM sorted_page sp
  ),
  page_exact AS (
    SELECT * FROM page_with_extra WHERE rnum <= p_limit
  ),
  page_preds AS (
    SELECT DISTINCT ON (p.comment_id, p.content_hash)
           p.comment_id, p.content_hash,
           jsonb_build_object(
             'status', p.status, 'label', p.label, 'content_hash', p.content_hash,
             'analysis_key', p.analysis_key, 'model_id', r.model_id,
             'revision', r.revision_sha, 'preprocessing_version', r.preprocessing_version,
             'predicted_at', p.predicted_at, 'class_scores', p.class_scores
           ) AS pred_json
    FROM public.sentiment_predictions p
    JOIN page_exact pe ON pe.id = p.comment_id AND pe.content_hash = p.content_hash
    JOIN public.analysis_runs r ON r.workspace_id = w AND r.id = p.analysis_run_id
    WHERE p.workspace_id = w
      AND active IS NOT NULL AND p.analysis_key = active
    ORDER BY p.comment_id, p.content_hash, p.predicted_at DESC
  ),
  page_topic_preds AS (
    SELECT DISTINCT ON (p.comment_id, p.content_hash)
           p.comment_id, p.content_hash,
           jsonb_build_object(
             'status', p.status, 'topic_key', p.topic_key, 'confidence', p.confidence,
             'content_hash', p.content_hash, 'classification_key', p.classification_key,
             'model_id', p.model_id, 'prompt_version', p.prompt_version,
             'predicted_at', p.predicted_at, 'error_code', p.error_code
           ) AS topic_pred_json
    FROM public.topic_predictions p
    JOIN page_exact pe ON pe.id = p.comment_id AND pe.content_hash = p.content_hash
    WHERE p.workspace_id = w
      AND topic_active IS NOT NULL AND p.classification_key = topic_active
    ORDER BY p.comment_id, p.content_hash, p.predicted_at DESC
  ),
  page_reviews AS (
    SELECT rv.comment_id,
           coalesce(jsonb_agg(jsonb_build_object(
             'label', rv.label, 'content_hash', rv.content_hash,
             'created_at', rv.created_at, 'origin', rv.origin,
             'reviewer_id', rv.reviewer_id::text, 'reason', rv.reason
           ) ORDER BY rv.created_at), '[]'::jsonb) AS reviews_json
    FROM public.comment_reviews rv
    JOIN page_exact pe ON pe.id = rv.comment_id
    WHERE rv.workspace_id = w
    GROUP BY rv.comment_id
  ),
  page_topic_reviews AS (
    SELECT tr.comment_id,
           coalesce(jsonb_agg(jsonb_build_object(
             'topic_key', tr.topic_key, 'content_hash', tr.content_hash,
             'created_at', tr.created_at, 'origin', tr.origin,
             'reviewer_id', tr.reviewer_id::text, 'reason', tr.reason
           ) ORDER BY tr.created_at), '[]'::jsonb) AS topic_reviews_json
    FROM public.topic_reviews tr
    JOIN page_exact pe ON pe.id = tr.comment_id
    WHERE tr.workspace_id = w
    GROUP BY tr.comment_id
  ),
  assembled AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', pe.id::text,
      'workspace_id', pe.workspace_id::text,
      'client_id', pe.client_id::text,
      'channel_id', pe.channel_id::text,
      'video_id', pe.video_id::text,
      'platform', pe.platform,
      'by_channel_owner', pe.by_owner,
      'video_title', pe.video_title,
      'video_kind', pe.video_kind,
      'author_channel_id', pe.author_channel_id,
      'author_name', pe.author_name,
      'text_raw', pe.text_raw,
      'content_hash', pe.content_hash,
      'likes_raw', pe.likes_raw,
      'likes_value', pe.likes_value,
      'published_at', pe.published_at,
      'published_time_raw', pe.published_time_raw,
      'timestamp_precision', pe.timestamp_precision,
      'is_reply', pe.is_reply,
      'parent_comment_id', pe.external_parent_id,
      'parent_source', pe.parent_source,
      'source', pe.source,
      'field_provenance', pe.field_provenance,
      'comment_type', pe.comment_type,
      'content_purged_at', pe.content_purged_at,
      'prediction', ap.pred_json,
      'reviews', coalesce(ra.reviews_json, '[]'::jsonb),
      'topic_prediction', atp.topic_pred_json,
      'topic_reviews', coalesce(tra.topic_reviews_json, '[]'::jsonb)
    ) ORDER BY pe.rnum) AS items
    FROM page_exact pe
    LEFT JOIN page_preds ap ON ap.comment_id = pe.id
    LEFT JOIN page_topic_preds atp ON atp.comment_id = pe.id
    LEFT JOIN page_reviews ra ON ra.comment_id = pe.id
    LEFT JOIN page_topic_reviews tra ON tra.comment_id = pe.id
  )
  SELECT
    (SELECT cnt FROM counted),
    coalesce((SELECT items FROM assembled), '[]'::jsonb),
    (SELECT count(*) > p_limit FROM page_with_extra),
    (SELECT id::text FROM page_exact ORDER BY rnum DESC LIMIT 1)
  INTO total_matches, comments_list, has_more_flag, next_cur;

  RETURN jsonb_build_object(
    'total', total_matches,
    'comments', comments_list,
    'limit', p_limit,
    'offset', p_offset,
    'has_more', has_more_flag,
    'next_cursor', CASE WHEN has_more_flag THEN next_cur ELSE NULL END
  );
END;
$fn$;

-- 7. Multi-platform Catalogue Ingestion
CREATE OR REPLACE FUNCTION private.worker_commit_catalogue(token_hash text, j uuid, t uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w uuid; c uuid; c_platform text; n int; BEGIN
  w := private.worker_job(token_hash, j, t);
  SELECT channel_id INTO c FROM public.jobs WHERE id = j;
  SELECT coalesce(platform, 'youtube') INTO c_platform FROM public.channels WHERE id = c;
  IF payload IS NULL OR jsonb_typeof(payload) <> 'array' THEN
    RAISE EXCEPTION 'invalid_catalogue' USING errcode='22023'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload) i
     WHERE jsonb_typeof(i) <> 'object'
        OR (c_platform = 'youtube' AND coalesce(i->>'external_video_id','') !~ '^[A-Za-z0-9_-]{11}$')
        OR (c_platform <> 'youtube' AND (length(coalesce(i->>'external_video_id','')) NOT BETWEEN 1 AND 100 OR coalesce(i->>'external_video_id','') ~ '\s'))
        OR (c_platform = 'youtube' AND i ? 'kind' AND i->>'kind' NOT IN ('video','short','stream'))
        OR (c_platform <> 'youtube' AND i ? 'kind' AND i->>'kind' NOT IN ('video','short','stream','channel_post','tweet','status'))
        OR (i ? 'reported_comment_count'
            AND jsonb_typeof(i->'reported_comment_count') NOT IN ('number','null'))
        OR (i ? 'published_at' AND jsonb_typeof(i->'published_at') NOT IN ('string','null'))
        OR (i ? 'field_provenance' AND jsonb_typeof(i->'field_provenance') <> 'object')) THEN
    RAISE EXCEPTION 'invalid_catalogue' USING errcode='22023'; END IF;

  INSERT INTO public.videos(workspace_id, channel_id, platform, external_video_id, title, kind,
    published_at, duration_sec, thumbnail_url, reported_comment_count, comments_state,
    catalogued_at, last_observed_at, field_provenance)
  SELECT w, c, c_platform, i->>'external_video_id',
         coalesce(nullif(i->>'title',''), i->>'external_video_id'),
         coalesce(i->>'kind', CASE WHEN c_platform='telegram' THEN 'channel_post' WHEN c_platform='x' THEN 'tweet' ELSE 'video' END),
         (i->>'published_at')::timestamptz,
         (i->>'duration_sec')::int,
         i->>'thumbnail_url',
         (i->>'reported_comment_count')::int,
         CASE WHEN jsonb_typeof(i->'reported_comment_count') = 'number'
              THEN 'open' ELSE 'disabled' END,
         now(), now(), coalesce(i->'field_provenance', '{}'::jsonb)
    FROM jsonb_array_elements(payload) i
  ON CONFLICT (workspace_id, platform, external_video_id) DO UPDATE SET
    title = CASE WHEN excluded.title <> excluded.external_video_id
                 THEN excluded.title ELSE public.videos.title END,
    kind = excluded.kind,
    published_at = coalesce(excluded.published_at, public.videos.published_at),
    duration_sec = coalesce(excluded.duration_sec, public.videos.duration_sec),
    thumbnail_url = coalesce(excluded.thumbnail_url, public.videos.thumbnail_url),
    reported_comment_count = excluded.reported_comment_count,
    comments_state = excluded.comments_state,
    catalogued_at = now(), last_observed_at = now(),
    field_provenance = public.videos.field_provenance || excluded.field_provenance;
  GET DIAGNOSTICS n = row_count;

  UPDATE public.channels SET catalogued_at = now() WHERE workspace_id = w AND id = c;
  UPDATE public.sync_runs SET coverage_summary = jsonb_build_object(
      'videos_found', (SELECT count(*) FROM jsonb_array_elements(payload)),
      'by_kind', (SELECT coalesce(jsonb_object_agg(k, cnt), '{}'::jsonb)
                    FROM (SELECT coalesce(i->>'kind','video') k, count(*) cnt
                            FROM jsonb_array_elements(payload) i GROUP BY 1) x))
   WHERE workspace_id = w AND job_id = j;
  RETURN jsonb_build_object('videos', n);
END $$;

-- 8. Multi-platform Batch Ingestion
CREATE OR REPLACE FUNCTION private.commit_batch(j uuid, t uuid, b text, hash text, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  w uuid; ch uuid; vid uuid; prior text; outcome text; ch_platform text;
  keys text[]; covered text[]; wanted int; inserted int;
BEGIN
  SELECT workspace_id, channel_id INTO w, ch FROM public.jobs
  WHERE id=j AND lease_token=t AND status='running' AND lease_expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lease_lost' USING errcode='40001'; END IF;
  IF b IS NULL OR length(b) NOT BETWEEN 1 AND 200 OR hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_batch' USING errcode='22023'; END IF;
  IF jsonb_array_length(coalesce(payload->'comments','[]'::jsonb)) > 500
     OR jsonb_array_length(coalesce(payload->'predictions','[]'::jsonb)) > 500 THEN
    RAISE EXCEPTION 'batch_too_large' USING errcode='22023'; END IF;
  outcome := payload->>'outcome';
  IF outcome NOT IN ('partial','exhausted','blocked','failed') THEN
    RAISE EXCEPTION 'invalid_batch' USING errcode='22023'; END IF;

  SELECT coalesce(platform, 'youtube') INTO ch_platform FROM public.channels WHERE id=ch;

  IF (SELECT count(DISTINCT c->>'external_comment_id')
      FROM jsonb_array_elements(coalesce(payload->'comments','[]'::jsonb)) c)
     <> jsonb_array_length(coalesce(payload->'comments','[]'::jsonb)) THEN
    RAISE EXCEPTION 'invalid_batch' USING errcode='22023'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(payload->'predictions','[]'::jsonb)) p
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(payload->'comments','[]'::jsonb)) c
      WHERE c->>'external_comment_id' = p->>'external_comment_id')
  ) THEN RAISE EXCEPTION 'invalid_batch' USING errcode='22023'; END IF;

  SELECT payload_hash INTO prior FROM private.job_batches WHERE job_id=j AND batch_key=b;
  IF FOUND THEN
    IF prior IS DISTINCT FROM hash THEN RAISE EXCEPTION 'batch_conflict' USING errcode='23505'; END IF;
    RETURN jsonb_build_object('replayed', true);
  END IF;

  INSERT INTO public.videos(workspace_id,channel_id,platform,external_video_id,title,kind)
  VALUES (w, ch, ch_platform, payload->>'external_video_id',
          coalesce(nullif(payload->>'video_title',''), payload->>'external_video_id'),
          coalesce(payload->>'video_kind', payload->>'kind', CASE WHEN ch_platform = 'telegram' THEN 'channel_post' WHEN ch_platform = 'x' THEN 'tweet' ELSE 'video' END))
  ON CONFLICT (workspace_id,platform,external_video_id) DO UPDATE
    SET last_observed_at = now(),
        kind = coalesce(excluded.kind, public.videos.kind),
        title = CASE
                  WHEN excluded.title <> public.videos.external_video_id
                    THEN excluded.title
                  ELSE public.videos.title
                END
  RETURNING id INTO vid;

  INSERT INTO public.comments(
    workspace_id,video_id,platform,external_comment_id,external_parent_id,is_reply,parent_source,
    author_channel_id,author_name,text_raw,text_plain,content_hash,published_time_raw,
    published_at,timestamp_precision,likes_raw,likes_value,source,field_provenance)
  SELECT w, vid, ch_platform, c.external_comment_id, c.external_parent_id, c.is_reply, c.parent_source,
         c.author_channel_id, c.author_name, c.text_raw, c.text_plain, c.content_hash,
         c.published_time_raw, c.published_at, c.timestamp_precision, c.likes_raw,
         c.likes_value, c.source, c.field_provenance
  FROM jsonb_to_recordset(payload->'comments') AS c(
    external_comment_id text, external_parent_id text, is_reply boolean, parent_source text,
    author_channel_id text, author_name text, text_raw text, text_plain text, content_hash text,
    published_time_raw text, published_at timestamptz, timestamp_precision text,
    likes_raw text, likes_value bigint, source text, field_provenance jsonb)
  ON CONFLICT (workspace_id,platform,external_comment_id) DO UPDATE SET
    text_raw=excluded.text_raw, text_plain=excluded.text_plain,
    content_hash=excluded.content_hash, likes_raw=excluded.likes_raw,
    likes_value=excluded.likes_value, field_provenance=excluded.field_provenance,
    last_seen_at=now();
  GET DIAGNOSTICS inserted = row_count;

  IF jsonb_array_length(coalesce(payload->'predictions','[]'::jsonb)) > 0 THEN
    SELECT coalesce(array_agg(DISTINCT 'analysis:'||ch_platform||':'||(p->>'external_comment_id')),'{}')
    INTO keys FROM jsonb_array_elements(payload->'predictions') p
    WHERE p->>'status'='succeeded';
    wanted := coalesce(array_length(keys,1),0);
    IF wanted > 0 THEN
      covered := private.reserve_usage(w,'comment_analysis',keys);
      IF coalesce(array_length(covered,1),0) <> wanted THEN
        RAISE EXCEPTION 'quota_exceeded' USING errcode='53400'; END IF;
    END IF;

    INSERT INTO public.analysis_runs(
      workspace_id,model_id,revision_sha,preprocessing_version,parameters,status)
    SELECT DISTINCT w, p->>'model_id', p->>'revision', p->>'preprocessing_version',
           coalesce(p->'parameters','{}'::jsonb), 'succeeded'
    FROM jsonb_array_elements(payload->'predictions') p
    ON CONFLICT (workspace_id,model_id,revision_sha,preprocessing_version,parameters) DO NOTHING;

    INSERT INTO public.sentiment_predictions(
      workspace_id,comment_id,content_hash,analysis_run_id,analysis_key,status,label,class_scores)
    SELECT w, cm.id, p.content_hash, r.id, p.analysis_key, p.status, p.label, p.class_scores
    FROM jsonb_to_recordset(payload->'predictions') AS p(
      external_comment_id text, content_hash text, analysis_key text, status text,
      label text, class_scores jsonb, model_id text, revision text,
      preprocessing_version text, parameters jsonb)
    JOIN public.comments cm ON cm.workspace_id=w AND cm.platform=ch_platform
      AND cm.external_comment_id=p.external_comment_id
    JOIN public.analysis_runs r ON r.workspace_id=w AND r.model_id=p.model_id
      AND r.revision_sha=p.revision AND r.preprocessing_version=p.preprocessing_version
      AND r.parameters=coalesce(p.parameters,'{}'::jsonb)
    ON CONFLICT (workspace_id,comment_id,content_hash,analysis_key) DO UPDATE SET
      status=excluded.status, label=excluded.label, class_scores=excluded.class_scores,
      analysis_run_id=excluded.analysis_run_id, predicted_at=now()
    WHERE public.sentiment_predictions.status = 'failed';
  END IF;

  INSERT INTO private.job_batches(job_id,batch_key,checkpoint,payload_hash,outcome)
  VALUES (j, b, coalesce(payload->'checkpoint','{}'::jsonb), hash, outcome);
  UPDATE public.jobs SET checkpoint=coalesce(payload->'checkpoint','{}'::jsonb) WHERE id=j;

  INSERT INTO public.sync_runs(workspace_id, channel_id, job_id, mode, source, status)
  VALUES (w, ch, j, 'collect',
          coalesce((SELECT c->>'source'
                      FROM jsonb_array_elements(coalesce(payload->'comments','[]'::jsonb)) c
                     LIMIT 1), 'unknown'),
          'running')
  ON CONFLICT (workspace_id, job_id) DO NOTHING;

  UPDATE public.sync_runs r SET coverage_summary = (
    WITH seen AS (
      SELECT coalesce(r.coverage_summary->'videos', '[]'::jsonb)
             || jsonb_build_array(vid::text) AS v)
    SELECT jsonb_build_object(
      'videos', (SELECT jsonb_agg(DISTINCT e)
                   FROM seen, jsonb_array_elements_text(seen.v) e),
      'videos_seen', (SELECT count(DISTINCT e)
                        FROM seen, jsonb_array_elements_text(seen.v) e),
      'comments_collected',
        coalesce((r.coverage_summary->>'comments_collected')::int, 0) + inserted,
      'complete', outcome = 'exhausted')
  )
  WHERE r.workspace_id = w AND r.job_id = j;

  RETURN jsonb_build_object('replayed', false, 'comments', inserted, 'video_id', vid);
END $$;

