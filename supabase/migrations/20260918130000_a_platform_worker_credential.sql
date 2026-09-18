-- A platform worker credential: one credential that serves every workspace.
--
-- Until now a credential was bound to one workspace (20260913160000), and the
-- worker held one per tenant: WORKER_CREDENTIAL and WORKER_CREDENTIAL_WS2 in
-- scripts/worker-service.sh. A workspace a signup created had none, so nothing
-- ever asked for its jobs, and its page said «الجمع متوقّف الآن» for good. On
-- 2026-09-17 a deleted test workspace also took one of the two live
-- credentials with it (delete_workspace deletes them by workspace), and the
-- worker has been refused on it every minute since.
--
-- The wire contract never carries a workspace — the worker sends a bearer and
-- job ids and the database derives the tenant — so a credential that resolves
-- to "any workspace" needs no gateway, worker, contract or UI change. Design:
-- docs/superpowers/specs/2026-09-18-platform-worker-credential-design.md.
--
-- Every create or replace below is a whole-body rewrite from the function's
-- current definition (the file named at each), with only the named change.

-- 1. The column. Null is a platform credential.
alter table private.worker_credentials alter column workspace_id drop not null;
comment on column private.worker_credentials.workspace_id is
  'The one workspace this credential may touch; null is a platform credential, which serves every workspace.';

-- 2. Registration and retirement of platform credentials, beside the scoped
-- doors of 20260914012000 and 20260915160000. Service role only, like them.
create function private.register_platform_worker_credential(secret text, label text)
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid; begin
  if secret is null or length(secret) < 32 then
    raise exception 'weak_credential' using errcode='22023'; end if;
  insert into private.worker_credentials(token_hash, label, workspace_id)
  values (encode(extensions.digest(secret, 'sha256'), 'hex'), label, null)
  returning private.worker_credentials.id into new_id;
  return new_id;
end $$;

create function public.svc_register_platform_worker_credential(secret text, label text)
returns uuid language sql security invoker set search_path='' as $$
  select private.register_platform_worker_credential(secret, label)
$$;

-- Retires every platform credential except the ones named. Revoked, not
-- deleted, as for scoped ones: the row stays as the record that a credential
-- existed. keep_at_least_one on an empty list — a platform with no worker at
-- all is a decision to make explicitly, in a console, not by passing nothing.
create function private.retire_platform_worker_credentials(keep uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer; begin
  if keep is null or cardinality(keep) = 0 then
    raise exception 'keep_at_least_one' using errcode='22023'; end if;
  if exists(select 1 from unnest(keep) k(id)
             where not exists(select 1 from private.worker_credentials c
                               where c.id = k.id and c.workspace_id is null and c.status = 'active')) then
    raise exception 'unknown_credential' using errcode='23503'; end if;
  update private.worker_credentials
     set status = 'revoked'
   where workspace_id is null and status = 'active' and not (id = any(keep));
  get diagnostics n = row_count;
  return n;
end $$;

create function public.svc_retire_platform_worker_credentials(keep uuid[])
returns integer language sql security invoker set search_path='' as $$
  select private.retire_platform_worker_credentials(keep)
$$;

revoke all on function private.register_platform_worker_credential(text,text),
  public.svc_register_platform_worker_credential(text,text),
  private.retire_platform_worker_credentials(uuid[]),
  public.svc_retire_platform_worker_credentials(uuid[]) from public, anon, authenticated;
grant execute on function private.register_platform_worker_credential(text,text),
  public.svc_register_platform_worker_credential(text,text),
  private.retire_platform_worker_credentials(uuid[]),
  public.svc_retire_platform_worker_credentials(uuid[]) to service_role;

-- 3. worker_workspace, rebuilt from 20260913160000:22-30 with one change: an
-- active row whose workspace is null is a platform credential and answers
-- null, so "no row" and "a platform row" are told apart by a marker rather
-- than by the workspace being null.
create or replace function private.worker_workspace(token_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare w uuid; matched boolean; begin
  update private.worker_credentials c set last_seen_at = now()
  where c.token_hash = worker_workspace.token_hash and c.status = 'active'
  returning c.workspace_id, true into w, matched;
  if matched is not true then raise exception 'invalid_worker_credential' using errcode='42501'; end if;
  return w;
end $$;

-- 4. claim_job, rebuilt from 20260915132000:4-60 with two changes: a null
-- workspace means every workspace — the reaper and the claim read
-- (w is null or workspace_id = w), and the order across tenants is the one
-- already used within one, oldest due first — and the sighting a platform
-- poll leaves is a row for every workspace, because that poll asked them
-- all. worker_seen's own comment stays true: the last time a worker asked
-- this workspace for work.
create or replace function private.claim_job(w uuid) returns setof public.jobs
language plpgsql security invoker set search_path='' as $$
declare claimed public.jobs;
begin
  if w is null then
    insert into public.worker_seen(workspace_id, last_seen_at)
    select ws.id, now() from public.workspaces ws
    on conflict (workspace_id) do update set last_seen_at = now();
  else
    insert into public.worker_seen(workspace_id, last_seen_at)
    values (w, now())
    on conflict (workspace_id) do update set last_seen_at = now();
  end if;

  update public.jobs set
      status = 'failed',
      error_code = case
        when reclaims >= 20
          then 'lease_thrashing:' || reclaims::text
        else 'retry_exhausted:' || coalesce(last_error, 'no_error_recorded')
      end,
      lease_token = null,
      lease_expires_at = null
   where (w is null or workspace_id = w)
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
      where (w is null or q.workspace_id = w)
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
