-- A channel can hold one live grant, and the schema let it hold several.
--
-- Every attach inserts a row into private.oauth_connections and never touches
-- the rows already there. Re-link a connected channel — which the account page
-- now offers, to store its name — and it has two rows with status 'connected'.
-- worker_channel_grant picks between them with `order by id desc limit 1`, and
-- ids are random uuids: which grant the worker collects with is then decided
-- by a coin toss at insert time. Both tokens work today, so nothing fails —
-- which is exactly the kind of defect ACTIVE.md says to write down. Grants
-- were also never retired: a channel connected three times kept three
-- credentials with equal standing.
--
-- Two changes, one invariant. The attach function marks the channel's older
-- connected rows 'superseded' before inserting the new one — rebuilt from its
-- current body in 20260915080000_a_channel_has_a_name.sql, same signature, so
-- `create or replace` is enough. A partial unique index then makes "at most one
-- connected grant per channel" a property of the table rather than of the one
-- function that currently respects it; a future writer that forgets is refused
-- with 23505 instead of quietly restoring the coin toss.
--
-- The reader is left alone. With one connected row per channel its `order by
-- id desc limit 1` chooses among one, and not rewriting a body is one fewer
-- body to get wrong.
--
-- Backfill: where a channel already holds several connected rows, keep the one
-- with the greatest id and supersede the rest. Not because greatest-id means
-- newest — it does not — but because that is the row the reader was already
-- returning, so the worker keeps collecting with the grant it was using.
-- Nothing changes hands. Superseded rows keep their sealed tokens; retiring a
-- credential is a status, not a deletion, and the history of who connected a
-- channel and when stays readable to whoever needs it.

-- `order by id desc limit 1` rather than max(): Postgres has no max over uuid,
-- and this is the reader's own expression, which is the point.
update private.oauth_connections c set status = 'superseded'
where c.status = 'connected'
  and c.id <> (
    select o.id from private.oauth_connections o
    where o.channel_id = c.channel_id and o.status = 'connected'
    order by o.id desc limit 1);

create unique index oauth_connections_one_connected
  on private.oauth_connections (channel_id) where status = 'connected';

create or replace function private.oauth_attach_channel_for(
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

  -- The grant being stored replaces whatever was live. Retired, not deleted:
  -- the row stays as the record that a connection existed.
  update private.oauth_connections set status='superseded'
  where channel_id=ch and status='connected';

  insert into private.oauth_connections(
    workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
  values (w, ch, u, tokens, key_version, scopes, 'connected');
  return ch;
end $$;
