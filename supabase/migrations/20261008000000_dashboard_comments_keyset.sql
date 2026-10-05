-- Keyset pagination for dashboard comments. Offset remains available for the
-- interactive dashboard, while exports can seek from an opaque cursor.

CREATE OR REPLACE FUNCTION private.dashboard_comments_impl(w uuid, f jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET statement_timeout = '30s' AS $fn$
DECLARE
  active text;
  topic_active text;
  p_limit int := LEAST(COALESCE((f->>'limit')::int, 25), 100);
  p_offset int := GREATEST(COALESCE((f->>'offset')::int, 0), 0);
  p_sort text := COALESCE(f->>'sort', 'published_desc');
  p_after text := NULLIF(f->>'after', '');
  p_with_total boolean := COALESCE((f->>'with_total')::boolean, true);
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
  cursor_payload jsonb;
  cursor_id uuid;
  cursor_published timestamptz;
  cursor_likes bigint;
  total_matches int := NULL;
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

  IF p_after IS NOT NULL THEN
    BEGIN
      cursor_payload := convert_from(decode(p_after, 'hex'), 'UTF8')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_cursor' USING errcode = '22023';
    END;
    IF jsonb_typeof(cursor_payload) <> 'object'
       OR cursor_payload->>'sort' IS DISTINCT FROM p_sort
       OR NOT (cursor_payload ? 'id')
       OR NOT (cursor_payload ? 'published_at')
       OR (p_sort IN ('likes_desc', 'likes_asc') AND NOT (cursor_payload ? 'likes_value')) THEN
      RAISE EXCEPTION 'invalid_cursor' USING errcode = '22023';
    END IF;
    BEGIN
      cursor_id := (cursor_payload->>'id')::uuid;
      cursor_published := NULLIF(cursor_payload->>'published_at', '')::timestamptz;
      cursor_likes := NULLIF(cursor_payload->>'likes_value', '')::bigint;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_cursor' USING errcode = '22023';
    END;
    -- Check ownership without revealing whether the id exists elsewhere.
    IF NOT EXISTS (
      SELECT 1 FROM public.comments cm
      WHERE cm.id = cursor_id AND cm.workspace_id = w
    ) THEN
      RAISE EXCEPTION 'invalid_cursor' USING errcode = '22023';
    END IF;
  END IF;

  WITH ch AS (
    SELECT c.id as channel_id, c.client_id, c.external_channel_id, c.active_analysis_key
    FROM public.channels c
    WHERE c.workspace_id = w
    ORDER BY (c.status = 'connected') DESC, c.id LIMIT 1
  ),
  distinct_videos AS (
    SELECT v.id, v.title, v.kind, v.channel_id
    FROM public.videos v
    WHERE v.workspace_id = w
      AND (v_video IS NULL OR v.id::text = v_video)
      AND (v_video_kind IS NULL OR v.kind = v_video_kind)
  ),
  raw_keys AS (
    SELECT
      cm.id,
      cm.video_id,
      cm.platform,
      cm.published_at,
      cm.likes_value,
      cm.is_reply,
      cm.content_hash,
      coalesce(cm.author_channel_id IS NOT NULL AND cm.author_channel_id = ch.external_channel_id, false) AS by_owner
    FROM public.comments cm
    LEFT JOIN ch ON true
    WHERE cm.workspace_id = w
      AND (v_platform IS NULL OR cm.platform = v_platform)
      AND (v_video IS NULL OR cm.video_id::text = v_video)
      AND (v_video_kind IS NULL OR cm.video_id IN (SELECT id FROM distinct_videos))
      AND (v_from IS NULL OR cm.published_at >= v_from)
      AND (v_to IS NULL OR cm.published_at < v_to)
      AND (v_replies IS NULL OR v_replies = 'all' OR (v_replies = 'comments' AND NOT cm.is_reply) OR (v_replies = 'replies' AND cm.is_reply))
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
      rk.*,
      ann.value AS comment_type,
      (rev.comment_id IS NOT NULL AND rev.content_hash = rk.content_hash) AS reviewed,
      CASE
        WHEN rev.content_hash = rk.content_hash THEN rev.label
        WHEN pred.content_hash = rk.content_hash THEN pred.label
        ELSE NULL
      END AS eff_label,
      CASE
        WHEN tr.content_hash = rk.content_hash THEN tr.topic_key
        WHEN tp.content_hash = rk.content_hash THEN tp.topic_key
        ELSE NULL
      END AS eff_topic
    FROM raw_keys rk
    LEFT JOIN rev_cte rev ON rev.comment_id = rk.id
    LEFT JOIN pred_cte pred ON pred.comment_id = rk.id
    LEFT JOIN tr_rev tr ON tr.comment_id = rk.id
    LEFT JOIN tp_cte tp ON tp.comment_id = rk.id
    LEFT JOIN ann_cte ann ON ann.comment_id = rk.id
  ),
  filtered AS (
    SELECT e.* FROM evaluated e
    WHERE (v_sentiment IS NULL OR e.eff_label = v_sentiment)
      AND (v_topic IS NULL OR (v_topic = '__unclassified' AND e.eff_topic IS NULL) OR (e.eff_topic = v_topic))
      AND (v_comment_type IS NULL OR e.comment_type = v_comment_type)
      AND (v_review_status IS NULL OR v_review_status = 'all' OR (v_review_status = 'reviewed' AND e.reviewed) OR (v_review_status = 'unreviewed' AND NOT e.reviewed))
      AND (
        v_search IS NULL OR
        EXISTS (
          SELECT 1 FROM public.comments scm
          WHERE scm.id = e.id AND (scm.text_raw ILIKE '%' || v_search || '%' OR scm.author_name ILIKE '%' || v_search || '%')
        )
      )
  ),
  counted AS (
    SELECT count(*)::int AS cnt FROM filtered
    HAVING p_with_total
  ),
  sorted_page AS (
    SELECT f.* FROM filtered f
    WHERE p_after IS NULL OR
      CASE p_sort
        WHEN 'published_desc' THEN
          (cursor_published IS NOT NULL AND (f.published_at < cursor_published OR f.published_at IS NULL))
          OR (f.published_at IS NOT DISTINCT FROM cursor_published AND f.id < cursor_id)
        WHEN 'published_asc' THEN
          (cursor_published IS NOT NULL AND (f.published_at > cursor_published OR f.published_at IS NULL))
          OR (f.published_at IS NOT DISTINCT FROM cursor_published AND f.id < cursor_id)
        WHEN 'likes_desc' THEN
          (cursor_likes IS NOT NULL AND (f.likes_value < cursor_likes OR f.likes_value IS NULL))
          OR (f.likes_value IS NOT DISTINCT FROM cursor_likes AND (
            (cursor_published IS NOT NULL AND (f.published_at < cursor_published OR f.published_at IS NULL))
            OR (f.published_at IS NOT DISTINCT FROM cursor_published AND f.id < cursor_id)
          ))
        WHEN 'likes_asc' THEN
          (cursor_likes IS NOT NULL AND (f.likes_value > cursor_likes OR f.likes_value IS NULL))
          OR (f.likes_value IS NOT DISTINCT FROM cursor_likes AND (
            (cursor_published IS NOT NULL AND (f.published_at < cursor_published OR f.published_at IS NULL))
            OR (f.published_at IS NOT DISTINCT FROM cursor_published AND f.id < cursor_id)
          ))
        ELSE false
      END
    ORDER BY
      CASE WHEN p_sort = 'likes_desc' THEN f.likes_value END DESC NULLS LAST,
      CASE WHEN p_sort = 'likes_asc' THEN f.likes_value END ASC NULLS LAST,
      CASE WHEN p_sort = 'published_asc' THEN f.published_at END ASC NULLS LAST,
      f.published_at DESC NULLS LAST,
      f.id DESC
    LIMIT p_limit + 1 OFFSET CASE WHEN p_after IS NULL THEN p_offset ELSE 0 END
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
      'workspace_id', cm.workspace_id::text,
      'client_id', coalesce(ch.client_id, cm.workspace_id)::text,
      'channel_id', coalesce(ch.channel_id, dv.channel_id)::text,
      'video_id', pe.video_id::text,
      'platform', pe.platform,
      'by_channel_owner', pe.by_owner,
      'video_title', dv.title,
      'video_kind', dv.kind,
      'author_channel_id', cm.author_channel_id,
      'author_name', cm.author_name,
      'author_profile_image_url', cm.author_profile_image_url,
      'author_channel_url', cm.author_channel_url,
      'reply_count', coalesce(cm.reply_count, 0),
      'updated_at', cm.updated_at,
      'text_raw', cm.text_raw,
      'content_hash', cm.content_hash,
      'likes_raw', cm.likes_raw,
      'likes_value', cm.likes_value,
      'published_at', cm.published_at,
      'published_time_raw', cm.published_time_raw,
      'timestamp_precision', cm.timestamp_precision,
      'is_reply', cm.is_reply,
      'parent_comment_id', cm.external_parent_id,
      'parent_source', cm.parent_source,
      'source', cm.source,
      'field_provenance', cm.field_provenance,
      'comment_type', pe.comment_type,
      'content_purged_at', cm.content_purged_at,
      'prediction', ap.pred_json,
      'reviews', coalesce(ra.reviews_json, '[]'::jsonb),
      'topic_prediction', atp.topic_pred_json,
      'topic_reviews', coalesce(tra.topic_reviews_json, '[]'::jsonb)
    ) ORDER BY pe.rnum) AS items
    FROM page_exact pe
    JOIN public.comments cm ON cm.id = pe.id
    LEFT JOIN distinct_videos dv ON dv.id = pe.video_id
    LEFT JOIN ch ON true
    LEFT JOIN page_preds ap ON ap.comment_id = pe.id
    LEFT JOIN page_topic_preds atp ON atp.comment_id = pe.id
    LEFT JOIN page_reviews ra ON ra.comment_id = pe.id
    LEFT JOIN page_topic_reviews tra ON tra.comment_id = pe.id
  )
  SELECT
    (SELECT cnt FROM counted),
    coalesce((SELECT items FROM assembled), '[]'::jsonb),
    (SELECT count(*) > p_limit FROM page_with_extra),
    (SELECT encode(convert_to(jsonb_build_object(
      'sort', p_sort,
      'published_at', published_at,
      'likes_value', likes_value,
      'id', id
    )::text, 'UTF8'), 'hex') FROM page_exact ORDER BY rnum DESC LIMIT 1)
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

REVOKE ALL ON FUNCTION private.dashboard_comments_impl(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.dashboard_comments_impl(uuid, jsonb) TO authenticated, service_role;
