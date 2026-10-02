-- Migration: 20260920140000_dashboard_snapshot_window_and_fair_index.sql
-- Optimizes dashboard_snapshot by scoping comment materialization to the most recent window (1500 comments),
-- joining relation CTEs directly against the slice to eliminate 100+ MB memory serialization and PostgREST timeouts,
-- setting statement_timeout = '30s' on public.dashboard_snapshot with SECURITY DEFINER,
-- and adding partial indexes for fair job scheduling and descending comment ordering.

-- 1. Index supporting fair multi-tenant claim_job scheduling
CREATE INDEX IF NOT EXISTS jobs_running_fair_idx
  ON public.jobs (workspace_id, status, lease_expires_at)
  WHERE status = 'running';

-- 2. Index supporting recent comments window ordering
CREATE INDEX IF NOT EXISTS comments_workspace_published_desc_idx
  ON public.comments (workspace_id, published_at DESC NULLS LAST, id DESC);

-- 3. Optimized dashboard_snapshot_impl: scoped to recent comments window
CREATE OR REPLACE FUNCTION private.dashboard_snapshot_impl(w uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET statement_timeout = '30s' AS $$
DECLARE
  active text;
  topic_active text;
  rows jsonb;
  state jsonb;
  rev text;
  taxonomy jsonb;
BEGIN
  IF NOT private.has_role(w) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Active analysis key
  SELECT c.active_analysis_key INTO active FROM public.channels c
   WHERE c.workspace_id = w AND c.active_analysis_key IS NOT NULL
   ORDER BY (c.status = 'connected') DESC, c.id LIMIT 1;

  SELECT active_topic_key INTO topic_active FROM public.workspaces WHERE id = w;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'key', tp.key, 'name_ar', tp.name_ar, 'name_en', tp.name_en,
      'description', tp.description, 'position', tp.position,
      'retired', tp.retired_at IS NOT NULL) ORDER BY tp.position), '[]'::jsonb)
    INTO taxonomy FROM public.workspace_topics tp WHERE tp.workspace_id = w;

  -- Revision based on recent sync runs or comments
  SELECT coalesce(max(s.ended_at)::text, max(s.started_at)::text, 'empty') INTO rev
   FROM public.sync_runs s WHERE s.workspace_id = w;

  -- Comments and their associated relations, scoped to the most recent window (1500 comments)
  -- to prevent 50+ MB memory explosions and PostgREST timeout/gateway crash while maintaining
  -- rich, interactive dashboard browsing and instant rendering.
  WITH recent_comments AS (
    SELECT cm.*, v.title AS video_title, v.kind AS video_kind,
           (cm.author_channel_id IS NOT NULL AND cm.author_channel_id = ch.external_channel_id) AS by_channel_owner
    FROM public.comments cm
    JOIN public.videos v ON v.workspace_id = w AND v.id = cm.video_id
    JOIN public.channels ch ON ch.workspace_id = w AND ch.id = v.channel_id
    WHERE cm.workspace_id = w
    ORDER BY cm.published_at DESC NULLS LAST, cm.id DESC
    LIMIT 1500
  ),
  active_pred AS (
    SELECT DISTINCT ON (p.comment_id, p.content_hash)
           p.comment_id, p.content_hash,
           json_build_object(
             'status', p.status, 'label', p.label, 'content_hash', p.content_hash,
             'analysis_key', p.analysis_key, 'model_id', r.model_id,
             'revision', r.revision_sha, 'preprocessing_version', r.preprocessing_version,
             'predicted_at', p.predicted_at, 'class_scores', p.class_scores
           ) AS pred_json
    FROM public.sentiment_predictions p
    JOIN recent_comments rc ON rc.id = p.comment_id AND rc.content_hash = p.content_hash
    JOIN public.analysis_runs r ON r.workspace_id = w AND r.id = p.analysis_run_id
    WHERE p.workspace_id = w
      AND active IS NOT NULL AND p.analysis_key = active
    ORDER BY p.comment_id, p.content_hash, p.predicted_at DESC
  ),
  active_tp AS (
    SELECT DISTINCT ON (p.comment_id, p.content_hash)
           p.comment_id, p.content_hash,
           json_build_object(
             'status', p.status, 'topic_key', p.topic_key, 'confidence', p.confidence,
             'content_hash', p.content_hash, 'classification_key', p.classification_key,
             'model_id', p.model_id, 'prompt_version', p.prompt_version,
             'predicted_at', p.predicted_at, 'error_code', p.error_code
           ) AS topic_pred_json
    FROM public.topic_predictions p
    JOIN recent_comments rc ON rc.id = p.comment_id AND rc.content_hash = p.content_hash
    WHERE p.workspace_id = w
      AND topic_active IS NOT NULL AND p.classification_key = topic_active
    ORDER BY p.comment_id, p.content_hash, p.predicted_at DESC
  ),
  reviews_agg AS (
    SELECT rv.comment_id,
           coalesce(json_agg(json_build_object(
             'label', rv.label, 'content_hash', rv.content_hash,
             'created_at', rv.created_at, 'origin', rv.origin,
             'reviewer_id', rv.reviewer_id::text, 'reason', rv.reason
           ) ORDER BY rv.created_at), '[]'::json) AS reviews_json
    FROM public.comment_reviews rv
    JOIN recent_comments rc ON rc.id = rv.comment_id
    WHERE rv.workspace_id = w
    GROUP BY rv.comment_id
  ),
  topic_reviews_agg AS (
    SELECT tr.comment_id,
           coalesce(json_agg(json_build_object(
             'topic_key', tr.topic_key, 'content_hash', tr.content_hash,
             'created_at', tr.created_at, 'origin', tr.origin,
             'reviewer_id', tr.reviewer_id::text, 'reason', tr.reason
           ) ORDER BY tr.created_at), '[]'::json) AS topic_reviews_json
    FROM public.topic_reviews tr
    JOIN recent_comments rc ON rc.id = tr.comment_id
    WHERE tr.workspace_id = w
    GROUP BY tr.comment_id
  ),
  annotations_latest AS (
    SELECT DISTINCT ON (a.comment_id) a.comment_id, a.value
    FROM public.comment_annotations a
    JOIN recent_comments rc ON rc.id = a.comment_id
    WHERE a.workspace_id = w AND a.kind = 'comment_type'
    ORDER BY a.comment_id, a.created_at DESC
  )
  SELECT coalesce(json_agg(r.row ORDER BY r.published_at NULLS LAST, r.id), '[]'::json)::jsonb
  INTO rows FROM (
    SELECT cm.id, cm.published_at, json_build_object(
      'id', cm.id::text,
      'workspace_id', cm.workspace_id::text,
      'client_id', ch.client_id::text,
      'channel_id', ch.id::text,
      'video_id', v.id::text,
      'by_channel_owner', cm.by_channel_owner,
      'video_title', cm.video_title,
      'video_kind', cm.video_kind,
      'author_channel_id', cm.author_channel_id,
      'author_name', cm.author_name,
      'text_raw', cm.text_raw,
      'content_hash', cm.content_hash,
      'likes_raw', cm.likes_raw,
      'likes_value', cm.likes_value,
      'published_at', cm.published_at,
      'published_time_raw', cm.published_time_raw,
      'timestamp_precision', cm.timestamp_precision,
      'is_reply', cm.is_reply,
      'parent_comment_id', parent.id::text,
      'parent_source', cm.parent_source,
      'source', cm.source,
      'field_provenance', cm.field_provenance,
      'content_purged_at', cm.content_purged_at,
      'comment_type', an.value,
      'prediction', ap.pred_json,
      'reviews', coalesce(ra.reviews_json, '[]'::json),
      'topic_prediction', atp.topic_pred_json,
      'topic_reviews', coalesce(tra.topic_reviews_json, '[]'::json)
    ) AS row
    FROM recent_comments cm
    JOIN public.videos v ON v.workspace_id = w AND v.id = cm.video_id
    JOIN public.channels ch ON ch.workspace_id = w AND ch.id = v.channel_id
    LEFT JOIN public.comments parent ON parent.workspace_id = w
      AND parent.platform = cm.platform AND parent.external_comment_id = cm.external_parent_id
    LEFT JOIN active_pred ap ON ap.comment_id = cm.id AND ap.content_hash = cm.content_hash
    LEFT JOIN active_tp atp ON atp.comment_id = cm.id AND atp.content_hash = cm.content_hash
    LEFT JOIN reviews_agg ra ON ra.comment_id = cm.id
    LEFT JOIN topic_reviews_agg tra ON tra.comment_id = cm.id
    LEFT JOIN annotations_latest an ON an.comment_id = cm.id
  ) r;

  -- Collection health
  SELECT jsonb_build_object(
    'worker', jsonb_build_object(
      'connected', coalesce((SELECT s.last_seen_at > now() - INTERVAL '3 minutes'
                               FROM public.worker_seen s
                              WHERE s.workspace_id = w), false),
      'last_heartbeat_at', (SELECT s.last_seen_at FROM public.worker_seen s
                             WHERE s.workspace_id = w),
      'busy', coalesce((SELECT count(*) > 0 FROM public.jobs j
                         WHERE j.workspace_id = w
                           AND j.status = 'running'
                           AND j.lease_expires_at > now()), false)),
    'queued_jobs', (SELECT count(*) FROM public.jobs j
                     WHERE j.workspace_id = w AND j.status = 'queued'),
    'last_run', (
      SELECT jsonb_build_object(
        'started_at', s.started_at, 'ended_at', s.ended_at, 'status', s.status,
        'source', s.source, 'error_code', s.error_code,
        'coverage', jsonb_build_object(
          'videos_seen', coalesce((s.coverage_summary->>'videos_seen')::int, 0),
          'comments_collected', coalesce((s.coverage_summary->>'comments_collected')::int, 0),
          'complete', coalesce((s.coverage_summary->>'complete')::boolean, false)))
      FROM public.sync_runs s WHERE s.workspace_id = w AND s.mode = 'collect'
      ORDER BY s.started_at DESC LIMIT 1))
  INTO state;

  RETURN jsonb_build_object(
    'mode', 'live',
    'revision', rev,
    'active_analysis_key', coalesce(active, ''),
    'active_analysis_labels', coalesce((
      SELECT jsonb_agg(k) FROM (
        SELECT DISTINCT k FROM (
          SELECT jsonb_object_keys(p.class_scores) AS k
          FROM public.sentiment_predictions p
          WHERE p.workspace_id = w AND active IS NOT NULL
            AND p.analysis_key = active AND p.status = 'succeeded'
          LIMIT 50
        ) s
      ) s2), '[]'::jsonb),
    'topics', taxonomy,
    'active_topic_key', coalesce(topic_active, ''),
    'plan', private.usage_summary_impl(w),
    'sync', state,
    'comments', rows);
END $$;

-- Update public.dashboard_snapshot to be SECURITY DEFINER with statement_timeout
CREATE OR REPLACE FUNCTION public.dashboard_snapshot(w uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET statement_timeout = '30s' AS $$
  SELECT private.dashboard_snapshot_impl(w);
$$;

REVOKE ALL ON FUNCTION public.dashboard_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_snapshot(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.dashboard_snapshot_impl(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.dashboard_snapshot_impl(uuid) TO authenticated, service_role;
