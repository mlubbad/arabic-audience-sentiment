-- Owner console review batch E, definitions and scale
-- (docs/reviews/2026-10-13-owner-console-review.md, findings 9, 10, 11 and 20).
--
-- 10. Deleting the largest workspace (155k comments) ran past the 8 s API
--     limit: the stats triggers recounted every one of its 4,583 videos twice
--     (once as its predictions went, once as its comments went), only for
--     those stats rows to be deleted with the videos a moment later. The
--     recount now skips the workspace being deleted, and the delete and its
--     footprint have their own limits (PostgREST applies a statement_timeout
--     set on the function the RPC names; 20261011000000).
-- 11. admin_ops has a 30 s limit, and its failed count is failed runs only;
--     partial runs are counted beside it (finding 9: "failed" meant four
--     things). comments_7d stays "collected this week" (first_seen_at, on its
--     own index); the page now says so.
-- 20. audit_events gets the three indexes the console's reads use: by time,
--     by actor, by target.

-- ---- 10. the stats recount skips a workspace that is being deleted ----
-- `app.deleting_workspace` is set, for one transaction, only by
-- delete_workspace, remove_channel_impl and purge_foreign_catalogue, and
-- each deletes the videos whose stats it would recount (the stats rows go
-- with them, on delete cascade). From 20261003120000; the filter is new.
create or replace function private.refresh_video_comment_stats(pairs jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  deleting text := nullif(current_setting('app.deleting_workspace', true), '');
begin
  if deleting is not null then
    select coalesce(jsonb_agg(e), '[]'::jsonb) into pairs
    from jsonb_array_elements(coalesce(pairs, '[]'::jsonb)) e
    where e->>'workspace_id' is distinct from deleting;
    if pairs = '[]'::jsonb then return; end if;
  end if;

  insert into private.video_comment_stats(workspace_id, video_id, total, analysed)
  select distinct p.workspace_id, p.video_id, 0, 0
  from jsonb_to_recordset(coalesce(pairs, '[]'::jsonb))
    as p(workspace_id uuid, video_id uuid)
  on conflict (workspace_id, video_id) do nothing;

  -- Serialize recomputes for each video. The following UPDATE is a separate
  -- statement, so READ COMMITTED gives it a fresh snapshot after any lock
  -- holder commits. Stable ordering prevents multi-video statements from
  -- taking the same row locks in conflicting orders.
  perform 1
  from private.video_comment_stats s
  join jsonb_to_recordset(coalesce(pairs, '[]'::jsonb))
    as p(workspace_id uuid, video_id uuid)
    on p.workspace_id = s.workspace_id
   and p.video_id = s.video_id
  order by s.workspace_id, s.video_id
  for update of s;

  with affected as (
    select distinct p.workspace_id, p.video_id
    from jsonb_to_recordset(coalesce(pairs, '[]'::jsonb))
      as p(workspace_id uuid, video_id uuid)
  ), counts as (
    select
      p.workspace_id,
      p.video_id,
      count(c.id)::int as total,
      count(c.id) filter (
        where exists (
          select 1
          from public.sentiment_predictions sp
          where sp.workspace_id = c.workspace_id
            and sp.comment_id = c.id
            and sp.status = 'succeeded'
        )
      )::int as analysed
    from affected p
    left join public.comments c
      on c.workspace_id = p.workspace_id
     and c.video_id = p.video_id
    group by p.workspace_id, p.video_id
  )
  update private.video_comment_stats s
  set total = counts.total,
      analysed = counts.analysed
  from counts
  where s.workspace_id = counts.workspace_id
    and s.video_id = counts.video_id;
end;
$$;

-- The delete of a workspace this size, and the counts its dialog shows
-- first. Owner-only calls, so a generous limit costs no tenant anything.
alter function public.delete_workspace(uuid) set statement_timeout = '120s';
alter function public.admin_workspace_footprint(uuid) set statement_timeout = '60s';

-- ---- 11 and 9. admin_ops: a limit, and failed apart from partial ----
-- From the current definition; sync_failed_7d is failed runs only and
-- sync_partial_7d is new. The failed-runs list still shows both, labelled
-- by status.
create or replace function public.admin_ops() returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '30s' as $$
declare
  overview jsonb;
  failed jsonb;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  select jsonb_build_object(
    'workspaces', (select count(*) from public.workspaces),
    'channels', (select count(*) from public.channels),
    -- Collected this week, by first_seen_at (comments_first_seen), whatever
    -- the comment's own date: an import of old comments counts here.
    'comments_7d', (
      select count(*) from public.comments
      where first_seen_at >= now() - interval '7 days'),
    'worker_fresh', coalesce((
      select max(last_seen_at) >= now() - interval '3 minutes'
      from public.worker_seen), false),
    'worker_last_seen', to_jsonb((select max(last_seen_at) from public.worker_seen)),
    'jobs_open', (
      select count(*) from public.jobs where status in ('queued','running')),
    'sync_runs_7d', (
      select count(*) from public.sync_runs
      where started_at >= now() - interval '7 days'),
    'sync_failed_7d', (
      select count(*) from public.sync_runs
      where started_at >= now() - interval '7 days'
        and status = 'failed'),
    'sync_partial_7d', (
      select count(*) from public.sync_runs
      where started_at >= now() - interval '7 days'
        and status = 'partial'))
  into overview;
  select coalesce(jsonb_agg(jsonb_build_object(
      'workspace_id', j.workspace_id, 'workspace_name', w.name,
      'channel_id', j.channel_id, 'handle', c.handle,
      'mode', j.mode, 'source', j.source,
      'started_at', to_jsonb(j.started_at), 'ended_at', to_jsonb(j.ended_at),
      'status', j.status, 'error_code', j.error_code)
    order by j.started_at desc), '[]'::jsonb)
  into failed
  from (
    select sr.workspace_id, sr.channel_id, sr.mode, sr.source,
           sr.started_at, sr.ended_at, sr.status, sr.error_code
    from public.sync_runs sr
    where sr.status in ('failed','partial')
      and sr.started_at >= now() - interval '14 days'
    order by sr.started_at desc
    limit 25
  ) j
  join public.workspaces w on w.id = j.workspace_id
  left join public.channels c on c.id = j.channel_id;
  return overview || jsonb_build_object('failed_runs', failed);
end $$;

-- ---- 20. the audit trail's reads ----
-- Small table today (owner actions only); built here so it stays an index
-- lookup as it grows. Plain CREATE INDEX: the write lock lasts the build,
-- which on this table is milliseconds.
create index if not exists audit_events_by_time on public.audit_events (created_at desc);
create index if not exists audit_events_by_actor on public.audit_events (actor_id, created_at desc);
create index if not exists audit_events_by_target on public.audit_events (target_type, target_id);
