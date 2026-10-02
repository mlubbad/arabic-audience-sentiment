-- A collection run could outlive the access token it was handed.
--
-- The gateway renews at claim time, but a run over a large channel lasts
-- longer than the token it starts with, and the worker holds neither the
-- refresh token nor the sealing key — deliberately — so it could not renew
-- on its own. A run that hit a 401 half-way ended `credential_expired` and
-- gave up everything it had not yet committed.
--
-- This gives the worker one thing: the right to ask for a fresh short-lived
-- token against a lease it still holds. The validation is the same seam as
-- every other leased call — the credential must own the job's workspace and
-- the lease must still be live — so a credential still cannot ask for a
-- grant belonging to a workspace it does not own, and a lost lease still
-- ends the run rather than minting tokens for a job someone else holds.

create function private.worker_renew_grant(token_hash text, j uuid, t uuid)
returns table(connection_id uuid, encrypted_tokens bytea, key_version text)
language plpgsql security invoker set search_path='' as $$
declare w uuid; begin
  -- The same lease check every worker call makes: live lease, owned job.
  w := private.worker_job(token_hash, j, t);
  return query
  select c.id, c.encrypted_tokens, c.key_version
  from private.oauth_connections c
  join public.jobs jb on jb.channel_id = c.channel_id and jb.workspace_id = c.workspace_id
  where jb.id = j and c.workspace_id = w and c.status = 'connected'
  order by c.id desc limit 1;
  if not found then
    -- Same answer the claim path gives: a channel with no usable grant is a
    -- fact about the channel, and the worker stops asking for tokens.
    raise exception 'channel_not_connected' using errcode='42501'; end if;
end $$;

create function public.svc_worker_renew_grant(credential_hash text, j uuid, t uuid)
returns table(connection_id uuid, encrypted_tokens bytea, key_version text)
language sql security invoker set search_path='' as $$
  select * from private.worker_renew_grant(credential_hash, j, t)
$$;

do $$ declare f text; begin
  foreach f in array array[
    'private.worker_renew_grant(text,uuid,uuid)',
    'public.svc_worker_renew_grant(text,uuid,uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
