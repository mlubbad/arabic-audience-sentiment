-- The dashboard reported "Mixed: 0" for a model that has no Mixed class.
--
-- Hand-labelling every audience comment on the connected channel put a number
-- on what that zero was hiding: roughly one comment in twenty expresses praise
-- and criticism together. The active classifier has three classes and cannot
-- say so, so the figure was not merely uninformative — it was a measurement of
-- none where the truth was four per cent.
--
-- Derived rather than declared: a prediction's class_scores are the classes
-- the model scored, and a model cannot score a class it does not have. Nothing
-- new has to be sent by the worker, and the answer cannot drift from the
-- predictions it describes.

create or replace function private.dashboard_snapshot_impl(w uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare active text; rows jsonb; state jsonb; rev text;
begin
  if not private.has_role(w) then
    raise exception 'forbidden' using errcode='42501'; end if;

  -- A connected channel's key wins; otherwise any channel that names one. Null
  -- is legitimate and means nothing has been analysed yet.
  select c.active_analysis_key into active from public.channels c
   where c.workspace_id=w and c.active_analysis_key is not null
   order by (c.status='connected') desc, c.id limit 1;

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
      'connected', (select count(*) > 0 from public.jobs j
                     where j.workspace_id=w and j.lease_expires_at > now()),
      'last_heartbeat_at', (select max(j.lease_expires_at - interval '5 minutes')
                             from public.jobs j where j.workspace_id=w and j.lease_expires_at is not null)),
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
      from public.sync_runs s where s.workspace_id=w
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
    'plan', private.usage_summary_impl(w),
    'sync', state,
    'comments', rows);
end $$;

