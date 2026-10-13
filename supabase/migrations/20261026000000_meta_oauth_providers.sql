-- OAuth states carry a provider, pending grants carry a platform.
--
-- Until now every connection was a Google one: the state row did not say
-- which consent screen it was bound for, the pending row assumed a YouTube
-- channel id, and the attach step filed the channel under platform
-- 'youtube'. Facebook pages and Instagram accounts connect through the
-- same state → ticket → nonce machinery, so the rows now say which door
-- they came through. Every caller that passed five arguments keeps working
-- and means Google, as before; the old signatures are dropped rather than
-- overloaded so PostgREST has exactly one candidate per name.

alter table private.oauth_states
  add column provider text not null default 'google'
  check (provider in ('google', 'facebook', 'instagram'));

alter table private.oauth_pending
  add column platform text not null default 'youtube'
  check (platform in ('youtube', 'facebook', 'instagram'));

-- 1. Start: the provider is stored with the state.
drop function public.oauth_start(uuid, uuid, text, text, text);
drop function private.oauth_start_impl(uuid, uuid, text, text, text);

create function private.oauth_start_impl(
  w uuid, c uuid, state_hash text, verifier text, browser_nonce_hash text,
  p_provider text default 'google')
returns text language plpgsql security definer set search_path='' as $$
begin
  if not private.has_role(w, array['workspace_owner']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where workspace_id=w and id=c) then
    raise exception 'invalid_client' using errcode='23503'; end if;
  if state_hash is null or length(state_hash) <> 64 then
    raise exception 'invalid_state' using errcode='22023'; end if;
  if verifier is null or length(verifier) not between 43 and 128
     or verifier !~ '^[A-Za-z0-9._~-]+$' then
    raise exception 'invalid_verifier' using errcode='22023'; end if;
  if browser_nonce_hash is null or length(browser_nonce_hash) <> 64
     or browser_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_browser_nonce' using errcode='22023'; end if;
  if p_provider is null or p_provider not in ('google', 'facebook', 'instagram') then
    raise exception 'invalid_provider' using errcode='22023'; end if;
  insert into private.oauth_states(
    state_hash,user_id,workspace_id,client_id,expires_at,code_verifier,browser_nonce_hash,provider)
  values (
    state_hash,(select auth.uid()),w,c,now()+interval '10 minutes',verifier,browser_nonce_hash,p_provider);
  return state_hash;
end $$;

create function public.oauth_start(
  w uuid, c uuid, state_hash text, verifier text, browser_nonce_hash text,
  p_provider text default 'google')
returns text language sql security invoker set search_path='' as $$
  select private.oauth_start_impl(w,c,state_hash,verifier,browser_nonce_hash,p_provider)
$$;

-- 2. Consume: the service learns which provider's code it is holding.
drop function public.svc_oauth_consume_state(text);
drop function private.oauth_consume_state(text);

create function private.oauth_consume_state(state_hash text)
returns table(
  state_id uuid, user_id uuid, workspace_id uuid, client_id uuid,
  code_verifier text, browser_nonce_hash text, provider text)
language plpgsql security invoker set search_path='' as $$
begin
  return query
  update private.oauth_states s set consumed_at=now()
  where s.state_hash=oauth_consume_state.state_hash
    and s.consumed_at is null and s.expires_at>now()
  returning s.id,s.user_id,s.workspace_id,s.client_id,s.code_verifier,s.browser_nonce_hash,s.provider;
  if not found then raise exception 'invalid_state' using errcode='42501'; end if;
end $$;

create function public.svc_oauth_consume_state(state_hash text)
returns table(
  state_id uuid, user_id uuid, workspace_id uuid, client_id uuid,
  code_verifier text, browser_nonce_hash text, provider text)
language sql security invoker set search_path='' as $$
  select * from private.oauth_consume_state(state_hash)
$$;

-- 3. Pending: the id is checked by the platform it belongs to.
drop function public.svc_oauth_create_pending(uuid,text,text,bytea,text,text[],text,text);
drop function private.oauth_create_pending(uuid,text,text,bytea,text,text[],text,text);

create function private.oauth_create_pending(
  pending_state_id uuid, pending_ticket_hash text, pending_external_channel text,
  pending_tokens bytea, pending_key_version text, pending_scopes text[],
  pending_channel_handle text default null, pending_channel_title text default null,
  pending_platform text default 'youtube')
returns void language plpgsql security definer set search_path='' as $$
begin
  if pending_ticket_hash is null or length(pending_ticket_hash) <> 64 then
    raise exception 'invalid_ticket' using errcode='22023'; end if;
  if pending_platform is null or pending_platform not in ('youtube', 'facebook', 'instagram') then
    raise exception 'invalid_platform' using errcode='22023'; end if;
  -- A YouTube channel id is a UC id; a Meta page or account id is numeric.
  if pending_platform = 'youtube' then
    if pending_external_channel !~ '^UC[A-Za-z0-9_-]{22}$' then
      raise exception 'invalid_channel_id' using errcode='22023'; end if;
  elsif pending_external_channel !~ '^[0-9]{1,64}$' then
    raise exception 'invalid_channel_id' using errcode='22023';
  end if;
  if not exists(
    select 1 from private.oauth_states s
    where s.id=pending_state_id and s.consumed_at is not null) then
    raise exception 'invalid_state' using errcode='42501'; end if;
  insert into private.oauth_pending(
    state_id,ticket_hash,external_channel,channel_handle,channel_title,
    encrypted_tokens,key_version,granted_scopes,expires_at,platform)
  values (
    pending_state_id,pending_ticket_hash,pending_external_channel,
    pending_channel_handle,pending_channel_title,pending_tokens,
    pending_key_version,pending_scopes,now()+interval '10 minutes',pending_platform);
end $$;

create function public.svc_oauth_create_pending(
  state_id uuid, ticket_hash text, external_channel text, tokens bytea,
  key_version text, scopes text[], channel_handle text default null,
  channel_title text default null, pending_platform text default 'youtube')
returns void language sql security invoker set search_path='' as $$
  select private.oauth_create_pending(
    state_id,ticket_hash,external_channel,tokens,key_version,scopes,
    channel_handle,channel_title,pending_platform)
$$;

-- 4. Attach: the channel is keyed by (platform, external id).
drop function private.oauth_attach_channel_for(uuid,uuid,uuid,text,bytea,text,text[],text,text);

create function private.oauth_attach_channel_for(
  u uuid, w uuid, c uuid, external_channel text, tokens bytea,
  key_version text, scopes text[],
  channel_handle text default null, channel_title text default null,
  p_platform text default 'youtube')
returns uuid language plpgsql security invoker set search_path='' as $$
declare ch uuid; begin
  if p_platform is null or p_platform not in ('youtube', 'facebook', 'instagram') then
    raise exception 'invalid_platform' using errcode='22023'; end if;
  if p_platform = 'youtube' then
    if external_channel !~ '^UC[A-Za-z0-9_-]{22}$' then
      raise exception 'invalid_channel_id' using errcode='22023'; end if;
  elsif external_channel !~ '^[0-9]{1,64}$' then
    raise exception 'invalid_channel_id' using errcode='22023';
  end if;
  if exists(select 1 from public.channels
            where platform=p_platform and external_channel_id=external_channel
              and status='connected' and workspace_id <> w) then
    raise exception 'channel_already_connected' using errcode='23505'; end if;

  -- A name the provider did not send this time does not erase one it sent
  -- before: a reconnect after a lapsed grant should not cost the reader the label.
  update public.channels set status='connected', client_id=c,
    handle=coalesce(channel_handle, handle),
    title=coalesce(channel_title, title)
  where workspace_id=w and platform=p_platform
    and external_channel_id=external_channel
  returning id into ch;
  if ch is null then
    insert into public.channels(workspace_id,client_id,external_channel_id,status,handle,title,platform)
    values (w, c, external_channel, 'connected', channel_handle, channel_title, p_platform)
    returning id into ch;
  end if;

  -- The grant being stored replaces whatever was live. Retired, not deleted:
  -- the row stays as the record that a connection existed.
  update private.oauth_connections set status='superseded'
  where channel_id=ch and status='connected';

  insert into private.oauth_connections(
    workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
  values (w, ch, u, tokens, key_version, scopes, 'connected');

  perform private.enqueue_scheduled(w, ch, 'discover');
  return ch;
end $$;

-- 5. Complete: the pending row's platform travels to the channel.
create or replace function private.oauth_complete_impl(ticket text, browser_nonce text)
returns table(channel_id uuid, code text)
language plpgsql security definer set search_path='' as $$
declare
  pending record;
  attached uuid;
begin
  select p.*,s.user_id,s.workspace_id,s.client_id,s.browser_nonce_hash
    into pending
  from private.oauth_pending p
  join private.oauth_states s on s.id=p.state_id
  where p.ticket_hash=encode(extensions.digest(ticket,'sha256'),'hex')
  for update of p;

  if not found then
    return query select null::uuid,'oauth_binding_mismatch'::text;
    return;
  end if;

  -- Consume before checking. Returning a coded refusal commits this deletion;
  -- raising would roll the transaction back and leave a replayable ticket.
  delete from private.oauth_pending p where p.id=pending.id;

  if pending.expires_at<=now()
     or browser_nonce is null
     or encode(extensions.digest(browser_nonce,'sha256'),'hex') is distinct from pending.browser_nonce_hash
     or (select auth.uid()) is distinct from pending.user_id
     or not private.has_role(pending.workspace_id,array['workspace_owner']) then
    return query select null::uuid,'oauth_binding_mismatch'::text;
    return;
  end if;

  attached := private.oauth_attach_channel_for(
    pending.user_id,pending.workspace_id,pending.client_id,
    pending.external_channel,pending.encrypted_tokens,pending.key_version,
    pending.granted_scopes,pending.channel_handle,pending.channel_title,
    pending.platform);
  return query select attached,null::text;
end $$;

-- 6. Grants: exactly what the previous definitions carried.
revoke all on function private.oauth_start_impl(uuid,uuid,text,text,text,text),
  private.oauth_consume_state(text),
  private.oauth_create_pending(uuid,text,text,bytea,text,text[],text,text,text),
  private.oauth_attach_channel_for(uuid,uuid,uuid,text,bytea,text,text[],text,text,text),
  private.oauth_complete_impl(text,text),
  public.oauth_start(uuid,uuid,text,text,text,text),
  public.svc_oauth_consume_state(text),
  public.svc_oauth_create_pending(uuid,text,text,bytea,text,text[],text,text,text),
  public.oauth_complete(text,text)
  from public,anon,authenticated;

grant execute on function private.oauth_start_impl(uuid,uuid,text,text,text,text),
  public.oauth_start(uuid,uuid,text,text,text,text),
  public.oauth_complete(text,text) to authenticated;
grant execute on function private.oauth_consume_state(text),
  public.svc_oauth_consume_state(text),
  private.oauth_create_pending(uuid,text,text,bytea,text,text[],text,text,text),
  public.svc_oauth_create_pending(uuid,text,text,bytea,text,text[],text,text,text),
  private.oauth_attach_channel_for(uuid,uuid,uuid,text,bytea,text,text[],text,text,text)
  to service_role;
