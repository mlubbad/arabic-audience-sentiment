-- Optimize dashboard_aggregates text scanning
--
-- In private.dashboard_aggregates_impl, selecting cm.text_raw for every comment
-- caused 70k+ TOAST row lookups and temp disk spills during aggregate computation,
-- even though text_raw is only needed when a text search (v_search) is performed
-- or for the top 5 most engaged negative comments.
--
-- This migration updates private.dashboard_aggregates_impl to:
-- 1. Conditionally project text_raw only when v_search IS NOT NULL.
-- 2. Fetch text_raw for the top 5 engaged negatives via direct join on cm.id.

CREATE OR REPLACE FUNCTION private.dashboard_aggregates_impl(w uuid, f jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET statement_timeout = '30s' AS $fn$
DECLARE
  active text;
  topic_active text;
  rev text;
  taxonomy jsonb;
  res jsonb;
  active_labels text[];
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

  -- Derive active measurable labels from the active analysis predictions
  IF active IS NOT NULL THEN
    SELECT coalesce(array_agg(DISTINCT k), ARRAY[]::text[])
      INTO active_labels
      FROM (
        SELECT jsonb_object_keys(p.class_scores) AS k
        FROM public.sentiment_predictions p
        WHERE p.workspace_id = w AND p.analysis_key = active AND p.status = 'succeeded'
        LIMIT 100
      ) sub;
  END IF;

  IF active_labels IS NULL OR cardinality(active_labels) = 0 THEN
    IF active ILIKE '%camelbert%' THEN
      active_labels := ARRAY['positive', 'negative', 'neutral'];
    ELSE
      active_labels := ARRAY['positive', 'negative', 'neutral', 'mixed'];
    END IF;
  END IF;

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
      CASE WHEN v_search IS NOT NULL THEN cm.text_raw ELSE NULL END AS text_raw,
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
        'id', f.id::text,
        'video_id', f.video_id::text,
        'video_title', f.video_title,
        'text_raw', coalesce(f.text_raw, cm_neg.text_raw, ''),
        'author_name', f.author_name,
        'published_at', f.published_at,
        'likes_value', f.likes_value,
        'label', f.eff_label,
        'topic', f.eff_topic
      ) AS item
      FROM (
        SELECT id, video_id, video_title, text_raw, author_name, published_at, likes_value, eff_label, eff_topic
        FROM filtered
        WHERE NOT by_owner AND eff_label = 'negative'
        ORDER BY likes_value DESC NULLS LAST, published_at DESC
        LIMIT 5
      ) f
      LEFT JOIN public.comments cm_neg ON cm_neg.id = f.id
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
    'measurable', active_labels,
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
