-- A platform reader: one OAuth grant that reads any public channel by id.
--
-- The public-channel path was built for a project API key (20260919180000),
-- and Google refused every key we could make: this account's credentials
-- project now issues only the new `AQ.` key format, and the YouTube Data API
-- v3 endpoint does not accept that format — 401 "API keys are not supported
-- by this API", verified with a correctly restricted key against an enabled
-- API, over both hosts, with the parameter and the header. The data itself
-- never needed the key: an OAuth grant with the readonly scope reads the
-- same public endpoints, and the platform already speaks OAuth fluently.
--
-- So the key becomes optional and the platform holds one reader grant of its
-- own — connected once by the operator through the ordinary consent flow.
-- Tenants keep adding channels by link or search without granting anything;
-- what changed is who the platform reads with, not what a tenant may ask for.
--
-- Provenance stays honest: rows read by id through the reader are still
-- public data (`youtube_data_api_public`), never filed as the owner's.

-- 1. The reader's grant store. Exactly one active row, platform-wide; the
-- sealed bytes are the same AES-GCM seal the channel connections use.
create table private.platform_reader (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  encrypted_tokens bytea not null,
  key_version text not null,
  granted_scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'retired')),
  connected_by uuid not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
comment on table private.platform_reader is
  'The platform''s own OAuth grant for reading public channel data by id. '
  'One active row; the seal is copied from an ordinary connection at promotion.';
create unique index one_active_platform_reader
  on private.platform_reader ((1)) where status = 'active';

-- 2. Promotion: the platform admin copies a live, connected grant — their own
-- — into the reader slot. The original connection is untouched; from here the
-- two seals renew independently, which is why the reader carries its own copy
-- rather than pointing at the connection. The platform-admin functions' own
-- pattern: definer in public, deciding for itself who may call it.
create function public.promote_platform_reader(w uuid, c uuid) returns void
language plpgsql security definer set search_path='' as $$
declare conn record; begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501'; end if;
  select id, encrypted_tokens, key_version, granted_scopes, connected_by into conn
    from private.oauth_connections
   where workspace_id = w and channel_id = c and status = 'connected'
   order by id desc limit 1;
  if not found then raise exception 'channel_not_connected' using errcode='22023'; end if;
  update private.platform_reader set status = 'retired', retired_at = now()
   where status = 'active';
  insert into private.platform_reader(connection_id, encrypted_tokens, key_version,
                                      granted_scopes, connected_by)
  values (conn.id, conn.encrypted_tokens, conn.key_version, conn.granted_scopes,
          conn.connected_by);
end $$;

-- 3. The worker's read seam, credential-gated exactly like the channel one:
-- any valid worker credential may read the reader, because every tenant's
-- public jobs are collected with it. Renewal writes back to the reader's own
-- row; a Google revocation retires the reader instead of touching any
-- channel's connection.
create function private.worker_reader_grant(token_hash text)
returns table(connection_id uuid, encrypted_tokens bytea, key_version text)
language plpgsql security invoker set search_path='' as $$
begin
  perform private.worker_workspace(token_hash);
  -- connection_id here is the reader row's own id — the handle renewals and
  -- revocation write back to — not the connection the seal was copied from.
  return query select r.id, r.encrypted_tokens, r.key_version
    from private.platform_reader r
   where r.status = 'active' order by r.created_at desc limit 1;
end $$;

create function private.worker_store_reader_grant(token_hash text, connection uuid, tokens bytea)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform private.worker_workspace(token_hash);
  update private.platform_reader set encrypted_tokens = tokens
   where id = connection and status = 'active';
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
end $$;

create function private.worker_reader_revoked(token_hash text, connection uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform private.worker_workspace(token_hash);
  update private.platform_reader set status = 'retired', retired_at = now()
   where id = connection and status = 'active';
end $$;

create function public.svc_worker_reader_grant(credential_hash text)
returns table(connection_id uuid, encrypted_tokens bytea, key_version text)
language sql security invoker set search_path='' as $$
  select * from private.worker_reader_grant(credential_hash) $$;
create function public.svc_worker_store_reader_grant(credential_hash text, connection uuid, tokens bytea)
returns void language sql security invoker set search_path='' as $$
  select private.worker_store_reader_grant(credential_hash, connection, tokens) $$;
create function public.svc_worker_reader_revoked(credential_hash text, connection uuid)
returns void language sql security invoker set search_path='' as $$
  select private.worker_reader_revoked(credential_hash, connection) $$;

-- 4. The lookup door. The channel-lookup function runs on the caller's JWT,
-- so it needs the sealed reader through an invoker-visible wrapper; the seal
-- is useless without the platform's signing key, which never leaves the
-- functions. Signed-in callers only — anon gets nothing.
create function public.channel_lookup_reader_grant()
returns table(connection_id uuid, encrypted_tokens bytea, key_version text)
language sql security definer set search_path='' as $$
  select r.id, r.encrypted_tokens, r.key_version
    from private.platform_reader r
   where r.status = 'active' order by r.created_at desc limit 1 $$;

do $$ declare f text; begin
  foreach f in array array[
    'private.worker_reader_grant(text)',
    'private.worker_store_reader_grant(text,uuid,bytea)',
    'private.worker_reader_revoked(text,uuid)',
    'public.svc_worker_reader_grant(text)',
    'public.svc_worker_store_reader_grant(text,uuid,bytea)',
    'public.svc_worker_reader_revoked(text,uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function public.channel_lookup_reader_grant() from public, anon;
grant execute on function public.channel_lookup_reader_grant() to authenticated;
