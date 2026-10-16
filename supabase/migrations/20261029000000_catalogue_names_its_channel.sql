-- A YouTube catalogue names the channel that uploaded each video, and the
-- database files it only when that is the job's channel.
--
-- Why: between 2026-10-12 and 2026-10-16 a worker built before the platform
-- reader (pre-2026-09-19) claimed discover jobs of public channels. The
-- gateway handed it the reader's token beside the channel's id; it read the
-- token as the channel owner's, dropped the id and listed `channels?mine=true`
-- — the reader's own channel, AJ360. Its 4,604 uploads were filed under 73 of
-- the 107 public YouTube channels (335,218 rows): nothing between the source's
-- answer and `public.videos` asked whose videos they were.
--
-- The gateway now keeps the reader's token from a worker that does not say it
-- knows a reader lease. This is the last line, whatever worker or source is
-- wrong next: every item carries `channel_external_id` (YouTube's
-- snippet.channelId) and a list with any item that is not the job's channel,
-- or does not say, is refused whole (Invariant 4).
--
-- Rollout: a worker older than this change sends no `channel_external_id`,
-- so its YouTube discovery is refused (`catalogue_channel_mismatch`) until it
-- runs this commit. That is intended: such a worker is exactly the hazard.

CREATE OR REPLACE FUNCTION private.worker_commit_catalogue(token_hash text, j uuid, t uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w uuid; c uuid; c_platform text; c_external text; n int; BEGIN
  w := private.worker_job(token_hash, j, t);
  SELECT channel_id INTO c FROM public.jobs WHERE id = j;
  SELECT coalesce(platform, 'youtube'), external_channel_id
    INTO c_platform, c_external FROM public.channels WHERE id = c;
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
  -- Whose videos these are. A YouTube video has one uploader and the API
  -- names it; a list that is not all the job's channel's is not this
  -- channel's catalogue, however well-formed.
  IF c_platform = 'youtube' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload) i
     WHERE (i->>'channel_external_id') IS DISTINCT FROM c_external) THEN
    RAISE EXCEPTION 'catalogue_channel_mismatch' USING errcode='22023'; END IF;

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

-- The cleanup, for the owner to run (it deletes, so no migration runs it).
-- From one YouTube channel, remove the videos that another channel uploaded:
-- those whose id is catalogued under any channel row naming `source_external`.
-- A YouTube video has exactly one uploader, so a video catalogued under the
-- source channel is never also the target's. Its comments, predictions,
-- reviews, annotations and selections go with it, in the order
-- remove_channel_impl uses. Usage already metered is not touched: whether to
-- give it back is a billing decision.
--
--   select c.title, private.purge_foreign_catalogue(c.id, 'UC…source…')
--     from public.channels c
--    where c.platform = 'youtube' and c.status = 'public_unverified';
--
-- One channel per call is a transaction per channel; run them one at a time
-- if the editor's statement timeout is shorter than the whole list.
CREATE OR REPLACE FUNCTION private.purge_foreign_catalogue(p_channel uuid, source_external text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ch public.channels; foreign_ids uuid[]; n_videos int; n_comments int; BEGIN
  SELECT * INTO ch FROM public.channels WHERE id = p_channel;
  IF ch.id IS NULL THEN
    RAISE EXCEPTION 'invalid_channel' USING errcode='23503'; END IF;
  IF source_external IS NULL OR source_external !~ '^UC[A-Za-z0-9_-]{22}$' THEN
    RAISE EXCEPTION 'invalid_channel_id' USING errcode='22023'; END IF;
  -- The source channel's own rows are its own, wherever they sit.
  IF coalesce(ch.platform, 'youtube') <> 'youtube' OR ch.external_channel_id = source_external THEN
    RETURN jsonb_build_object('videos', 0, 'comments', 0);
  END IF;

  SELECT coalesce(array_agg(v.id), '{}') INTO foreign_ids
    FROM public.videos v
   WHERE v.workspace_id = ch.workspace_id AND v.channel_id = ch.id
     AND EXISTS (
       SELECT 1 FROM public.videos s
         JOIN public.channels sc ON sc.workspace_id = s.workspace_id AND sc.id = s.channel_id
        WHERE sc.platform = 'youtube' AND sc.external_channel_id = source_external
          AND s.platform = 'youtube' AND s.external_video_id = v.external_video_id);
  IF cardinality(foreign_ids) = 0 THEN
    RETURN jsonb_build_object('videos', 0, 'comments', 0);
  END IF;

  PERFORM set_config('app.deleting_workspace', ch.workspace_id::text, true);
  DELETE FROM public.sentiment_predictions WHERE workspace_id = ch.workspace_id AND comment_id IN (
    SELECT id FROM public.comments WHERE workspace_id = ch.workspace_id AND video_id = ANY(foreign_ids));
  DELETE FROM public.topic_predictions WHERE workspace_id = ch.workspace_id AND comment_id IN (
    SELECT id FROM public.comments WHERE workspace_id = ch.workspace_id AND video_id = ANY(foreign_ids));
  DELETE FROM public.comment_reviews WHERE workspace_id = ch.workspace_id AND comment_id IN (
    SELECT id FROM public.comments WHERE workspace_id = ch.workspace_id AND video_id = ANY(foreign_ids));
  DELETE FROM public.topic_reviews WHERE workspace_id = ch.workspace_id AND comment_id IN (
    SELECT id FROM public.comments WHERE workspace_id = ch.workspace_id AND video_id = ANY(foreign_ids));
  DELETE FROM public.comment_annotations WHERE workspace_id = ch.workspace_id AND comment_id IN (
    SELECT id FROM public.comments WHERE workspace_id = ch.workspace_id AND video_id = ANY(foreign_ids));
  DELETE FROM public.comments WHERE workspace_id = ch.workspace_id AND video_id = ANY(foreign_ids);
  GET DIAGNOSTICS n_comments = row_count;
  DELETE FROM public.video_selections WHERE workspace_id = ch.workspace_id AND video_id = ANY(foreign_ids);
  DELETE FROM public.videos WHERE workspace_id = ch.workspace_id AND id = ANY(foreign_ids);
  GET DIAGNOSTICS n_videos = row_count;
  PERFORM set_config('app.deleting_workspace', '', true);
  RETURN jsonb_build_object('videos', n_videos, 'comments', n_comments);
END $$;

REVOKE ALL ON FUNCTION private.purge_foreign_catalogue(uuid, text) FROM public, anon, authenticated, service_role;
