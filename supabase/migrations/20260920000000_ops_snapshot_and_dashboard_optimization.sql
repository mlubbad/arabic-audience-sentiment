-- Decouple operations and sync state from comments snapshot, and optimize
-- dashboard_snapshot_impl query performance with set-based CTEs and a protective
-- statement timeout.

-- 1. Operational status RPC: lightweight, fast, returns in < 30ms without loading comments
create or replace function private.workspace_ops_snapshot_impl(w uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  state jsonb;
  plan_summary jsonb;
  video_counts jsonb;
begin
  if not private.has_role(w) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  -- Collection health and worker status
  select jsonb_build_object(
    'worker', jsonb_build_object(
      'connected', coalesce((select s.last_seen_at > now() - interval '3 minutes'
                               from public.worker_seen s
                              where s.workspace_id = w), false),
      'last_heartbeat_at', (select s.last_seen_at from public.worker_seen s
                             where s.workspace_id = w),
      'busy', coalesce((select count(*) > 0 from public.jobs j
                         where j.workspace_id = w
                           and j.status = 'running'
                           and j.lease_expires_at > now()), false)),
    'queued_jobs', (select count(*) from public.jobs j
                     where j.workspace_id=w and j.status='queued'),
    'last_run', (
      select jsonb_build_object(
        'started_at', s.started_at, 'ended_at', s.ended_at, 'status', s.status,
        'source', s.source, 'error_code', s.error_code,
        'coverage', jsonb_build_object(
          'videos_seen', coalesce((s.coverage_summary->>'videos_seen')::int, 0),
          'comments_collected', coalesce((s.coverage_summary->>'comments_collected')::int, 0),
          'complete', coalesce((s.coverage_summary->>'complete')::boolean, false)))
      from public.sync_runs s where s.workspace_id=w and s.mode = 'collect'
      order by s.started_at desc limit 1))
  into state;

  -- Usage summary (plan, budgets, quotas)
  select private.usage_summary_impl(w) into plan_summary;

  -- Stored comments count per video, directly aggregated from comments index
  select coalesce(json_agg(json_build_object('id', v.id::text, 'total', coalesce(c.total, 0))), '[]'::json)::jsonb
  into video_counts
  from public.videos v
  left join (
    select video_id, count(*)::int as total
    from public.comments
    where workspace_id = w
    group by video_id
  ) c on c.video_id = v.id
  where v.workspace_id = w;

  return jsonb_build_object(
    'sync', state,
    'plan', plan_summary,
    'video_counts', video_counts
  );
end $$;

create or replace function public.workspace_ops_snapshot(w uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.workspace_ops_snapshot_impl(w);
$$;

revoke all on function private.workspace_ops_snapshot_impl(uuid), public.workspace_ops_snapshot(uuid) from public;
grant execute on function private.workspace_ops_snapshot_impl(uuid) to authenticated, service_role;
grant execute on function public.workspace_ops_snapshot(uuid) to authenticated, service_role;


-- 2. Optimized dashboard_snapshot_impl: replaces N*M correlated subqueries with set-based CTEs
-- and guarantees a 30s statement_timeout ceiling.
create or replace function private.dashboard_snapshot_impl(w uuid)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout = '30s' as $$
declare
  active text;
  topic_active text;
  rows jsonb;
  state jsonb;
  rev text;
  taxonomy jsonb;
begin
  if not private.has_role(w) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  -- A connected channel's key wins; otherwise any channel that names one.
  select c.active_analysis_key into active from public.channels c
   where c.workspace_id=w and c.active_analysis_key is not null
   order by (c.status='connected') desc, c.id limit 1;

  select active_topic_key into topic_active from public.workspaces where id = w;

  select coalesce(jsonb_agg(jsonb_build_object(
      'key', tp.key, 'name_ar', tp.name_ar, 'name_en', tp.name_en,
      'description', tp.description, 'position', tp.position,
      'retired', tp.retired_at is not null) order by tp.position), '[]'::jsonb)
    into taxonomy from public.workspace_topics tp where tp.workspace_id = w;

  select coalesce(max(cm.last_seen_at)::text, 'empty') into rev
   from public.comments cm where cm.workspace_id=w;

  -- Comments and their associated relations, resolved in set-based passes
  with active_pred as (
    select distinct on (p.comment_id, p.content_hash)
           p.comment_id, p.content_hash,
           json_build_object(
             'status', p.status, 'label', p.label, 'content_hash', p.content_hash,
             'analysis_key', p.analysis_key, 'model_id', r.model_id,
             'revision', r.revision_sha, 'preprocessing_version', r.preprocessing_version,
             'predicted_at', p.predicted_at, 'class_scores', p.class_scores
           ) as pred_json
    from public.sentiment_predictions p
    join public.analysis_runs r on r.workspace_id = w and r.id = p.analysis_run_id
    where p.workspace_id = w
      and active is not null and p.analysis_key = active
    order by p.comment_id, p.content_hash, p.predicted_at desc
  ),
  active_tp as (
    select distinct on (p.comment_id, p.content_hash)
           p.comment_id, p.content_hash,
           json_build_object(
             'status', p.status, 'topic_key', p.topic_key, 'confidence', p.confidence,
             'content_hash', p.content_hash, 'classification_key', p.classification_key,
             'model_id', p.model_id, 'prompt_version', p.prompt_version,
             'predicted_at', p.predicted_at, 'error_code', p.error_code
           ) as topic_pred_json
    from public.topic_predictions p
    where p.workspace_id = w
      and topic_active is not null and p.classification_key = topic_active
    order by p.comment_id, p.content_hash, p.predicted_at desc
  ),
  reviews_agg as (
    select rv.comment_id,
           coalesce(json_agg(json_build_object(
             'label', rv.label, 'content_hash', rv.content_hash,
             'created_at', rv.created_at, 'origin', rv.origin,
             'reviewer_id', rv.reviewer_id::text, 'reason', rv.reason
           ) order by rv.created_at), '[]'::json) as reviews_json
    from public.comment_reviews rv
    where rv.workspace_id = w
    group by rv.comment_id
  ),
  topic_reviews_agg as (
    select tr.comment_id,
           coalesce(json_agg(json_build_object(
             'topic_key', tr.topic_key, 'content_hash', tr.content_hash,
             'created_at', tr.created_at, 'origin', tr.origin,
             'reviewer_id', tr.reviewer_id::text, 'reason', tr.reason
           ) order by tr.created_at), '[]'::json) as topic_reviews_json
    from public.topic_reviews tr
    where tr.workspace_id = w
    group by tr.comment_id
  ),
  annotations_latest as (
    select distinct on (a.comment_id) a.comment_id, a.value
    from public.comment_annotations a
    where a.workspace_id = w and a.kind = 'comment_type'
    order by a.comment_id, a.created_at desc
  )
  select coalesce(json_agg(r.row order by r.published_at nulls last, r.id), '[]'::json)::jsonb
  into rows from (
    select cm.id, cm.published_at, json_build_object(
      'id', cm.id::text,
      'workspace_id', cm.workspace_id::text,
      'client_id', ch.client_id::text,
      'channel_id', ch.id::text,
      'video_id', v.id::text,
      'by_channel_owner',
        cm.author_channel_id is not null
          and cm.author_channel_id = ch.external_channel_id,
      'video_title', v.title,
      'video_kind', v.kind,
      'author_channel_id', cm.author_channel_id,
      'author_name', cm.author_name,
      'text_raw', cm.text_raw,
      'content_hash', cm.content_hash,
      'likes_raw', cm.likes_raw,
      'likes_value', cm.likes_value,
      'published_at', cm.published_at,
      'published_time_raw', cm.published_time_raw,
      'timestamp_precision', cm.timestamp_precision,
      'is_reply', cm.is_reply,
      'parent_comment_id', parent.id::text,
      'parent_source', cm.parent_source,
      'source', cm.source,
      'field_provenance', cm.field_provenance,
      'content_purged_at', cm.content_purged_at,
      'comment_type', an.value,
      'prediction', ap.pred_json,
      'reviews', coalesce(ra.reviews_json, '[]'::json),
      'topic_prediction', atp.topic_pred_json,
      'topic_reviews', coalesce(tra.topic_reviews_json, '[]'::json)
    ) as row
    from public.comments cm
    join public.videos v on v.workspace_id=w and v.id=cm.video_id
    join public.channels ch on ch.workspace_id=w and ch.id=v.channel_id
    left join public.comments parent on parent.workspace_id=w
      and parent.platform=cm.platform and parent.external_comment_id=cm.external_parent_id
    left join active_pred ap on ap.comment_id=cm.id and ap.content_hash=cm.content_hash
    left join active_tp atp on atp.comment_id=cm.id and atp.content_hash=cm.content_hash
    left join reviews_agg ra on ra.comment_id=cm.id
    left join topic_reviews_agg tra on tra.comment_id=cm.id
    left join annotations_latest an on an.comment_id=cm.id
    where cm.workspace_id=w
  ) r;

  -- Collection health
  select jsonb_build_object(
    'worker', jsonb_build_object(
      'connected', coalesce((select s.last_seen_at > now() - interval '3 minutes'
                               from public.worker_seen s
                              where s.workspace_id = w), false),
      'last_heartbeat_at', (select s.last_seen_at from public.worker_seen s
                             where s.workspace_id = w),
      'busy', coalesce((select count(*) > 0 from public.jobs j
                         where j.workspace_id = w
                           and j.status = 'running'
                           and j.lease_expires_at > now()), false)),
    'queued_jobs', (select count(*) from public.jobs j
                     where j.workspace_id=w and j.status='queued'),
    'last_run', (
      select jsonb_build_object(
        'started_at', s.started_at, 'ended_at', s.ended_at, 'status', s.status,
        'source', s.source, 'error_code', s.error_code,
        'coverage', jsonb_build_object(
          'videos_seen', coalesce((s.coverage_summary->>'videos_seen')::int, 0),
          'comments_collected', coalesce((s.coverage_summary->>'comments_collected')::int, 0),
          'complete', coalesce((s.coverage_summary->>'complete')::boolean, false)))
      from public.sync_runs s where s.workspace_id=w and s.mode = 'collect'
      order by s.started_at desc limit 1))
  into state;

  return jsonb_build_object(
    'mode', 'live',
    'revision', rev,
    'active_analysis_key', coalesce(active, ''),
    'active_analysis_labels', coalesce((
      select jsonb_agg(k) from (
        select distinct k from (
          select jsonb_object_keys(p.class_scores) as k
          from public.sentiment_predictions p
          where p.workspace_id = w and active is not null
            and p.analysis_key = active and p.status = 'succeeded'
          limit 50
        ) s
      ) s2), '[]'::jsonb),
    'topics', taxonomy,
    'active_topic_key', coalesce(topic_active, ''),
    'plan', private.usage_summary_impl(w),
    'sync', state,
    'comments', rows);
end $$;

grant execute on function private.dashboard_snapshot_impl(uuid) to authenticated, service_role;
