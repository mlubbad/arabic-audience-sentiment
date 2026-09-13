-- M5: the server side of linking a YouTube channel.
-- The live Google exchange happens in an Edge Function; everything security
-- relevant about it is here, so it can be tested without credentials.

-- Exactly one workspace may hold the authorised connection for a channel.
-- Others may keep collecting public data, which needs no authorisation, but
-- they can never become the verified holder while someone else is connected.
create unique index channels_one_connected_claim
  on public.channels (platform, external_channel_id) where status = 'connected';

-- A tenant reads connection status and never the secrets beside it.
create view public.connection_status
  with (security_invoker = true) as
  select c.workspace_id, c.id as channel_id, c.external_channel_id, c.handle,
         c.status, c.active_analysis_key
  from public.channels c;
grant select on public.connection_status to authenticated;

create function private.oauth_start_impl(w uuid, c uuid, state_hash text) returns text
language plpgsql security definer set search_path='' as $$
begin
  if not private.has_role(w, array['workspace_owner']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where workspace_id=w and id=c) then
    raise exception 'invalid_client' using errcode='23503'; end if;
  if state_hash is null or length(state_hash) not between 16 and 200 then
    raise exception 'invalid_state' using errcode='22023'; end if;
  -- Only the hash is stored. A database read cannot reconstruct the state, so
  -- it cannot be used to forge a callback.
  insert into private.oauth_states(state_hash,user_id,workspace_id,client_id,expires_at)
  values (state_hash, (select auth.uid()), w, c, now() + interval '10 minutes');
  return state_hash;
end $$;
create function public.oauth_start(w uuid, c uuid, state_hash text) returns text
language sql security invoker set search_path='' as $$select private.oauth_start_impl(w,c,state_hash)$$;

-- Single use, time limited, and it returns the binding rather than accepting
-- one: the callback is reachable without a session, so nothing it sends about
-- which workspace it belongs to may be trusted.
create function private.oauth_consume_state(state_hash text)
returns table(user_id uuid, workspace_id uuid, client_id uuid)
language plpgsql security invoker set search_path='' as $$
begin
  return query
  update private.oauth_states s set consumed_at = now()
  where s.state_hash = oauth_consume_state.state_hash
    and s.consumed_at is null and s.expires_at > now()
  returning s.user_id, s.workspace_id, s.client_id;
  if not found then raise exception 'invalid_state' using errcode='42501'; end if;
end $$;

-- The channel identity comes from channels.list(mine=true) run with the new
-- token, never from anything the browser sent.
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

  -- Upgrade the row that public collection already created, so the data
  -- gathered before authorisation carries over instead of being orphaned.
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

-- A revoked or expired token never falls back to scraping without the operator
-- knowing: the channel asks to be reconnected and dependent work stops.
create function private.oauth_mark_revoked(channel uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  update public.channels set status='reconnect_required' where id=channel;
  update private.oauth_connections set status='reconnect_required' where channel_id=channel;
  update public.jobs set status='cancelled', error_code='connection_revoked'
  where channel_id=channel and status in ('queued','running');
end $$;

create function private.oauth_disconnect_impl(w uuid, channel uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.has_role(w, array['workspace_owner']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.channels where workspace_id=w and id=channel) then
    raise exception 'invalid_channel' using errcode='23503'; end if;
  update public.channels set status='disconnected' where id=channel;
  update private.oauth_connections set status='revoked' where channel_id=channel;
  update public.jobs set status='cancelled', error_code='disconnected'
  where channel_id=channel and status in ('queued','running');
end $$;
create function public.oauth_disconnect(w uuid, channel uuid) returns void
language sql security invoker set search_path='' as $$select private.oauth_disconnect_impl(w,channel)$$;

revoke all on function private.oauth_start_impl(uuid,uuid,text),
  private.oauth_consume_state(text),
  private.oauth_attach_channel(text,text,bytea,text,text[]),
  private.oauth_mark_revoked(uuid),
  private.oauth_disconnect_impl(uuid,uuid) from public, anon, authenticated;
grant execute on function private.oauth_start_impl(uuid,uuid,text),
  private.oauth_disconnect_impl(uuid,uuid) to authenticated;
grant execute on function private.oauth_consume_state(text),
  private.oauth_attach_channel(text,text,bytea,text,text[]),
  private.oauth_mark_revoked(uuid) to service_role;
revoke all on function public.oauth_start(uuid,uuid,text),
  public.oauth_disconnect(uuid,uuid) from public, anon;
grant execute on function public.oauth_start(uuid,uuid,text),
  public.oauth_disconnect(uuid,uuid) to authenticated;
