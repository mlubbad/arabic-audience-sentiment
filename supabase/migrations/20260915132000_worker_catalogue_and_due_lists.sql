-- claim_job, rebuilt byte-for-byte from 20260914200000 with one change: the
-- run it opens takes its mode from the job's type instead of the literal
-- 'collect'. Everything else is what production runs.
create or replace function private.claim_job(w uuid) returns setof public.jobs
language plpgsql security invoker set search_path='' as $$
declare claimed public.jobs;
begin
  insert into public.worker_seen(workspace_id, last_seen_at)
  values (w, now())
  on conflict (workspace_id) do update set last_seen_at = now();

  update public.jobs set
      status = 'failed',
      error_code = case
        when reclaims >= 20
          then 'lease_thrashing:' || reclaims::text
        else 'retry_exhausted:' || coalesce(last_error, 'no_error_recorded')
      end,
      lease_token = null,
      lease_expires_at = null
   where workspace_id = w
     and status in ('queued', 'running')
     and (attempt >= 3 or reclaims >= 20)
     and (lease_expires_at is null or lease_expires_at <= now());

  update public.jobs j set
      status = 'running',
      attempt = j.attempt + case when j.status = 'queued' then 1 else 0 end,
      reclaims = j.reclaims + case when j.status = 'running' then 1 else 0 end,
      not_before = case
        when j.status = 'running' and j.reclaims >= 1
          then now() + least(interval '30 seconds' * (2 ^ least(j.reclaims, 5)),
                             interval '10 minutes')
        else j.not_before end,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '5 minutes'
   where j.id = (
     select q.id from public.jobs q
      where q.workspace_id = w
        and q.attempt < 3
        and q.reclaims < 20
        and q.not_before <= now()
        and (q.status = 'queued'
             or (q.status = 'running' and q.lease_expires_at <= now()))
      order by q.not_before, q.id
      for update skip locked limit 1)
  returning j.* into claimed;

  if claimed.id is null then return; end if;

  insert into public.sync_runs(workspace_id, channel_id, job_id, mode, source,
                               status)
  values (claimed.workspace_id, claimed.channel_id, claimed.id,
          case when claimed.type in ('discover','collect','analyse','import')
               then claimed.type else 'collect' end,
          'unknown', 'running')
  on conflict (workspace_id, job_id) do update
    set status = 'running', ended_at = null, error_code = null;

  return next claimed;
end $$;
grant execute on function private.claim_job(uuid) to service_role;

-- What this claimed collect job should read.
create function private.worker_due_videos(token_hash text, j uuid, t uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid; c uuid; begin
  w := private.worker_job(token_hash, j, t);
  select channel_id into c from public.jobs where id = j;
  return private.due_videos(w, c);
end $$;

-- A catalogue batch: every item must be well-formed or none is written.
create function private.worker_commit_catalogue(token_hash text, j uuid, t uuid, payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w uuid; c uuid; n int; begin
  w := private.worker_job(token_hash, j, t);
  select channel_id into c from public.jobs where id = j;
  if payload is null or jsonb_typeof(payload) <> 'array' then
    raise exception 'invalid_catalogue' using errcode='22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(payload) i
     where jsonb_typeof(i) <> 'object'
        or coalesce(i->>'external_video_id','') !~ '^[A-Za-z0-9_-]{11}$'
        or (i ? 'kind' and i->>'kind' not in ('video','short','stream'))
        or (i ? 'reported_comment_count'
            and jsonb_typeof(i->'reported_comment_count') not in ('number','null'))
        or (i ? 'published_at' and jsonb_typeof(i->'published_at') not in ('string','null'))
        or (i ? 'field_provenance' and jsonb_typeof(i->'field_provenance') <> 'object')) then
    raise exception 'invalid_catalogue' using errcode='22023'; end if;

  insert into public.videos(workspace_id, channel_id, external_video_id, title, kind,
    published_at, duration_sec, thumbnail_url, reported_comment_count, comments_state,
    catalogued_at, last_observed_at, field_provenance)
  select w, c, i->>'external_video_id',
         coalesce(nullif(i->>'title',''), i->>'external_video_id'),
         coalesce(i->>'kind', 'video'),
         (i->>'published_at')::timestamptz,
         (i->>'duration_sec')::int,
         i->>'thumbnail_url',
         (i->>'reported_comment_count')::int,
         -- Absent or null count: comments are switched off on the source.
         case when jsonb_typeof(i->'reported_comment_count') = 'number'
              then 'open' else 'disabled' end,
         now(), now(), coalesce(i->'field_provenance', '{}'::jsonb)
    from jsonb_array_elements(payload) i
  on conflict (workspace_id, platform, external_video_id) do update set
    -- The best name known, as 20260914060000 decided for commits.
    title = case when excluded.title <> excluded.external_video_id
                 then excluded.title else public.videos.title end,
    kind = excluded.kind,
    published_at = coalesce(excluded.published_at, public.videos.published_at),
    duration_sec = coalesce(excluded.duration_sec, public.videos.duration_sec),
    thumbnail_url = coalesce(excluded.thumbnail_url, public.videos.thumbnail_url),
    reported_comment_count = excluded.reported_comment_count,
    comments_state = excluded.comments_state,
    catalogued_at = now(), last_observed_at = now(),
    field_provenance = public.videos.field_provenance || excluded.field_provenance;
  get diagnostics n = row_count;

  update public.channels set catalogued_at = now() where workspace_id = w and id = c;
  update public.sync_runs set coverage_summary = jsonb_build_object(
      'videos_found', (select count(*) from jsonb_array_elements(payload)),
      'by_kind', (select coalesce(jsonb_object_agg(k, cnt), '{}'::jsonb)
                    from (select coalesce(i->>'kind','video') k, count(*) cnt
                            from jsonb_array_elements(payload) i group by 1) x))
   where workspace_id = w and job_id = j;
  return jsonb_build_object('videos', n);
end $$;

-- One video's end. exhausted schedules the next check; comments_disabled is
-- learned back into the catalogue; anything else stays due so the next run
-- tries again.
create function private.worker_video_finished(
  token_hash text, j uuid, t uuid, v uuid, outcome text, reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare w uuid; iv int; begin
  w := private.worker_job(token_hash, j, t);
  if outcome not in ('exhausted','partial','blocked','failed') then
    raise exception 'invalid_outcome' using errcode='22023'; end if;
  if not exists(select 1 from public.videos where workspace_id = w and id = v) then
    raise exception 'invalid_video' using errcode='23503'; end if;
  iv := coalesce(private.plan_limit(w, 'live_interval'), 1440);
  if outcome = 'exhausted' then
    update public.video_selections
       set last_collected_at = now(), last_outcome = 'exhausted',
           next_check_at = now() + make_interval(mins => iv)
     where workspace_id = w and video_id = v;
    update public.videos set comments_state = 'open' where workspace_id = w and id = v;
  elsif reason = 'comments_disabled' then
    update public.videos set comments_state = 'disabled' where workspace_id = w and id = v;
    update public.video_selections set last_outcome = 'comments_disabled'
     where workspace_id = w and video_id = v;
  else
    update public.video_selections set last_outcome = coalesce(reason, outcome)
     where workspace_id = w and video_id = v;
  end if;
end $$;

-- Enqueue under the one-outstanding rule and the plan's rate limit, silently:
-- the tick is called on a schedule and has nobody to tell.
create function private.enqueue_scheduled(w uuid, c uuid, kind text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare j uuid; gap int; begin
  if exists(select 1 from public.jobs where workspace_id=w and channel_id=c and type=kind
             and status in ('queued','running')) then return null; end if;
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

create function private.schedule_due_work(w uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ch record; d int := 0; k int := 0; cat int; begin
  cat := coalesce(private.plan_limit(w, 'catalogue_interval'), 1440);
  for ch in select id, catalogued_at from public.channels
             where workspace_id = w and status = 'connected' loop
    if ch.catalogued_at is null
       or ch.catalogued_at < now() - make_interval(mins => cat) then
      if private.enqueue_scheduled(w, ch.id, 'discover') is not null then d := d + 1; end if;
    end if;
    if jsonb_array_length(private.due_videos(w, ch.id)) > 0 then
      if private.enqueue_scheduled(w, ch.id, 'collect') is not null then k := k + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('discover', d, 'collect', k);
end $$;

create function private.worker_tick(token_hash text) returns jsonb
language sql security invoker set search_path='' as $$
  select private.schedule_due_work(private.worker_workspace(token_hash))
$$;

-- For pg_cron, when the operator enables it on the project:
--   select cron.schedule('sentiment-tick', '17 * * * *', $$select private.schedule_all()$$);
create function private.schedule_all() returns void
language plpgsql security definer set search_path='' as $$
declare w uuid; begin
  for w in select workspace_id from public.subscriptions where status = 'active' loop
    perform private.schedule_due_work(w);
  end loop;
end $$;

create function public.svc_worker_due_videos(credential_hash text, j uuid, t uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.worker_due_videos(credential_hash, j, t) $$;
create function public.svc_worker_commit_catalogue(credential_hash text, j uuid, t uuid, payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.worker_commit_catalogue(credential_hash, j, t, payload) $$;
create function public.svc_worker_video_finished(
  credential_hash text, j uuid, t uuid, v uuid, outcome text, error_code text)
returns void language sql security invoker set search_path='' as $$
  select private.worker_video_finished(credential_hash, j, t, v, outcome, error_code) $$;
create function public.svc_worker_tick(credential_hash text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.worker_tick(credential_hash) $$;

revoke all on function
  private.worker_due_videos(text,uuid,uuid), private.worker_commit_catalogue(text,uuid,uuid,jsonb),
  private.worker_video_finished(text,uuid,uuid,uuid,text,text), private.enqueue_scheduled(uuid,uuid,text),
  private.schedule_due_work(uuid), private.worker_tick(text), private.schedule_all(),
  public.svc_worker_due_videos(text,uuid,uuid), public.svc_worker_commit_catalogue(text,uuid,uuid,jsonb),
  public.svc_worker_video_finished(text,uuid,uuid,uuid,text,text), public.svc_worker_tick(text)
  from public, anon, authenticated;
grant execute on function
  private.worker_due_videos(text,uuid,uuid), private.worker_commit_catalogue(text,uuid,uuid,jsonb),
  private.worker_video_finished(text,uuid,uuid,uuid,text,text), private.enqueue_scheduled(uuid,uuid,text),
  private.schedule_due_work(uuid), private.worker_tick(text), private.schedule_all(),
  public.svc_worker_due_videos(text,uuid,uuid), public.svc_worker_commit_catalogue(text,uuid,uuid,jsonb),
  public.svc_worker_video_finished(text,uuid,uuid,uuid,text,text), public.svc_worker_tick(text)
  to service_role;

-- oauth_attach_channel_for, rebuilt from 20260915110000 with one addition at
-- the end: a fresh connection queues its first discovery.
create or replace function private.oauth_attach_channel_for(
  u uuid, w uuid, c uuid, external_channel text, tokens bytea,
  key_version text, scopes text[],
  channel_handle text default null, channel_title text default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare ch uuid; begin
  if external_channel !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise exception 'invalid_channel_id' using errcode='22023'; end if;
  if exists(select 1 from public.channels
            where platform='youtube' and external_channel_id=external_channel
              and status='connected' and workspace_id <> w) then
    raise exception 'channel_already_connected' using errcode='23505'; end if;

  -- A name Google did not send this time does not erase one it sent before:
  -- a reconnect after a lapsed grant should not cost the reader the label.
  update public.channels set status='connected', client_id=c,
    handle=coalesce(channel_handle, handle),
    title=coalesce(channel_title, title)
  where workspace_id=w and platform='youtube'
    and external_channel_id=external_channel
  returning id into ch;
  if ch is null then
    insert into public.channels(workspace_id,client_id,external_channel_id,status,handle,title)
    values (w, c, external_channel, 'connected', channel_handle, channel_title)
    returning id into ch;
  end if;

  -- The grant being stored replaces whatever was live. Retired, not deleted:
  -- the row stays as the record that a connection existed.
  update private.oauth_connections set status='superseded'
  where channel_id=ch and status='connected';

  insert into private.oauth_connections(
    workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
  values (w, ch, u, tokens, key_version, scopes, 'connected');

  perform private.enqueue_scheduled(w, ch, 'discover');
  return ch;
end $$;
