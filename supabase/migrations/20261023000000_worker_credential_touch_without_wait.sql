-- Stop worker requests from queueing behind one another on their credential.
--
-- `private.worker_workspace` authenticated a request by UPDATE-ing the
-- credential's row (`last_seen_at = now()`), and every worker request goes
-- through it: claim, heartbeat, commit, finish, tick. An UPDATE holds the row's
-- lock until the transaction ends, so a request using a credential waited for
-- every other request in flight with the same credential. `svc_worker_tick`
-- holds that lock for the whole of `schedule_due_work` (5.6 s on average,
-- `pg_stat_statements`, owner's SQL editor, 2026-10-13), and a claim or a
-- commit arriving meanwhile sat behind it until the 8 s statement timeout:
-- `control_plane_error:57014` on the Mac and the Oracle worker alike, and a
-- maximum within 0.3 s of 8 s for every worker RPC in the same report.
--
-- 1. worker_workspace, rebuilt from 20260918130000_a:80-88 with one change:
--    the credential is read, not updated, and `last_seen_at` is touched at
--    most once a minute and only when no other request holds the row
--    (`skip locked`). Nothing reads `worker_credentials.last_seen_at` but a
--    person looking at the table, which a minute's resolution serves. A null
--    workspace (the platform credential) still means every workspace; an
--    unknown or revoked credential is still refused with 42501.
-- 2. svc_worker_tick gets its own statement timeout. PostgREST applies one set
--    on the function the RPC names (20261011000000), and the tick otherwise
--    runs under the 8 s it was being cancelled at. 25 s stays inside the
--    worker's 30 s HTTP timeout, so a slow tick is answered, not abandoned.
--    With (1) a long tick no longer delays any other request.

create or replace function private.worker_workspace(token_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare w uuid; cred uuid; begin
  select c.id, c.workspace_id into cred, w
    from private.worker_credentials c
   where c.token_hash = worker_workspace.token_hash and c.status = 'active';
  if cred is null then raise exception 'invalid_worker_credential' using errcode='42501'; end if;
  update private.worker_credentials c set last_seen_at = now()
   where c.id = (select x.id from private.worker_credentials x
                  where x.id = cred
                    and (x.last_seen_at is null
                         or x.last_seen_at < now() - interval '1 minute')
                  for update skip locked);
  return w;
end $$;

alter function public.svc_worker_tick(text) set statement_timeout = '25s';
