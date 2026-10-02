-- 20260924160000_fix_scheduler_and_quota_lifecycle.sql
-- Root-cause resolution for statement timeouts (57014), quota recovery,
-- and automated unblocking of due jobs.

-- 1. Covering index for lightning-fast due video checks
create index if not exists video_selections_due_active_idx
  on public.video_selections(workspace_id, channel_id, next_check_at);

-- 2. Fast boolean check to replace slow JSONB array aggregation in scheduler
create or replace function private.has_due_videos(w uuid, c uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists (
    select 1
      from public.video_selections s
      join public.videos v on v.workspace_id = s.workspace_id and v.id = s.video_id
     where s.workspace_id = w and s.channel_id = c
       and s.next_check_at <= now()
       and v.comments_state <> 'disabled'
  );
$$;

revoke all on function private.has_due_videos(uuid, uuid) from public, anon, authenticated;
grant execute on function private.has_due_videos(uuid, uuid) to service_role;

-- 3. Optimized topics_pending with early-stopping LIMIT 1
create or replace function private.topics_pending(w uuid, c uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare active text; ver int; begin
  select active_topic_key, topic_taxonomy_version into active, ver from public.workspaces where id = w;
  return exists (
    select 1 from public.comments cm
      join public.videos v on v.workspace_id = w and v.id = cm.video_id
      join public.channels ch on ch.workspace_id = w and ch.id = v.channel_id
     where cm.workspace_id = w and v.channel_id = c
       and (cm.author_channel_id is null or cm.author_channel_id <> ch.external_channel_id)
       and (case when active is null
                 then not exists (select 1 from public.topic_predictions p
                                   where p.workspace_id = w and p.comment_id = cm.id
                                     and p.content_hash = cm.content_hash
                                     and p.status in ('succeeded','skipped','unsupported')
                                     and p.classification_key like 'topics:v' || ver::text || '+%')
                 else private.topic_row_due(w, cm, active) end)
     limit 1);
end $$;

revoke all on function private.topics_pending(uuid, uuid) from public, anon, authenticated;
grant execute on function private.topics_pending(uuid, uuid) to service_role;

-- 4. Automated unblocking of expired quota and blocked jobs whose backoff elapsed
create or replace function private.unblock_due_jobs() returns integer
language plpgsql security definer set search_path='' as $$
declare count int := 0; begin
  -- Cancel any blocked job that is already superseded by an active queued/running job
  update public.jobs b
     set status = 'cancelled',
         error_code = 'superseded_by_active_job'
   where b.status = 'blocked'
     and exists (
       select 1 from public.jobs a
        where a.workspace_id = b.workspace_id
          and a.channel_id = b.channel_id
          and a.type = b.type
          and a.status in ('queued', 'running')
          and a.id <> b.id
     );

  -- Unblock due jobs that have no outstanding active job
  update public.jobs j
     set status = 'queued',
         error_code = null,
         attempt = 0,
         reclaims = 0,
         lease_token = null,
         lease_expires_at = null,
         not_before = now()
   where j.status = 'blocked'
     and j.not_before <= now()
     and not exists (
       select 1 from public.jobs a
        where a.workspace_id = j.workspace_id
          and a.channel_id = j.channel_id
          and a.type = j.type
          and a.status in ('queued', 'running')
          and a.id <> j.id
     );
  get diagnostics count = row_count;
  return count;
end $$;

revoke all on function private.unblock_due_jobs() from public, anon, authenticated;
grant execute on function private.unblock_due_jobs() to service_role;

-- 5. Updated schedule_due_work using lightweight checks and budget gating
create or replace function private.schedule_due_work(w uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ch record; d int := 0; k int := 0; a int := 0; cat int; begin
  -- Automatically unblock any blocked jobs whose wait duration elapsed
  perform private.unblock_due_jobs();

  cat := coalesce(private.plan_limit(w, 'catalogue_interval'), 1440);
  for ch in select id, catalogued_at from public.channels
             where workspace_id = w and status in ('connected', 'public_unverified') loop
    if ch.catalogued_at is null
       or ch.catalogued_at < now() - make_interval(mins => cat) then
      if private.enqueue_scheduled(w, ch.id, 'discover') is not null then d := d + 1; end if;
    end if;

    if private.has_due_videos(w, ch.id) then
      if private.enqueue_scheduled(w, ch.id, 'collect') is not null then k := k + 1; end if;
    end if;

    if private.topics_pending(w, ch.id) then
      if private.enqueue_scheduled(w, ch.id, 'analyse') is not null then a := a + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('discover', d, 'collect', k, 'analyse', a);
end $$;

-- 6. One-time clean resolution of historical blocked/failed jobs from yesterday
update public.jobs b
   set status = 'cancelled',
       error_code = 'superseded_by_active_job'
 where b.status in ('blocked', 'failed')
   and exists (
     select 1 from public.jobs a
      where a.workspace_id = b.workspace_id
        and a.channel_id = b.channel_id
        and a.type = b.type
        and a.status in ('queued', 'running')
        and a.id <> b.id
   );

update public.jobs j
   set status = 'cancelled',
       error_code = 'resolved_quota_rollover'
 where j.status in ('blocked', 'failed')
   and j.created_at < now() - interval '1 hour'
   and (j.error_code in ('quota_exceeded', 'rate_limit_exceeded', 'api_error', 'source_http_error')
        or j.error_code is null);

-- Clean up any orphaned running sync_runs older than 2 hours
update public.sync_runs
   set status = 'failed',
       ended_at = now(),
       error_code = 'lease_expired'
 where status = 'running'
   and started_at < now() - interval '2 hours';
