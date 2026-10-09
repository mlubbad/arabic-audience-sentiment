-- The platform owner's bulk import: one public YouTube channel becomes one
-- workspace named after it, with the channel attached and its first
-- collection requested.
--
-- The admin page reads a CSV of channels, names each one through
-- `channel-lookup` (the owner confirms every match), then calls this once per
-- channel. One call per channel keeps each import its own transaction: a
-- failed row leaves no half-made workspace behind, and the page can show
-- progress and a per-row verdict.
--
-- A channel the owner's account already holds in any workspace (created or
-- joined, retired ones included) is not imported again: the answer is
-- `exists` with the workspace that holds it. An advisory lock per channel
-- makes that check and the insert one step, so two tabs importing the same
-- list cannot both pass it.
--
-- Everything else goes through the same functions a person adding one
-- channel by hand goes through: `create_workspace_impl` (the plan's workspace
-- limit, the billing link to the owner's home workspace),
-- `register_public_channel_impl` (the plan's public-channel rule, the id
-- format) and `request_discovery_impl` (the first catalogue run). From then
-- on the scheduler keeps the channel collected like any other.

create or replace function public.admin_import_channel(
  p_external text,
  p_title text default null,
  p_handle text default null,
  p_platform text default 'youtube'
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := (select auth.uid());
  v_platform text := coalesce(nullif(trim(p_platform), ''), 'youtube');
  v_external text := trim(coalesce(p_external, ''));
  v_name text;
  held record;
  w uuid;
  c uuid;
  ch public.channels;
  j uuid;
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  -- YouTube only: the lookup names YouTube channels by id; the other
  -- platforms have no id this import could confirm.
  if v_platform <> 'youtube' then
    raise exception 'invalid_platform' using errcode='22023';
  end if;
  if v_external !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise exception 'invalid_channel_id' using errcode='22023';
  end if;

  -- The workspace is named after the channel: its title, else its handle,
  -- else its id. Cut to the 120 characters a workspace name may hold.
  v_name := left(coalesce(nullif(trim(coalesce(p_title, '')), ''),
                          nullif(trim(coalesce(p_handle, '')), ''),
                          v_external), 120);

  perform pg_advisory_xact_lock(
    hashtext('admin_import_channel:' || v_platform || ':' || v_external));

  select ws.id, ws.name into held
    from public.channels chn
    join public.workspaces ws on ws.id = chn.workspace_id
   where chn.platform = v_platform
     and chn.external_channel_id = v_external
     and (ws.created_by = uid
          or exists (select 1 from public.memberships m
                      where m.workspace_id = ws.id and m.user_id = uid))
   order by ws.created_at
   limit 1;
  if found then
    return jsonb_build_object('status', 'exists',
                              'workspace_id', held.id,
                              'workspace_name', held.name);
  end if;

  w := private.create_workspace_impl(v_name);
  select id into c from public.clients where workspace_id = w limit 1;
  ch := private.register_public_channel_impl(w, c, v_external, p_handle, p_title, v_platform);
  j := private.request_discovery_impl(w, ch.id);

  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (w, uid, 'channel_imported', 'channel', ch.id::text);

  return jsonb_build_object('status', 'created',
                            'workspace_id', w,
                            'workspace_name', v_name,
                            'channel_id', ch.id,
                            'job_id', j);
end $$;

revoke all on function public.admin_import_channel(text, text, text, text) from public, anon;
grant execute on function public.admin_import_channel(text, text, text, text) to authenticated;
