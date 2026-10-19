ALTER TABLE public.plans ADD COLUMN competitors_limit integer CHECK (competitors_limit IS NULL OR competitors_limit >= 0);
-- This is a schema backfill, not a customer or operator plan change.
ALTER TABLE public.plans DISABLE TRIGGER plans_audited;
UPDATE public.plans SET competitors_limit = CASE key WHEN 'free' THEN 0 WHEN 'creator' THEN 3 WHEN 'creator_plus' THEN 3 WHEN 'pilot' THEN 3 WHEN 'agency' THEN 10 WHEN 'media' THEN 25 WHEN 'enterprise' THEN 25 WHEN 'owner' THEN NULL END;
ALTER TABLE public.plans ENABLE TRIGGER plans_audited;

CREATE OR REPLACE FUNCTION private.plan_limit(w uuid, which text) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.plans; BEGIN
 SELECT pl.* INTO p FROM public.subscriptions s JOIN public.plans pl ON pl.key=s.plan_key
 WHERE s.workspace_id=private.billing_root(w) AND s.status IN ('active','past_due');
 IF NOT FOUND THEN RAISE EXCEPTION 'no_active_plan' USING errcode='42501'; END IF;
 RETURN CASE which WHEN 'channels' THEN p.channels_limit WHEN 'members' THEN p.members_limit
 WHEN 'workspaces' THEN p.workspaces_limit WHEN 'sync_interval' THEN p.min_sync_interval_minutes
 WHEN 'live_interval' THEN p.live_interval_minutes WHEN 'catalogue_interval' THEN p.catalogue_interval_minutes
 WHEN 'competitors' THEN p.competitors_limit END;
END $$;

CREATE OR REPLACE FUNCTION public.competitor_decide(p_channel uuid,p_candidate_external_id text,p_decision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ws uuid;lim integer;cnt integer;BEGIN
 SELECT workspace_id INTO ws FROM public.channels WHERE id=p_channel;
 IF ws IS NULL OR NOT private.has_role(ws,ARRAY['workspace_owner','analyst']) THEN RAISE EXCEPTION 'forbidden' USING errcode='42501'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('tracked','dismissed','clear') OR p_candidate_external_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.competitor_candidates WHERE workspace_id=ws AND channel_id=p_channel AND platform='youtube' AND candidate_external_id=p_candidate_external_id) THEN RAISE EXCEPTION 'invalid_input' USING errcode='22023'; END IF;
 IF p_decision='clear' THEN DELETE FROM public.competitor_decisions WHERE workspace_id=ws AND channel_id=p_channel AND platform='youtube' AND candidate_external_id=p_candidate_external_id;
 ELSE
  IF p_decision='tracked' THEN lim:=private.plan_limit(ws,'competitors'); SELECT count(*) INTO cnt FROM public.competitor_decisions WHERE workspace_id=ws AND status='tracked' AND NOT(channel_id=p_channel AND candidate_external_id=p_candidate_external_id); IF lim IS NOT NULL AND cnt>=lim THEN RAISE EXCEPTION 'competitor_limit_reached' USING errcode='P0001'; END IF; END IF;
  INSERT INTO public.competitor_decisions(workspace_id,channel_id,candidate_external_id,status,decided_by) VALUES(ws,p_channel,p_candidate_external_id,p_decision,auth.uid()) ON CONFLICT(workspace_id,channel_id,platform,candidate_external_id) DO UPDATE SET status=excluded.status,decided_by=excluded.decided_by,decided_at=now();
 END IF;
 lim:=private.plan_limit(ws,'competitors'); SELECT count(*) INTO cnt FROM public.competitor_decisions WHERE workspace_id=ws AND status='tracked'; RETURN jsonb_build_object('status',p_decision,'tracked_count',cnt,'limit',lim);
END $$;
REVOKE ALL ON FUNCTION public.competitor_decide(uuid,text,text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.competitor_decide(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.competitor_suggestions(p_channel uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path='' AS $$
DECLARE ch public.channels;lim integer;cnt integer;BEGIN
 SELECT * INTO ch FROM public.channels WHERE id=p_channel;
 IF ch.id IS NULL OR NOT private.has_role(ch.workspace_id) THEN RAISE EXCEPTION 'forbidden' USING errcode='42501'; END IF;
 lim:=private.plan_limit(ch.workspace_id,'competitors'); SELECT count(*) INTO cnt FROM public.competitor_decisions WHERE workspace_id=ch.workspace_id AND status='tracked';
 -- B-7 will add genre-based similarity after candidate genre classification is enabled.
 RETURN jsonb_build_object(
  'channel',jsonb_build_object('id',ch.id,'title',ch.title,'handle',ch.handle,'subscriber_count',ch.subscriber_count,'subscriber_count_hidden',ch.subscriber_count_hidden,'country',ch.country,'default_language',ch.default_language,'topic_categories',ch.topic_categories,'channel_published_at',ch.channel_published_at,'profile_observed_at',ch.profile_observed_at,'stats_observed_at',ch.stats_observed_at),
  'limit',lim,'tracked_count',cnt,
  'candidates',coalesce((
   WITH grouped AS (
    SELECT c.candidate_external_id,
      (array_agg(c.title ORDER BY (c.title IS NULL),c.last_seen_at DESC))[1] title,
      (array_agg(c.handle ORDER BY (c.handle IS NULL),c.last_seen_at DESC))[1] handle,
      array_agg(DISTINCT c.source ORDER BY c.source) sources,
      max(c.subscriber_count) subscriber_count,max(c.view_count) view_count,max(c.video_count) video_count,
      bool_or(coalesce(c.subscriber_count_hidden,false)) subscriber_count_hidden,
      max(c.country) country,max(c.default_language) default_language,max(c.profile_observed_at) profile_observed_at,
      min(c.topic_categories::text)::text[] topic_categories,
      max(d.status) status
    FROM public.competitor_candidates c
    LEFT JOIN public.competitor_decisions d ON d.workspace_id=c.workspace_id AND d.channel_id=c.channel_id AND d.platform=c.platform AND d.candidate_external_id=c.candidate_external_id
    WHERE c.workspace_id=ch.workspace_id AND c.channel_id=p_channel AND c.platform='youtube'
    GROUP BY c.candidate_external_id
    HAVING coalesce(max(d.status),'')<>'dismissed'
   ), scored AS (
    SELECT g.*,
      CASE WHEN ch.topic_categories IS NULL OR array_length(ch.topic_categories,1) IS NULL OR g.topic_categories IS NULL OR array_length(g.topic_categories,1) IS NULL THEN NULL
       ELSE (SELECT count(*)::numeric FROM (SELECT unnest(ch.topic_categories) INTERSECT SELECT unnest(g.topic_categories)) x)
        / NULLIF((SELECT count(*)::numeric FROM (SELECT unnest(ch.topic_categories) UNION SELECT unnest(g.topic_categories)) x),0) END content,
      CASE WHEN ch.default_language IS NOT NULL AND g.default_language IS NOT NULL AND ch.country IS NOT NULL AND g.country IS NOT NULL
       THEN ((CASE WHEN lower(ch.default_language)=lower(g.default_language) THEN 1 ELSE 0 END)+(CASE WHEN upper(ch.country)=upper(g.country) THEN 1 ELSE 0 END))::numeric/2
       WHEN ch.default_language IS NOT NULL AND g.default_language IS NOT NULL THEN CASE WHEN lower(ch.default_language)=lower(g.default_language) THEN 1::numeric ELSE 0::numeric END
       WHEN ch.country IS NOT NULL AND g.country IS NOT NULL THEN CASE WHEN upper(ch.country)=upper(g.country) THEN 1::numeric ELSE 0::numeric END
       ELSE NULL END locale,
      CASE WHEN ch.subscriber_count>0 AND g.subscriber_count>0 AND NOT coalesce(ch.subscriber_count_hidden,false) AND NOT g.subscriber_count_hidden
       THEN greatest(0::numeric,least(1::numeric,1-abs(log(10,g.subscriber_count::numeric/ch.subscriber_count::numeric))/2)) ELSE NULL END size,
      CASE WHEN ch.subscriber_count>0 AND g.subscriber_count>0 AND NOT coalesce(ch.subscriber_count_hidden,false) AND NOT g.subscriber_count_hidden THEN g.subscriber_count::numeric/ch.subscriber_count::numeric ELSE NULL END ratio,
      CASE WHEN ch.topic_categories IS NULL OR array_length(ch.topic_categories,1) IS NULL OR g.topic_categories IS NULL OR array_length(g.topic_categories,1) IS NULL THEN NULL
       ELSE (SELECT count(*) FROM (SELECT unnest(ch.topic_categories) INTERSECT SELECT unnest(g.topic_categories)) x) END shared_topics
    FROM grouped g
   ), weighted AS (
    SELECT s.*, CASE WHEN content IS NULL AND locale IS NULL AND size IS NULL THEN NULL
     ELSE round((coalesce(content*0.5,0)+coalesce(locale*0.25,0)+coalesce(size*0.25,0)) /
       ((CASE WHEN content IS NULL THEN 0 ELSE 0.5 END)+(CASE WHEN locale IS NULL THEN 0 ELSE 0.25 END)+(CASE WHEN size IS NULL THEN 0 ELSE 0.25 END)),3) END score
    FROM scored s
   )
   SELECT jsonb_agg(jsonb_build_object(
    'external_id',candidate_external_id,'title',title,'handle',handle,'sources',sources,'status',status,
    'subscriber_count',subscriber_count,'view_count',view_count,'video_count',video_count,'country',country,'default_language',default_language,'profile_observed_at',profile_observed_at,
    'components',jsonb_build_object('content',content,'locale',locale,'size',size),'score',score,
    'tier',CASE WHEN content IS NULL OR ratio IS NULL THEN NULL WHEN ratio>=10 AND content>=0.3 THEN 'aspirational' WHEN ratio BETWEEN 0.25 AND 4 AND content>=0.5 THEN 'direct' WHEN content>=0.2 THEN 'indirect' ELSE 'related' END,
    'reasons',(CASE WHEN shared_topics IS NOT NULL AND shared_topics>0 THEN jsonb_build_array(jsonb_build_object('kind','shared_topics','value',shared_topics)) ELSE '[]'::jsonb END)
      || (CASE WHEN ch.default_language IS NOT NULL AND default_language IS NOT NULL AND lower(ch.default_language)=lower(default_language) THEN jsonb_build_array(jsonb_build_object('kind','same_language')) ELSE '[]'::jsonb END)
      || (CASE WHEN ch.country IS NOT NULL AND country IS NOT NULL AND upper(ch.country)=upper(country) THEN jsonb_build_array(jsonb_build_object('kind','same_country')) ELSE '[]'::jsonb END)
      || (CASE WHEN ratio IS NOT NULL THEN jsonb_build_array(jsonb_build_object('kind','size_ratio','value',round(ratio,3))) ELSE '[]'::jsonb END)
   ) ORDER BY (status='tracked') DESC NULLS LAST,score DESC NULLS LAST,subscriber_count DESC NULLS LAST,candidate_external_id)
   FROM weighted
  ),'[]'::jsonb)
 );
END $$;
REVOKE ALL ON FUNCTION public.competitor_suggestions(uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.competitor_suggestions(uuid) TO authenticated;

CREATE TABLE public.competitor_decisions(
 workspace_id uuid NOT NULL, channel_id uuid NOT NULL, platform text NOT NULL DEFAULT 'youtube',
 candidate_external_id text NOT NULL, status text NOT NULL CHECK(status IN ('tracked','dismissed')),
 decided_by uuid REFERENCES auth.users ON DELETE SET NULL, decided_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,channel_id,platform,candidate_external_id),
 FOREIGN KEY(workspace_id,channel_id) REFERENCES public.channels(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE public.competitor_stats_daily(
 workspace_id uuid NOT NULL, channel_id uuid NOT NULL, candidate_external_id text NOT NULL, day date NOT NULL,
 subscriber_count bigint, view_count bigint, video_count bigint, observed_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,channel_id,candidate_external_id,day),
 FOREIGN KEY(workspace_id,channel_id) REFERENCES public.channels(workspace_id,id) ON DELETE CASCADE
);
ALTER TABLE public.competitor_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_stats_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON public.competitor_decisions FOR SELECT TO authenticated USING(private.has_role(workspace_id));
CREATE POLICY tenant_read ON public.competitor_stats_daily FOR SELECT TO authenticated USING(private.has_role(workspace_id));
REVOKE ALL ON public.competitor_decisions,public.competitor_stats_daily FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.competitor_decisions,public.competitor_stats_daily TO authenticated;
GRANT ALL ON public.competitor_decisions,public.competitor_stats_daily TO service_role;

CREATE OR REPLACE FUNCTION private.worker_candidates_due(token_hash text,j uuid,t uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w uuid;c uuid;kind text;ids jsonb; BEGIN
 w:=private.worker_job(token_hash,j,t); SELECT channel_id,type INTO c,kind FROM public.jobs WHERE id=j;
 IF kind<>'discover' THEN RAISE EXCEPTION 'invalid_job_type' USING errcode='22023'; END IF;
 SELECT coalesce(jsonb_agg(candidate_external_id ORDER BY tracked DESC,observed NULLS FIRST,candidate_external_id),'[]'::jsonb) INTO ids FROM (
  SELECT cc.candidate_external_id,min(cc.profile_observed_at) observed,coalesce(bool_or(d.status='tracked'),false) tracked
  FROM public.competitor_candidates cc JOIN public.channels ch ON ch.id=cc.channel_id AND ch.workspace_id=cc.workspace_id
  LEFT JOIN public.competitor_decisions d ON d.workspace_id=cc.workspace_id AND d.channel_id=cc.channel_id AND d.platform=cc.platform AND d.candidate_external_id=cc.candidate_external_id
  WHERE cc.workspace_id=w AND cc.channel_id=c AND ch.platform='youtube'
  GROUP BY cc.candidate_external_id
  HAVING min(cc.profile_observed_at) IS NULL OR min(cc.profile_observed_at)<now()-CASE WHEN coalesce(bool_or(d.status='tracked'),false) THEN interval '1 day' ELSE interval '7 days' END
  ORDER BY coalesce(bool_or(d.status='tracked'),false) DESC,min(cc.profile_observed_at) NULLS FIRST,cc.candidate_external_id LIMIT 50
 ) q; RETURN ids;
END $$;

CREATE OR REPLACE FUNCTION private.worker_commit_candidate_profiles(token_hash text,j uuid,t uuid,profiles jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w uuid;c uuid;kind text;p jsonb;n integer:=0;affected integer; BEGIN
 w:=private.worker_job(token_hash,j,t); SELECT channel_id,type INTO c,kind FROM public.jobs WHERE id=j;
 IF kind<>'discover' THEN RAISE EXCEPTION 'invalid_job_type' USING errcode='22023'; END IF;
 IF profiles IS NULL OR jsonb_typeof(profiles)<>'array' OR jsonb_array_length(profiles)>50
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(profiles) x WHERE jsonb_typeof(x)<>'object' OR x-'external_channel_id'-'subscriber_count'-'subscriber_count_hidden'-'view_count'-'video_count'-'country'-'default_language'-'topic_categories'<>'{}'::jsonb OR jsonb_typeof(x->'external_channel_id')<>'string'
 OR EXISTS(SELECT 1 FROM jsonb_each(x) e WHERE e.key IN ('subscriber_count','view_count','video_count') AND jsonb_typeof(e.value) NOT IN ('number','null'))
 OR EXISTS(SELECT 1 FROM jsonb_each(x) e WHERE e.key IN ('subscriber_count','view_count','video_count') AND jsonb_typeof(e.value)='number' AND ((e.value #>> '{}') !~ '^[0-9]+$' OR (e.value #>> '{}')::numeric>9223372036854775807))
 OR (x?'subscriber_count_hidden' AND jsonb_typeof(x->'subscriber_count_hidden') NOT IN ('boolean','null'))
 OR EXISTS(SELECT 1 FROM jsonb_each(x) e WHERE e.key IN ('country','default_language') AND jsonb_typeof(e.value) NOT IN ('string','null'))
 OR (x?'topic_categories' AND jsonb_typeof(x->'topic_categories') NOT IN ('array','null'))
 OR (jsonb_typeof(x->'topic_categories')='array' AND EXISTS(SELECT 1 FROM jsonb_array_elements(x->'topic_categories') a WHERE jsonb_typeof(a)<>'string'))
 OR NOT EXISTS(SELECT 1 FROM public.competitor_candidates cc WHERE cc.workspace_id=w AND cc.channel_id=c AND cc.platform='youtube' AND cc.candidate_external_id=x->>'external_channel_id'))
 THEN RAISE EXCEPTION 'invalid_candidate_profiles' USING errcode='22023'; END IF;
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
   GET DIAGNOSTICS affected=ROW_COUNT;n:=n+affected;
   IF EXISTS(SELECT 1 FROM public.competitor_decisions d WHERE d.workspace_id=w AND d.channel_id=c AND d.platform='youtube' AND d.candidate_external_id=p->>'external_channel_id' AND d.status='tracked')
   AND p?'subscriber_count' AND p?'view_count' AND p?'video_count' THEN
    INSERT INTO public.competitor_stats_daily(workspace_id,channel_id,candidate_external_id,day,subscriber_count,view_count,video_count,observed_at)
    SELECT w,c,p->>'external_channel_id',(now() AT TIME ZONE 'UTC')::date,(p->>'subscriber_count')::bigint,(p->>'view_count')::bigint,(p->>'video_count')::bigint,now()
    ON CONFLICT(workspace_id,channel_id,candidate_external_id,day) DO UPDATE SET subscriber_count=excluded.subscriber_count,view_count=excluded.view_count,video_count=excluded.video_count,observed_at=excluded.observed_at;
   END IF;
  END IF;
 END LOOP; RETURN jsonb_build_object('updated',n);
END $$;

CREATE OR REPLACE FUNCTION private.purge_channel_profile(retain_text interval DEFAULT interval '30 days',retain_stats interval DEFAULT interval '30 days') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cleared integer;removed integer;competitor_removed integer; BEGIN
 IF retain_text<interval '0' OR retain_stats<interval '0' THEN RAISE EXCEPTION 'invalid_input' USING errcode='22023'; END IF;
 UPDATE public.channels SET description=NULL,keywords=NULL,topic_categories=NULL WHERE profile_observed_at<now()-retain_text AND (description IS NOT NULL OR keywords IS NOT NULL OR topic_categories IS NOT NULL); GET DIAGNOSTICS cleared=row_count;
 DELETE FROM public.channel_stats_daily WHERE observed_at<now()-retain_stats; GET DIAGNOSTICS removed=row_count;
 DELETE FROM public.competitor_stats_daily WHERE observed_at<now()-retain_stats; GET DIAGNOSTICS competitor_removed=row_count;
 UPDATE public.competitor_candidates SET subscriber_count=NULL,subscriber_count_hidden=NULL,view_count=NULL,video_count=NULL,country=NULL,default_language=NULL,topic_categories=NULL,profile_observed_at=NULL WHERE profile_observed_at<now()-retain_text;
 RETURN jsonb_build_object('profiles',cleared,'stats',removed,'competitor_stats',competitor_removed);
END $$;
