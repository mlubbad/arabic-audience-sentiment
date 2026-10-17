-- A discover job on a catalogued YouTube channel is told which videos the
-- channel already has, so the worker reads each tab only down to them.
--
-- Why: one Google project's 10,000 units a day serve the platform reader and
-- every owner grant, and refresh discovers spent about 7,600 of them: every
-- catalogue_interval (1440 min) each of 107 public channels re-paged all
-- three tabs and re-read videos.list for each of its videos, about 179k
-- videos and two units per fifty, mostly to learn nothing (2026-10-17, PR
-- #142's measurement). The tab playlists are newest first, so a page made
-- only of videos the channel already has means the rest of that tab is
-- known too; the worker stops there and asks videos.list only about the new
-- ones. A known 1,000-video channel's refresh falls from about 44 units to 4
-- when nothing is new.
--
-- What the worker is sent: the channel's most recently published 5,000
-- video ids. Enough to cover the head of every tab of the largest channel;
-- a tab whose head is not in the list is simply read further, as before.
-- Nothing (null) when the job is not a discover, the channel is not
-- YouTube, or the channel was never catalogued: then the worker reads the
-- whole channel, exactly as a first discover always has.
--
-- The commit is unchanged, on purpose. worker_commit_catalogue (live body:
-- 20261029000000) upserts the videos it is sent and writes no other video
-- row: a video the list leaves out keeps its row, its counts, its kind and
-- its selection, and nothing is marked absent. A list of only the new
-- videos, or of none, is therefore committed as it stands
-- (supabase/tests/incremental_catalogue.test.ts pins that).
--
-- What a refresh no longer does: re-read view, like and comment counts of
-- videos it does not list. The comment count of every video due for a read
-- is still refreshed at no extra cost by the collect path's live check
-- (worker_video_counts, one unit per fifty).

CREATE FUNCTION private.worker_known_videos(token_hash text, j uuid, t uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
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
              FROM public.videos v
             WHERE v.workspace_id = w AND v.channel_id = c AND v.platform = 'youtube'
             ORDER BY v.published_at DESC NULLS LAST, v.external_video_id
             LIMIT 5000) k), '[]'::jsonb);
END $$;

CREATE FUNCTION public.svc_worker_known_videos(credential_hash text, j uuid, t uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.worker_known_videos(credential_hash, j, t) $$;

REVOKE ALL ON FUNCTION
  private.worker_known_videos(text,uuid,uuid),
  public.svc_worker_known_videos(text,uuid,uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  private.worker_known_videos(text,uuid,uuid),
  public.svc_worker_known_videos(text,uuid,uuid)
  TO service_role;
