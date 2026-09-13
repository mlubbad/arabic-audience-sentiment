-- Registering a worker had no route either.
--
-- private.worker_credentials holds only the hash of a credential, which is
-- right: a database read must not yield a working worker token. But PostgREST
-- exposes public alone, so there was no way to create one without opening a SQL
-- console — and the hashing would then be done by whoever typed it.
--
-- The hash is computed here, from a secret the caller supplies, so the plain
-- credential exists in exactly two places: the caller's hand and the worker's
-- environment. It is never stored and never returned.
--
-- Service role only. A tenant creating worker credentials for its own workspace
-- would be handing out collection rights, and nothing about the product asks
-- for that yet.

create function private.register_worker_credential(
  secret text, label text, w uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid; begin
  if secret is null or length(secret) < 32 then
    -- A short secret is a guessable one, and this credential authenticates a
    -- process that can write comments into a tenant's workspace.
    raise exception 'weak_credential' using errcode='22023'; end if;
  if not exists(select 1 from public.workspaces where id = w) then
    raise exception 'invalid_workspace' using errcode='23503'; end if;
  insert into private.worker_credentials(token_hash, label, workspace_id)
  values (encode(extensions.digest(secret, 'sha256'), 'hex'), label, w)
  returning private.worker_credentials.id into id;
  return id;
end $$;

create function public.svc_register_worker_credential(
  secret text, label text, w uuid)
returns uuid language sql security invoker set search_path='' as $$
  select private.register_worker_credential(secret, label, w)
$$;

revoke all on function private.register_worker_credential(text,text,uuid),
  public.svc_register_worker_credential(text,text,uuid)
  from public, anon, authenticated;
grant execute on function private.register_worker_credential(text,text,uuid),
  public.svc_register_worker_credential(text,text,uuid) to service_role;
