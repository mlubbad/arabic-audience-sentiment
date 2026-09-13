-- The callback cannot attach a channel in one step, and the schema assumed it
-- could.
--
-- oauth_attach_channel consumed the state itself. But the real sequence needs
-- the state's verifier *before* the token exchange, and the channel id only
-- *after* it — because the channel is read from channels.list with the new
-- token, never taken from the browser. Consume is single use, so it cannot
-- happen at both ends.
--
-- Split, not weakened. oauth_consume_state still burns the state exactly once,
-- and the binding it returns is carried server-side inside one request. The
-- property that matters is unchanged: the browser never chooses the workspace,
-- because the workspace comes from a row the browser could not write. The new
-- function is service-role only, so nothing a tenant can call accepts a
-- workspace argument.
--
-- A failed exchange therefore burns the state and the user starts again. That
-- is the correct trade: a state that survived a failure would be a code that
-- could be replayed.

create function private.oauth_attach_channel_for(
  u uuid, w uuid, c uuid, external_channel text, tokens bytea,
  key_version text, scopes text[])
returns uuid language plpgsql security invoker set search_path='' as $$
declare ch uuid; begin
  if external_channel !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise exception 'invalid_channel_id' using errcode='22023'; end if;
  if exists(select 1 from public.channels
            where platform='youtube' and external_channel_id=external_channel
              and status='connected' and workspace_id <> w) then
    raise exception 'channel_already_connected' using errcode='23505'; end if;

  update public.channels set status='connected', client_id=c
  where workspace_id=w and platform='youtube'
    and external_channel_id=external_channel
  returning id into ch;
  if ch is null then
    insert into public.channels(workspace_id,client_id,external_channel_id,status)
    values (w, c, external_channel, 'connected') returning id into ch;
  end if;

  insert into private.oauth_connections(
    workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
  values (w, ch, u, tokens, key_version, scopes, 'connected');
  return ch;
end $$;

-- The original entry point keeps working and stops duplicating the logic: it
-- consumes, then delegates. One body to be correct in.
create or replace function private.oauth_attach_channel(
  state_hash text, external_channel text, tokens bytea, key_version text, scopes text[])
returns uuid language plpgsql security invoker set search_path='' as $$
declare st record; begin
  select * into st from private.oauth_consume_state(state_hash);
  return private.oauth_attach_channel_for(
    st.user_id, st.workspace_id, st.client_id, external_channel, tokens, key_version, scopes);
end $$;

revoke all on function private.oauth_attach_channel_for(uuid,uuid,uuid,text,bytea,text,text[])
  from public, anon, authenticated;
grant execute on function private.oauth_attach_channel_for(uuid,uuid,uuid,text,bytea,text,text[])
  to service_role;
