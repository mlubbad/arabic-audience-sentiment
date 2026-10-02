-- A public channel registers by its metadata, before any grant exists.
--
-- The Data API path: with a project API key, any channel's public videos and
-- comments are readable without the owner's consent, so the product can add a
-- channel from its link or from a search instead of only through OAuth. The
-- worker already knows the state: `public_unverified` is the channels table's
-- default and the setup path renders it. What was missing is a way to file the
-- channel with the name and handle the lookup found — `register_channel` takes
-- a bare UC id only — and a way for a worker without a grant to know which
-- channel a job is for. This file is the first half: registration with
-- metadata. The claim's `external_channel_id` and the key-based collector land
-- beside it.
--
-- Same rules as register_channel (20260912185902): role-checked, tenant-
-- checked, syntactically valid UC id only, and 'connected' stays reserved for
-- a completed OAuth flow — a channel added by link or search is never more
-- than public data, no matter how it arrived.

create function private.register_public_channel_impl(
  w uuid, c uuid, external text, handle text, title text
) returns public.channels
language plpgsql security definer set search_path='' as $$
declare ch public.channels; begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where workspace_id=w and id=c) then
    raise exception 'invalid_client' using errcode='23503'; end if;
  if external !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise exception 'invalid_channel_id' using errcode='22023'; end if;
  -- Blank stays blank (null), and an overlong field is refused rather than
  -- truncated: a truncated title would not be the name the reader searched
  -- for. YouTube handles run to 30 characters and titles to 100, so these
  -- bounds are headroom, not the source's own limits.
  handle := nullif(trim(coalesce(handle, '')), '');
  title := nullif(trim(coalesce(title, '')), '');
  if handle is not null and length(handle) > 50 then
    raise exception 'invalid_channel_handle' using errcode='22023'; end if;
  if title is not null and length(title) > 200 then
    raise exception 'invalid_channel_title' using errcode='22023'; end if;
  insert into public.channels(workspace_id, client_id, external_channel_id, handle, title)
  values (w, c, external, handle, title)
  on conflict (workspace_id, platform, external_channel_id) do nothing
  returning * into ch;
  if ch.id is null then
    -- Already filed under this workspace: the same channel re-added is the
    -- existing row, not a duplicate and not an error. Filed under another
    -- client of this workspace is the same refusal register_channel gives.
    select * into ch from public.channels
     where workspace_id = w and platform = 'youtube'
       and external_channel_id = external and client_id = c;
    if ch.id is null then
      raise exception 'channel_claimed_by_other_client' using errcode='23505';
    end if;
  end if;
  return ch;
end $$;
create function public.register_public_channel(
  w uuid, c uuid, external text, handle text, title text
) returns public.channels
language sql security invoker set search_path='' as $$
  select private.register_public_channel_impl(w, c, external, handle, title) $$;
