-- Revoking a worker credential had no route. Registering one has had a
-- service-role entry point since 20260914011500; retiring one still meant a
-- SQL console. On 2026-09-15 a worker running the pre-selection code somewhere
-- unreachable kept polling with both live credentials — it claimed the first
-- collect after the deploy and read the channel's newest uploads regardless
-- of the selection — and the only clean way to stop a process nobody can find
-- is to make its credential stop answering.
--
-- Retires every credential of the workspace except the ones named. Revoked,
-- not deleted: the row stays as the record that a credential existed, and
-- worker_workspace already refuses a revoked one with invalid_worker_credential.
create function private.retire_worker_credentials(w uuid, keep uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer; begin
  if not exists(select 1 from public.workspaces where id = w) then
    raise exception 'invalid_workspace' using errcode='23503'; end if;
  if keep is null or cardinality(keep) = 0 then
    -- Retiring every credential leaves the workspace with no worker at all;
    -- that is a decision to make explicitly, not by passing nothing.
    raise exception 'keep_at_least_one' using errcode='22023'; end if;
  if exists(select 1 from unnest(keep) k(id)
             where not exists(select 1 from private.worker_credentials c
                               where c.id = k.id and c.workspace_id = w and c.status = 'active')) then
    raise exception 'unknown_credential' using errcode='23503'; end if;
  update private.worker_credentials
     set status = 'revoked'
   where workspace_id = w and status = 'active' and not (id = any(keep));
  get diagnostics n = row_count;
  return n;
end $$;

create function public.svc_retire_worker_credentials(w uuid, keep uuid[])
returns integer language sql security invoker set search_path='' as $$
  select private.retire_worker_credentials(w, keep)
$$;

revoke all on function private.retire_worker_credentials(uuid,uuid[]),
  public.svc_retire_worker_credentials(uuid,uuid[]) from public, anon, authenticated;
grant execute on function private.retire_worker_credentials(uuid,uuid[]),
  public.svc_retire_worker_credentials(uuid,uuid[]) to service_role;
