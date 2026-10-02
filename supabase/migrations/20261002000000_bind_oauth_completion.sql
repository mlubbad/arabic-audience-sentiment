-- Bind OAuth completion to the browser and user that began the flow.

alter table private.oauth_states
  add column id uuid not null default gen_random_uuid(),
  add column browser_nonce_hash text;
alter table private.oauth_states add constraint oauth_states_id_key unique (id);

create table private.oauth_pending (
  id uuid primary key default gen_random_uuid(),
  state_id uuid not null unique references private.oauth_states(id) on delete cascade,
  ticket_hash text not null unique,
  external_channel text not null,
  channel_handle text,
  channel_title text,
  encrypted_tokens bytea not null,
  key_version text not null,
  granted_scopes text[] not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table private.oauth_pending enable row level security;
revoke all on private.oauth_pending from public, anon, authenticated;

drop function public.svc_oauth_consume_state(text);
drop function private.oauth_consume_state(text);
drop function public.oauth_start(uuid, uuid, text, text);
drop function private.oauth_start_impl(uuid, uuid, text, text);

create function private.oauth_start_impl(
  w uuid, c uuid, state_hash text, verifier text, browser_nonce_hash text)
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
  insert into private.oauth_states(
    state_hash,user_id,workspace_id,client_id,expires_at,code_verifier,browser_nonce_hash)
  values (
    state_hash,(select auth.uid()),w,c,now()+interval '10 minutes',verifier,browser_nonce_hash);
  return state_hash;
end $$;

create function public.oauth_start(
  w uuid, c uuid, state_hash text, verifier text, browser_nonce_hash text)
returns text language sql security invoker set search_path='' as $$
  select private.oauth_start_impl(w,c,state_hash,verifier,browser_nonce_hash)
$$;

create function private.oauth_consume_state(state_hash text)
returns table(
  state_id uuid, user_id uuid, workspace_id uuid, client_id uuid,
  code_verifier text, browser_nonce_hash text)
language plpgsql security invoker set search_path='' as $$
begin
  return query
  update private.oauth_states s set consumed_at=now()
  where s.state_hash=oauth_consume_state.state_hash
    and s.consumed_at is null and s.expires_at>now()
  returning s.id,s.user_id,s.workspace_id,s.client_id,s.code_verifier,s.browser_nonce_hash;
  if not found then raise exception 'invalid_state' using errcode='42501'; end if;
end $$;

create function public.svc_oauth_consume_state(state_hash text)
returns table(
  state_id uuid, user_id uuid, workspace_id uuid, client_id uuid,
  code_verifier text, browser_nonce_hash text)
language sql security invoker set search_path='' as $$
  select * from private.oauth_consume_state(state_hash)
$$;

create function private.oauth_create_pending(
  pending_state_id uuid, pending_ticket_hash text, pending_external_channel text,
  pending_tokens bytea, pending_key_version text, pending_scopes text[],
  pending_channel_handle text default null, pending_channel_title text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if pending_ticket_hash is null or length(pending_ticket_hash) <> 64 then
    raise exception 'invalid_ticket' using errcode='22023'; end if;
  if pending_external_channel !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise exception 'invalid_channel_id' using errcode='22023'; end if;
  if not exists(
    select 1 from private.oauth_states s
    where s.id=pending_state_id and s.consumed_at is not null) then
    raise exception 'invalid_state' using errcode='42501'; end if;
  insert into private.oauth_pending(
    state_id,ticket_hash,external_channel,channel_handle,channel_title,
    encrypted_tokens,key_version,granted_scopes,expires_at)
  values (
    pending_state_id,pending_ticket_hash,pending_external_channel,
    pending_channel_handle,pending_channel_title,pending_tokens,
    pending_key_version,pending_scopes,now()+interval '10 minutes');
end $$;

create function public.svc_oauth_create_pending(
  state_id uuid, ticket_hash text, external_channel text, tokens bytea,
  key_version text, scopes text[], channel_handle text default null,
  channel_title text default null)
returns void language sql security invoker set search_path='' as $$
  select private.oauth_create_pending(
    state_id,ticket_hash,external_channel,tokens,key_version,scopes,
    channel_handle,channel_title)
$$;

create function private.oauth_complete_impl(ticket text, browser_nonce text)
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
    pending.granted_scopes,pending.channel_handle,pending.channel_title);
  return query select attached,null::text;
end $$;

create function public.oauth_complete(ticket text, nonce text)
returns table(channel_id uuid, code text)
language sql security definer set search_path='' as $$
  select * from private.oauth_complete_impl(ticket,nonce)
$$;

create or replace function private.prune_oauth_states(retain interval default interval '7 days')
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer; pending_removed integer;
begin
  if retain<interval '0' then
    raise exception 'invalid_input' using errcode='22023'; end if;
  delete from private.oauth_pending p where p.expires_at<now();
  get diagnostics pending_removed=row_count;
  delete from private.oauth_states s
  where (s.consumed_at is not null and s.consumed_at<now()-retain)
     or (s.consumed_at is null and s.expires_at<now()-retain);
  get diagnostics removed=row_count;
  return removed+pending_removed;
end $$;

revoke all on function private.oauth_start_impl(uuid,uuid,text,text,text),
  private.oauth_consume_state(text),
  private.oauth_create_pending(uuid,text,text,bytea,text,text[],text,text),
  private.oauth_complete_impl(text,text),
  public.oauth_start(uuid,uuid,text,text,text),
  public.svc_oauth_consume_state(text),
  public.svc_oauth_create_pending(uuid,text,text,bytea,text,text[],text,text),
  public.oauth_complete(text,text),
  private.prune_oauth_states(interval)
  from public,anon,authenticated;

grant execute on function private.oauth_start_impl(uuid,uuid,text,text,text),
  public.oauth_start(uuid,uuid,text,text,text),
  public.oauth_complete(text,text) to authenticated;
grant execute on function private.oauth_consume_state(text),
  public.svc_oauth_consume_state(text),
  private.oauth_create_pending(uuid,text,text,bytea,text,text[],text,text),
  public.svc_oauth_create_pending(uuid,text,text,bytea,text,text[],text,text),
  private.prune_oauth_states(interval) to service_role;
