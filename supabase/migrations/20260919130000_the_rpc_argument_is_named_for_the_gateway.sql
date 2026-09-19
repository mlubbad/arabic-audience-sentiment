-- The gateway's argument is named for the gateway.
--
-- 20260919120000 added the scoped claim RPC with its first parameter named
-- token_hash, the private schema's name for it. The gateway sends
-- credential_hash — the name the single-argument door beside it has always
-- used — and PostgREST resolves RPCs by parameter name, so every scoped claim
-- answered PGRST202 the moment it was deployed. PostgreSQL refuses to rename
-- an input parameter in place, so the two-argument overload is dropped and
-- rebuilt with the name the wire contract uses. The old file is not edited:
-- migrations are immutable once applied.
drop function public.svc_worker_claim(token_hash text, job_types text[]);

create function public.svc_worker_claim(credential_hash text, job_types text[])
returns setof public.jobs language sql security invoker set search_path='' as $$
  select * from private.claim_job(private.worker_workspace(credential_hash), job_types)
$$;
revoke all on function public.svc_worker_claim(text, text[]) from public, anon, authenticated;
grant execute on function public.svc_worker_claim(text, text[]) to service_role;

-- The introspection probes this fault was found with. They answer 42 and are
-- nobody's API.
drop function public.__pgrst_probe();
drop function public.__pgrst_probe2(text);
drop function public.__pgrst_probe2(text, text[]);
