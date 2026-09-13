-- The Edge Functions could not reach any of the primitives they exist to call.
--
-- PostgREST exposes `public` and `graphql_public` only, and every worker and
-- callback primitive lives in `private`. So the gateway and the OAuth callback
-- had no route to the database at all — the handlers were complete and
-- unreachable.
--
-- Wrappers, not a schema exposure. Putting `private` on the API would publish
-- every internal function to anyone holding any key; these publish exactly the
-- five the functions call, each revoked from anon and authenticated and granted
-- to service_role alone. A tenant key reaching any of them gets
-- "permission denied for function", which is asserted rather than assumed.
--
-- None of them takes a workspace from the caller. The worker's tenant comes
-- from its hashed credential and the callback's from the consumed state, so
-- there is still no field on any of these a caller could forge.

create function public.svc_oauth_consume_state(state_hash text)
returns table(user_id uuid, workspace_id uuid, client_id uuid, code_verifier text)
language sql security invoker set search_path='' as $$
  select * from private.oauth_consume_state(state_hash)
$$;

create function public.svc_oauth_attach_channel(
  u uuid, w uuid, c uuid, external_channel text, tokens bytea,
  key_version text, scopes text[])
returns uuid language sql security invoker set search_path='' as $$
  select private.oauth_attach_channel_for(u, w, c, external_channel, tokens, key_version, scopes)
$$;

create function public.svc_worker_claim(credential_hash text)
returns setof public.jobs language sql security invoker set search_path='' as $$
  select * from private.worker_claim(credential_hash)
$$;

create function public.svc_worker_heartbeat(credential_hash text, j uuid, t uuid)
returns void language sql security invoker set search_path='' as $$
  select private.worker_heartbeat(credential_hash, j, t)
$$;

create function public.svc_worker_commit_batch(
  credential_hash text, j uuid, t uuid, b text, hash text, payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.worker_commit_batch(credential_hash, j, t, b, hash, payload)
$$;

create function public.svc_worker_finish(
  credential_hash text, j uuid, t uuid, outcome text, error_code text)
returns void language sql security invoker set search_path='' as $$
  select private.worker_finish(credential_hash, j, t, outcome, error_code)
$$;

do $$ declare f text; begin
  foreach f in array array[
    'public.svc_oauth_consume_state(text)',
    'public.svc_oauth_attach_channel(uuid,uuid,uuid,text,bytea,text,text[])',
    'public.svc_worker_claim(text)',
    'public.svc_worker_heartbeat(text,uuid,uuid)',
    'public.svc_worker_commit_batch(text,uuid,uuid,text,text,jsonb)',
    'public.svc_worker_finish(text,uuid,uuid,text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
