-- The final review of selective video sync: what the quota counts, what the
-- operations page calls the last run, and when a failing collection rests.
--
-- Every create or replace below is a whole-body rewrite from the function's
-- current definition (the file named at each), with only the named change.

-- The tick's backoff below assumed the pilot plan rate-limited collections at
-- all; it did not. Half an hour between collections of one channel.
update public.plans set min_sync_interval_minutes = 30 where key = 'pilot';

-- select_videos_impl, rebuilt from 20260915131000 with three changes: the
-- quota is priced against everything already chosen and not yet stored, not
-- only against this call's additions; a removal alone reads no plan; and a
-- collection already running is reported as such rather than as queued.
create or replace function private.select_videos_impl(w uuid, c uuid, add uuid[], remove uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare estimate int := 0; unknowns int := 0; outstanding int := 0; remaining int; j uuid;
        queued boolean := false; deferred boolean := false; running boolean := false; begin
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
  -- the whole workspace and before this call writes anything. Without it two
  -- selections that each fit alone were both accepted against the same units.
  -- A selection this call removes is not outstanding.
  select coalesce(sum(greatest(0, v.reported_comment_count
           - (select count(*) from public.comments cm
               where cm.workspace_id=w and cm.video_id=v.id))), 0)::int
    into outstanding
    from public.video_selections s
    join public.videos v on v.workspace_id=w and v.id=s.video_id
   where s.workspace_id=w and not (s.video_id = any(remove));
  -- A removal alone spends nothing and needs no plan: a paused tenant can
  -- still deselect.
  if cardinality(add) > 0 then
    remaining := private.analysis_remaining(w);
    if estimate + outstanding > remaining then
      raise exception 'quota_exceeded' using errcode='53400'; end if;
  end if;

  delete from public.video_selections where workspace_id=w and video_id = any(remove);
  insert into public.video_selections(workspace_id, channel_id, video_id, selected_by)
  select w, c, x.id, (select auth.uid()) from unnest(add) x(id)
  on conflict (workspace_id, video_id) do nothing;

  if cardinality(add) > 0 then
    -- A collection already under way read its due list when it was claimed;
    -- the new video waits for the next tick. Saying "queued" here would
    -- promise that run something it will not do.
    select id into j from public.jobs
     where workspace_id=w and channel_id=c and type='collect' and status='running'
     order by created_at limit 1;
    if j is not null then
      running := true;
    else
      begin
        j := private.enqueue_sync_impl(w, c, 'selection-' || gen_random_uuid()::text);
        -- The job handed back may have been claimed between the two reads.
        select status = 'running' into running from public.jobs where id = j;
        queued := not running;
      exception when sqlstate '53400' then
        -- sync_too_soon. The selection is written; the tick picks it up.
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

-- dashboard_snapshot_impl, rebuilt from 20260914200000 with one change: the
-- last run is the last *collect* run.
create or replace function private.dashboard_snapshot_impl(w uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
    'plan', private.usage_summary_impl(w),
    'sync', state,
    'comments', rows);
end $$;

grant execute on function private.dashboard_snapshot_impl(uuid) to authenticated, service_role;

-- enqueue_scheduled, rebuilt from 20260915132000 with one addition: a failure
-- backoff independent of the plan's rate limit.
create or replace function private.enqueue_scheduled(w uuid, c uuid, kind text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare j uuid; gap int; begin
  if exists(select 1 from public.jobs where workspace_id=w and channel_id=c and type=kind
             and status in ('queued','running')) then return null; end if;
  -- A job of this kind that just ended badly is not tried again for an hour,
  -- whatever the plan's rate limit says: on a plan with no rate limit the
  -- idle tick re-enqueued a failing collection every time it ran. Measured
  -- from the run's end where one was recorded, else from the job's creation.
  if exists(
       select 1 from public.jobs q
         left join public.sync_runs r on r.workspace_id=q.workspace_id and r.job_id=q.id
        where q.id = (select id from public.jobs
                       where workspace_id=w and channel_id=c and type=kind
                       order by created_at desc limit 1)
          and q.status in ('failed','blocked','partial','cancelled')
          and coalesce(r.ended_at, q.created_at) > now() - interval '60 minutes') then
    return null; end if;
  gap := private.plan_limit(w, 'sync_interval');
  if gap is not null and gap > 0 and exists(
       select 1 from public.jobs where workspace_id=w and channel_id=c and type=kind
         and created_at > now() - make_interval(mins => gap)) then return null; end if;
  begin
    insert into public.jobs(workspace_id, channel_id, type, dedupe_key)
    values (w, c, kind, kind || '-' || gen_random_uuid()::text) returning id into j;
  exception when unique_violation then return null;
  end;
  return j;
end $$;
