-- Prioritize initial collection for channels whose selected videos have never been collected yet.
--
-- Order of priority in private.claim_job:
--   0: First discover of an uncatalogued channel (ch.catalogued_at IS NULL)
--   1: Overdue refresh discover (catalogued_at older than interval + 6h grace)
--   2: Initial collect of a channel with selected videos and zero collected videos so far
--   3: Routine non-discover work (periodic collect, analyse, import)
--   4: Young refresh discover

CREATE OR REPLACE FUNCTION private.claim_job(w uuid, job_types text[])
 RETURNS SETOF public.jobs
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  claimed public.jobs;
BEGIN
  IF w IS NULL THEN
    INSERT INTO public.worker_seen(workspace_id, last_seen_at)
    SELECT ws.id, now() FROM public.workspaces ws
    ON CONFLICT (workspace_id) DO NOTHING;

    UPDATE public.worker_seen s
       SET last_seen_at = now()
     WHERE s.workspace_id IN (
       SELECT ws.workspace_id
         FROM public.worker_seen ws
        WHERE ws.last_seen_at < now() - interval '30 seconds'
          FOR UPDATE SKIP LOCKED
     );
  ELSE
    INSERT INTO public.worker_seen(workspace_id, last_seen_at)
    VALUES (w, now())
    ON CONFLICT (workspace_id) DO UPDATE SET last_seen_at = now();
  END IF;

  UPDATE public.jobs SET
      status = 'failed',
      error_code = CASE
        WHEN reclaims >= 20
          THEN 'lease_thrashing:' || reclaims::text
        ELSE 'retry_exhausted:' || coalesce(last_error, 'no_error_recorded')
      END,
      lease_token = NULL,
      lease_expires_at = NULL
   WHERE (w IS NULL OR workspace_id = w)
     AND status IN ('queued', 'running')
     AND (attempt >= 3 OR reclaims >= 20)
     AND (lease_expires_at IS NULL OR lease_expires_at <= now());

  UPDATE public.jobs j SET
      status = 'running',
      attempt = j.attempt + CASE WHEN j.status = 'queued' THEN 1 ELSE 0 END,
      reclaims = j.reclaims + CASE
        WHEN j.status = 'running' AND j.heartbeats > 0 THEN 1 ELSE 0 END,
      not_before = CASE
        WHEN j.status = 'running' AND j.heartbeats > 0 AND j.reclaims >= 1
          THEN now() + least(interval '30 seconds' * (2 ^ least(j.reclaims, 5)),
                             interval '10 minutes')
        ELSE j.not_before END,
      heartbeats = 0,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '5 minutes'
   WHERE j.id = (
     WITH running_by_ws AS (
       SELECT r.workspace_id, count(*) AS running_count
         FROM public.jobs r
        WHERE w IS NULL
          AND r.status = 'running'
          AND r.lease_expires_at > now()
        GROUP BY r.workspace_id
     )
     SELECT q.id
       FROM public.jobs q
       LEFT JOIN public.channels ch
         ON ch.id = q.channel_id AND ch.workspace_id = q.workspace_id
       LEFT JOIN running_by_ws r_ws
         ON r_ws.workspace_id = q.workspace_id
      WHERE (w IS NULL OR q.workspace_id = w)
        AND (job_types IS NULL OR cardinality(job_types) = 0
             OR q.type = ANY(job_types))
        AND q.attempt < 3
        AND q.reclaims < 20
        AND q.not_before <= now()
        AND (q.status = 'queued'
             OR (q.status = 'running' AND q.lease_expires_at <= now()))
      ORDER BY
        CASE
          WHEN q.type = 'discover' AND ch.catalogued_at IS NULL
            THEN 0
          WHEN q.type = 'discover'
               AND ch.catalogued_at <= now()
                 - make_interval(mins => private.catalogue_interval_or_default(q.workspace_id))
                 - interval '6 hours'
            THEN 1
          WHEN q.type = 'collect'
               AND EXISTS (
                 SELECT 1 FROM public.video_selections vs
                  WHERE vs.workspace_id = q.workspace_id
                    AND vs.channel_id = q.channel_id
               )
               AND NOT EXISTS (
                 SELECT 1 FROM public.video_selections vs
                  WHERE vs.workspace_id = q.workspace_id
                    AND vs.channel_id = q.channel_id
                    AND vs.last_collected_at IS NOT NULL
               )
            THEN 2
          WHEN q.type <> 'discover' THEN 3
          ELSE 4
        END,
        CASE WHEN w IS NULL THEN coalesce(r_ws.running_count, 0) ELSE 0 END,
        q.not_before,
        q.id
      FOR UPDATE OF q SKIP LOCKED
      LIMIT 1
   )
  RETURNING j.* INTO claimed;

  IF claimed.id IS NULL THEN RETURN; END IF;

  INSERT INTO public.sync_runs(workspace_id, channel_id, job_id, mode, source, status)
  VALUES (claimed.workspace_id, claimed.channel_id, claimed.id,
          CASE WHEN claimed.type IN ('discover','collect','analyse','import')
               THEN claimed.type ELSE 'collect' END,
          'unknown', 'running')
  ON CONFLICT (workspace_id, job_id) DO UPDATE
    SET status = 'running', ended_at = NULL, error_code = NULL;

  RETURN NEXT claimed;
END $function$;
