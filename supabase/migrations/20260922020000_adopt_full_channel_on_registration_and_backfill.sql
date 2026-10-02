-- Migration: 20260922020000_adopt_full_channel_on_registration_and_backfill.sql
-- Goal: Unify channel data across workspaces so duplicate channels automatically
-- adopt all videos, comments, sentiments, and topics from existing workspaces
-- without re-fetching or re-analysing, preserving insights even if videos are unselected.

-- 1. Ensure all workspace owners have a membership record
insert into public.memberships (workspace_id, user_id, role)
select w.id, w.created_by, 'workspace_owner'
from public.workspaces w
where w.created_by is not null
on conflict do nothing;

-- 2. Allow service_role and workspace members in private.workspace_ops_snapshot_impl
create or replace function private.workspace_ops_snapshot_impl(w uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  state jsonb;
  plan_summary jsonb;
  video_counts jsonb;
  cat_summary jsonb;
begin
  if not (coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' or private.has_role(w)) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  -- Collection health and worker status
  select jsonb_build_object(
    'worker', jsonb_build_object(
      'connected', coalesce(
        (select s.last_seen_at > now() - interval '3 minutes'
           from public.worker_seen s
          where s.workspace_id = w),
        (select max(s.last_seen_at) > now() - interval '3 minutes'
           from public.worker_seen s),
        (select count(*) > 0
           from public.jobs
          where status = 'running' and lease_expires_at > now()),
        false),
      'last_heartbeat_at', coalesce(
        (select s.last_seen_at from public.worker_seen s
          where s.workspace_id = w),
        (select max(s.last_seen_at) from public.worker_seen s),
        (select max(lease_expires_at) - interval '5 minutes'
           from public.jobs
          where status = 'running' and lease_expires_at > now())),
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

  -- Single-pass computation of stored comments and analysed count across all videos
  with stats as (
    select c.video_id,
           count(*)::int as total,
           count(sp.comment_id)::int as analysed
    from public.comments c
    left join public.sentiment_predictions sp
      on sp.workspace_id = w
     and sp.comment_id = c.id
     and sp.status = 'succeeded'
    where c.workspace_id = w
    group by c.video_id
  )
  select
    coalesce(json_agg(json_build_object(
      'id', v.id::text,
      'total', coalesce(s.total, 0),
      'analysed', coalesce(s.analysed, 0)
    )), '[]'::json)::jsonb,
    jsonb_build_object(
      'total_comments_collected', coalesce(sum(s.total), 0)::int,
      'total_comments_analysed', coalesce(sum(s.analysed), 0)::int,
      'videos_with_comments', count(s.video_id) filter (where s.total > 0)::int
    )
  into video_counts, cat_summary
  from public.videos v
  left join stats s on s.video_id = v.id
  where v.workspace_id = w;

  return jsonb_build_object(
    'sync', state,
    'plan', plan_summary,
    'video_counts', coalesce(video_counts, '[]'::jsonb),
    'catalogue_summary', coalesce(cat_summary, jsonb_build_object(
      'total_comments_collected', 0,
      'total_comments_analysed', 0,
      'videos_with_comments', 0
    ))
  );
end $$;

-- 3. Implement set-based fast adoption of channel catalogue, comments, sentiment, and topics
create or replace function private.adopt_channel_content(w uuid, c uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  vids_adopted int := 0;
  comments_adopted int := 0;
  sentiment_adopted int := 0;
  topics_adopted int := 0;
  donor_ch record;
  donor_ws uuid;
begin
  -- Step 1: Adopt catalogue (videos)
  vids_adopted := private.adopt_channel_catalogue(w, c);

  -- Step 2: Identify the donor channel from another workspace
  select donor_c.id, donor_c.workspace_id, donor_c.active_analysis_key
    into donor_ch
  from public.channels c_target
  join public.channels donor_c
    on donor_c.platform = c_target.platform
   and donor_c.external_channel_id = c_target.external_channel_id
   and donor_c.workspace_id <> c_target.workspace_id
  where c_target.workspace_id = w and c_target.id = c
    and donor_c.status <> 'disconnected'
  order by (donor_c.active_analysis_key is not null) desc, donor_c.id asc
  limit 1;

  if donor_ch.id is null then
    return jsonb_build_object('videos', vids_adopted, 'comments', 0, 'sentiment', 0, 'topics', 0);
  end if;

  donor_ws := donor_ch.workspace_id;

  -- Step 3: Inherit channel active_analysis_key if missing on target
  if donor_ch.active_analysis_key is not null then
    update public.channels
    set active_analysis_key = donor_ch.active_analysis_key
    where workspace_id = w and id = c and active_analysis_key is null;
  end if;

  -- Step 4: Inherit workspace active_topic_key if missing on target
  update public.workspaces target_w
  set active_topic_key = donor_w.active_topic_key
  from public.workspaces donor_w
  where target_w.id = w and donor_w.id = donor_ws
    and target_w.active_topic_key is null
    and donor_w.active_topic_key is not null;

  -- Step 5: Adopt workspace topics if missing on target
  insert into public.workspace_topics (workspace_id, key, name_ar, name_en, description, position)
  select w, dt.key, dt.name_ar, dt.name_en, dt.description, dt.position
  from public.workspace_topics dt
  where dt.workspace_id = donor_ws and dt.retired_at is null
  on conflict (workspace_id, key) do nothing;

  -- Step 6: Bulk adopt comments in a single set-based insert
  insert into public.comments (
    workspace_id, video_id, platform, external_comment_id, external_parent_id,
    is_reply, parent_source, author_channel_id, author_name, text_raw, text_plain,
    content_hash, published_time_raw, published_at, timestamp_precision,
    likes_raw, likes_value, source, field_provenance
  )
  select
    w, target_v.id, c_src.platform, c_src.external_comment_id, c_src.external_parent_id,
    c_src.is_reply, c_src.parent_source, c_src.author_channel_id, c_src.author_name, c_src.text_raw, c_src.text_plain,
    c_src.content_hash, c_src.published_time_raw, c_src.published_at, c_src.timestamp_precision,
    c_src.likes_raw, c_src.likes_value, c_src.source, c_src.field_provenance
  from public.videos target_v
  join public.videos donor_v
    on donor_v.platform = target_v.platform
   and donor_v.external_video_id = target_v.external_video_id
   and donor_v.workspace_id = donor_ws
  join public.comments c_src
    on c_src.workspace_id = donor_ws
   and c_src.video_id = donor_v.id
  where target_v.workspace_id = w
    and target_v.channel_id = c
  on conflict (workspace_id, platform, external_comment_id) do nothing;

  get diagnostics comments_adopted = row_count;

  -- Step 7: Ensure analysis runs exist on target workspace
  insert into public.analysis_runs (
    workspace_id, model_id, revision_sha, preprocessing_version, parameters, status
  )
  select distinct w, ar.model_id, ar.revision_sha, ar.preprocessing_version, ar.parameters, 'succeeded'
  from public.analysis_runs ar
  where ar.workspace_id = donor_ws
  on conflict (workspace_id, model_id, revision_sha, preprocessing_version, parameters) do nothing;

  -- Step 8: Bulk adopt sentiment predictions in a single set-based insert
  insert into public.sentiment_predictions (
    workspace_id, comment_id, content_hash, analysis_run_id, analysis_key,
    status, label, class_scores, predicted_at
  )
  select distinct on (target_c.id, sp.analysis_key)
    w, target_c.id, target_c.content_hash, target_ar.id, sp.analysis_key,
    sp.status, sp.label, sp.class_scores, sp.predicted_at
  from public.videos target_v
  join public.videos donor_v
    on donor_v.platform = target_v.platform
   and donor_v.external_video_id = target_v.external_video_id
   and donor_v.workspace_id = donor_ws
  join public.comments target_c
    on target_c.workspace_id = w
   and target_c.video_id = target_v.id
  join public.comments donor_c
    on donor_c.workspace_id = donor_ws
   and donor_c.video_id = donor_v.id
   and donor_c.platform = target_c.platform
   and donor_c.external_comment_id = target_c.external_comment_id
  join public.sentiment_predictions sp
    on sp.workspace_id = donor_ws
   and sp.comment_id = donor_c.id
   and sp.status = 'succeeded'
  join public.analysis_runs donor_ar
    on donor_ar.workspace_id = donor_ws
   and donor_ar.id = sp.analysis_run_id
  join public.analysis_runs target_ar
    on target_ar.workspace_id = w
   and target_ar.model_id = donor_ar.model_id
   and target_ar.revision_sha = donor_ar.revision_sha
   and target_ar.preprocessing_version = donor_ar.preprocessing_version
   and target_ar.parameters = donor_ar.parameters
  where target_v.workspace_id = w
    and target_v.channel_id = c
  on conflict (workspace_id, comment_id, content_hash, analysis_key) do nothing;

  get diagnostics sentiment_adopted = row_count;

  -- Step 9: Bulk adopt topic predictions in a single set-based insert
  insert into public.topic_predictions (
    workspace_id, comment_id, content_hash, classification_key,
    status, topic_key, confidence, model_id, prompt_version, error_code, predicted_at
  )
  select distinct on (target_c.id, tp.classification_key)
    w, target_c.id, target_c.content_hash,
    tp.classification_key,
    tp.status, tp.topic_key, tp.confidence, tp.model_id, tp.prompt_version, tp.error_code, tp.predicted_at
  from public.videos target_v
  join public.videos donor_v
    on donor_v.platform = target_v.platform
   and donor_v.external_video_id = target_v.external_video_id
   and donor_v.workspace_id = donor_ws
  join public.comments target_c
    on target_c.workspace_id = w
   and target_c.video_id = target_v.id
  join public.comments donor_c
    on donor_c.workspace_id = donor_ws
   and donor_c.video_id = donor_v.id
   and donor_c.platform = target_c.platform
   and donor_c.external_comment_id = target_c.external_comment_id
  join public.topic_predictions tp
    on tp.workspace_id = donor_ws
   and tp.comment_id = donor_c.id
   and tp.status = 'succeeded'
  join public.workspace_topics wt
    on wt.workspace_id = w and wt.key = tp.topic_key and wt.retired_at is null
  where target_v.workspace_id = w
    and target_v.channel_id = c
  on conflict (workspace_id, comment_id, content_hash, classification_key) do nothing;

  get diagnostics topics_adopted = row_count;

  -- Step 10: Sync latest succeeded sync_runs record if target has none
  if not exists (select 1 from public.sync_runs where workspace_id = w and status = 'succeeded') then
    insert into public.sync_runs (workspace_id, channel_id, mode, source, started_at, ended_at, status, error_code, coverage_summary)
    select w, c, sr.mode, sr.source, sr.started_at, sr.ended_at, sr.status, sr.error_code, sr.coverage_summary
    from public.sync_runs sr
    where sr.workspace_id = donor_ws and sr.channel_id = donor_ch.id and sr.status = 'succeeded'
    order by sr.ended_at desc nulls last limit 1
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'videos', vids_adopted,
    'comments', comments_adopted,
    'sentiment', sentiment_adopted,
    'topics', topics_adopted
  );
end $$;

-- 4. Update register_public_channel_impl to call adopt_channel_content immediately
create or replace function private.register_public_channel_impl(
  w uuid, c uuid, external text, handle text, title text, p_platform text default 'youtube'
) returns public.channels
language plpgsql security definer set search_path='' as $$
declare ch public.channels; begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where workspace_id=w and id=c) then
    raise exception 'invalid_client' using errcode='23503'; end if;
  if p_platform not in ('youtube', 'telegram', 'x', 'tiktok', 'facebook', 'instagram') then
    raise exception 'invalid_platform' using errcode='22023'; end if;
  
  if p_platform = 'youtube' then
    if external !~ '^UC[A-Za-z0-9_-]{22}$' then
      raise exception 'invalid_channel_id' using errcode='22023'; end if;
  elsif p_platform = 'telegram' then
    if external !~ '^(@?[A-Za-z0-9_]{4,64}|-?[0-9]+)$' then
      raise exception 'invalid_channel_id' using errcode='22023'; end if;
  else
    if length(trim(external)) < 1 or length(external) > 100 then
      raise exception 'invalid_channel_id' using errcode='22023'; end if;
  end if;

  handle := nullif(trim(coalesce(handle, '')), '');
  title := nullif(trim(coalesce(title, '')), '');
  if handle is not null and length(handle) > 50 then
    raise exception 'invalid_channel_handle' using errcode='22023'; end if;
  if title is not null and length(title) > 200 then
    raise exception 'invalid_channel_title' using errcode='22023'; end if;

  insert into public.channels(workspace_id, client_id, external_channel_id, handle, title, platform)
  values (w, c, external, handle, title, p_platform)
  on conflict (workspace_id, platform, external_channel_id) do nothing
  returning * into ch;

  if ch.id is null then
    select * into ch from public.channels
     where workspace_id = w and platform = p_platform
       and external_channel_id = external and client_id = c;
    if ch.id is null then
      raise exception 'channel_claimed_by_other_client' using errcode='23505';
    end if;
  end if;

  -- Adopt all existing catalogue, comments, sentiment, and topics from existing workspaces
  perform private.adopt_channel_content(w, ch.id);

  return ch;
end $$;

-- 5. Backfill all duplicate channels across workspaces
do $$
declare
  ch record;
begin
  for ch in (
    select c1.workspace_id, c1.id
    from public.channels c1
    join public.channels c2
      on c2.platform = c1.platform
     and c2.external_channel_id = c1.external_channel_id
     and c2.workspace_id <> c1.workspace_id
    where c1.status <> 'disconnected'
      and exists (
        select 1 from public.comments c
        where c.workspace_id = c2.workspace_id
      )
  ) loop
    perform private.adopt_channel_content(ch.workspace_id, ch.id);
  end loop;
end $$;
