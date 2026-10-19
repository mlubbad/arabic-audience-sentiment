ALTER TABLE public.competitor_candidates
  ADD COLUMN subscriber_count bigint,
  ADD COLUMN subscriber_count_hidden boolean,
  ADD COLUMN view_count bigint,
  ADD COLUMN video_count bigint,
  ADD COLUMN country text,
  ADD COLUMN default_language text,
  ADD COLUMN topic_categories text[],
  ADD COLUMN profile_observed_at timestamptz;

CREATE FUNCTION private.worker_candidates_due(token_hash text, j uuid, t uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w uuid; c uuid; kind text; ids jsonb;
BEGIN
  w := private.worker_job(token_hash, j, t);
  SELECT channel_id, type INTO c, kind FROM public.jobs WHERE id=j;
  IF kind <> 'discover' THEN RAISE EXCEPTION 'invalid_job_type' USING errcode='22023'; END IF;
  SELECT coalesce(jsonb_agg(candidate_external_id ORDER BY observed NULLS FIRST, candidate_external_id), '[]'::jsonb)
    INTO ids FROM (
      SELECT DISTINCT cc.candidate_external_id, min(cc.profile_observed_at) observed
      FROM public.competitor_candidates cc
      JOIN public.channels ch ON ch.id=cc.channel_id AND ch.workspace_id=cc.workspace_id
      WHERE cc.workspace_id=w AND cc.channel_id=c AND ch.platform='youtube'
        AND (cc.profile_observed_at IS NULL OR cc.profile_observed_at < now()-interval '7 days')
      GROUP BY cc.candidate_external_id ORDER BY min(cc.profile_observed_at) NULLS FIRST, cc.candidate_external_id LIMIT 50
    ) due;
  RETURN ids;
END $$;

CREATE FUNCTION private.worker_commit_candidate_profiles(token_hash text,j uuid,t uuid,profiles jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w uuid; c uuid; kind text; p jsonb; n integer:=0; affected integer;
BEGIN
  w:=private.worker_job(token_hash,j,t);
  SELECT channel_id,type INTO c,kind FROM public.jobs WHERE id=j;
  IF kind<>'discover' THEN RAISE EXCEPTION 'invalid_job_type' USING errcode='22023'; END IF;
  IF profiles IS NULL OR jsonb_typeof(profiles)<>'array' OR jsonb_array_length(profiles)>50
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(profiles) x WHERE
       jsonb_typeof(x)<>'object' OR x-'external_channel_id'-'subscriber_count'-'subscriber_count_hidden'-'view_count'-'video_count'-'country'-'default_language'-'topic_categories'<>'{}'::jsonb
       OR jsonb_typeof(x->'external_channel_id')<>'string'
       OR EXISTS (SELECT 1 FROM jsonb_each(x) e WHERE e.key IN ('subscriber_count','view_count','video_count') AND jsonb_typeof(e.value) NOT IN ('number','null'))
       OR EXISTS (SELECT 1 FROM jsonb_each(x) e WHERE e.key IN ('subscriber_count','view_count','video_count') AND jsonb_typeof(e.value)='number' AND ((e.value #>> '{}') !~ '^[0-9]+$' OR (e.value #>> '{}')::numeric>9223372036854775807))
       OR (x ? 'subscriber_count_hidden' AND jsonb_typeof(x->'subscriber_count_hidden') NOT IN ('boolean','null'))
       OR EXISTS (SELECT 1 FROM jsonb_each(x) e WHERE e.key IN ('country','default_language') AND jsonb_typeof(e.value) NOT IN ('string','null'))
       OR (x ? 'topic_categories' AND jsonb_typeof(x->'topic_categories') NOT IN ('array','null'))
       OR (jsonb_typeof(x->'topic_categories')='array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(x->'topic_categories') a WHERE jsonb_typeof(a)<>'string'))
       OR NOT EXISTS (SELECT 1 FROM public.competitor_candidates cc WHERE cc.workspace_id=w AND cc.channel_id=c AND cc.platform='youtube' AND cc.candidate_external_id=x->>'external_channel_id')
     ) THEN RAISE EXCEPTION 'invalid_candidate_profiles' USING errcode='22023'; END IF;
  FOR p IN SELECT value FROM jsonb_array_elements(profiles) LOOP
    IF (p-'external_channel_id')<>'{}'::jsonb THEN
      UPDATE public.competitor_candidates cc SET
        subscriber_count=CASE WHEN p?'subscriber_count' THEN (p->>'subscriber_count')::bigint ELSE cc.subscriber_count END,
        subscriber_count_hidden=CASE WHEN p?'subscriber_count_hidden' THEN (p->>'subscriber_count_hidden')::boolean ELSE cc.subscriber_count_hidden END,
        view_count=CASE WHEN p?'view_count' THEN (p->>'view_count')::bigint ELSE cc.view_count END,
        video_count=CASE WHEN p?'video_count' THEN (p->>'video_count')::bigint ELSE cc.video_count END,
        country=CASE WHEN p?'country' THEN p->>'country' ELSE cc.country END,
        default_language=CASE WHEN p?'default_language' THEN p->>'default_language' ELSE cc.default_language END,
        topic_categories=CASE WHEN p?'topic_categories' AND jsonb_typeof(p->'topic_categories')='array' THEN ARRAY(SELECT jsonb_array_elements_text(p->'topic_categories')) WHEN p?'topic_categories' THEN NULL ELSE cc.topic_categories END,
        profile_observed_at=now()
      WHERE cc.workspace_id=w AND cc.channel_id=c AND cc.platform='youtube' AND cc.candidate_external_id=p->>'external_channel_id';
      GET DIAGNOSTICS affected=ROW_COUNT;
      n:=n+affected;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('updated',n);
END $$;

CREATE FUNCTION public.svc_worker_candidates_due(credential_hash text,j uuid,t uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.worker_candidates_due(credential_hash,j,t) $$;
CREATE FUNCTION public.svc_worker_commit_candidate_profiles(credential_hash text,j uuid,t uuid,profiles jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.worker_commit_candidate_profiles(credential_hash,j,t,profiles) $$;
REVOKE ALL ON FUNCTION private.worker_candidates_due(text,uuid,uuid), private.worker_commit_candidate_profiles(text,uuid,uuid,jsonb), public.svc_worker_candidates_due(text,uuid,uuid), public.svc_worker_commit_candidate_profiles(text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.worker_candidates_due(text,uuid,uuid), private.worker_commit_candidate_profiles(text,uuid,uuid,jsonb), public.svc_worker_candidates_due(text,uuid,uuid), public.svc_worker_commit_candidate_profiles(text,uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION private.purge_channel_profile(retain_text interval DEFAULT interval '30 days',retain_stats interval DEFAULT interval '30 days')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cleared integer; removed integer;
BEGIN
  IF retain_text<interval '0' OR retain_stats<interval '0' THEN RAISE EXCEPTION 'invalid_input' USING errcode='22023'; END IF;
  UPDATE public.channels SET description=NULL,keywords=NULL,topic_categories=NULL WHERE profile_observed_at<now()-retain_text AND (description IS NOT NULL OR keywords IS NOT NULL OR topic_categories IS NOT NULL);
  GET DIAGNOSTICS cleared=row_count;
  DELETE FROM public.channel_stats_daily WHERE observed_at<now()-retain_stats;
  GET DIAGNOSTICS removed=row_count;
  UPDATE public.competitor_candidates SET subscriber_count=NULL,subscriber_count_hidden=NULL,view_count=NULL,video_count=NULL,country=NULL,default_language=NULL,topic_categories=NULL,profile_observed_at=NULL WHERE profile_observed_at<now()-retain_text;
  RETURN jsonb_build_object('profiles',cleared,'stats',removed);
END $$;
