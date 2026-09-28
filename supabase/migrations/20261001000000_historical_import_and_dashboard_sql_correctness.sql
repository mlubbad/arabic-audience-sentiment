-- Migration: Historical import and dashboard SQL correctness
-- Enforces Invariant 3: Unknown is never zero (null metrics preserved, missing dates null/unknown)
-- Enforces Invariant 4: Usage arithmetic and limits; unlimited is NULL, never magic numbers like -1

-- 1. Correct public.import_historical_records
CREATE OR REPLACE FUNCTION public.import_historical_records(
  w uuid,
  c uuid DEFAULT NULL,
  payload jsonb DEFAULT NULL,
  p_channel_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  effective_c uuid;
  effective_payload jsonb;
  sub record;
  ch_platform text;
  keys text[];
  covered text[];
  wanted int;
  p_rec record;
  c_rec record;
  v_id uuid;
  posts_count int := 0;
  comments_count int := 0;
  min_pub timestamptz;
BEGIN
  IF NOT private.has_role(w, ARRAY['workspace_owner', 'analyst']) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  effective_c := coalesce(c, p_channel_id);
  effective_payload := coalesce(payload, p_payload);

  IF effective_c IS NULL THEN
    RAISE EXCEPTION 'channel_not_found' USING errcode = '22023';
  END IF;

  SELECT coalesce(platform, 'youtube') INTO ch_platform
    FROM public.channels WHERE id = effective_c AND workspace_id = w;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'channel_not_found' USING errcode = '22023';
  END IF;

  SELECT pl.key, pl.backfill_units, pl.historical_days_limit INTO sub
    FROM public.subscriptions s JOIN public.plans pl ON pl.key = s.plan_key
   WHERE s.workspace_id = private.billing_root(w) AND private.subscription_open(s);
  IF NOT FOUND THEN RAISE EXCEPTION 'no_active_plan' USING errcode = '53400'; END IF;

  -- Only block if explicitly set to 0. NULL means unlimited (Owner / Enterprise).
  IF sub.historical_days_limit IS NOT NULL AND sub.historical_days_limit = 0 THEN
    RAISE EXCEPTION 'historical_sync_not_allowed_on_plan' USING errcode = '53400';
  END IF;

  IF effective_payload IS NULL OR jsonb_typeof(effective_payload) != 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING errcode = '22023';
  END IF;

  -- Validate comments volume (max 1000 per import request)
  IF jsonb_array_length(coalesce(effective_payload->'comments', '[]'::jsonb)) > 1000 THEN
    RAISE EXCEPTION 'batch_too_large' USING errcode = '22023';
  END IF;
  IF jsonb_array_length(coalesce(effective_payload->'comments', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'no_comments_provided' USING errcode = '22023';
  END IF;

  -- If plan has historical_days_limit > 0, ensure imported items do not exceed date depth
  IF sub.historical_days_limit IS NOT NULL AND sub.historical_days_limit > 0 THEN
    SELECT min((comm_el->>'published_at')::timestamptz)
      INTO min_pub
      FROM jsonb_array_elements(effective_payload->'comments') comm_el
     WHERE (comm_el->>'published_at') IS NOT NULL AND (comm_el->>'published_at') <> '';

    IF min_pub IS NOT NULL AND min_pub < (now() - (sub.historical_days_limit || ' days')::interval) THEN
      RAISE EXCEPTION 'date_beyond_plan_limit' USING errcode = '22023';
    END IF;
  END IF;

  -- Meter usage against historical_backfill
  SELECT coalesce(array_agg(DISTINCT 'backfill:' || ch_platform || ':' || (comm_el->>'external_comment_id')), '{}')
    INTO keys
    FROM jsonb_array_elements(effective_payload->'comments') comm_el;
  wanted := coalesce(array_length(keys, 1), 0);
  IF wanted > 0 THEN
    covered := private.reserve_usage(w, 'historical_backfill', keys);
    IF coalesce(array_length(covered, 1), 0) <> wanted THEN
      RAISE EXCEPTION 'quota_exceeded' USING errcode = '53400';
    END IF;
  END IF;

  -- Upsert posts/videos
  FOR p_rec IN
    SELECT p->>'external_video_id' AS ext_id,
           coalesce(nullif(p->>'title', ''), p->>'external_video_id') AS title,
           coalesce(p->>'kind', CASE WHEN ch_platform = 'telegram' THEN 'channel_post' ELSE 'video' END) AS kind,
           nullif(p->>'published_at', '')::timestamptz AS published_at
      FROM jsonb_array_elements(coalesce(effective_payload->'posts', '[]'::jsonb)) p
  LOOP
    INSERT INTO public.videos(workspace_id, channel_id, platform, external_video_id, title, kind, published_at)
    VALUES (w, effective_c, ch_platform, p_rec.ext_id, p_rec.title, p_rec.kind, p_rec.published_at)
    ON CONFLICT (workspace_id, platform, external_video_id) DO UPDATE SET
      title = CASE WHEN excluded.title <> public.videos.external_video_id THEN excluded.title ELSE public.videos.title END,
      kind = coalesce(excluded.kind, public.videos.kind),
      published_at = coalesce(excluded.published_at, public.videos.published_at),
      last_observed_at = now();
    posts_count := posts_count + 1;
  END LOOP;

  -- Upsert comments
  FOR c_rec IN
    SELECT comm_el->>'external_video_id' AS ext_video_id,
           comm_el->>'external_comment_id' AS ext_comm_id,
           comm_el->>'external_parent_id' AS ext_parent_id,
           coalesce((comm_el->>'is_reply')::boolean, false) AS is_reply,
           comm_el->>'author_name' AS author_name,
           comm_el->>'text_raw' AS text_raw,
           coalesce(comm_el->>'text_plain', comm_el->>'text_raw') AS text_plain,
           comm_el->>'content_hash' AS content_hash,
           nullif(comm_el->>'published_at', '')::timestamptz AS published_at,
           (comm_el->>'likes_value')::bigint AS likes_value
      FROM jsonb_array_elements(effective_payload->'comments') comm_el
  LOOP
    -- Ensure video exists
    INSERT INTO public.videos(workspace_id, channel_id, platform, external_video_id, title, kind)
    VALUES (w, effective_c, ch_platform, c_rec.ext_video_id, c_rec.ext_video_id, CASE WHEN ch_platform = 'telegram' THEN 'channel_post' ELSE 'video' END)
    ON CONFLICT (workspace_id, platform, external_video_id) DO UPDATE SET last_observed_at = now()
    RETURNING id INTO v_id;

    -- Upsert comment (Invariant 3: null likes preserved, missing date is null with unknown precision)
    INSERT INTO public.comments(
      workspace_id, video_id, platform, external_comment_id, external_parent_id,
      is_reply, author_name, text_raw, text_plain, content_hash,
      timestamp_precision, published_at, likes_value, source, field_provenance
    )
    VALUES (
      w, v_id, ch_platform, c_rec.ext_comm_id, c_rec.ext_parent_id,
      c_rec.is_reply, coalesce(c_rec.author_name, ''), c_rec.text_raw, c_rec.text_plain,
      coalesce(nullif(c_rec.content_hash, ''), md5(c_rec.text_raw)),
      CASE WHEN c_rec.published_at IS NOT NULL THEN 'second' ELSE 'unknown' END,
      c_rec.published_at,
      c_rec.likes_value,
      'external_import',
      jsonb_build_object('imported_at', now(), 'source', 'file_upload')
    )
    ON CONFLICT (workspace_id, platform, external_comment_id) DO UPDATE SET
      text_raw = excluded.text_raw,
      text_plain = excluded.text_plain,
      likes_value = coalesce(excluded.likes_value, public.comments.likes_value),
      published_at = coalesce(excluded.published_at, public.comments.published_at),
      timestamp_precision = CASE
        WHEN excluded.published_at IS NOT NULL THEN 'second'
        ELSE public.comments.timestamp_precision
      END,
      last_seen_at = now();
    comments_count := comments_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'posts_count', posts_count,
    'comments_count', comments_count,
    'backfill_units_used', wanted,
    'backfill_units_remaining', private.backfill_remaining(w)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_historical_records(uuid, uuid, jsonb, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_historical_records(uuid, uuid, jsonb, uuid, jsonb) TO authenticated;

-- 2. Correct public.request_historical_platform_sync
CREATE OR REPLACE FUNCTION public.request_historical_platform_sync(
  w uuid,
  c uuid,
  since_date timestamptz DEFAULT NULL,
  max_items int DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sub record;
  effective_since timestamptz;
  job_id uuid;
BEGIN
  IF NOT private.has_role(w, ARRAY['workspace_owner', 'analyst']) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  PERFORM 1 FROM public.channels WHERE id = c AND workspace_id = w;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'channel_not_found' USING errcode = '22023';
  END IF;

  SELECT pl.key, pl.backfill_units, pl.historical_days_limit INTO sub
    FROM public.subscriptions s JOIN public.plans pl ON pl.key = s.plan_key
   WHERE s.workspace_id = private.billing_root(w) AND private.subscription_open(s);
  IF NOT FOUND THEN RAISE EXCEPTION 'no_active_plan' USING errcode = '53400'; END IF;

  -- Only block if explicitly set to 0 (e.g. Free tier). NULL means unlimited (Owner / Enterprise).
  IF sub.historical_days_limit IS NOT NULL AND sub.historical_days_limit = 0 THEN
    RAISE EXCEPTION 'historical_sync_not_allowed_on_plan' USING errcode = '53400';
  END IF;

  effective_since := coalesce(since_date, now() - interval '30 days');

  IF sub.historical_days_limit IS NOT NULL AND sub.historical_days_limit > 0 THEN
    IF effective_since < (now() - (sub.historical_days_limit || ' days')::interval) THEN
      RAISE EXCEPTION 'date_beyond_plan_limit' USING errcode = '22023';
    END IF;
  END IF;

  -- Guard against quota exceeded when limit is bounded
  IF private.backfill_remaining(w) IS NOT NULL AND private.backfill_remaining(w) <= 0 THEN
    RAISE EXCEPTION 'quota_exceeded' USING errcode = '53400';
  END IF;

  INSERT INTO public.jobs(workspace_id, channel_id, type, dedupe_key, checkpoint)
  VALUES (w, c, 'import', 'hist_sync:' || c || ':' || extract(epoch FROM effective_since), jsonb_build_object(
    'is_historical', true,
    'since', effective_since,
    'max_items', coalesce(max_items, 500),
    'source', 'platform_sync'
  ))
  ON CONFLICT (workspace_id, dedupe_key) DO UPDATE SET
    checkpoint = excluded.checkpoint, status = 'queued', attempt = 0, not_before = now()
  RETURNING id INTO job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', job_id,
    'status', 'queued',
    'historical_days_limit', coalesce(sub.historical_days_limit, -1),
    'backfill_remaining', private.backfill_remaining(w)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_historical_platform_sync(uuid, uuid, timestamptz, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_historical_platform_sync(uuid, uuid, timestamptz, int) TO authenticated;

-- Overload for request_historical_platform_sync
CREATE OR REPLACE FUNCTION public.request_historical_platform_sync(
  w uuid,
  p_channel_id uuid,
  p_days_back int DEFAULT NULL,
  p_max_items int DEFAULT 500,
  p_published_after timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  calc_since timestamptz;
BEGIN
  IF p_published_after IS NOT NULL THEN
    calc_since := p_published_after;
  ELSIF p_days_back IS NOT NULL AND p_days_back > 0 THEN
    calc_since := now() - (p_days_back || ' days')::interval;
  ELSE
    calc_since := now() - interval '30 days';
  END IF;

  RETURN public.request_historical_platform_sync(
    w => w,
    c => p_channel_id,
    since_date => calc_since,
    max_items => coalesce(p_max_items, 500)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_historical_platform_sync(uuid, uuid, int, int, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_historical_platform_sync(uuid, uuid, int, int, timestamptz) TO authenticated;

-- 3. Correct private.dashboard_aggregates_impl
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
    SELECT c.id as channel_id, c.client_id, c.external_channel_id, c.active_analysis_key,
           c.title as channel_title, c.avatar_url as channel_avatar_url,
           c.subscriber_count, c.total_view_count as channel_view_count, c.video_count as channel_video_count
    FROM public.channels c
    WHERE c.workspace_id = w
    ORDER BY (c.status = 'connected') DESC, c.id LIMIT 1
  ),
  distinct_videos AS (
    SELECT
      v.id,
      v.title,
      v.kind,
      v.thumbnail_url,
      v.view_count,
      v.like_count,
      v.reported_comment_count
    FROM public.videos v
    WHERE v.workspace_id = w
      AND (v_platform IS NULL OR v.platform = v_platform)
      AND (v_video IS NULL OR v.id::text = v_video)
      AND (v_video_kind IS NULL OR v.kind = v_video_kind)
  ),
  video_kpis AS (
    SELECT
      sum(view_count) AS total_views,
      sum(like_count) AS total_likes,
      sum(reported_comment_count) AS total_reported_comments
    FROM distinct_videos
  ),
  raw_comments AS (
    SELECT
      cm.id,
      cm.video_id,
      cm.platform,
      cm.published_at,
      cm.likes_value,
      cm.is_reply,
      cm.author_name,
      cm.author_channel_id,
      cm.author_profile_image_url,
      cm.author_channel_url,
      cm.reply_count,
      cm.content_hash,
      CASE WHEN v_search IS NOT NULL THEN cm.text_raw ELSE NULL END AS text_raw,
      coalesce(cm.author_channel_id IS NOT NULL AND cm.author_channel_id = ch.external_channel_id, false) AS by_owner
    FROM public.comments cm
    LEFT JOIN ch ON true
    WHERE cm.workspace_id = w
      AND (v_platform IS NULL OR cm.platform = v_platform)
      AND (v_video IS NULL OR cm.video_id::text = v_video)
      AND (v_video_kind IS NULL OR cm.video_id IN (SELECT id FROM distinct_videos))
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
    WHERE (v_sentiment IS NULL OR e.eff_label = v_sentiment)
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
  videos_sub AS (
    SELECT
      f.video_id,
      count(*) AS total,
      count(*) FILTER (WHERE eff_label IS NOT NULL) AS analysed,
      count(*) FILTER (WHERE is_reply) AS replies,
      jsonb_build_object(
        'positive', count(*) FILTER (WHERE eff_label = 'positive'),
        'negative', count(*) FILTER (WHERE eff_label = 'negative'),
        'neutral', count(*) FILTER (WHERE eff_label = 'neutral'),
        'mixed', count(*) FILTER (WHERE eff_label = 'mixed')
      ) AS sentiments
    FROM filtered f
    WHERE NOT by_owner
    GROUP BY f.video_id
  ),
  videos_agg AS (
    SELECT
      vs.video_id::text AS id,
      dv.title,
      dv.thumbnail_url,
      dv.view_count,
      dv.like_count,
      dv.reported_comment_count,
      vs.total,
      vs.analysed,
      vs.replies,
      vs.sentiments
    FROM videos_sub vs
    JOIN distinct_videos dv ON dv.id = vs.video_id
  ),
  hours_counts AS (
    SELECT
      extract(hour FROM published_at AT TIME ZONE 'UTC')::int AS h,
      count(*) AS cnt
    FROM filtered
    WHERE NOT by_owner AND published_at IS NOT NULL
    GROUP BY 1
  ),
  hours_agg AS (
    SELECT jsonb_agg(coalesce(hc.cnt, 0) ORDER BY gs.h) AS hours
    FROM generate_series(0, 23) gs(h)
    LEFT JOIN hours_counts hc ON hc.h = gs.h
  ),
  weekdays_counts AS (
    SELECT
      extract(dow FROM published_at AT TIME ZONE 'UTC')::int AS d,
      count(*) AS cnt
    FROM filtered
    WHERE NOT by_owner AND published_at IS NOT NULL
    GROUP BY 1
  ),
  weekdays_agg AS (
    SELECT jsonb_agg(coalesce(wc.cnt, 0) ORDER BY gs.d) AS weekdays
    FROM generate_series(0, 6) gs(d)
    LEFT JOIN weekdays_counts wc ON wc.d = gs.d
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
        (array_agg(author_profile_image_url) FILTER (WHERE author_profile_image_url IS NOT NULL))[1] AS avatar_url,
        (array_agg(author_channel_url) FILTER (WHERE author_channel_url IS NOT NULL))[1] AS channel_url,
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
        'video_title', dv.title,
        'text_raw', coalesce(cm_neg.text_raw, ''),
        'author_name', f.author_name,
        'author_profile_image_url', cm_neg.author_profile_image_url,
        'published_at', f.published_at,
        'likes_value', f.likes_value,
        'label', f.eff_label,
        'topic', f.eff_topic
      ) AS item
      FROM (
        SELECT id, video_id, author_name, published_at, likes_value, eff_label, eff_topic
        FROM filtered
        WHERE NOT by_owner AND eff_label = 'negative'
        ORDER BY likes_value DESC NULLS LAST, published_at DESC
        LIMIT 5
      ) f
      LEFT JOIN distinct_videos dv ON dv.id = f.video_id
      LEFT JOIN public.comments cm_neg ON cm_neg.id = f.id
    ) r
  ),
  distinct_types AS (
    SELECT coalesce(jsonb_agg(DISTINCT value) FILTER (WHERE value IS NOT NULL), '[]'::jsonb) AS types
    FROM public.comment_annotations
    WHERE workspace_id = w AND kind = 'comment_type'
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
    'kpis', jsonb_build_object(
      'total_views', (SELECT total_views FROM video_kpis),
      'total_likes', (SELECT total_likes FROM video_kpis),
      'total_comments', (SELECT total FROM summary_stats),
      'engagement_rate', (
        SELECT CASE
          WHEN total_views IS NOT NULL AND total_views > 0 THEN
            round(
              ((coalesce(total_likes, 0) + (SELECT total FROM summary_stats))::numeric / total_views::numeric) * 100,
              2
            )
          ELSE NULL
        END
        FROM video_kpis
      ),
      'net_sentiment', (
        SELECT round(
          ((positive - negative)::numeric / NULLIF(positive + negative, 0)::numeric) * 100,
          1
        )
        FROM summary_stats
      )
    ),
    'channel', (
      SELECT jsonb_build_object(
        'id', ch.channel_id,
        'title', ch.channel_title,
        'avatar_url', ch.channel_avatar_url,
        'subscriber_count', ch.subscriber_count,
        'view_count', ch.channel_view_count,
        'video_count', ch.channel_video_count
      ) FROM ch
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

REVOKE ALL ON FUNCTION private.dashboard_aggregates_impl(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.dashboard_aggregates_impl(uuid, jsonb) TO authenticated, service_role;
