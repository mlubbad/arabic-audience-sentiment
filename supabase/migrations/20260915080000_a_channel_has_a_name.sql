-- A channel has a name, and nothing ever stored it.
--
-- `channels.handle` has existed since the foundation migration and has been
-- null in every row since, because the callback asked YouTube for `part=id`
-- and the attach function had no parameter to receive anything else. The
-- account page then printed the one thing it had — `UC…`, 24 opaque
-- characters — where a name should be. The audit read that as "the channel id
-- is displayed as content"; the cause is that there was no content to display.
--
-- Two names, because they are different things and Google reports both: the
-- `@handle` (customUrl) a channel chose, and the title it shows. Either can be
-- absent — a channel need not have set a handle — so both are nullable and
-- the id stays the identity. Names are a courtesy on top of it, never a key.
--
-- The attach function is rebuilt from its current body in
-- 20260914001500_attach_after_exchange.sql plus the two columns. Postgres
-- cannot add a parameter with `create or replace`, and leaving the seven-
-- argument overload beside an eight-argument one with defaults would make a
-- named call ambiguous, so the old signatures are dropped and the entry point
-- is recreated with the same name. The Edge Function passes the two new
-- arguments by name; an older deploy that omits them still resolves, because
-- they default to null.

alter table public.channels add column title text;

-- `title` goes last: `create or replace view` may append a column and may not
-- move one, and the view's existing readers select by name.
create or replace view public.connection_status
  with (security_invoker = true) as
  select c.workspace_id, c.id as channel_id, c.external_channel_id, c.handle,
         c.status, c.active_analysis_key, c.title
  from public.channels c;

drop function public.svc_oauth_attach_channel(uuid,uuid,uuid,text,bytea,text,text[]);
drop function private.oauth_attach_channel_for(uuid,uuid,uuid,text,bytea,text,text[]);

create function private.oauth_attach_channel_for(
  u uuid, w uuid, c uuid, external_channel text, tokens bytea,
  key_version text, scopes text[],
  channel_handle text default null, channel_title text default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare ch uuid; begin
  if external_channel !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise exception 'invalid_channel_id' using errcode='22023'; end if;
  if exists(select 1 from public.channels
            where platform='youtube' and external_channel_id=external_channel
              and status='connected' and workspace_id <> w) then
    raise exception 'channel_already_connected' using errcode='23505'; end if;

  -- A name Google did not send this time does not erase one it sent before:
  -- a reconnect after a lapsed grant should not cost the reader the label.
  update public.channels set status='connected', client_id=c,
    handle=coalesce(channel_handle, handle),
    title=coalesce(channel_title, title)
  where workspace_id=w and platform='youtube'
    and external_channel_id=external_channel
  returning id into ch;
  if ch is null then
    insert into public.channels(workspace_id,client_id,external_channel_id,status,handle,title)
    values (w, c, external_channel, 'connected', channel_handle, channel_title)
    returning id into ch;
  end if;

  insert into private.oauth_connections(
    workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
  values (w, ch, u, tokens, key_version, scopes, 'connected');
  return ch;
end $$;

revoke all on function private.oauth_attach_channel_for(uuid,uuid,uuid,text,bytea,text,text[],text,text)
  from public, anon, authenticated;
grant execute on function private.oauth_attach_channel_for(uuid,uuid,uuid,text,bytea,text,text[],text,text)
  to service_role;

create function public.svc_oauth_attach_channel(
  u uuid, w uuid, c uuid, external_channel text, tokens bytea,
  key_version text, scopes text[],
  channel_handle text default null, channel_title text default null)
returns uuid language sql security invoker set search_path='' as $$
  select private.oauth_attach_channel_for(
    u, w, c, external_channel, tokens, key_version, scopes, channel_handle, channel_title)
$$;
revoke all on function public.svc_oauth_attach_channel(uuid,uuid,uuid,text,bytea,text,text[],text,text)
  from public, anon, authenticated;
grant execute on function public.svc_oauth_attach_channel(uuid,uuid,uuid,text,bytea,text,text[],text,text)
  to service_role;
