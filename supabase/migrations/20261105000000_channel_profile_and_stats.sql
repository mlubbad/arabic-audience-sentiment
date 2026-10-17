-- A discover already reads the channel resource. Keep that observation so
-- channel classification and growth do not have to infer facts from videos.
ALTER TABLE public.channels
  ADD COLUMN description text,
  ADD COLUMN keywords text[],
  ADD COLUMN topic_categories text[],
  ADD COLUMN country text,
  ADD COLUMN default_language text,
  ADD COLUMN channel_published_at timestamptz,
  ADD COLUMN subscriber_count_hidden boolean,
  ADD COLUMN profile_observed_at timestamptz,
  ADD COLUMN stats_observed_at timestamptz;

CREATE TABLE public.channel_stats_daily (
  workspace_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  day date NOT NULL,
  subscriber_count bigint,
  view_count bigint,
  video_count bigint,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, channel_id, day),
  FOREIGN KEY (workspace_id, channel_id)
    REFERENCES public.channels(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX channel_stats_daily_retention
  ON public.channel_stats_daily(observed_at);

ALTER TABLE public.channel_stats_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.channel_stats_daily FROM anon, authenticated;
GRANT SELECT ON public.channel_stats_daily TO authenticated;
CREATE POLICY tenant_read ON public.channel_stats_daily
  FOR SELECT TO authenticated
  USING (private.has_role(workspace_id));

CREATE FUNCTION private.worker_commit_channel(
  token_hash text, j uuid, t uuid, profile jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  w uuid;
  c uuid;
  expected_external text;
  observed timestamptz := now();
  has_profile boolean;
  has_stats boolean;
  k text;
BEGIN
  w := private.worker_job(token_hash, j, t);
  SELECT channel_id INTO c FROM public.jobs
   WHERE workspace_id = w AND id = j;
  SELECT external_channel_id INTO expected_external FROM public.channels
   WHERE workspace_id = w AND id = c;

  IF profile IS NULL OR jsonb_typeof(profile) <> 'object' THEN
    RAISE EXCEPTION 'invalid_channel_profile' USING errcode='22023';
  END IF;
  IF NOT profile ? 'external_channel_id'
     OR jsonb_typeof(profile->'external_channel_id') <> 'string' THEN
    RAISE EXCEPTION 'invalid_channel_profile' USING errcode='22023';
  END IF;
  IF profile->>'external_channel_id' IS DISTINCT FROM expected_external THEN
    RAISE EXCEPTION 'channel_profile_mismatch' USING errcode='22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_each(profile) f(key, value)
     WHERE key NOT IN (
       'external_channel_id', 'description', 'keywords', 'topic_categories',
       'country', 'default_language', 'channel_published_at',
       'subscriber_count', 'view_count', 'video_count',
       'subscriber_count_hidden')
        OR (key IN ('subscriber_count', 'view_count', 'video_count')
            AND jsonb_typeof(value) NOT IN ('number', 'null'))
        OR (key IN ('keywords', 'topic_categories')
            AND jsonb_typeof(value) NOT IN ('array', 'null'))
        OR (key IN ('description', 'country', 'default_language',
                    'channel_published_at')
            AND jsonb_typeof(value) NOT IN ('string', 'null'))
        OR (key = 'subscriber_count_hidden'
            AND jsonb_typeof(value) NOT IN ('boolean', 'null'))
  ) THEN
    RAISE EXCEPTION 'invalid_channel_profile' USING errcode='22023';
  END IF;

  FOREACH k IN ARRAY ARRAY['keywords', 'topic_categories'] LOOP
    IF profile ? k AND jsonb_typeof(profile->k) = 'array'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(profile->k) item
          WHERE jsonb_typeof(item) <> 'string') THEN
      RAISE EXCEPTION 'invalid_channel_profile' USING errcode='22023';
    END IF;
  END LOOP;

  FOREACH k IN ARRAY ARRAY['subscriber_count', 'view_count', 'video_count'] LOOP
    IF profile ? k AND jsonb_typeof(profile->k) = 'number'
       AND ((profile->>k)::numeric < 0
         OR (profile->>k)::numeric <> trunc((profile->>k)::numeric)
         OR (profile->>k)::numeric > 9223372036854775807) THEN
      RAISE EXCEPTION 'invalid_channel_profile' USING errcode='22023';
    END IF;
  END LOOP;

  has_profile := profile ?| ARRAY[
    'description', 'keywords', 'topic_categories', 'country',
    'default_language', 'channel_published_at'];
  has_stats := profile ?| ARRAY[
    'subscriber_count', 'view_count', 'video_count',
    'subscriber_count_hidden'];

  BEGIN
    UPDATE public.channels SET
      description = CASE WHEN profile ? 'description'
        THEN profile->>'description' ELSE description END,
      keywords = CASE WHEN profile ? 'keywords' THEN
        CASE WHEN jsonb_typeof(profile->'keywords') = 'null' THEN NULL
             ELSE ARRAY(SELECT jsonb_array_elements_text(profile->'keywords')) END
        ELSE keywords END,
      topic_categories = CASE WHEN profile ? 'topic_categories' THEN
        CASE WHEN jsonb_typeof(profile->'topic_categories') = 'null' THEN NULL
             ELSE ARRAY(SELECT jsonb_array_elements_text(profile->'topic_categories')) END
        ELSE topic_categories END,
      country = CASE WHEN profile ? 'country'
        THEN profile->>'country' ELSE country END,
      default_language = CASE WHEN profile ? 'default_language'
        THEN profile->>'default_language' ELSE default_language END,
      channel_published_at = CASE WHEN profile ? 'channel_published_at' THEN
        (profile->>'channel_published_at')::timestamptz ELSE channel_published_at END,
      subscriber_count = CASE WHEN profile ? 'subscriber_count' THEN
        (profile->>'subscriber_count')::bigint ELSE subscriber_count END,
      total_view_count = CASE WHEN profile ? 'view_count' THEN
        (profile->>'view_count')::bigint ELSE total_view_count END,
      video_count = CASE WHEN profile ? 'video_count' THEN
        (profile->>'video_count')::bigint ELSE video_count END,
      subscriber_count_hidden = CASE WHEN profile ? 'subscriber_count_hidden' THEN
        (profile->>'subscriber_count_hidden')::boolean ELSE subscriber_count_hidden END,
      profile_observed_at = CASE WHEN has_profile THEN observed ELSE profile_observed_at END,
      stats_observed_at = CASE WHEN has_stats THEN observed ELSE stats_observed_at END
     WHERE workspace_id = w AND id = c;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'invalid_channel_profile' USING errcode='22023';
  END;

  IF has_stats THEN
    INSERT INTO public.channel_stats_daily(
      workspace_id, channel_id, day, subscriber_count, view_count,
      video_count, observed_at)
    SELECT workspace_id, id, (observed AT TIME ZONE 'utc')::date,
           subscriber_count, total_view_count, video_count, observed
      FROM public.channels WHERE workspace_id = w AND id = c
    ON CONFLICT (workspace_id, channel_id, day) DO UPDATE SET
      subscriber_count = excluded.subscriber_count,
      view_count = excluded.view_count,
      video_count = excluded.video_count,
      observed_at = excluded.observed_at;
  END IF;

  RETURN jsonb_build_object('channel_id', c);
END $$;

CREATE FUNCTION public.svc_worker_commit_channel(
  credential_hash text, j uuid, t uuid, profile jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.worker_commit_channel(credential_hash, j, t, profile)
$$;

REVOKE ALL ON FUNCTION private.worker_commit_channel(text,uuid,uuid,jsonb)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.svc_worker_commit_channel(text,uuid,uuid,jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.worker_commit_channel(text,uuid,uuid,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.svc_worker_commit_channel(text,uuid,uuid,jsonb)
  TO service_role;

CREATE FUNCTION private.purge_channel_profile(
  retain_text interval DEFAULT interval '30 days',
  retain_stats interval DEFAULT interval '30 days')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cleared integer; removed integer;
BEGIN
  IF retain_text < interval '0' OR retain_stats < interval '0' THEN
    RAISE EXCEPTION 'invalid_input' USING errcode='22023';
  END IF;
  UPDATE public.channels SET
    description = NULL, keywords = NULL, topic_categories = NULL
   WHERE profile_observed_at < now() - retain_text
     AND (description IS NOT NULL OR keywords IS NOT NULL
          OR topic_categories IS NOT NULL);
  GET DIAGNOSTICS cleared = row_count;
  DELETE FROM public.channel_stats_daily
   WHERE observed_at < now() - retain_stats;
  GET DIAGNOSTICS removed = row_count;
  RETURN jsonb_build_object('profiles', cleared, 'stats', removed);
END $$;

REVOKE ALL ON FUNCTION private.purge_channel_profile(interval,interval)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.purge_channel_profile(interval,interval)
  TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
  THEN
    RAISE NOTICE 'pg_cron unavailable here; channel retention is not scheduled';
    RETURN;
  END IF;
  EXECUTE 'create extension if not exists pg_cron';
  PERFORM cron.unschedule(jobid) FROM cron.job
   WHERE jobname = 'purge-channel-profile';
  -- YouTube text stays on its 30-day cycle. Statistics may move to 36 months
  -- only after the owner's Derived Metrics application is accepted; that is
  -- an argument change here, not another storage migration.
  PERFORM cron.schedule(
    'purge-channel-profile', '29 3 * * *',
    $job$select private.purge_channel_profile('30 days','30 days')$job$);
END $$;
