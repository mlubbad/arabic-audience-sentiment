-- dashboard_snapshot_impl, rebuilt from 20260915140000 with one change: the
-- read carries the workspace's topic taxonomy, its active classification key,
-- and each comment's effective topic verdict and topic reviews, selected by
-- the same rule as the sentiment prediction — the text as it stands now,
-- under the active key, newest first.
create or replace function private.dashboard_snapshot_impl(w uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare active text; topic_active text; rows jsonb; state jsonb; rev text; taxonomy jsonb;
begin
  if not private.has_role(w) then
    raise exception 'forbidden' using errcode='42501'; end if;

  -- A connected channel's key wins; otherwise any channel that names one. Null
  -- is legitimate and means nothing has been analysed yet.
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

  select coalesce(jsonb_agg(r.row order by r.published_at nulls last, r.id), '[]'::jsonb)
  into rows from (
    select cm.id, cm.published_at, jsonb_build_object(
      'id', cm.id::text,
      'workspace_id', cm.workspace_id::text,
      'client_id', ch.client_id::text,
      'channel_id', ch.id::text,
      'video_id', v.id::text,
      -- Written by the channel, not by its audience. Derived here from the
      -- two ids rather than stored, so it cannot drift away from either.
      'by_channel_owner',
        cm.author_channel_id is not null
          and cm.author_channel_id = ch.external_channel_id,
      -- The video's own title. Without it the dashboard printed a UUID
      -- where a person expects the name of an episode, and the video filter
      -- had no option text to show at all.
      'video_title', v.title,
      'video_kind', v.kind,
      'author_channel_id', cm.author_channel_id,
      'author_name', cm.author_name,
      'text_raw', cm.text_raw,
      'content_hash', cm.content_hash,
      'likes_raw', cm.likes_raw,
      -- Unknown stays null. A scraped count that could not be parsed must not
      -- arrive at the dashboard as a number.
      'likes_value', cm.likes_value,
      'published_at', cm.published_at,
      'published_time_raw', cm.published_time_raw,
      'timestamp_precision', cm.timestamp_precision,
      'is_reply', cm.is_reply,
      -- The app addresses rows by internal id, so the stored platform parent is
      -- resolved here rather than leaking an external id into the UI.
      'parent_comment_id', parent.id::text,
      'parent_source', cm.parent_source,
      'source', cm.source,
      'field_provenance', cm.field_provenance,
      'content_purged_at', cm.content_purged_at,
      'comment_type', (
        select a.value from public.comment_annotations a
         where a.workspace_id=w and a.comment_id=cm.id and a.kind='comment_type'
         order by a.created_at desc limit 1),
      -- The effective prediction only: it must judge the text as it stands now
      -- and belong to the active analysis. Anything else is history, and
      -- showing it would label a comment by a verdict on text it no longer has.
      'prediction', (
        select jsonb_build_object(
          'status', p.status, 'label', p.label, 'content_hash', p.content_hash,
          'analysis_key', p.analysis_key, 'model_id', r.model_id,
          'revision', r.revision_sha, 'preprocessing_version', r.preprocessing_version,
          'predicted_at', p.predicted_at, 'class_scores', p.class_scores)
        from public.sentiment_predictions p
        join public.analysis_runs r on r.workspace_id=w and r.id=p.analysis_run_id
        where p.workspace_id=w and p.comment_id=cm.id
          and p.content_hash=cm.content_hash
          and active is not null and p.analysis_key=active
        order by p.predicted_at desc limit 1),
      'reviews', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'label', rv.label, 'content_hash', rv.content_hash,
          'created_at', rv.created_at, 'origin', rv.origin,
          -- Null reviewer and null reason are what an imported amendment is;
          -- inventing either would attribute a correction to someone.
          'reviewer_id', rv.reviewer_id::text, 'reason', rv.reason
        ) order by rv.created_at), '[]'::jsonb)
        from public.comment_reviews rv
        where rv.workspace_id=w and rv.comment_id=cm.id)
      ,
      'topic_prediction', (
        select jsonb_build_object(
          'status', p.status, 'topic_key', p.topic_key, 'confidence', p.confidence,
          'content_hash', p.content_hash, 'classification_key', p.classification_key,
          'model_id', p.model_id, 'prompt_version', p.prompt_version,
          'predicted_at', p.predicted_at, 'error_code', p.error_code)
        from public.topic_predictions p
        where p.workspace_id=w and p.comment_id=cm.id
          and p.content_hash=cm.content_hash
          and topic_active is not null and p.classification_key=topic_active
        order by p.predicted_at desc limit 1),
      'topic_reviews', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'topic_key', tr.topic_key, 'content_hash', tr.content_hash,
          'created_at', tr.created_at, 'origin', tr.origin,
          'reviewer_id', tr.reviewer_id::text, 'reason', tr.reason
        ) order by tr.created_at), '[]'::jsonb)
        from public.topic_reviews tr
        where tr.workspace_id=w and tr.comment_id=cm.id)
    ) as row
    from public.comments cm
    join public.videos v on v.workspace_id=w and v.id=cm.video_id
    join public.channels ch on ch.workspace_id=w and ch.id=v.channel_id
    left join public.comments parent on parent.workspace_id=w
      and parent.platform=cm.platform and parent.external_comment_id=cm.external_parent_id
    where cm.workspace_id=w
  ) r;

  -- Collection health. Absent rather than invented: a workspace that has never
  -- synced reports no last run, which the app classifies as unknown.
  select jsonb_build_object(
    'worker', jsonb_build_object(
      -- Read, not inferred. This used to be "some job in this workspace holds
      -- a live lease", which answers a different question: a worker that is
      -- running and has nothing to do holds no lease, and read as absent.
      -- Those are opposite situations and the panel showed them in one colour.
      'connected', coalesce((select s.last_seen_at > now() - interval '3 minutes'
                               from public.worker_seen s
                              where s.workspace_id = w), false),
      -- The real time it last spoke. The old figure was arithmetic —
      -- lease_expires_at minus five minutes — against a lease that was one
      -- minute long, so it reported a heartbeat four minutes before any had
      -- happened. Raising the lease to five minutes made that subtraction
      -- accidentally correct; this makes it correct on purpose.
      'last_heartbeat_at', (select s.last_seen_at from public.worker_seen s
                             where s.workspace_id = w),
      -- Alive with nothing to do is not the same as alive and working, and an
      -- operator waiting on a collection needs to tell them apart.
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
          -- Complete means the source was traversed to its end, never that
          -- every comment that exists was retrieved.
          'complete', coalesce((s.coverage_summary->>'complete')::boolean, false)))
      -- The last collection. A discover run carries no comment coverage; read
      -- as the last run it says the collection found nothing and never
      -- finished, at the moment a catalogue was just refreshed.
      from public.sync_runs s where s.workspace_id=w and s.mode = 'collect'
      order by s.started_at desc limit 1))
  into state;

  return jsonb_build_object(
    'mode', 'live',
    'revision', rev,
    'active_analysis_key', coalesce(active, ''),
    -- The labels the active analysis can produce, read from the class scores
    -- its own predictions carry rather than declared anywhere. A model cannot
    -- score a class it does not have, so the keys are the vocabulary.
    'active_analysis_labels', coalesce((
      select jsonb_agg(distinct k)
        from public.sentiment_predictions p,
             jsonb_object_keys(p.class_scores) k
       where p.workspace_id = w and active is not null
         and p.analysis_key = active and p.status = 'succeeded'), '[]'::jsonb),
    'topics', taxonomy,
    'active_topic_key', coalesce(topic_active, ''),
    'plan', private.usage_summary_impl(w),
    'sync', state,
    'comments', rows);
end $$;

grant execute on function private.dashboard_snapshot_impl(uuid) to authenticated, service_role;
