-- Migration: 20260924010000_interaction_metrics_and_storytelling.sql
-- Description: Adds interaction metrics columns to videos, comments, and channels tables,
-- updates worker_commit_catalogue and commit_batch to persist them,
-- and enhances dashboard_aggregates_impl and dashboard_comments_impl to expose
-- storytelling KPIs (views, likes, engagement rate, net sentiment), enriched video cards, and author avatars.

-- 1. Schema Alterations
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS view_count bigint,
  ADD COLUMN IF NOT EXISTS like_count bigint,
  ADD COLUMN IF NOT EXISTS favorite_count bigint,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS category_id text;

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS author_profile_image_url text,
  ADD COLUMN IF NOT EXISTS author_channel_url text,
  ADD COLUMN IF NOT EXISTS reply_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS subscriber_count bigint,
  ADD COLUMN IF NOT EXISTS total_view_count bigint,
  ADD COLUMN IF NOT EXISTS video_count bigint,
  ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE INDEX IF NOT EXISTS videos_workspace_views_idx ON public.videos(workspace_id, view_count DESC NULLS LAST);

-- 2. Update worker_commit_catalogue to upsert video interaction metrics
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
        OR (i ? 'view_count'
            AND jsonb_typeof(i->'view_count') NOT IN ('number','null'))
        OR (i ? 'like_count'
            AND jsonb_typeof(i->'like_count') NOT IN ('number','null'))
        OR (i ? 'favorite_count'
            AND jsonb_typeof(i->'favorite_count') NOT IN ('number','null'))
        OR (i ? 'published_at' AND jsonb_typeof(i->'published_at') NOT IN ('string','null'))
        OR (i ? 'comments_state' AND i->>'comments_state' NOT IN ('open','disabled','unknown'))
        OR (i ? 'field_provenance' AND jsonb_typeof(i->'field_provenance') <> 'object')) THEN
    RAISE EXCEPTION 'invalid_catalogue' USING errcode='22023'; END IF;

  INSERT INTO public.videos(workspace_id, channel_id, platform, external_video_id, title, kind,
    published_at, duration_sec, thumbnail_url, reported_comment_count, comments_state,
    view_count, like_count, favorite_count, tags, description, category_id,
    catalogued_at, last_observed_at, field_provenance)
  SELECT w, c, c_platform, i->>'external_video_id',
         coalesce(nullif(i->>'title',''), i->>'external_video_id'),
         coalesce(i->>'kind', CASE WHEN c_platform='telegram' THEN 'channel_post' WHEN c_platform='x' THEN 'tweet' ELSE 'video' END),
         (i->>'published_at')::timestamptz,
         (i->>'duration_sec')::int,
         i->>'thumbnail_url',
         (i->>'reported_comment_count')::int,
         coalesce(
           nullif(i->>'comments_state', ''),
           CASE
             WHEN c_platform = 'youtube' THEN
               CASE WHEN jsonb_typeof(i->'reported_comment_count') = 'number' THEN 'open' ELSE 'disabled' END
             ELSE
               'open'
           END
         ),
         (i->>'view_count')::bigint,
         (i->>'like_count')::bigint,
         (i->>'favorite_count')::bigint,
         CASE WHEN i ? 'tags' AND jsonb_typeof(i->'tags') = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(i->'tags'))
              ELSE '{}'::text[] END,
         i->>'description',
         i->>'category_id',
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
    view_count = coalesce(excluded.view_count, public.videos.view_count),
    like_count = coalesce(excluded.like_count, public.videos.like_count),
    favorite_count = coalesce(excluded.favorite_count, public.videos.favorite_count),
    tags = CASE WHEN excluded.tags <> '{}'::text[] THEN excluded.tags ELSE public.videos.tags END,
    description = coalesce(nullif(excluded.description, ''), public.videos.description),
    category_id = coalesce(excluded.category_id, public.videos.category_id),
    comments_state = CASE
                       WHEN excluded.comments_state IN ('open', 'disabled')
                         THEN excluded.comments_state
                       WHEN public.videos.comments_state IS NOT NULL
                         THEN public.videos.comments_state
                       ELSE 'open'
                     END,
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

REVOKE ALL ON FUNCTION private.worker_commit_catalogue(text, uuid, uuid, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.worker_commit_catalogue(text, uuid, uuid, jsonb) TO service_role;

-- 3. Update commit_batch (retaining exact structure from 20260923180000 + storing new comment fields)
CREATE OR REPLACE FUNCTION private.commit_batch(
  j uuid, t uuid, b text, hash text, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  w uuid; ch uuid; vid uuid; prior text; outcome text;
  inserted int; keys text[]; covered text[]; wanted int;
  j_type text; j_payload jsonb; is_hist boolean;
  ch_platform text;
BEGIN
  SELECT workspace_id, channel_id, type, payload
  INTO w, ch, j_type, j_payload
  FROM public.jobs
  WHERE id=j AND lease_token=t AND lease_expires_at > now();
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

  is_hist := (j_type = 'import' OR coalesce(j_payload->>'is_historical', 'false') = 'true' OR coalesce(payload->>'is_historical', 'false') = 'true');

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
    published_at,timestamp_precision,likes_raw,likes_value,source,field_provenance,
    author_profile_image_url,author_channel_url,reply_count,updated_at)
  SELECT w, vid, ch_platform, c.external_comment_id, c.external_parent_id, coalesce(c.is_reply, false), coalesce(c.parent_source, 'unknown'),
         c.author_channel_id, c.author_name, c.text_raw, c.text_plain, c.content_hash,
         c.published_time_raw, c.published_at, coalesce(c.timestamp_precision, 'second'), c.likes_raw,
         c.likes_value, coalesce(c.source, 'unknown'), coalesce(c.field_provenance, '{}'::jsonb),
         c.author_profile_image_url, c.author_channel_url, coalesce(c.reply_count, 0), c.updated_at
  FROM jsonb_to_recordset(payload->'comments') AS c(
    external_comment_id text, external_parent_id text, is_reply boolean, parent_source text,
    author_channel_id text, author_name text, text_raw text, text_plain text, content_hash text,
    published_time_raw text, published_at timestamptz, timestamp_precision text,
    likes_raw text, likes_value bigint, source text, field_provenance jsonb,
    author_profile_image_url text, author_channel_url text, reply_count int, updated_at timestamptz)
  ON CONFLICT (workspace_id,platform,external_comment_id) DO UPDATE SET
    text_raw=excluded.text_raw, text_plain=excluded.text_plain,
    content_hash=excluded.content_hash, likes_raw=excluded.likes_raw,
    likes_value=excluded.likes_value, field_provenance=coalesce(excluded.field_provenance, public.comments.field_provenance),
    author_profile_image_url=coalesce(excluded.author_profile_image_url, public.comments.author_profile_image_url),
    author_channel_url=coalesce(excluded.author_channel_url, public.comments.author_channel_url),
    reply_count=coalesce(excluded.reply_count, public.comments.reply_count),
    updated_at=coalesce(excluded.updated_at, public.comments.updated_at),
    last_seen_at=now();
  GET DIAGNOSTICS inserted = row_count;

  -- Metering logic
  IF is_hist THEN
    SELECT coalesce(array_agg(DISTINCT 'backfill:'||ch_platform||':'||(c->>'external_comment_id')),'{}')
    INTO keys FROM jsonb_array_elements(coalesce(payload->'comments','[]'::jsonb)) c;
    wanted := coalesce(array_length(keys,1),0);
    IF wanted > 0 THEN
      covered := private.reserve_usage(w, 'historical_backfill', keys);
      IF coalesce(array_length(covered,1),0) <> wanted THEN
        RAISE EXCEPTION 'quota_exceeded' USING errcode='53400';
      END IF;
    END IF;
  ELSE
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
    END IF;
  END IF;

  IF jsonb_array_length(coalesce(payload->'predictions','[]'::jsonb)) > 0 THEN
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
  VALUES (w, ch, j, case when is_hist then 'backfill' else 'collect' end,
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

REVOKE ALL ON FUNCTION private.commit_batch(uuid, uuid, text, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.commit_batch(uuid, uuid, text, text, jsonb) TO service_role;

-- 4. Enhance dashboard_aggregates_impl with storytelling KPIs, enriched video stats, and commenter avatars
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
      coalesce(v.view_count, 0) AS view_count,
      coalesce(v.like_count, 0) AS like_count,
      coalesce(v.reported_comment_count, 0) AS reported_comment_count
    FROM public.videos v
    WHERE v.workspace_id = w
      AND (v_platform IS NULL OR v.platform = v_platform)
      AND (v_video IS NULL OR v.id::text = v_video)
      AND (v_video_kind IS NULL OR v.kind = v_video_kind)
  ),
  video_kpis AS (
    SELECT
      coalesce(sum(view_count), 0) AS total_views,
      coalesce(sum(like_count), 0) AS total_likes,
      coalesce(sum(reported_comment_count), 0) AS total_reported_comments
    FROM distinct_videos
  ),
  raw_comments AS (
    SELECT
      cm.id,
      cm.video_id,
      cm.platform,
      v.title AS video_title,
      v.kind AS video_kind,
      v.thumbnail_url,
      v.view_count,
      v.like_count,
      v.reported_comment_count,
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
      max(thumbnail_url) AS thumbnail_url,
      max(view_count) AS view_count,
      max(like_count) AS like_count,
      max(reported_comment_count) AS reported_comment_count,
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
        'video_title', f.video_title,
        'text_raw', coalesce(f.text_raw, cm_neg.text_raw, ''),
        'author_name', f.author_name,
        'author_profile_image_url', cm_neg.author_profile_image_url,
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
    'kpis', jsonb_build_object(
      'total_views', (SELECT total_views FROM video_kpis),
      'total_likes', (SELECT total_likes FROM video_kpis),
      'total_comments', (SELECT total FROM summary_stats),
      'engagement_rate', (
        SELECT round(
          ((total_likes + (SELECT total FROM summary_stats))::numeric / NULLIF(total_views, 0)::numeric) * 100,
          2
        )
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

-- 5. Enhance dashboard_comments_impl to return author avatars, URLs, reply counts, and edit dates
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
      'author_profile_image_url', pe.author_profile_image_url,
      'author_channel_url', pe.author_channel_url,
      'reply_count', coalesce(pe.reply_count, 0),
      'updated_at', pe.updated_at,
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

REVOKE ALL ON FUNCTION private.dashboard_comments_impl(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.dashboard_comments_impl(uuid, jsonb) TO authenticated, service_role;

-- 6. Update adoption functions to preserve interaction metrics across workspaces
CREATE OR REPLACE FUNCTION private.adopt_channel_catalogue(w uuid, c uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  ch public.channels;
  adopted_count int := 0;
BEGIN
  SELECT * INTO ch FROM public.channels WHERE workspace_id = w AND id = c;
  IF ch.id IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.videos (
    workspace_id, channel_id, platform, external_video_id, title, kind,
    published_at, duration_sec, thumbnail_url, reported_comment_count,
    reported_comment_count_at, comments_state, view_count, like_count, favorite_count,
    tags, description, category_id, catalogued_at, last_observed_at,
    field_provenance
  )
  SELECT DISTINCT ON (v.external_video_id)
    w, c, v.platform, v.external_video_id, v.title, v.kind,
    v.published_at, v.duration_sec, v.thumbnail_url, v.reported_comment_count,
    v.reported_comment_count_at, v.comments_state, v.view_count, v.like_count, v.favorite_count,
    v.tags, v.description, v.category_id, coalesce(v.catalogued_at, now()), now(),
    coalesce(v.field_provenance, '{}'::jsonb)
  FROM public.videos v
  JOIN public.channels donor_ch ON donor_ch.id = v.channel_id AND donor_ch.workspace_id = v.workspace_id
  WHERE donor_ch.platform = ch.platform
    AND donor_ch.external_channel_id = ch.external_channel_id
    AND v.workspace_id <> w
  ORDER BY v.external_video_id, v.catalogued_at DESC NULLS LAST
  ON CONFLICT (workspace_id, platform, external_video_id) DO UPDATE SET
    title = CASE
              WHEN excluded.title <> excluded.external_video_id
                THEN excluded.title
              ELSE public.videos.title
            END,
    kind = excluded.kind,
    thumbnail_url = coalesce(excluded.thumbnail_url, public.videos.thumbnail_url),
    reported_comment_count = coalesce(excluded.reported_comment_count, public.videos.reported_comment_count),
    reported_comment_count_at = coalesce(excluded.reported_comment_count_at, public.videos.reported_comment_count_at),
    comments_state = excluded.comments_state,
    view_count = coalesce(excluded.view_count, public.videos.view_count),
    like_count = coalesce(excluded.like_count, public.videos.like_count),
    favorite_count = coalesce(excluded.favorite_count, public.videos.favorite_count),
    tags = CASE WHEN excluded.tags <> '{}'::text[] THEN excluded.tags ELSE public.videos.tags END,
    description = coalesce(nullif(excluded.description, ''), public.videos.description),
    category_id = coalesce(excluded.category_id, public.videos.category_id),
    last_observed_at = now();

  GET DIAGNOSTICS adopted_count = row_count;

  IF adopted_count > 0 AND ch.catalogued_at IS NULL THEN
    UPDATE public.channels SET catalogued_at = now() WHERE workspace_id = w AND id = c;
  END IF;

  RETURN adopted_count;
END $$;

REVOKE ALL ON FUNCTION private.adopt_channel_catalogue(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.adopt_channel_catalogue(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.adopt_video_comments_and_predictions(w uuid, v uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  vid public.videos;
  donor_vid uuid;
  donor_ws uuid;
  donor_ch uuid;
  adopted_comments int := 0;
  adopted_sentiment int := 0;
  adopted_topics int := 0;
  total_stored int := 0;
BEGIN
  SELECT * INTO vid FROM public.videos WHERE workspace_id = w AND id = v;
  IF vid.id IS NULL THEN
    RETURN jsonb_build_object('comments', 0, 'sentiment', 0, 'topics', 0);
  END IF;

  SELECT donor_v.id, donor_v.workspace_id, donor_v.channel_id
    INTO donor_vid, donor_ws, donor_ch
  FROM public.videos donor_v
  JOIN public.comments c ON c.video_id = donor_v.id AND c.workspace_id = donor_v.workspace_id
  WHERE donor_v.platform = vid.platform
    AND donor_v.external_video_id = vid.external_video_id
    AND donor_v.workspace_id <> w
  LIMIT 1;

  IF donor_vid IS NULL THEN
    RETURN jsonb_build_object('comments', 0, 'sentiment', 0, 'topics', 0);
  END IF;

  -- 1. Adopt comments from donor workspace
  INSERT INTO public.comments (
    workspace_id, video_id, platform, external_comment_id, external_parent_id,
    is_reply, parent_source, author_channel_id, author_name, text_raw, text_plain,
    content_hash, published_time_raw, published_at, timestamp_precision,
    likes_raw, likes_value, source, field_provenance,
    author_profile_image_url, author_channel_url, reply_count, updated_at
  )
  SELECT
    w, v, c.platform, c.external_comment_id, c.external_parent_id,
    c.is_reply, c.parent_source, c.author_channel_id, c.author_name, c.text_raw, c.text_plain,
    c.content_hash, c.published_time_raw, c.published_at, c.timestamp_precision,
    c.likes_raw, c.likes_value, c.source, c.field_provenance,
    c.author_profile_image_url, c.author_channel_url, coalesce(c.reply_count, 0), c.updated_at
  FROM public.comments c
  WHERE c.workspace_id = donor_ws
    AND c.video_id = donor_vid
  ON CONFLICT (workspace_id, platform, external_comment_id) DO UPDATE SET
    author_profile_image_url = coalesce(excluded.author_profile_image_url, public.comments.author_profile_image_url),
    author_channel_url = coalesce(excluded.author_channel_url, public.comments.author_channel_url),
    reply_count = coalesce(excluded.reply_count, public.comments.reply_count),
    updated_at = coalesce(excluded.updated_at, public.comments.updated_at);

  GET DIAGNOSTICS adopted_comments = row_count;

  -- 2. Adopt sentiment predictions
  INSERT INTO public.analysis_runs (
    workspace_id, model_id, revision_sha, preprocessing_version, parameters, status
  )
  SELECT DISTINCT w, ar.model_id, ar.revision_sha, ar.preprocessing_version, ar.parameters, 'succeeded'
  FROM public.sentiment_predictions sp
  JOIN public.analysis_runs ar ON ar.id = sp.analysis_run_id AND ar.workspace_id = sp.workspace_id
  JOIN public.comments c ON c.id = sp.comment_id AND c.workspace_id = sp.workspace_id
  WHERE c.workspace_id = donor_ws
    AND c.video_id = donor_vid
  ON CONFLICT (workspace_id, model_id, revision_sha, preprocessing_version, parameters) DO NOTHING;

  INSERT INTO public.sentiment_predictions (
    workspace_id, comment_id, content_hash, analysis_run_id, analysis_key,
    status, label, class_scores, predicted_at
  )
  SELECT DISTINCT ON (target_c.id, sp.analysis_key)
    w, target_c.id, target_c.content_hash, target_ar.id, sp.analysis_key,
    sp.status, sp.label, sp.class_scores, sp.predicted_at
  FROM public.comments target_c
  JOIN public.comments donor_c
    ON donor_c.workspace_id = donor_ws
   AND donor_c.video_id = donor_vid
   AND donor_c.platform = target_c.platform
   AND donor_c.external_comment_id = target_c.external_comment_id
  JOIN public.sentiment_predictions sp
    ON sp.workspace_id = donor_c.workspace_id
   AND sp.comment_id = donor_c.id
   AND sp.status = 'succeeded'
  JOIN public.analysis_runs donor_ar
    ON donor_ar.workspace_id = sp.workspace_id
   AND donor_ar.id = sp.analysis_run_id
  JOIN public.analysis_runs target_ar
    ON target_ar.workspace_id = w
   AND target_ar.model_id = donor_ar.model_id
   AND target_ar.revision_sha = donor_ar.revision_sha
   AND target_ar.preprocessing_version = donor_ar.preprocessing_version
   AND target_ar.parameters = donor_ar.parameters
  WHERE target_c.workspace_id = w
    AND target_c.video_id = v
  ON CONFLICT (workspace_id, comment_id, content_hash, analysis_key) DO NOTHING;

  GET DIAGNOSTICS adopted_sentiment = row_count;

  -- 3. Adopt topic predictions
  INSERT INTO public.workspace_topics (
    workspace_id, key, name_ar, name_en, description, position, retired_at
  )
  SELECT
    w, dt.key, dt.name_ar, dt.name_en, dt.description, dt.position, dt.retired_at
  FROM public.workspace_topics dt
  WHERE dt.workspace_id = donor_ws AND dt.retired_at IS NULL
  ON CONFLICT (workspace_id, key) DO NOTHING;

  INSERT INTO public.topic_predictions (
    workspace_id, comment_id, content_hash, classification_key,
    status, topic_key, confidence, model_id, prompt_version, error_code, predicted_at
  )
  SELECT DISTINCT ON (target_c.id, tp.classification_key)
    w, target_c.id, target_c.content_hash,
    tp.classification_key,
    tp.status, tp.topic_key, tp.confidence, tp.model_id, tp.prompt_version, tp.error_code, tp.predicted_at
  FROM public.comments target_c
  JOIN public.comments donor_c
    ON donor_c.workspace_id = donor_ws
   AND donor_c.video_id = donor_vid
   AND donor_c.platform = target_c.platform
   AND donor_c.external_comment_id = target_c.external_comment_id
  JOIN public.topic_predictions tp
    ON tp.workspace_id = donor_c.workspace_id
   AND tp.comment_id = donor_c.id
   AND tp.status = 'succeeded'
  JOIN public.workspace_topics wt
    ON wt.workspace_id = w AND wt.key = tp.topic_key AND wt.retired_at IS NULL
  WHERE target_c.workspace_id = w
    AND target_c.video_id = v
  ON CONFLICT (workspace_id, comment_id, content_hash, classification_key) DO NOTHING;

  GET DIAGNOSTICS adopted_topics = row_count;

  -- 4. Update video_selections if video is selected and comments are now present
  SELECT count(*)::int INTO total_stored FROM public.comments WHERE workspace_id = w AND video_id = v;
  IF total_stored > 0 THEN
    UPDATE public.video_selections
       SET last_seen_comment_count = total_stored,
           last_collected_at = coalesce((SELECT max(last_seen_at) FROM public.comments WHERE workspace_id = w AND video_id = v), now()),
           last_outcome = 'exhausted',
           next_check_at = now() + make_interval(mins => coalesce(private.plan_limit(w, 'live_interval'), 1440))
     WHERE workspace_id = w AND video_id = v;
  END IF;

  RETURN jsonb_build_object(
    'comments', adopted_comments,
    'sentiment', adopted_sentiment,
    'topics', adopted_topics
  );
END $$;

REVOKE ALL ON FUNCTION private.adopt_video_comments_and_predictions(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.adopt_video_comments_and_predictions(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.adopt_channel_content(w uuid, c uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  ch public.channels;
  donor_ch public.channels;
  donor_ws uuid;
  vids_adopted int := 0;
  comments_adopted int := 0;
  sentiment_adopted int := 0;
  topics_adopted int := 0;
BEGIN
  SELECT * INTO ch FROM public.channels WHERE workspace_id = w AND id = c;
  IF ch.id IS NULL THEN
    RETURN jsonb_build_object('videos', 0, 'comments', 0, 'sentiment', 0, 'topics', 0);
  END IF;

  vids_adopted := private.adopt_channel_catalogue(w, c);

  SELECT * INTO donor_ch
  FROM public.channels dc
  WHERE dc.platform = ch.platform
    AND dc.external_channel_id = ch.external_channel_id
    AND dc.workspace_id <> w
    AND dc.status <> 'disconnected'
  ORDER BY (dc.active_analysis_key IS NOT NULL) DESC, dc.id ASC
  LIMIT 1;

  IF donor_ch.id IS NULL THEN
    RETURN jsonb_build_object('videos', vids_adopted, 'comments', 0, 'sentiment', 0, 'topics', 0);
  END IF;

  donor_ws := donor_ch.workspace_id;

  IF ch.active_analysis_key IS NULL AND donor_ch.active_analysis_key IS NOT NULL THEN
    UPDATE public.channels SET active_analysis_key = donor_ch.active_analysis_key WHERE workspace_id = w AND id = c;
  END IF;

  UPDATE public.workspaces target_w
  SET active_topic_key = donor_w.active_topic_key
  FROM public.workspaces donor_w
  WHERE target_w.id = w AND donor_w.id = donor_ws
    AND target_w.active_topic_key IS NULL
    AND donor_w.active_topic_key IS NOT NULL;

  INSERT INTO public.workspace_topics (workspace_id, key, name_ar, name_en, description, position)
  SELECT w, dt.key, dt.name_ar, dt.name_en, dt.description, dt.position
  FROM public.workspace_topics dt
  WHERE dt.workspace_id = donor_ws AND dt.retired_at IS NULL
  ON CONFLICT (workspace_id, key) DO NOTHING;

  INSERT INTO public.comments (
    workspace_id, video_id, platform, external_comment_id, external_parent_id,
    is_reply, parent_source, author_channel_id, author_name, text_raw, text_plain,
    content_hash, published_time_raw, published_at, timestamp_precision,
    likes_raw, likes_value, source, field_provenance,
    author_profile_image_url, author_channel_url, reply_count, updated_at
  )
  SELECT
    w, target_v.id, c_src.platform, c_src.external_comment_id, c_src.external_parent_id,
    c_src.is_reply, c_src.parent_source, c_src.author_channel_id, c_src.author_name, c_src.text_raw, c_src.text_plain,
    c_src.content_hash, c_src.published_time_raw, c_src.published_at, c_src.timestamp_precision,
    c_src.likes_raw, c_src.likes_value, c_src.source, c_src.field_provenance,
    c_src.author_profile_image_url, c_src.author_channel_url, coalesce(c_src.reply_count, 0), c_src.updated_at
  FROM public.videos target_v
  JOIN public.videos donor_v
    ON donor_v.platform = target_v.platform
   AND donor_v.external_video_id = target_v.external_video_id
   AND donor_v.workspace_id = donor_ws
  JOIN public.comments c_src
    ON c_src.workspace_id = donor_ws
   AND c_src.video_id = donor_v.id
  WHERE target_v.workspace_id = w
    AND target_v.channel_id = c
  ON CONFLICT (workspace_id, platform, external_comment_id) DO NOTHING;

  GET DIAGNOSTICS comments_adopted = row_count;

  INSERT INTO public.analysis_runs (
    workspace_id, model_id, revision_sha, preprocessing_version, parameters, status
  )
  SELECT DISTINCT w, ar.model_id, ar.revision_sha, ar.preprocessing_version, ar.parameters, 'succeeded'
  FROM public.analysis_runs ar
  WHERE ar.workspace_id = donor_ws
  ON CONFLICT (workspace_id, model_id, revision_sha, preprocessing_version, parameters) DO NOTHING;

  INSERT INTO public.sentiment_predictions (
    workspace_id, comment_id, content_hash, analysis_run_id, analysis_key,
    status, label, class_scores, predicted_at
  )
  SELECT DISTINCT ON (target_c.id, sp.analysis_key)
    w, target_c.id, target_c.content_hash, target_ar.id, sp.analysis_key,
    sp.status, sp.label, sp.class_scores, sp.predicted_at
  FROM public.videos target_v
  JOIN public.videos donor_v
    ON donor_v.platform = target_v.platform
   AND donor_v.external_video_id = target_v.external_video_id
   AND donor_v.workspace_id = donor_ws
  JOIN public.comments target_c
    ON target_c.workspace_id = w
   AND target_c.video_id = target_v.id
  JOIN public.comments donor_c
    ON donor_c.workspace_id = donor_ws
   AND donor_c.video_id = donor_v.id
   AND donor_c.platform = target_c.platform
   AND donor_c.external_comment_id = target_c.external_comment_id
  JOIN public.sentiment_predictions sp
    ON sp.workspace_id = donor_ws
   AND sp.comment_id = donor_c.id
   AND sp.status = 'succeeded'
  JOIN public.analysis_runs donor_ar
    ON donor_ar.workspace_id = donor_ws
   AND donor_ar.id = sp.analysis_run_id
  JOIN public.analysis_runs target_ar
    ON target_ar.workspace_id = w
   AND target_ar.model_id = donor_ar.model_id
   AND target_ar.revision_sha = donor_ar.revision_sha
   AND target_ar.preprocessing_version = donor_ar.preprocessing_version
   AND target_ar.parameters = donor_ar.parameters
  WHERE target_v.workspace_id = w
    AND target_v.channel_id = c
  ON CONFLICT (workspace_id, comment_id, content_hash, analysis_key) DO NOTHING;

  GET DIAGNOSTICS sentiment_adopted = row_count;

  INSERT INTO public.topic_predictions (
    workspace_id, comment_id, content_hash, classification_key,
    status, topic_key, confidence, model_id, prompt_version, error_code, predicted_at
  )
  SELECT DISTINCT ON (target_c.id, tp.classification_key)
    w, target_c.id, target_c.content_hash,
    tp.classification_key,
    tp.status, tp.topic_key, tp.confidence, tp.model_id, tp.prompt_version, tp.error_code, tp.predicted_at
  FROM public.videos target_v
  JOIN public.videos donor_v
    ON donor_v.platform = target_v.platform
   AND donor_v.external_video_id = target_v.external_video_id
   AND donor_v.workspace_id = donor_ws
  JOIN public.comments target_c
    ON target_c.workspace_id = w
   AND target_c.video_id = target_v.id
  JOIN public.comments donor_c
    ON donor_c.workspace_id = donor_ws
   AND donor_c.video_id = donor_v.id
   AND donor_c.platform = target_c.platform
   AND donor_c.external_comment_id = target_c.external_comment_id
  JOIN public.topic_predictions tp
    ON tp.workspace_id = donor_ws
   AND tp.comment_id = donor_c.id
   AND tp.status = 'succeeded'
  JOIN public.workspace_topics wt
    ON wt.workspace_id = w AND wt.key = tp.topic_key AND wt.retired_at IS NULL
  WHERE target_v.workspace_id = w
    AND target_v.channel_id = c
  ON CONFLICT (workspace_id, comment_id, content_hash, classification_key) DO NOTHING;

  GET DIAGNOSTICS topics_adopted = row_count;

  IF NOT EXISTS (SELECT 1 FROM public.sync_runs WHERE workspace_id = w AND status = 'succeeded') THEN
    INSERT INTO public.sync_runs (workspace_id, channel_id, mode, source, started_at, ended_at, status, error_code, coverage_summary)
    SELECT w, c, sr.mode, sr.source, sr.started_at, sr.ended_at, sr.status, sr.error_code, sr.coverage_summary
    FROM public.sync_runs sr
    WHERE sr.workspace_id = donor_ws AND sr.channel_id = donor_ch.id AND sr.status = 'succeeded'
    ORDER BY sr.ended_at DESC NULLS LAST LIMIT 1
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'videos', vids_adopted,
    'comments', comments_adopted,
    'sentiment', sentiment_adopted,
    'topics', topics_adopted
  );
END $$;

REVOKE ALL ON FUNCTION private.adopt_channel_content(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.adopt_channel_content(uuid, uuid) TO service_role;
