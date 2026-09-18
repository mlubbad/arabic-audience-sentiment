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
