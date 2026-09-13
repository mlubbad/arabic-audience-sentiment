-- PKCE. The state row now carries the code verifier the exchange must present.
--
-- Why this is stored raw while the state is stored only as a hash: they are not
-- the same kind of secret. The state travels back through the browser, so a
-- database read of a raw state would be enough to forge a callback — hence the
-- hash. The verifier never leaves the server. It is presented once, by us, at
-- the token exchange, alongside the client secret. Storing it is what the
-- protocol requires; storing the state raw is not.
--
-- It lives in private.oauth_states, which has no tenant grants, is single use,
-- expires in ten minutes, and is now pruned.

alter table private.oauth_states add column code_verifier text;

-- Return type and signature both change, so these are dropped rather than
-- replaced. oauth_attach_channel depends on consume and goes with it.
drop function private.oauth_attach_channel(text, text, bytea, text, text[]);
drop function private.oauth_consume_state(text);
drop function public.oauth_start(uuid, uuid, text);
drop function private.oauth_start_impl(uuid, uuid, text);

create function private.oauth_start_impl(w uuid, c uuid, state_hash text, verifier text)
returns text language plpgsql security definer set search_path='' as $$
begin
  if not private.has_role(w, array['workspace_owner']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where workspace_id=w and id=c) then
    raise exception 'invalid_client' using errcode='23503'; end if;
  if state_hash is null or length(state_hash) not between 16 and 200 then
    raise exception 'invalid_state' using errcode='22023'; end if;
  -- RFC 7636 section 4.1: 43 to 128 characters from the unreserved set. A
  -- shorter one is checked here because the exchange cannot check it later —
  -- by then a weak verifier has already been used.
  if verifier is null or length(verifier) not between 43 and 128
     or verifier !~ '^[A-Za-z0-9._~-]+$' then
    raise exception 'invalid_verifier' using errcode='22023'; end if;
  insert into private.oauth_states(state_hash,user_id,workspace_id,client_id,expires_at,code_verifier)
  values (state_hash, (select auth.uid()), w, c, now() + interval '10 minutes', verifier);
  return state_hash;
end $$;
create function public.oauth_start(w uuid, c uuid, state_hash text, verifier text) returns text
language sql security invoker set search_path='' as $$select private.oauth_start_impl(w,c,state_hash,verifier)$$;

create function private.oauth_consume_state(state_hash text)
returns table(user_id uuid, workspace_id uuid, client_id uuid, code_verifier text)
language plpgsql security invoker set search_path='' as $$
begin
  return query
  update private.oauth_states s set consumed_at = now()
  where s.state_hash = oauth_consume_state.state_hash
    and s.consumed_at is null and s.expires_at > now()
  returning s.user_id, s.workspace_id, s.client_id, s.code_verifier;
  if not found then raise exception 'invalid_state' using errcode='42501'; end if;
end $$;

create function private.oauth_attach_channel(
  state_hash text, external_channel text, tokens bytea, key_version text, scopes text[])
returns uuid language plpgsql security invoker set search_path='' as $$
declare st record; ch uuid; begin
  select * into st from private.oauth_consume_state(state_hash);
  if external_channel !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise exception 'invalid_channel_id' using errcode='22023'; end if;
  if exists(select 1 from public.channels
            where platform='youtube' and external_channel_id=external_channel
              and status='connected' and workspace_id <> st.workspace_id) then
    raise exception 'channel_already_connected' using errcode='23505'; end if;

  update public.channels set status='connected', client_id=st.client_id
  where workspace_id=st.workspace_id and platform='youtube'
    and external_channel_id=external_channel
  returning id into ch;
  if ch is null then
    insert into public.channels(workspace_id,client_id,external_channel_id,status)
    values (st.workspace_id, st.client_id, external_channel, 'connected') returning id into ch;
  end if;

  insert into private.oauth_connections(
    workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
  values (st.workspace_id, ch, st.user_id, tokens, key_version, scopes, 'connected');
  return ch;
end $$;

revoke all on function private.oauth_start_impl(uuid,uuid,text,text),
  private.oauth_consume_state(text),
  private.oauth_attach_channel(text,text,bytea,text,text[]),
  public.oauth_start(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function private.oauth_start_impl(uuid,uuid,text,text),
  public.oauth_start(uuid,uuid,text,text) to authenticated;
grant execute on function private.oauth_consume_state(text),
  private.oauth_attach_channel(text,text,bytea,text,text[]) to service_role;
