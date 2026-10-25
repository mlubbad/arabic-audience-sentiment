-- 1. Lock-free, throttled worker_seen touch (review finding #4) ---------------
--
-- With the platform credential, `touch_worker_seen` previously updated every
-- workspace's row in `public.worker_seen` unconditionally at the start of
-- `worker_commit_batch` and `worker_heartbeat`, holding row locks across all
-- workspaces until the transaction ended. Because the freshness window is 3
-- minutes, a row updated within the last 30 seconds is already fresh: insert
-- new workspaces with `on conflict do nothing`, and refresh existing rows only
-- when older than 30 seconds using `for update skip locked`.

CREATE OR REPLACE FUNCTION private.touch_worker_seen(token_hash text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  w uuid;
BEGIN
  w := private.worker_workspace(token_hash);
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
    ON CONFLICT (workspace_id) DO NOTHING;

    UPDATE public.worker_seen s
       SET last_seen_at = now()
     WHERE s.workspace_id IN (
       SELECT ws.workspace_id
         FROM public.worker_seen ws
        WHERE ws.workspace_id = w
          AND ws.last_seen_at < now() - interval '30 seconds'
          FOR UPDATE SKIP LOCKED
     );
  END IF;
END $$;

-- 2. Join-optimized claim_job with pre-aggregated running counts --------------

CREATE INDEX IF NOT EXISTS jobs_running_workspace_lease_idx
  ON public.jobs (workspace_id, lease_expires_at)
  WHERE status = 'running';

CREATE OR REPLACE FUNCTION private.claim_job(w uuid, job_types text[])
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
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
          WHEN q.type <> 'discover' THEN 2
          ELSE 3
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
END $$;

GRANT EXECUTE ON FUNCTION private.claim_job(uuid, text[]) TO service_role;

-- 3. Scale dashboard_aggregates_cache drain & index pending rows --------------

CREATE INDEX IF NOT EXISTS dashboard_aggregates_cache_pending_idx
  ON private.dashboard_aggregates_cache (requested_at)
  WHERE computed_at IS NULL OR requested_at > computed_at;

CREATE OR REPLACE FUNCTION private.drain_dashboard_aggregates(max_rows int DEFAULT 10)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  r record;
  done int := 0;
BEGIN
  DELETE FROM private.dashboard_aggregates_cache
   WHERE requested_at < now() - interval '7 days';

  FOR r IN
    SELECT workspace_id, filter_key, filters
      FROM private.dashboard_aggregates_cache
     WHERE (computed_at IS NULL OR requested_at > computed_at)
       AND coalesce(next_attempt_at, '-infinity') <= now()
     ORDER BY requested_at
     LIMIT max_rows
       FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    BEGIN
      UPDATE private.dashboard_aggregates_cache
         SET payload = private.dashboard_aggregates_compute(r.workspace_id, r.filters),
             computed_at = now(), attempts = 0, next_attempt_at = NULL, last_error = NULL
       WHERE workspace_id = r.workspace_id AND filter_key = r.filter_key;
      done := done + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE private.dashboard_aggregates_cache
         SET attempts = attempts + 1,
             last_error = sqlstate,
             next_attempt_at = now() + make_interval(secs => least(60 * power(2, attempts), 3600))
       WHERE workspace_id = r.workspace_id AND filter_key = r.filter_key;
    END;
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN done;
END
$fn$;

REVOKE ALL ON FUNCTION private.drain_dashboard_aggregates(int) FROM PUBLIC, anon, authenticated;

DO $schedule$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RETURN;
  END IF;
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dashboard-aggregates-drain';
  PERFORM cron.schedule(
    'dashboard-aggregates-drain',
    '* * * * *',
    $job$set local statement_timeout = '10min'; select private.drain_dashboard_aggregates(10)$job$
  );
END;
$schedule$;

-- 4. Seltz Spike Context Attribution persistence & RPCs (ADR-0005) -----------

CREATE TABLE public.sentiment_spike_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  dominant_sentiment text NOT NULL CHECK (dominant_sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
  query text NOT NULL CHECK (length(trim(query)) BETWEEN 1 AND 300),
  scope text NOT NULL DEFAULT 'news' CHECK (scope IN ('news', 'web')),
  status text NOT NULL CHECK (status IN ('succeeded', 'empty', 'failed')),
  headline_ar text,
  summary_ar text,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(citations) = 'array'),
  error_code text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sentiment_spike_attributions_channel_fkey
    FOREIGN KEY (workspace_id, channel_id)
    REFERENCES public.channels(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT sentiment_spike_attributions_window_check
    CHECK (to_date >= from_date),
  CONSTRAINT sentiment_spike_attributions_succeeded_fields_check
    CHECK ((status = 'succeeded') = (headline_ar IS NOT NULL AND length(trim(headline_ar)) > 0 AND summary_ar IS NOT NULL AND length(trim(summary_ar)) > 0)),
  CONSTRAINT sentiment_spike_attributions_failed_error_check
    CHECK ((status = 'failed') = (error_code IS NOT NULL AND length(trim(error_code)) > 0)),
  CONSTRAINT sentiment_spike_attributions_window_key
    UNIQUE (workspace_id, channel_id, from_date, to_date, dominant_sentiment)
);

CREATE INDEX sentiment_spike_attributions_channel_dates_idx
  ON public.sentiment_spike_attributions (workspace_id, channel_id, from_date DESC);

ALTER TABLE public.sentiment_spike_attributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sentiment_spike_attributions_member_read
  ON public.sentiment_spike_attributions
  FOR SELECT TO authenticated
  USING (private.has_role(workspace_id));

REVOKE ALL ON TABLE public.sentiment_spike_attributions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sentiment_spike_attributions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sentiment_spike_attributions TO service_role;

CREATE OR REPLACE FUNCTION public.list_spike_attributions(
  p_channel uuid,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ch public.channels;
  result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid_input' USING errcode = '22023';
  END IF;
  SELECT * INTO ch FROM public.channels WHERE id = p_channel;
  IF ch.id IS NULL OR NOT private.has_role(ch.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'channel_id', a.channel_id,
        'from_date', a.from_date,
        'to_date', a.to_date,
        'dominant_sentiment', a.dominant_sentiment,
        'query', a.query,
        'scope', a.scope,
        'status', a.status,
        'headline_ar', a.headline_ar,
        'summary_ar', a.summary_ar,
        'citations', a.citations,
        'error_code', a.error_code,
        'computed_at', a.computed_at
      )
      ORDER BY a.from_date DESC, a.computed_at DESC
    ),
    '[]'::jsonb
  )
  INTO result
  FROM (
    SELECT *
      FROM public.sentiment_spike_attributions s
     WHERE s.workspace_id = ch.workspace_id
       AND s.channel_id = ch.id
     ORDER BY s.from_date DESC, s.computed_at DESC
     LIMIT p_limit
  ) a;

  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.list_spike_attributions(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_spike_attributions(uuid, integer) TO authenticated, service_role;
