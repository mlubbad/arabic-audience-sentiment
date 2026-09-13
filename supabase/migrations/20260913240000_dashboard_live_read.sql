-- The dashboard had no live read path at all.
--
-- apps/web/src/data.ts pinned dataMode to "sanitized_fixture" with nothing able
-- to change it, because a live read did not exist. Everything downstream — the
-- filters, the aggregates, the export, the corrections — ran over a JSON file.
--
-- This produces exactly the shape the fixture has, so both modes feed the same
-- shared snapshot() and cannot drift into computing different figures from the
-- same rows. Where the fixture is a file, this is the same object assembled
-- from the tables under RLS.
--
-- security invoker, so row-level security applies to the caller as it would to
-- a direct select; the explicit role check on top turns another tenant's
-- workspace id into a refusal rather than an empty-looking success, and does so
-- before any row is touched.
--
-- That check is defence in depth, not the only guard, and the test cannot tell
-- the difference: private.usage_summary_impl raises forbidden for a non-member
-- too, so removing the check here still refuses the call. It is kept because a
-- read should authorise at its own entry point rather than depend on which
-- sub-call happens to raise first, but the honest claim is that the suite
-- proves tenant isolation, not this particular line.
--
-- KNOWN BOUND: this reads every comment in the workspace in one call. That is
-- the same whole-set read the fixture does and it is what lets snapshot()
-- compute identical aggregates in both modes. It is right for pilot-scale data
-- and will need server-side filtering before a workspace holds substantially
-- more. It is not capped: returning a silent subset would report partial data
-- as if it were the whole set, which is the one behaviour this codebase refuses
-- everywhere else.

create function private.dashboard_snapshot_impl(w uuid) returns jsonb
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
      'video_kind', v.kind,
      'author_channel_id', cm.author_channel_id,
      'author_name', coalesce(cm.author_name, ''),
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
    'plan', private.usage_summary_impl(w),
    'sync', state,
    'comments', rows);
end $$;

create function public.dashboard_snapshot(w uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.dashboard_snapshot_impl(w)$$;

revoke all on function private.dashboard_snapshot_impl(uuid), public.dashboard_snapshot(uuid)
  from public, anon;
grant execute on function private.dashboard_snapshot_impl(uuid), public.dashboard_snapshot(uuid)
  to authenticated;
