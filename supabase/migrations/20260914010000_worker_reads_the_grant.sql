-- The worker had no way to reach the credential it needs to collect with.
--
-- A connected channel's tokens are sealed in private.oauth_connections, and the
-- worker holds neither the sealing key nor the service role — deliberately. So
-- the gateway fetches the sealed grant on the worker's behalf, opens it, and
-- hands down a short-lived access token. The refresh token and the sealing key
-- never leave the server.
--
-- The lookup is keyed on the worker's credential *and* the job, so a credential
-- cannot ask for a grant belonging to a workspace it does not own. As
-- everywhere else on this seam, there is no workspace argument to forge: it is
-- derived from the hashed credential inside the database.

create function private.worker_channel_grant(token_hash text, j uuid)
returns table(connection_id uuid, encrypted_tokens bytea, key_version text)
language plpgsql security invoker set search_path='' as $$
declare w uuid; begin
  w := private.worker_workspace(token_hash);
  return query
  select c.id, c.encrypted_tokens, c.key_version
  from private.oauth_connections c
  join public.jobs jb on jb.channel_id = c.channel_id and jb.workspace_id = c.workspace_id
  where jb.id = j and c.workspace_id = w and c.status = 'connected'
  order by c.id desc limit 1;
  if not found then
    -- A job on a channel nobody has connected is not an error to retry: there
    -- is nothing to collect with until someone authorises it.
    raise exception 'channel_not_connected' using errcode='42501'; end if;
end $$;

-- A renewed grant is written back, so the next claim does not renew again.
create function private.worker_store_grant(token_hash text, connection uuid, tokens bytea)
returns void language plpgsql security invoker set search_path='' as $$
declare w uuid; begin
  w := private.worker_workspace(token_hash);
  update private.oauth_connections set encrypted_tokens = tokens
  where id = connection and workspace_id = w and status = 'connected';
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
end $$;

-- Revocation is the worker's to report: it is the only thing that talks to
-- Google often enough to notice, and a channel that cannot be renewed must ask
-- to be reconnected rather than collect nothing in silence.
create function private.worker_mark_revoked(token_hash text, j uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare w uuid; ch uuid; begin
  w := private.worker_workspace(token_hash);
  select channel_id into ch from public.jobs where id = j and workspace_id = w;
  if ch is null then raise exception 'forbidden' using errcode='42501'; end if;
  perform private.oauth_mark_revoked(ch);
end $$;

create function public.svc_worker_channel_grant(credential_hash text, j uuid)
returns table(connection_id uuid, encrypted_tokens bytea, key_version text)
language sql security invoker set search_path='' as $$
  select * from private.worker_channel_grant(credential_hash, j)
$$;
create function public.svc_worker_store_grant(credential_hash text, connection uuid, tokens bytea)
returns void language sql security invoker set search_path='' as $$
  select private.worker_store_grant(credential_hash, connection, tokens)
$$;
create function public.svc_worker_mark_revoked(credential_hash text, j uuid)
returns void language sql security invoker set search_path='' as $$
  select private.worker_mark_revoked(credential_hash, j)
$$;

do $$ declare f text; begin
  foreach f in array array[
    'private.worker_channel_grant(text,uuid)',
    'private.worker_store_grant(text,uuid,bytea)',
    'private.worker_mark_revoked(text,uuid)',
    'public.svc_worker_channel_grant(text,uuid)',
    'public.svc_worker_store_grant(text,uuid,bytea)',
    'public.svc_worker_mark_revoked(text,uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
