CREATE OR REPLACE FUNCTION public.competitor_benchmark(p_channel uuid,p_days integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE ch public.channels; result jsonb;
BEGIN
 IF p_days IS NULL OR p_days<7 OR p_days>1095 THEN RAISE EXCEPTION 'invalid_input' USING errcode='22023'; END IF;
 SELECT * INTO ch FROM public.channels WHERE id=p_channel;
 IF ch.id IS NULL OR NOT private.has_role(ch.workspace_id) THEN RAISE EXCEPTION 'forbidden' USING errcode='42501'; END IF;
 WITH series AS (
  SELECT 'own'::text kind,ch.external_channel_id external_id,coalesce(ch.title,ch.handle,ch.external_channel_id) title,
   d.day,d.subscriber_count,d.view_count,d.video_count,0 ord
  FROM public.channel_stats_daily d WHERE d.workspace_id=ch.workspace_id AND d.channel_id=ch.id AND d.day >= (current_date-(p_days-1))
  UNION ALL
  SELECT 'competitor',cc.candidate_external_id,coalesce(cc.title,cc.handle,cc.candidate_external_id),d.day,d.subscriber_count,d.view_count,d.video_count,1
  FROM public.competitor_decisions cd JOIN public.competitor_candidates cc ON cc.workspace_id=cd.workspace_id AND cc.channel_id=cd.channel_id AND cc.platform=cd.platform AND cc.candidate_external_id=cd.candidate_external_id
  LEFT JOIN public.competitor_stats_daily d ON d.workspace_id=cd.workspace_id AND d.channel_id=cd.channel_id AND d.candidate_external_id=cd.candidate_external_id AND d.day >= (current_date-(p_days-1))
  WHERE cd.workspace_id=ch.workspace_id AND cd.channel_id=ch.id AND cd.platform='youtube' AND cd.status='tracked'
 ), grouped AS (
  SELECT kind,external_id,max(title) title,min(ord) ord,
   coalesce(jsonb_agg(jsonb_build_object('day',day,'subscriber_count',subscriber_count,'view_count',view_count,'video_count',video_count) ORDER BY day) FILTER(WHERE day IS NOT NULL),'[]'::jsonb) points,
   (array_agg(subscriber_count ORDER BY day) FILTER(WHERE day IS NOT NULL))[1] first_sub,
   (array_agg(view_count ORDER BY day) FILTER(WHERE day IS NOT NULL))[1] first_views,
   (array_agg(video_count ORDER BY day) FILTER(WHERE day IS NOT NULL))[1] first_videos,
   (array_agg(day ORDER BY day) FILTER(WHERE day IS NOT NULL))[1] first_day,
   (array_agg(subscriber_count ORDER BY day DESC) FILTER(WHERE day IS NOT NULL))[1] last_sub,
   (array_agg(view_count ORDER BY day DESC) FILTER(WHERE day IS NOT NULL))[1] last_views,
   (array_agg(video_count ORDER BY day DESC) FILTER(WHERE day IS NOT NULL))[1] last_videos,
   (array_agg(day ORDER BY day DESC) FILTER(WHERE day IS NOT NULL))[1] last_day,
   count(day) point_count
  FROM series GROUP BY kind,external_id
 ), own AS (
  SELECT 'own'::text kind,ch.external_channel_id external_id,coalesce(ch.title,ch.handle,ch.external_channel_id) title,0 ord WHERE NOT EXISTS(SELECT 1 FROM grouped WHERE kind='own')
 ), complete AS (SELECT * FROM grouped UNION ALL SELECT kind,external_id,title,ord,'[]'::jsonb,NULL::bigint,NULL::bigint,NULL::bigint,NULL::date,NULL::bigint,NULL::bigint,NULL::bigint,NULL::date,0::bigint FROM own)
 SELECT jsonb_build_object('days',p_days,'series',coalesce(jsonb_agg(jsonb_build_object(
  'kind',kind,'external_id',external_id,'title',title,'points',points,'kpis',jsonb_build_object(
   'subscribers',last_sub,'views',last_views,
   'subscribers_change',CASE WHEN point_count>=2 AND first_sub IS NOT NULL AND last_sub IS NOT NULL THEN last_sub-first_sub END,
   'views_change',CASE WHEN point_count>=2 AND first_views IS NOT NULL AND last_views IS NOT NULL THEN last_views-first_views END,
   'videos_per_week',CASE WHEN last_day-first_day>=7 AND first_videos IS NOT NULL AND last_videos IS NOT NULL THEN (last_videos-first_videos)::numeric/((last_day-first_day)::numeric/7) END,
   'views_per_video',CASE WHEN last_views IS NOT NULL AND last_videos IS NOT NULL AND last_videos<>0 THEN last_views::numeric/last_videos END
  )) ORDER BY ord,external_id),'[]'::jsonb)) INTO result FROM complete;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.competitor_benchmark(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.competitor_benchmark(uuid,integer) TO authenticated;
