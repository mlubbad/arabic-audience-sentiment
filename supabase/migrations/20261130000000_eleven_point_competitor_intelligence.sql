-- 11-Point Competitor Intelligence & SWOT Battlecard Engine (SKY-207 / ADR-0008).
--
-- Synthesizes Yara Gomaa's 11-point Digital Content Competitor Analysis methodology
-- with global Competitive Battlecard (Klue/Crayon), Jobs-to-be-Done Funnel Stage,
-- Audience Capacity & Anti-Shock Gradual Pacing, and Evidence-Backed SWOT Gap frameworks.

CREATE TABLE IF NOT EXISTS public.competitor_intelligence_profiles (
  workspace_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'youtube',
  candidate_external_id text NOT NULL,
  connection_between_platforms text NOT NULL DEFAULT 'unknown',
  primary_platform text,
  content_format_mix jsonb NOT NULL DEFAULT '{}'::jsonb,
  dominant_format text NOT NULL DEFAULT 'unknown',
  funnel_stage text NOT NULL DEFAULT 'unknown',
  tone_of_voice text NOT NULL DEFAULT 'unknown',
  cta_pattern text,
  conversion_channel text,
  visual_style text,
  strengths text[] NOT NULL DEFAULT '{}'::text[],
  weaknesses text[] NOT NULL DEFAULT '{}'::text[],
  opportunity_gap text,
  threat_level text,
  analysis_source text NOT NULL DEFAULT 'automated',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitor_intelligence_profiles_pkey
    PRIMARY KEY (workspace_id, channel_id, platform, candidate_external_id),
  CONSTRAINT competitor_intelligence_profiles_channel_fkey
    FOREIGN KEY (workspace_id, channel_id)
    REFERENCES public.channels(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT competitor_intelligence_profiles_platform_check
    CHECK (platform = ANY (ARRAY['youtube'::text, 'facebook'::text, 'instagram'::text, 'telegram'::text, 'x'::text, 'tiktok'::text])),
  CONSTRAINT competitor_intelligence_profiles_conn_check
    CHECK (connection_between_platforms = ANY (ARRAY['tailored_multi'::text, 'mirrored_multi'::text, 'single_focus'::text, 'unknown'::text])),
  CONSTRAINT competitor_intelligence_profiles_format_check
    CHECK (dominant_format = ANY (ARRAY['video'::text, 'short'::text, 'stream'::text, 'carousel'::text, 'post'::text, 'mixed'::text, 'unknown'::text])),
  CONSTRAINT competitor_intelligence_profiles_funnel_check
    CHECK (funnel_stage = ANY (ARRAY['awareness'::text, 'consideration'::text, 'engagement'::text, 'decision'::text, 'mixed'::text, 'unknown'::text])),
  CONSTRAINT competitor_intelligence_profiles_tone_check
    CHECK (tone_of_voice = ANY (ARRAY['formal'::text, 'semi_formal'::text, 'casual'::text, 'irreverent'::text, 'bilingual_friendly'::text, 'bilingual_premium'::text, 'unknown'::text])),
  CONSTRAINT competitor_intelligence_profiles_threat_check
    CHECK (threat_level IS NULL OR threat_level = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])),
  CONSTRAINT competitor_intelligence_profiles_source_check
    CHECK (analysis_source = ANY (ARRAY['automated'::text, 'ai_enriched'::text, 'analyst'::text])),
  CONSTRAINT competitor_intelligence_profiles_text_length_check
    CHECK (
      (primary_platform IS NULL OR length(primary_platform) <= 60)
      AND (cta_pattern IS NULL OR length(cta_pattern) <= 300)
      AND (conversion_channel IS NULL OR length(conversion_channel) <= 300)
      AND (visual_style IS NULL OR length(visual_style) <= 300)
      AND (opportunity_gap IS NULL OR length(opportunity_gap) <= 500)
      AND coalesce(array_length(strengths, 1), 0) <= 10
      AND coalesce(array_length(weaknesses, 1), 0) <= 10
    )
);

ALTER TABLE public.competitor_intelligence_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_read ON public.competitor_intelligence_profiles;
CREATE POLICY tenant_read ON public.competitor_intelligence_profiles
  FOR SELECT TO authenticated
  USING (private.has_role(workspace_id));

REVOKE ALL ON TABLE public.competitor_intelligence_profiles FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.competitor_intelligence_profiles TO authenticated;
GRANT ALL ON TABLE public.competitor_intelligence_profiles TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_competitor_intelligence_profile(
  p_channel uuid,
  p_candidate_external_id text,
  p_profile jsonb
)
RETURNS public.competitor_intelligence_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  ch public.channels;
  v_conn text;
  v_primary text;
  v_format text;
  v_funnel text;
  v_tone text;
  v_cta text;
  v_conv text;
  v_visual text;
  v_gap text;
  v_threat text;
  v_strengths text[];
  v_weaknesses text[];
  result public.competitor_intelligence_profiles;
BEGIN
  SELECT * INTO ch FROM public.channels WHERE id = p_channel;
  IF ch.id IS NULL OR NOT private.has_role(ch.workspace_id, ARRAY['workspace_owner','analyst']) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_candidate_external_id IS NULL OR p_profile IS NULL OR jsonb_typeof(p_profile) <> 'object'
     OR NOT EXISTS (
       SELECT 1 FROM public.competitor_candidates c
        WHERE c.workspace_id = ch.workspace_id
          AND c.channel_id = ch.id
          AND c.candidate_external_id = p_candidate_external_id
     ) THEN
    RAISE EXCEPTION 'invalid_input' USING errcode = '22023';
  END IF;

  v_conn := coalesce(nullif(trim(p_profile->>'connection_between_platforms'), ''), 'unknown');
  v_primary := nullif(trim(p_profile->>'primary_platform'), '');
  v_format := coalesce(nullif(trim(p_profile->>'dominant_format'), ''), 'unknown');
  v_funnel := coalesce(nullif(trim(p_profile->>'funnel_stage'), ''), 'unknown');
  v_tone := coalesce(nullif(trim(p_profile->>'tone_of_voice'), ''), 'unknown');
  v_cta := nullif(trim(p_profile->>'cta_pattern'), '');
  v_conv := nullif(trim(p_profile->>'conversion_channel'), '');
  v_visual := nullif(trim(p_profile->>'visual_style'), '');
  v_gap := nullif(trim(p_profile->>'opportunity_gap'), '');
  v_threat := nullif(trim(p_profile->>'threat_level'), '');

  IF p_profile ? 'strengths' AND jsonb_typeof(p_profile->'strengths') = 'array' THEN
    SELECT coalesce(array_agg(trim(x)) FILTER (WHERE length(trim(x)) > 0), '{}'::text[])
      INTO v_strengths
      FROM jsonb_array_elements_text(p_profile->'strengths') x;
  ELSE
    v_strengths := '{}'::text[];
  END IF;

  IF p_profile ? 'weaknesses' AND jsonb_typeof(p_profile->'weaknesses') = 'array' THEN
    SELECT coalesce(array_agg(trim(x)) FILTER (WHERE length(trim(x)) > 0), '{}'::text[])
      INTO v_weaknesses
      FROM jsonb_array_elements_text(p_profile->'weaknesses') x;
  ELSE
    v_weaknesses := '{}'::text[];
  END IF;

  INSERT INTO public.competitor_intelligence_profiles (
    workspace_id, channel_id, platform, candidate_external_id,
    connection_between_platforms, primary_platform, dominant_format,
    funnel_stage, tone_of_voice, cta_pattern, conversion_channel,
    visual_style, strengths, weaknesses, opportunity_gap, threat_level,
    analysis_source, updated_by, updated_at
  ) VALUES (
    ch.workspace_id, ch.id, coalesce(ch.platform, 'youtube'), p_candidate_external_id,
    v_conn, v_primary, v_format,
    v_funnel, v_tone, v_cta, v_conv,
    v_visual, v_strengths, v_weaknesses, v_gap, v_threat,
    'analyst', auth.uid(), now()
  )
  ON CONFLICT (workspace_id, channel_id, platform, candidate_external_id)
  DO UPDATE SET
    connection_between_platforms = excluded.connection_between_platforms,
    primary_platform = excluded.primary_platform,
    dominant_format = excluded.dominant_format,
    funnel_stage = excluded.funnel_stage,
    tone_of_voice = excluded.tone_of_voice,
    cta_pattern = excluded.cta_pattern,
    conversion_channel = excluded.conversion_channel,
    visual_style = excluded.visual_style,
    strengths = excluded.strengths,
    weaknesses = excluded.weaknesses,
    opportunity_gap = excluded.opportunity_gap,
    threat_level = excluded.threat_level,
    analysis_source = 'analyst',
    updated_by = auth.uid(),
    updated_at = now()
  RETURNING * INTO result;

  RETURN result;
END
$fn$;

REVOKE ALL ON FUNCTION public.upsert_competitor_intelligence_profile(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_competitor_intelligence_profile(uuid, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.competitor_intelligence_matrix(
  p_channel uuid,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '30s'
AS $fn$
DECLARE
  ch public.channels;
  v_platforms text[];
  v_own_subs bigint;
  v_own_views bigint;
  v_own_videos bigint;
  v_own_subs_change bigint;
  v_own_vpw numeric;
  v_own_vpv numeric;
  v_own_video_cnt int;
  v_own_short_cnt int;
  v_own_stream_cnt int;
  v_own_post_cnt int;
  v_own_dominant_format text;
  v_own_avg_comments numeric;
  v_own_avg_likes numeric;
  v_own_awareness int;
  v_own_consideration int;
  v_own_engagement int;
  v_own_decision int;
  v_own_funnel_stage text;
  v_own_tone text;
  v_own_pos int;
  v_own_neg int;
  v_own_neu int;
  v_own_mix int;
  v_tracked_cnt int;
  v_competitors jsonb;
  v_max_comp_vpw numeric;
  v_target_vpw numeric;
BEGIN
  IF p_days IS NULL OR p_days < 7 OR p_days > 1095 THEN
    RAISE EXCEPTION 'invalid_input' USING errcode = '22023';
  END IF;
  SELECT * INTO ch FROM public.channels WHERE id = p_channel;
  IF ch.id IS NULL OR NOT private.has_role(ch.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Point 1: Connected platforms in this workspace
  SELECT coalesce(array_agg(DISTINCT coalesce(c2.platform, 'youtube') ORDER BY coalesce(c2.platform, 'youtube')), ARRAY['youtube'])
    INTO v_platforms
    FROM public.channels c2
   WHERE c2.workspace_id = ch.workspace_id;

  -- Own channel daily stats over window
  WITH own_days AS (
    SELECT d.day, d.subscriber_count, d.view_count, d.video_count
      FROM public.channel_stats_daily d
     WHERE d.workspace_id = ch.workspace_id
       AND d.channel_id = ch.id
       AND d.day >= (current_date - (p_days - 1))
     ORDER BY d.day
  ), agg AS (
    SELECT
      (array_agg(subscriber_count ORDER BY day) FILTER (WHERE subscriber_count IS NOT NULL))[1] AS first_sub,
      (array_agg(subscriber_count ORDER BY day DESC) FILTER (WHERE subscriber_count IS NOT NULL))[1] AS last_sub,
      (array_agg(view_count ORDER BY day DESC) FILTER (WHERE view_count IS NOT NULL))[1] AS last_views,
      (array_agg(video_count ORDER BY day) FILTER (WHERE video_count IS NOT NULL))[1] AS first_videos,
      (array_agg(video_count ORDER BY day DESC) FILTER (WHERE video_count IS NOT NULL))[1] AS last_videos,
      min(day) AS first_day,
      max(day) AS last_day,
      count(*) AS pt_count
    FROM own_days
  )
  SELECT
    coalesce(agg.last_sub, ch.subscriber_count),
    agg.last_views,
    agg.last_videos,
    CASE WHEN agg.pt_count >= 2 AND agg.first_sub IS NOT NULL AND agg.last_sub IS NOT NULL
         THEN agg.last_sub - agg.first_sub ELSE NULL END,
    CASE WHEN agg.last_day - agg.first_day >= 7 AND agg.first_videos IS NOT NULL AND agg.last_videos IS NOT NULL
         THEN round((agg.last_videos - agg.first_videos)::numeric / ((agg.last_day - agg.first_day)::numeric / 7.0), 2)
         ELSE NULL END
  INTO v_own_subs, v_own_views, v_own_videos, v_own_subs_change, v_own_vpw
  FROM agg;

  -- Fallback videos_per_week and format/funnel mix from public.videos
  SELECT
    count(*) FILTER (WHERE coalesce(v.kind, 'video') = 'video'),
    count(*) FILTER (WHERE v.kind = 'short'),
    count(*) FILTER (WHERE v.kind = 'stream'),
    count(*) FILTER (WHERE v.kind IN ('channel_post', 'tweet', 'status')),
    round(avg(v.reported_comment_count) FILTER (WHERE v.reported_comment_count IS NOT NULL), 1),
    round(avg(v.like_count) FILTER (WHERE v.like_count IS NOT NULL), 1),
    count(*) FILTER (WHERE coalesce(v.title, '') ~* '(كيف|إزاي|ازاي|شرح|خطوات|نصائح|تعلم|دليل|طريقة|how to|guide|tutorial|tips)'),
    count(*) FILTER (WHERE coalesce(v.title, '') ~* '(رأيك|سؤال|شارك|بث مباشر|لايف|live|q&a|اسأل)'),
    count(*) FILTER (WHERE coalesce(v.title, '') ~* '(اشترك|احجز|كورس|خصم|عرض|سجل|انضم|شراء|باقة|course|offer|join|buy)'),
    CASE WHEN v_own_vpw IS NULL AND count(*) FILTER (WHERE v.published_at >= now() - make_interval(days => p_days)) > 0
         THEN round((count(*) FILTER (WHERE v.published_at >= now() - make_interval(days => p_days)))::numeric / (p_days::numeric / 7.0), 2)
         ELSE v_own_vpw END
  INTO
    v_own_video_cnt, v_own_short_cnt, v_own_stream_cnt, v_own_post_cnt,
    v_own_avg_comments, v_own_avg_likes,
    v_own_consideration, v_own_engagement, v_own_decision, v_own_vpw
  FROM public.videos v
  WHERE v.workspace_id = ch.workspace_id AND v.channel_id = ch.id;

  v_own_awareness := greatest(
    0,
    (coalesce(v_own_video_cnt, 0) + coalesce(v_own_short_cnt, 0) + coalesce(v_own_stream_cnt, 0) + coalesce(v_own_post_cnt, 0))
    - (coalesce(v_own_consideration, 0) + coalesce(v_own_engagement, 0) + coalesce(v_own_decision, 0))
  );

  IF v_own_views IS NOT NULL AND v_own_videos IS NOT NULL AND v_own_videos > 0 THEN
    v_own_vpv := round(v_own_views::numeric / v_own_videos::numeric, 0);
  ELSE
    SELECT round(avg(v.view_count) FILTER (WHERE v.view_count IS NOT NULL), 0)
      INTO v_own_vpv
      FROM public.videos v
     WHERE v.workspace_id = ch.workspace_id AND v.channel_id = ch.id;
  END IF;

  v_own_dominant_format := CASE
    WHEN coalesce(v_own_video_cnt, 0) + coalesce(v_own_short_cnt, 0) + coalesce(v_own_stream_cnt, 0) + coalesce(v_own_post_cnt, 0) = 0 THEN 'video'
    WHEN v_own_short_cnt >= v_own_video_cnt AND v_own_short_cnt >= v_own_post_cnt THEN 'short'
    WHEN v_own_post_cnt > v_own_video_cnt AND v_own_post_cnt > v_own_short_cnt THEN 'post'
    WHEN v_own_video_cnt > 0 AND v_own_short_cnt > 0 THEN 'mixed'
    ELSE 'video'
  END;

  v_own_funnel_stage := CASE
    WHEN v_own_consideration >= v_own_awareness AND v_own_consideration >= v_own_decision THEN 'consideration'
    WHEN v_own_decision > v_own_awareness AND v_own_decision > v_own_consideration THEN 'decision'
    WHEN v_own_engagement > v_own_awareness THEN 'engagement'
    ELSE 'awareness'
  END;

  v_own_tone := CASE
    WHEN lower(coalesce(ch.default_language, 'ar')) LIKE 'en%' THEN 'bilingual_premium'
    ELSE 'semi_formal'
  END;

  -- Own channel sentiment breakdown
  SELECT
    count(*) FILTER (WHERE sp.label = 'positive'),
    count(*) FILTER (WHERE sp.label = 'negative'),
    count(*) FILTER (WHERE sp.label = 'neutral'),
    count(*) FILTER (WHERE sp.label = 'mixed')
  INTO v_own_pos, v_own_neg, v_own_neu, v_own_mix
  FROM public.sentiment_predictions sp
  JOIN public.comments cm ON cm.workspace_id = sp.workspace_id AND cm.id = sp.comment_id
  JOIN public.videos vd ON vd.workspace_id = cm.workspace_id AND vd.id = cm.video_id
  WHERE sp.workspace_id = ch.workspace_id
    AND vd.channel_id = ch.id
    AND sp.status = 'succeeded'
    AND (ch.active_analysis_key IS NULL OR sp.analysis_key = ch.active_analysis_key);

  SELECT count(*) INTO v_tracked_cnt
    FROM public.competitor_decisions cd
   WHERE cd.workspace_id = ch.workspace_id
     AND cd.channel_id = ch.id
     AND cd.status = 'tracked';

  -- Build 11-point intelligence entries for tracked competitors (or top 5 candidates if none tracked yet)
  WITH base_candidates AS (
    SELECT
      c.candidate_external_id AS external_id,
      (array_agg(c.title ORDER BY (c.title IS NULL), c.last_seen_at DESC))[1] AS title,
      (array_agg(c.handle ORDER BY (c.handle IS NULL), c.last_seen_at DESC))[1] AS handle,
      max(c.subscriber_count) AS subscriber_count,
      max(c.view_count) AS view_count,
      max(c.video_count) AS video_count,
      bool_or(coalesce(c.subscriber_count_hidden, false)) AS subscriber_count_hidden,
      max(c.country) AS country,
      max(c.default_language) AS default_language,
      min(c.topic_categories::text)::text[] AS topic_categories,
      max(d.status) AS decision_status
    FROM public.competitor_candidates c
    LEFT JOIN public.competitor_decisions d
      ON d.workspace_id = c.workspace_id
     AND d.channel_id = c.channel_id
     AND d.platform = c.platform
     AND d.candidate_external_id = c.candidate_external_id
    WHERE c.workspace_id = ch.workspace_id
      AND c.channel_id = ch.id
      AND coalesce(d.status, '') <> 'dismissed'
    GROUP BY c.candidate_external_id
  ), filtered_candidates AS (
    SELECT *
      FROM base_candidates
     WHERE (v_tracked_cnt > 0 AND decision_status = 'tracked')
        OR (v_tracked_cnt = 0)
     ORDER BY (decision_status = 'tracked') DESC NULLS LAST,
              subscriber_count DESC NULLS LAST,
              external_id
     LIMIT CASE WHEN v_tracked_cnt > 0 THEN 50 ELSE 5 END
  ), stats_window AS (
    SELECT
      fc.external_id,
      (array_agg(sd.subscriber_count ORDER BY sd.day) FILTER (WHERE sd.subscriber_count IS NOT NULL))[1] AS first_sub,
      (array_agg(sd.subscriber_count ORDER BY sd.day DESC) FILTER (WHERE sd.subscriber_count IS NOT NULL))[1] AS last_sub,
      (array_agg(sd.view_count ORDER BY sd.day) FILTER (WHERE sd.view_count IS NOT NULL))[1] AS first_views,
      (array_agg(sd.view_count ORDER BY sd.day DESC) FILTER (WHERE sd.view_count IS NOT NULL))[1] AS last_views,
      (array_agg(sd.video_count ORDER BY sd.day) FILTER (WHERE sd.video_count IS NOT NULL))[1] AS first_videos,
      (array_agg(sd.video_count ORDER BY sd.day DESC) FILTER (WHERE sd.video_count IS NOT NULL))[1] AS last_videos,
      min(sd.day) AS first_day,
      max(sd.day) AS last_day,
      count(sd.day) AS pt_count
    FROM filtered_candidates fc
    LEFT JOIN public.competitor_stats_daily sd
      ON sd.workspace_id = ch.workspace_id
     AND sd.channel_id = ch.id
     AND sd.candidate_external_id = fc.external_id
     AND sd.day >= (current_date - (p_days - 1))
    GROUP BY fc.external_id
  ), enriched AS (
    SELECT
      fc.external_id,
      coalesce(fc.title, fc.handle, fc.external_id) AS title,
      fc.handle,
      coalesce(fc.decision_status, 'suggested') AS status,
      coalesce(sw.last_sub, fc.subscriber_count) AS subscribers,
      CASE WHEN sw.pt_count >= 2 AND sw.first_sub IS NOT NULL AND sw.last_sub IS NOT NULL
           THEN sw.last_sub - sw.first_sub ELSE NULL END AS subscribers_change,
      coalesce(sw.last_views, fc.view_count) AS views,
      coalesce(sw.last_videos, fc.video_count) AS videos,
      CASE WHEN sw.last_day - sw.first_day >= 7 AND sw.first_videos IS NOT NULL AND sw.last_videos IS NOT NULL
           THEN round((sw.last_videos - sw.first_videos)::numeric / ((sw.last_day - sw.first_day)::numeric / 7.0), 2)
           ELSE NULL END AS videos_per_week,
      CASE WHEN coalesce(sw.last_views, fc.view_count) IS NOT NULL
                AND coalesce(sw.last_videos, fc.video_count) IS NOT NULL
                AND coalesce(sw.last_videos, fc.video_count) > 0
           THEN round(coalesce(sw.last_views, fc.view_count)::numeric / coalesce(sw.last_videos, fc.video_count)::numeric, 0)
           ELSE NULL END AS views_per_video,
      fc.country,
      fc.default_language,
      coalesce(fc.topic_categories, '{}'::text[]) AS topic_categories,
      CASE WHEN ch.topic_categories IS NOT NULL AND fc.topic_categories IS NOT NULL
           THEN ARRAY(
             SELECT unnest(ch.topic_categories)
             EXCEPT
             SELECT unnest(fc.topic_categories)
           )
           ELSE '{}'::text[] END AS topic_gaps,
      CASE WHEN ch.topic_categories IS NOT NULL AND fc.topic_categories IS NOT NULL
           THEN ARRAY(
             SELECT unnest(ch.topic_categories)
             INTERSECT
             SELECT unnest(fc.topic_categories)
           )
           ELSE '{}'::text[] END AS shared_topics,
      CASE WHEN v_own_subs IS NOT NULL AND v_own_subs > 0 AND coalesce(sw.last_sub, fc.subscriber_count) IS NOT NULL
           THEN round(coalesce(sw.last_sub, fc.subscriber_count)::numeric / v_own_subs::numeric, 2)
           ELSE NULL END AS size_ratio,
      cip.connection_between_platforms AS manual_conn,
      cip.primary_platform AS manual_primary,
      cip.dominant_format AS manual_format,
      cip.funnel_stage AS manual_funnel,
      cip.tone_of_voice AS manual_tone,
      cip.cta_pattern AS manual_cta,
      cip.conversion_channel AS manual_conv,
      cip.visual_style AS manual_visual,
      cip.strengths AS manual_strengths,
      cip.weaknesses AS manual_weaknesses,
      cip.opportunity_gap AS manual_gap,
      cip.threat_level AS manual_threat,
      coalesce(cip.analysis_source, 'automated') AS analysis_source
    FROM filtered_candidates fc
    LEFT JOIN stats_window sw ON sw.external_id = fc.external_id
    LEFT JOIN public.competitor_intelligence_profiles cip
      ON cip.workspace_id = ch.workspace_id
     AND cip.channel_id = ch.id
     AND cip.candidate_external_id = fc.external_id
  ), scored AS (
    SELECT
      e.*,
      CASE
        WHEN e.size_ratio IS NULL THEN 'direct'
        WHEN e.size_ratio >= 10 THEN 'aspirational'
        WHEN e.size_ratio BETWEEN 0.25 AND 4 THEN 'direct'
        ELSE 'indirect'
      END AS tier,
      -- Point 3: Capacity state diagnosis (Yara Gomaa Point 3)
      CASE
        WHEN e.videos_per_week IS NOT NULL AND e.videos_per_week >= 3
             AND e.views_per_video IS NOT NULL AND (v_own_vpv IS NULL OR e.views_per_video >= v_own_vpv)
          THEN 'high_trust_high_frequency'
        WHEN e.videos_per_week IS NOT NULL AND e.videos_per_week >= 4
             AND e.views_per_video IS NOT NULL AND v_own_vpv IS NOT NULL AND e.views_per_video < v_own_vpv * 0.6
          THEN 'volume_diluted'
        WHEN (e.size_ratio IS NOT NULL AND e.size_ratio >= 1.5)
             AND (e.videos_per_week IS NOT NULL AND e.videos_per_week < 1.0)
          THEN 'dormant_brand_opportunity'
        ELSE 'balanced_growth'
      END AS capacity_state,
      -- Point 5: Dominant format
      CASE
        WHEN e.manual_format IS NOT NULL AND e.manual_format <> 'unknown' THEN e.manual_format
        WHEN e.videos IS NOT NULL AND e.videos > 300 THEN 'mixed'
        ELSE 'video'
      END AS resolved_format,
      -- Point 6: Funnel stage
      CASE
        WHEN e.manual_funnel IS NOT NULL AND e.manual_funnel <> 'unknown' THEN e.manual_funnel
        WHEN e.size_ratio IS NOT NULL AND e.size_ratio >= 3 THEN 'awareness'
        WHEN e.views_per_video IS NOT NULL AND v_own_vpv IS NOT NULL AND e.views_per_video > v_own_vpv THEN 'consideration'
        ELSE 'awareness'
      END AS resolved_funnel,
      -- Point 8: Tone of voice
      CASE
        WHEN e.manual_tone IS NOT NULL AND e.manual_tone <> 'unknown' THEN e.manual_tone
        WHEN lower(coalesce(e.default_language, '')) LIKE 'en%' THEN 'bilingual_premium'
        WHEN lower(coalesce(e.default_language, '')) LIKE 'ar%' THEN 'semi_formal'
        ELSE 'semi_formal'
      END AS resolved_tone,
      -- Point 11: Threat level
      CASE
        WHEN e.manual_threat IS NOT NULL THEN e.manual_threat
        WHEN e.size_ratio IS NOT NULL AND e.size_ratio >= 1.5
             AND e.views_per_video IS NOT NULL AND v_own_vpv IS NOT NULL AND e.views_per_video >= v_own_vpv
          THEN 'high'
        WHEN e.size_ratio IS NOT NULL AND e.size_ratio >= 0.6 THEN 'medium'
        ELSE 'low'
      END AS resolved_threat
    FROM enriched e
  )
  SELECT
    coalesce(max(s.videos_per_week), v_own_vpw),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'external_id', s.external_id,
          'title', s.title,
          'handle', s.handle,
          'status', s.status,
          'tier', s.tier,
          'analysis_source', s.analysis_source,
          -- Point 1: Platform connection
          'connection_between_platforms', CASE
            WHEN s.manual_conn IS NOT NULL AND s.manual_conn <> 'unknown' THEN s.manual_conn
            ELSE 'single_focus'
          END,
          'primary_platform', coalesce(s.manual_primary, 'youtube'),
          -- Point 2: Follower scale & demographic positioning
          'subscribers', s.subscribers,
          'subscribers_change', s.subscribers_change,
          'size_ratio', s.size_ratio,
          'country', s.country,
          'default_language', s.default_language,
          -- Point 3: Audience capacity & publishing cadence
          'videos', s.videos,
          'videos_per_week', s.videos_per_week,
          'capacity_state', s.capacity_state,
          -- Point 4: True engagement efficiency
          'views', s.views,
          'views_per_video', s.views_per_video,
          'views_per_video_ratio_vs_own', CASE
            WHEN s.views_per_video IS NOT NULL AND v_own_vpv IS NOT NULL AND v_own_vpv > 0
              THEN round(s.views_per_video::numeric / v_own_vpv::numeric, 2)
            ELSE NULL
          END,
          -- Point 5: Content format
          'dominant_format', s.resolved_format,
          -- Point 6: Post objective & customer journey funnel
          'funnel_stage', s.resolved_funnel,
          'next_funnel_stage', CASE s.resolved_funnel
            WHEN 'awareness' THEN 'consideration'
            WHEN 'consideration' THEN 'decision'
            WHEN 'engagement' THEN 'decision'
            ELSE 'engagement'
          END,
          -- Point 7: Topics covered & gaps
          'topics_covered', to_jsonb(s.topic_categories),
          'shared_topics', to_jsonb(s.shared_topics),
          'topic_gaps', to_jsonb(s.topic_gaps),
          -- Point 8: Tone of voice
          'tone_of_voice', s.resolved_tone,
          -- Point 9 & 10: CTA & conversion channel
          'cta_pattern', s.manual_cta,
          'conversion_channel', s.manual_conv,
          'visual_style', s.manual_visual,
          -- Point 11: Evidence-backed SWOT & Opportunity Gap
          'strengths', CASE
            WHEN coalesce(array_length(s.manual_strengths, 1), 0) > 0 THEN to_jsonb(s.manual_strengths)
            ELSE (
              SELECT coalesce(jsonb_agg(val), '[]'::jsonb)
              FROM (
                SELECT 'strong_subscriber_base' AS val WHERE s.size_ratio IS NOT NULL AND s.size_ratio > 1.2
                UNION ALL
                SELECT 'high_views_per_video' WHERE s.views_per_video IS NOT NULL AND v_own_vpv IS NOT NULL AND s.views_per_video > v_own_vpv * 1.15
                UNION ALL
                SELECT 'consistent_publishing_cadence' WHERE s.videos_per_week IS NOT NULL AND s.videos_per_week >= 2.0
                UNION ALL
                SELECT 'positive_subscriber_momentum' WHERE s.subscribers_change IS NOT NULL AND s.subscribers_change > 0
                UNION ALL
                SELECT 'broad_topic_coverage' WHERE coalesce(array_length(s.topic_categories, 1), 0) >= 3
              ) auto_s
            )
          END,
          'weaknesses', CASE
            WHEN coalesce(array_length(s.manual_weaknesses, 1), 0) > 0 THEN to_jsonb(s.manual_weaknesses)
            ELSE (
              SELECT coalesce(jsonb_agg(val), '[]'::jsonb)
              FROM (
                SELECT 'low_publishing_frequency' AS val WHERE s.videos_per_week IS NOT NULL AND s.videos_per_week < 1.0
                UNION ALL
                SELECT 'lower_views_per_video_than_own' WHERE s.views_per_video IS NOT NULL AND v_own_vpv IS NOT NULL AND s.views_per_video < v_own_vpv * 0.85
                UNION ALL
                SELECT 'volume_diluted_reach' WHERE s.capacity_state = 'volume_diluted'
                UNION ALL
                SELECT 'uncovered_audience_topics' WHERE coalesce(array_length(s.topic_gaps, 1), 0) > 0
                UNION ALL
                SELECT 'stagnant_subscriber_growth' WHERE s.subscribers_change IS NOT NULL AND s.subscribers_change <= 0
              ) auto_w
            )
          END,
          'opportunity_gap', coalesce(
            s.manual_gap,
            CASE
              WHEN s.capacity_state = 'dormant_brand_opportunity' THEN 'dormant_giant_capture'
              WHEN s.capacity_state = 'volume_diluted' THEN 'quality_over_quantity_outflank'
              WHEN coalesce(array_length(s.topic_gaps, 1), 0) > 0 THEN 'own_uncovered_topic_clusters'
              WHEN s.resolved_funnel = 'awareness' THEN 'advance_funnel_to_consideration_and_decision'
              ELSE 'differentiate_with_short_video_and_direct_cta'
            END
          ),
          'threat_level', s.resolved_threat
        )
        ORDER BY (s.status = 'tracked') DESC, s.subscribers DESC NULLS LAST, s.external_id
      ),
      '[]'::jsonb
    )
  INTO v_max_comp_vpw, v_competitors
  FROM scored s;

  v_target_vpw := greatest(coalesce(v_own_vpw, 1.0), least(coalesce(v_max_comp_vpw, 3.0), 5.0));

  RETURN jsonb_build_object(
    'days', p_days,
    'tracked_count', v_tracked_cnt,
    'own', jsonb_build_object(
      'id', ch.id,
      'external_id', ch.external_channel_id,
      'title', coalesce(ch.title, ch.handle, ch.external_channel_id),
      'handle', ch.handle,
      'platform', coalesce(ch.platform, 'youtube'),
      'country', ch.country,
      'default_language', ch.default_language,
      'connected_platforms', to_jsonb(v_platforms),
      'connection_strategy', CASE WHEN coalesce(array_length(v_platforms, 1), 1) > 1 THEN 'tailored_multi' ELSE 'single_focus' END,
      'subscribers', v_own_subs,
      'subscribers_change', v_own_subs_change,
      'views', v_own_views,
      'videos', v_own_videos,
      'videos_per_week', v_own_vpw,
      'views_per_video', v_own_vpv,
      'avg_comments_per_video', v_own_avg_comments,
      'avg_likes_per_video', v_own_avg_likes,
      'dominant_format', v_own_dominant_format,
      'format_mix', jsonb_build_object(
        'video', coalesce(v_own_video_cnt, 0),
        'short', coalesce(v_own_short_cnt, 0),
        'stream', coalesce(v_own_stream_cnt, 0),
        'post', coalesce(v_own_post_cnt, 0)
      ),
      'funnel_stage', v_own_funnel_stage,
      'funnel_mix', jsonb_build_object(
        'awareness', coalesce(v_own_awareness, 0),
        'consideration', coalesce(v_own_consideration, 0),
        'engagement', coalesce(v_own_engagement, 0),
        'decision', coalesce(v_own_decision, 0)
      ),
      'sentiment_mix', jsonb_build_object(
        'positive', coalesce(v_own_pos, 0),
        'negative', coalesce(v_own_neg, 0),
        'neutral', coalesce(v_own_neu, 0),
        'mixed', coalesce(v_own_mix, 0)
      ),
      'topics_covered', to_jsonb(coalesce(ch.topic_categories, '{}'::text[])),
      'tone_of_voice', v_own_tone
    ),
    'competitors', v_competitors,
    'pacing_plan', jsonb_build_object(
      'current_weekly_posts', v_own_vpw,
      'benchmark_weekly_posts', v_max_comp_vpw,
      'recommended_weekly_posts', round(v_target_vpw, 1),
      'week_1_schedule', ARRAY[
        greatest(1, round(coalesce(v_own_vpw, 2))::int),
        greatest(1, round((coalesce(v_own_vpw, 2) + v_target_vpw) / 2.0)::int),
        greatest(1, round(coalesce(v_own_vpw, 2))::int),
        greatest(1, round((coalesce(v_own_vpw, 2) + v_target_vpw) / 2.0)::int)
      ],
      'week_2_schedule', ARRAY[
        greatest(1, round(v_target_vpw)::int),
        greatest(1, round(v_target_vpw)::int),
        greatest(1, round(v_target_vpw)::int),
        greatest(1, round(v_target_vpw)::int)
      ]
    )
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.competitor_intelligence_matrix(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.competitor_intelligence_matrix(uuid, integer) TO authenticated, service_role;
