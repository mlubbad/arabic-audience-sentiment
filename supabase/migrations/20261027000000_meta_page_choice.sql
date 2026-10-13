-- A person who manages several Facebook pages chooses one inside the product.
--
-- Until now a Facebook grant naming more than one page ended at
-- `ambiguous_channel`, and the only way through was Meta's "Edit settings"
-- screen, which an ordinary user does not understand. Now the callback files
-- every page the person allowed, each with its own sealed page token, under
-- the one pending ticket; completion without a choice answers `choose_page`
-- and leaves the ticket in place, the browser lists the pages (names only,
-- never a token) through the same binding — the user who started, the
-- browser nonce, the owner role, ten minutes — and completion with a choice
-- attaches exactly that page and spends the ticket with every choice.

-- 1. A pending row either names its one channel and token, or holds choices.
alter table private.oauth_pending
  alter column external_channel drop not null,
  alter column encrypted_tokens drop not null,
  add constraint oauth_pending_single_or_choice
    check ((external_channel is null) = (encrypted_tokens is null));

create table private.oauth_pending_choices (
  id uuid primary key default gen_random_uuid(),
  pending_id uuid not null references private.oauth_pending(id) on delete cascade,
  position integer not null,
  external_channel text not null check (external_channel ~ '^[0-9]{1,64}$'),
  channel_handle text check (channel_handle is null or length(channel_handle) <= 100),
  channel_title text check (channel_title is null or length(channel_title) <= 200),
  encrypted_tokens bytea not null,
  unique (pending_id, external_channel)
);
alter table private.oauth_pending_choices enable row level security;
revoke all on private.oauth_pending_choices from public, anon, authenticated;

-- 2. The callback files the choices (service only).
create function private.oauth_create_pending_choices(
  pending_state_id uuid, pending_ticket_hash text, pending_key_version text,
  pending_scopes text[], pending_platform text, choices jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  pending_id uuid;
  choice jsonb;
  n integer := 0;
  external text;
  tokens text;
begin
  if pending_ticket_hash is null or length(pending_ticket_hash) <> 64 then
    raise exception 'invalid_ticket' using errcode='22023'; end if;
  if pending_platform is distinct from 'facebook' then
    raise exception 'invalid_platform' using errcode='22023'; end if;
  if jsonb_typeof(choices) is distinct from 'array'
     or jsonb_array_length(choices) < 1 or jsonb_array_length(choices) > 100 then
    raise exception 'invalid_choices' using errcode='22023'; end if;
  if not exists(
    select 1 from private.oauth_states s
    where s.id=pending_state_id and s.consumed_at is not null) then
    raise exception 'invalid_state' using errcode='42501'; end if;

  insert into private.oauth_pending(
    state_id,ticket_hash,external_channel,channel_handle,channel_title,
    encrypted_tokens,key_version,granted_scopes,expires_at,platform)
  values (
    pending_state_id,pending_ticket_hash,null,null,null,null,
    pending_key_version,pending_scopes,now()+interval '10 minutes',pending_platform)
  returning id into pending_id;

  for choice in select value from jsonb_array_elements(choices) loop
    external := choice->>'external_channel';
    tokens := choice->>'tokens';
    if tokens is null or tokens !~ '^\\x[0-9a-fA-F]{2,}$' then
      raise exception 'invalid_choices' using errcode='22023'; end if;
    if external is null or external !~ '^[0-9]{1,64}$' then
      raise exception 'invalid_channel_id' using errcode='22023'; end if;
    insert into private.oauth_pending_choices(
      pending_id,position,external_channel,channel_handle,channel_title,encrypted_tokens)
    values (
      pending_id, n, external,
      nullif(left(trim(coalesce(choice->>'handle','')),100),''),
      nullif(left(trim(coalesce(choice->>'title','')),200),''),
      decode(substr(tokens,3),'hex'));
    n := n + 1;
  end loop;
end $$;

create function public.svc_oauth_create_pending_choices(
  state_id uuid, ticket_hash text, key_version text, scopes text[],
  pending_platform text, choices jsonb)
returns void language sql security invoker set search_path='' as $$
  select private.oauth_create_pending_choices(
    state_id,ticket_hash,key_version,scopes,pending_platform,choices)
$$;

-- 3. The binding, in one place: the ticket's pending row, if the caller may use it.
create function private.oauth_pending_for(ticket text, browser_nonce text)
returns private.oauth_pending
language plpgsql stable security definer set search_path='' as $$
declare p private.oauth_pending; ok boolean;
begin
  select pe.* into p
  from private.oauth_pending pe
  join private.oauth_states s on s.id=pe.state_id
  where pe.ticket_hash=encode(extensions.digest(ticket,'sha256'),'hex')
    and pe.expires_at>now()
    and browser_nonce is not null
    and encode(extensions.digest(browser_nonce,'sha256'),'hex') = s.browser_nonce_hash
    and (select auth.uid()) = s.user_id
    and private.has_role(s.workspace_id,array['workspace_owner']);
  return p;
end $$;

-- 4. The pages to choose from: names only.
create function public.oauth_pending_choices(ticket text, nonce text)
returns table(id uuid, external_channel text, title text, handle text)
language plpgsql stable security definer set search_path='' as $$
declare p private.oauth_pending;
begin
  p := private.oauth_pending_for(ticket, nonce);
  if p.id is null then return; end if;
  return query
    select c.id, c.external_channel, c.channel_title, c.channel_handle
    from private.oauth_pending_choices c
    where c.pending_id=p.id
    order by c.position;
end $$;

-- 5. Completion takes the choice when the ticket holds several pages.
drop function public.oauth_complete(text,text);
drop function private.oauth_complete_impl(text,text);

create function private.oauth_complete_impl(
  ticket text, browser_nonce text, choice uuid default null)
returns table(channel_id uuid, code text)
language plpgsql security definer set search_path='' as $$
declare
  pending record;
  picked record;
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

  if pending.expires_at<=now()
     or browser_nonce is null
     or encode(extensions.digest(browser_nonce,'sha256'),'hex') is distinct from pending.browser_nonce_hash
     or (select auth.uid()) is distinct from pending.user_id
     or not private.has_role(pending.workspace_id,array['workspace_owner']) then
    -- A refused completion spends the ticket: a coded answer commits the
    -- deletion, where raising would roll it back and leave it replayable.
    delete from private.oauth_pending p where p.id=pending.id;
    return query select null::uuid,'oauth_binding_mismatch'::text;
    return;
  end if;

  if pending.external_channel is null then
    -- Several pages: nothing is attached until the person picks one, and
    -- asking again does not spend the ticket.
    if choice is null then
      return query select null::uuid,'choose_page'::text;
      return;
    end if;
    select c.* into picked from private.oauth_pending_choices c
     where c.id=choice and c.pending_id=pending.id;
    if not found then
      return query select null::uuid,'invalid_choice'::text;
      return;
    end if;
    delete from private.oauth_pending p where p.id=pending.id;
    attached := private.oauth_attach_channel_for(
      pending.user_id,pending.workspace_id,pending.client_id,
      picked.external_channel,picked.encrypted_tokens,pending.key_version,
      pending.granted_scopes,picked.channel_handle,picked.channel_title,
      pending.platform);
    return query select attached,null::text;
    return;
  end if;

  delete from private.oauth_pending p where p.id=pending.id;
  attached := private.oauth_attach_channel_for(
    pending.user_id,pending.workspace_id,pending.client_id,
    pending.external_channel,pending.encrypted_tokens,pending.key_version,
    pending.granted_scopes,pending.channel_handle,pending.channel_title,
    pending.platform);
  return query select attached,null::text;
end $$;

create function public.oauth_complete(ticket text, nonce text, choice uuid default null)
returns table(channel_id uuid, code text)
language sql security definer set search_path='' as $$
  select * from private.oauth_complete_impl(ticket,nonce,choice)
$$;

-- 6. Grants.
revoke all on function private.oauth_create_pending_choices(uuid,text,text,text[],text,jsonb),
  public.svc_oauth_create_pending_choices(uuid,text,text,text[],text,jsonb),
  private.oauth_pending_for(text,text),
  public.oauth_pending_choices(text,text),
  private.oauth_complete_impl(text,text,uuid),
  public.oauth_complete(text,text,uuid)
  from public,anon,authenticated;

grant execute on function private.oauth_create_pending_choices(uuid,text,text,text[],text,jsonb),
  public.svc_oauth_create_pending_choices(uuid,text,text,text[],text,jsonb)
  to service_role;
grant execute on function public.oauth_pending_choices(text,text),
  public.oauth_complete(text,text,uuid)
  to authenticated;
