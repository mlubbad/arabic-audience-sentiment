-- Migration: 20260920150000_decoupled_dashboard_architecture.sql
-- Decouples dashboard aggregations from comment stream pagination.
-- Provides pg_trgm GIN indexing for fast Arabic full-text search,
-- server-side aggregate computation for metrics/timelines/topics/videos/hours/people,
-- and high-performance server-side paginated comments retrieval.

-- 1. Ensure pg_trgm extension and GIN trigram index on comments text_raw (graceful in test runners like PGlite)
DO $ext$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
  CREATE INDEX IF NOT EXISTS comments_text_trgm_idx
    ON public.comments
    USING gin (text_raw extensions.gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$ext$;

-- 2. Server-side Aggregations Implementation
CREATE OR REPLACE FUNCTION private.dashboard_aggregates_impl(w uuid, f jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET statement_timeout = '30s' AS $fn$
DECLARE
  active text;
  topic_active text;
  rev text;
  taxonomy jsonb;
  res jsonb;
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
    WHERE (v_video IS NULL OR e.video_id::text = v_video)
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

CREATE OR REPLACE FUNCTION public.dashboard_aggregates(w uuid, f jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.dashboard_aggregates_impl(w, f);
$$;

REVOKE ALL ON FUNCTION public.dashboard_aggregates(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.dashboard_aggregates(uuid, jsonb) TO authenticated, service_role;

-- 3. Server-side Paginated Comments Implementation
CREATE OR REPLACE FUNCTION private.dashboard_comments_impl(w uuid, f jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET statement_timeout = '30s' AS $fn$
DECLARE
  active text;
  topic_active text;
  p_limit int := LEAST(COALESCE((f->>'limit')::int, 25), 100);
  p_offset int := GREATEST(COALESCE((f->>'offset')::int, 0), 0);
  p_sort text := COALESCE(f->>'sort', 'published_desc');
  p_card_tab text := f->>'card_tab';
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

CREATE OR REPLACE FUNCTION public.dashboard_comments(w uuid, f jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.dashboard_comments_impl(w, f);
$$;

REVOKE ALL ON FUNCTION public.dashboard_comments(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.dashboard_comments(uuid, jsonb) TO authenticated, service_role;
