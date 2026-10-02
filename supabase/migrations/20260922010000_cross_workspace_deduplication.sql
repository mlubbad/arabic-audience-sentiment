-- Cross-workspace deduplication and catalogue comment analytics
-- 1. Adds performance indexes for cross-workspace unique identity lookups.
-- 2. Updates private.workspace_ops_snapshot_impl to include per-video 'analysed' count and 'catalogue_summary'.
-- 3. Adds private.adopt_channel_catalogue, private.adopt_video_comments_and_predictions, and private.adopt_channel_content.
-- 4. Hooks deduplication into register_public_channel_impl and select_videos_impl.
-- 5. Exposes public.adopt_workspace_channel for explicit sync.
-- 6. Backfills existing cross-workspace channels and comments safely.

-- 1. Performance indexes for cross-workspace lookups
create index if not exists channels_platform_ext_id_idx on public.channels(platform, external_channel_id);
create index if not exists videos_platform_ext_id_idx on public.videos(platform, external_video_id);
create index if not exists comments_platform_ext_id_idx on public.comments(platform, external_comment_id);

-- 2. Update workspace_ops_snapshot_impl
create or replace function private.workspace_ops_snapshot_impl(w uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  state jsonb;
  plan_summary jsonb;
  video_counts jsonb;
  cat_summary jsonb;
begin
  if not private.has_role(w) then
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

  -- Single-pass computation of stored comments and analysed count
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
    'video_counts', video_counts,
    'catalogue_summary', cat_summary
  );
end $$;

-- 3. Procedure to adopt videos from other workspaces for the same channel
create or replace function private.adopt_channel_catalogue(w uuid, c uuid)
returns int
language plpgsql security definer set search_path='' as $$
declare
  ch public.channels;
  adopted_count int := 0;
begin
  select * into ch from public.channels where workspace_id = w and id = c;
  if ch.id is null then
    return 0;
  end if;

  insert into public.videos (
    workspace_id, channel_id, platform, external_video_id, title, kind,
    published_at, duration_sec, thumbnail_url, reported_comment_count,
    reported_comment_count_at, comments_state, catalogued_at, last_observed_at,
    field_provenance
  )
  select distinct on (v.external_video_id)
    w, c, v.platform, v.external_video_id, v.title, v.kind,
    v.published_at, v.duration_sec, v.thumbnail_url, v.reported_comment_count,
    v.reported_comment_count_at, v.comments_state, coalesce(v.catalogued_at, now()), now(),
    coalesce(v.field_provenance, '{}'::jsonb)
  from public.videos v
  join public.channels donor_ch on donor_ch.id = v.channel_id and donor_ch.workspace_id = v.workspace_id
  where donor_ch.platform = ch.platform
    and donor_ch.external_channel_id = ch.external_channel_id
    and v.workspace_id <> w
  order by v.external_video_id, v.catalogued_at desc nulls last
  on conflict (workspace_id, platform, external_video_id) do update set
    title = case
              when excluded.title <> excluded.external_video_id
                then excluded.title
              else public.videos.title
            end,
    kind = excluded.kind,
    thumbnail_url = coalesce(excluded.thumbnail_url, public.videos.thumbnail_url),
    reported_comment_count = coalesce(excluded.reported_comment_count, public.videos.reported_comment_count),
    reported_comment_count_at = coalesce(excluded.reported_comment_count_at, public.videos.reported_comment_count_at),
    comments_state = excluded.comments_state,
    last_observed_at = now();

  get diagnostics adopted_count = row_count;

  if adopted_count > 0 and ch.catalogued_at is null then
    update public.channels set catalogued_at = now() where workspace_id = w and id = c;
  end if;

  return adopted_count;
end $$;

revoke all on function private.adopt_channel_catalogue(uuid, uuid) from public, anon, authenticated;
grant execute on function private.adopt_channel_catalogue(uuid, uuid) to service_role;

-- 4. Procedure to adopt comments and predictions for a video from other workspaces
create or replace function private.adopt_video_comments_and_predictions(w uuid, v uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  vid public.videos;
  donor_vid uuid;
  donor_ws uuid;
  adopted_comments int := 0;
  adopted_sentiment int := 0;
  adopted_topics int := 0;
  total_stored int := 0;
begin
  select * into vid from public.videos where workspace_id = w and id = v;
  if vid.id is null then
    return jsonb_build_object('comments', 0, 'sentiment', 0, 'topics', 0);
  end if;

  -- Locate donor video with stored comments in another workspace
  select donor_v.id, donor_v.workspace_id
    into donor_vid, donor_ws
  from public.videos donor_v
  join public.comments c on c.video_id = donor_v.id and c.workspace_id = donor_v.workspace_id
  where donor_v.platform = vid.platform
    and donor_v.external_video_id = vid.external_video_id
    and donor_v.workspace_id <> w
  limit 1;

  if donor_vid is null then
    return jsonb_build_object('comments', 0, 'sentiment', 0, 'topics', 0);
  end if;

  -- 1. Adopt comments from donor workspace
  insert into public.comments (
    workspace_id, video_id, platform, external_comment_id, external_parent_id,
    is_reply, parent_source, author_channel_id, author_name, text_raw, text_plain,
    content_hash, published_time_raw, published_at, timestamp_precision,
    likes_raw, likes_value, source, field_provenance
  )
  select
    w, v, c.platform, c.external_comment_id, c.external_parent_id,
    c.is_reply, c.parent_source, c.author_channel_id, c.author_name, c.text_raw, c.text_plain,
    c.content_hash, c.published_time_raw, c.published_at, c.timestamp_precision,
    c.likes_raw, c.likes_value, c.source, c.field_provenance
  from public.comments c
  where c.workspace_id = donor_ws
    and c.video_id = donor_vid
  on conflict (workspace_id, platform, external_comment_id) do nothing;

  get diagnostics adopted_comments = row_count;

  -- 2. Ensure analysis_runs records exist for target workspace
  insert into public.analysis_runs (
    workspace_id, model_id, revision_sha, preprocessing_version, parameters, status
  )
  select distinct w, ar.model_id, ar.revision_sha, ar.preprocessing_version, ar.parameters, 'succeeded'
  from public.comments donor_c
  join public.sentiment_predictions sp
    on sp.workspace_id = donor_c.workspace_id
   and sp.comment_id = donor_c.id
   and sp.status = 'succeeded'
  join public.analysis_runs ar
    on ar.workspace_id = sp.workspace_id
   and ar.id = sp.analysis_run_id
  where donor_c.workspace_id = donor_ws
    and donor_c.video_id = donor_vid
  on conflict (workspace_id, model_id, revision_sha, preprocessing_version, parameters) do nothing;

  -- 3. Adopt sentiment predictions
  insert into public.sentiment_predictions (
    workspace_id, comment_id, content_hash, analysis_run_id, analysis_key,
    status, label, class_scores, predicted_at
  )
  select distinct on (target_c.id, sp.analysis_key)
    w, target_c.id, target_c.content_hash, target_ar.id, sp.analysis_key,
    sp.status, sp.label, sp.class_scores, sp.predicted_at
  from public.comments target_c
  join public.comments donor_c
    on donor_c.workspace_id = donor_ws
   and donor_c.video_id = donor_vid
   and donor_c.platform = target_c.platform
   and donor_c.external_comment_id = target_c.external_comment_id
  join public.sentiment_predictions sp
    on sp.workspace_id = donor_c.workspace_id
   and sp.comment_id = donor_c.id
   and sp.status = 'succeeded'
  join public.analysis_runs donor_ar
    on donor_ar.workspace_id = sp.workspace_id
   and donor_ar.id = sp.analysis_run_id
  join public.analysis_runs target_ar
    on target_ar.workspace_id = w
   and target_ar.model_id = donor_ar.model_id
   and target_ar.revision_sha = donor_ar.revision_sha
   and target_ar.preprocessing_version = donor_ar.preprocessing_version
   and target_ar.parameters = donor_ar.parameters
  where target_c.workspace_id = w
    and target_c.video_id = v
  on conflict (workspace_id, comment_id, content_hash, analysis_key) do nothing;

  get diagnostics adopted_sentiment = row_count;

  -- 4. Adopt topic predictions if matching topic exists in target workspace
  insert into public.topic_predictions (
    workspace_id, comment_id, content_hash, classification_key,
    status, topic_key, confidence, model_id, prompt_version, error_code, predicted_at
  )
  select distinct on (target_c.id, tp.classification_key)
    w, target_c.id, target_c.content_hash,
    tp.classification_key,
    tp.status, tp.topic_key, tp.confidence, tp.model_id, tp.prompt_version, tp.error_code, tp.predicted_at
  from public.comments target_c
  join public.comments donor_c
    on donor_c.workspace_id = donor_ws
   and donor_c.video_id = donor_vid
   and donor_c.platform = target_c.platform
   and donor_c.external_comment_id = target_c.external_comment_id
  join public.topic_predictions tp
    on tp.workspace_id = donor_c.workspace_id
   and tp.comment_id = donor_c.id
   and tp.status = 'succeeded'
  join public.workspace_topics wt
    on wt.workspace_id = w and wt.key = tp.topic_key and wt.retired_at is null
  where target_c.workspace_id = w
    and target_c.video_id = v
  on conflict (workspace_id, comment_id, content_hash, classification_key) do nothing;

  get diagnostics adopted_topics = row_count;

  -- 5. Update video_selections if video is selected and comments are now present
  select count(*)::int into total_stored from public.comments where workspace_id = w and video_id = v;
  if total_stored > 0 then
    update public.video_selections
       set last_seen_comment_count = total_stored,
           last_collected_at = coalesce((select max(last_seen_at) from public.comments where workspace_id = w and video_id = v), now()),
           last_outcome = 'exhausted',
           next_check_at = now() + make_interval(mins => coalesce(private.plan_limit(w, 'live_interval'), 1440))
     where workspace_id = w and video_id = v;
  end if;

  return jsonb_build_object(
    'comments', adopted_comments,
    'sentiment', adopted_sentiment,
    'topics', adopted_topics
  );
end $$;

revoke all on function private.adopt_video_comments_and_predictions(uuid, uuid) from public, anon, authenticated;
grant execute on function private.adopt_video_comments_and_predictions(uuid, uuid) to service_role;

-- 5. Adopt full channel content across workspaces
create or replace function private.adopt_channel_content(w uuid, c uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  vids_adopted int := 0;
  comments_adopted int := 0;
  sentiment_adopted int := 0;
  topics_adopted int := 0;
  vid_rec record;
  step_res jsonb;
begin
  vids_adopted := private.adopt_channel_catalogue(w, c);

  for vid_rec in
    select v.id
    from public.videos v
    join public.videos donor_v
      on donor_v.platform = v.platform
     and donor_v.external_video_id = v.external_video_id
     and donor_v.workspace_id <> v.workspace_id
    where v.workspace_id = w
      and v.channel_id = c
      and exists (
        select 1 from public.comments donor_c
        where donor_c.workspace_id = donor_v.workspace_id
          and donor_c.video_id = donor_v.id
      )
      and not exists (
        select 1 from public.comments target_c
        where target_c.workspace_id = w
          and target_c.video_id = v.id
      )
  loop
    step_res := private.adopt_video_comments_and_predictions(w, vid_rec.id);
    comments_adopted := comments_adopted + (step_res->>'comments')::int;
    sentiment_adopted := sentiment_adopted + (step_res->>'sentiment')::int;
    topics_adopted := topics_adopted + (step_res->>'topics')::int;
  end loop;

  return jsonb_build_object(
    'videos', vids_adopted,
    'comments', comments_adopted,
    'sentiment', sentiment_adopted,
    'topics', topics_adopted
  );
end $$;

revoke all on function private.adopt_channel_content(uuid, uuid) from public, anon, authenticated;
grant execute on function private.adopt_channel_content(uuid, uuid) to service_role;

-- 6. Expose public RPC for authenticated users
create or replace function public.adopt_workspace_channel(w uuid, c uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.has_role(w, array['workspace_owner', 'analyst']) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return private.adopt_channel_content(w, c);
end $$;

revoke all on function public.adopt_workspace_channel(uuid, uuid) from public;
grant execute on function public.adopt_workspace_channel(uuid, uuid) to authenticated;

-- 7. Hook adoption into register_public_channel_impl
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

  -- Adopt existing catalogue videos if available from another workspace
  perform private.adopt_channel_catalogue(w, ch.id);

  return ch;
end $$;

-- 8. Hook adoption into select_videos_impl
create or replace function private.select_videos_impl(w uuid, c uuid, add uuid[], remove uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare estimate int := 0; unknowns int := 0; outstanding int := 0; remaining int; j uuid;
        queued boolean := false; deferred boolean := false; running boolean := false;
        rec record;
begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.channels where workspace_id=w and id=c) then
    raise exception 'invalid_channel' using errcode='23503'; end if;
  add := coalesce(add, '{}'::uuid[]); remove := coalesce(remove, '{}'::uuid[]);
  if exists(select 1 from unnest(add || remove) x(id)
             where not exists(select 1 from public.videos v
                               where v.workspace_id=w and v.channel_id=c and v.id=x.id)) then
    raise exception 'invalid_video' using errcode='23503'; end if;
  if exists(select 1 from public.videos v
             where v.workspace_id=w and v.id = any(add) and v.comments_state='disabled') then
    raise exception 'comments_disabled' using errcode='22023'; end if;

  -- Comments already in the database were already metered. A null count adds
  -- nothing to the sum and is reported apart, never as zero.
  select coalesce(sum(greatest(0, v.reported_comment_count
           - (select count(*) from public.comments cm
               where cm.workspace_id=w and cm.video_id=v.id))), 0)::int,
         count(*) filter (where v.reported_comment_count is null)::int
    into estimate, unknowns
    from public.videos v
   where v.workspace_id=w and v.id = any(add)
     and not exists(select 1 from public.video_selections s
                     where s.workspace_id=w and s.video_id=v.id);

  -- What is already chosen and not yet stored, priced the same way, across
  -- the whole workspace and before this call writes anything.
  select coalesce(sum(greatest(0, v.reported_comment_count
           - (select count(*) from public.comments cm
               where cm.workspace_id=w and cm.video_id=v.id))), 0)::int
    into outstanding
    from public.video_selections s
    join public.videos v on v.workspace_id=w and v.id=s.video_id
   where s.workspace_id=w and not (s.video_id = any(remove));

  -- A removal alone spends nothing and needs no plan: a paused tenant can still deselect.
  if cardinality(add) > 0 then
    remaining := private.analysis_remaining(w);
    if estimate + outstanding > remaining then
      raise exception 'quota_exceeded' using errcode='53400'; end if;
  end if;

  delete from public.video_selections where workspace_id=w and video_id = any(remove);
  insert into public.video_selections(workspace_id, channel_id, video_id, selected_by)
  select w, c, x.id, (select auth.uid()) from unnest(add) x(id)
  on conflict (workspace_id, video_id) do nothing;

  -- Adopt comments and predictions from other workspaces for the newly selected videos
  if cardinality(add) > 0 then
    for rec in select x.id as video_id from unnest(add) x(id) loop
      perform private.adopt_video_comments_and_predictions(w, rec.video_id);
    end loop;
  end if;

  if cardinality(add) > 0 then
    select id into j from public.jobs
     where workspace_id=w and channel_id=c and type='collect' and status='running'
     order by created_at limit 1;
    if j is not null then
      running := true;
    else
      begin
        j := private.enqueue_sync_impl(w, c, 'selection-' || gen_random_uuid()::text);
        select status = 'running' into running from public.jobs where id = j;
        queued := not running;
      exception when sqlstate '53400' then
        deferred := true;
      end;
    end if;
  end if;

  return jsonb_build_object('job_id', j, 'queued', queued, 'deferred', deferred,
                            'already_running', running,
                            'estimate', estimate, 'unknown_count', unknowns,
                            'outstanding', outstanding,
                            'remaining_after', remaining - outstanding - estimate);
end $$;

-- 9. Backfill catalogue and content for duplicate channels safely
do $$
declare
  ch record;
  sel record;
begin
  -- Only adopt catalogue for channels that share platform and external_channel_id across workspaces
  for ch in (
    select c1.workspace_id, c1.id
    from public.channels c1
    join public.channels c2
      on c2.platform = c1.platform
     and c2.external_channel_id = c1.external_channel_id
     and c2.workspace_id <> c1.workspace_id
    where c1.status <> 'disconnected'
  ) loop
    perform private.adopt_channel_catalogue(ch.workspace_id, ch.id);
  end loop;

  -- Only adopt comments for empty selections that have a donor video with comments
  for sel in (
    select vs.workspace_id, vs.video_id
    from public.video_selections vs
    join public.videos v on v.workspace_id = vs.workspace_id and v.id = vs.video_id
    where not exists (
      select 1 from public.comments c where c.workspace_id = vs.workspace_id and c.video_id = vs.video_id
    )
    and exists (
      select 1 from public.videos donor_v
      join public.comments donor_c on donor_c.workspace_id = donor_v.workspace_id and donor_c.video_id = donor_v.id
      where donor_v.platform = v.platform
        and donor_v.external_video_id = v.external_video_id
        and donor_v.workspace_id <> v.workspace_id
    )
  ) loop
    perform private.adopt_video_comments_and_predictions(sel.workspace_id, sel.video_id);
  end loop;
end $$;
