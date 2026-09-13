-- `id` named both a PL/pgSQL variable and the column being returned, so the
-- insert raised 42702 rather than registering anything. Renamed; the behaviour
-- is otherwise unchanged.
--
-- Worth a migration of its own rather than an edit: the previous one has been
-- applied, and a migration that has run anywhere is not rewritten.

create or replace function private.register_worker_credential(
  secret text, label text, w uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid; begin
  if secret is null or length(secret) < 32 then
    raise exception 'weak_credential' using errcode='22023'; end if;
  if not exists(select 1 from public.workspaces where id = w) then
    raise exception 'invalid_workspace' using errcode='23503'; end if;
  insert into private.worker_credentials(token_hash, label, workspace_id)
  values (encode(extensions.digest(secret, 'sha256'), 'hex'), label, w)
  returning private.worker_credentials.id into new_id;
  return new_id;
end $$;
