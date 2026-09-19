-- Phase 1 of the admin roadmap (admin-dashboard-roadmap.md): eyes only.
-- Four read-only RPCs for the operator's screen — users, channels, an
-- operations overview with the recent failed runs, and the audit trail.
-- No write anywhere: every lever already on /admin keeps its own RPC, and
-- every one of these functions is gated exactly as those are — a row in
-- private.platform_admins checked at the head of the function, never a
-- policy on the underlying table.

-- One row per signed-up user: who they are, when they were last here, and
-- how many workspaces they stand in. The email is personal data; the gate
-- above is the only reason this function may read it, so it reads nothing
-- else about the account (no raw_user_meta_data, no phone, no keys).
create function public.admin_users() returns setof jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return query
    select jsonb_build_object(
      'id', u.id, 'email', u.email,
      'created_at', to_jsonb(u.created_at), 'last_sign_in_at', to_jsonb(u.last_sign_in_at),
      'workspace_count', count(m.workspace_id),
      'owner_count', count(m.workspace_id) filter (where m.role = 'workspace_owner'))
    from auth.users u
    left join public.memberships m on m.user_id = u.id
    group by u.id
    order by u.created_at desc;
end $$;
revoke all on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;

-- One row per connected channel: the workspace it feeds, how much has been
-- collected through it, and the last sync run's verdict. The counts ride the
-- same indexes the dashboard reads; a channel with a hundred thousand
-- comments pays one scan, the same scan the workspace's own page pays.
create function public.admin_channels() returns setof jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return query
    select jsonb_build_object(
      'id', c.id, 'workspace_id', c.workspace_id, 'workspace_name', w.name,
      'external_channel_id', c.external_channel_id,
      'handle', c.handle, 'title', c.title, 'status', c.status,
      'video_count', (select count(*) from public.videos v where v.channel_id = c.id),
      'comment_count', (
        select count(*) from public.comments cm
        join public.videos v on v.id = cm.video_id
        where v.channel_id = c.id),
      'last_sync_at', to_jsonb(ls.started_at),
      'last_sync_status', ls.status, 'last_sync_error', ls.error_code)
    from public.channels c
    join public.workspaces w on w.id = c.workspace_id
    left join lateral (
      select sr.started_at, sr.status, sr.error_code
      from public.sync_runs sr
      where sr.channel_id = c.id
      order by sr.started_at desc
      limit 1) ls on true
    order by w.created_at desc, c.external_channel_id;
end $$;
revoke all on function public.admin_channels() from public, anon;
grant execute on function public.admin_channels() to authenticated;

-- The operations overview in one object: the numbers the operator's cards
-- read, and the failed and partial runs of the last two weeks, newest first,
-- capped at twenty-five. `worker_fresh` is the same three-minute rule the
-- connection panel states — nothing has asked for work in three minutes and
-- the worker is not connected.
create function public.admin_ops() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  overview jsonb;
  failed jsonb;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  select jsonb_build_object(
    'workspaces', (select count(*) from public.workspaces),
    'channels', (select count(*) from public.channels),
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
        and status in ('failed','partial')))
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
revoke all on function public.admin_ops() from public, anon;
grant execute on function public.admin_ops() to authenticated;

-- The audit trail, newest first, bounded: the caller asks for how much it
-- wants, between one and five hundred rows. The join is for names — the
-- trail itself stays short and bounded by its own checks.
create function public.admin_audit(p_limit int default 100) returns setof jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_limit < 1 or p_limit > 500 then raise exception 'invalid_limit' using errcode='22023'; end if;
  return query
    select jsonb_build_object(
      'id', a.id, 'workspace_id', a.workspace_id, 'workspace_name', w.name,
      'actor_id', a.actor_id, 'actor_email', u.email,
      'action', a.action, 'target_type', a.target_type, 'target_id', a.target_id,
      'created_at', to_jsonb(a.created_at))
    from public.audit_events a
    join public.workspaces w on w.id = a.workspace_id
    left join auth.users u on u.id = a.actor_id
    order by a.created_at desc
    limit p_limit;
end $$;
revoke all on function public.admin_audit(int) from public, anon;
grant execute on function public.admin_audit(int) to authenticated;
