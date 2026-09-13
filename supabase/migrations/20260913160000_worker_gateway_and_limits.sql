-- P3: a worker reaches the queue through a scoped credential, never with the
-- service role, and plan limits are checked on the server rather than in the UI.

alter table public.plans add column min_sync_interval_minutes integer not null default 0
  check (min_sync_interval_minutes >= 0);

-- One credential, one workspace. The allowed tenant is a property of the
-- credential, so no call can ask for a different one.
create table private.worker_credentials (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (length(token_hash) between 32 and 200),
  label text not null,
  workspace_id uuid not null references public.workspaces(id),
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
alter table private.worker_credentials enable row level security;
revoke all on private.worker_credentials from public, anon, authenticated;
grant all on private.worker_credentials to service_role;

create function private.worker_workspace(token_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare w uuid; begin
  update private.worker_credentials c set last_seen_at = now()
  where c.token_hash = worker_workspace.token_hash and c.status = 'active'
  returning c.workspace_id into w;
  if w is null then raise exception 'invalid_worker_credential' using errcode='42501'; end if;
  return w;
end $$;

create function private.worker_claim(token_hash text) returns setof public.jobs
language plpgsql security invoker set search_path='' as $$
begin
  return query select * from private.claim_job(private.worker_workspace(token_hash));
end $$;

-- Shared by every call that acts on a leased job: the credential must own the
-- job's workspace and the lease must still be live.
create function private.worker_job(token_hash text, j uuid, t uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare w uuid; owner uuid; begin
  w := private.worker_workspace(token_hash);
  select workspace_id into owner from public.jobs
  where id = j and lease_token = t and status = 'running' and lease_expires_at > now();
  if owner is null then raise exception 'lease_lost' using errcode='40001'; end if;
  if owner <> w then raise exception 'forbidden' using errcode='42501'; end if;
  return w;
end $$;

create function private.worker_heartbeat(token_hash text, j uuid, t uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  perform private.worker_job(token_hash, j, t);
  perform private.heartbeat(j, t);
end $$;

create function private.worker_commit_batch(
  token_hash text, j uuid, t uuid, b text, hash text, payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform private.worker_job(token_hash, j, t);
  return private.commit_batch(j, t, b, hash, payload);
end $$;

-- The worker declares how the job ended. Nothing here promotes a job to
-- succeeded on its own: exhausting retries leaves it failed, which is what the
-- claim path already records.
create function private.worker_finish(
  token_hash text, j uuid, t uuid, outcome text, reason text) returns void
language plpgsql security invoker set search_path='' as $$
begin
  perform private.worker_job(token_hash, j, t);
  if outcome not in ('succeeded','partial','failed','blocked','cancelled') then
    raise exception 'invalid_outcome' using errcode='22023'; end if;
  update public.jobs set status = outcome,
    error_code = case when outcome = 'succeeded' then null else reason end,
    -- Releasing the lease is what makes a finished job unwritable.
    lease_token = null, lease_expires_at = null
  where id = j;
end $$;

revoke all on function private.worker_workspace(text), private.worker_claim(text),
  private.worker_job(text,uuid,uuid), private.worker_heartbeat(text,uuid,uuid),
  private.worker_commit_batch(text,uuid,uuid,text,text,jsonb),
  private.worker_finish(text,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function private.worker_workspace(text), private.worker_claim(text),
  private.worker_job(text,uuid,uuid), private.worker_heartbeat(text,uuid,uuid),
  private.worker_commit_batch(text,uuid,uuid,text,text,jsonb),
  private.worker_finish(text,uuid,uuid,text,text) to service_role;

-- Plan limits, checked where the row is actually created rather than in the UI.
create function private.plan_limit(w uuid, which text) returns integer
language sql stable security definer set search_path='' as $$
  select case which
           when 'channels' then p.channels_limit
           when 'members' then p.members_limit
           when 'sync_interval' then p.min_sync_interval_minutes
         end
  from public.subscriptions s join public.plans p on p.key = s.plan_key
  where s.workspace_id = w and s.status = 'active';
$$;

create or replace function private.register_channel_impl(w uuid,c uuid,external text) returns uuid
language plpgsql security definer set search_path='' as $$
declare ch uuid; allowed int; begin
 if not private.has_role(w,array['workspace_owner','analyst']) then raise exception 'forbidden' using errcode='42501'; end if;
 if not exists(select 1 from public.clients where workspace_id=w and id=c) then raise exception 'invalid_client' using errcode='23503'; end if;
 if external !~ '^UC[A-Za-z0-9_-]{22}$' then raise exception 'invalid_channel_id' using errcode='22023'; end if;
 select id into ch from public.channels
 where workspace_id=w and platform='youtube' and external_channel_id=external and client_id=c;
 if ch is not null then return ch; end if;
 allowed := private.plan_limit(w,'channels');
 if allowed is not null
    and (select count(*) from public.channels where workspace_id=w) >= allowed then
   raise exception 'channel_limit_reached' using errcode='53400'; end if;
 insert into public.channels(workspace_id,client_id,external_channel_id) values(w,c,external)
 on conflict(workspace_id,platform,external_channel_id) do nothing returning id into ch;
 if ch is null then raise exception 'channel_claimed_by_other_client' using errcode='23505'; end if;
 return ch;
end $$;

create or replace function private.enqueue_sync_impl(w uuid,c uuid,k text) returns uuid
language plpgsql security definer set search_path='' as $$
declare j uuid; gap int; begin
 if not private.has_role(w,array['workspace_owner','analyst']) then raise exception 'forbidden' using errcode='42501'; end if;
 if not exists(select 1 from public.channels where workspace_id=w and id=c) then raise exception 'invalid_channel' using errcode='23503'; end if;
 -- An idempotent replay is not a new request, so it is answered before the
 -- rate limit rather than being refused for arriving twice.
 select id into j from public.jobs where workspace_id=w and dedupe_key=k and channel_id=c and type='collect';
 if j is not null then return j; end if;
 gap := private.plan_limit(w,'sync_interval');
 if gap is not null and gap > 0 and exists(
      select 1 from public.jobs where workspace_id=w and channel_id=c and type='collect'
        and created_at > now() - make_interval(mins => gap)) then
   raise exception 'sync_too_soon' using errcode='53400'; end if;
 insert into public.jobs(workspace_id,channel_id,type,dedupe_key) values(w,c,'collect',k)
 on conflict(workspace_id,dedupe_key) do nothing returning id into j;
 if j is null then raise exception 'idempotency_conflict' using errcode='23505'; end if;
 return j;
end $$;
