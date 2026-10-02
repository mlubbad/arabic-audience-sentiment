-- Fix comments_state for non-YouTube platforms (Telegram, X, TikTok) in worker_commit_catalogue.
-- YouTube uses absence of commentCount in API to determine disabled comments.
-- Omnichannel platforms (e.g. Telegram) do not provide numeric commentCount on channel preview,
-- but comments are open unless explicitly marked disabled.

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
        OR (i ? 'comments_state' AND i->>'comments_state' NOT IN ('open','disabled','unknown'))
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
         coalesce(
           nullif(i->>'comments_state', ''),
           CASE
             WHEN c_platform = 'youtube' THEN
               CASE WHEN jsonb_typeof(i->'reported_comment_count') = 'number' THEN 'open' ELSE 'disabled' END
             ELSE
               'open'
           END
         ),
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

-- Fix existing omnichannel posts mistakenly marked as disabled due to null comment count
UPDATE public.videos
   SET comments_state = 'open'
 WHERE platform != 'youtube'
   AND comments_state = 'disabled';
