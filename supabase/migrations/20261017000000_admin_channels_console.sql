-- The owner console's channels page (phase 1b, owner approval 2026-10-09):
-- every channel in one read, with the state the home counts.
--
-- One row per channel: its state from `private.admin_channel_states()`
-- (20261016000000), so the page and the home always agree; whose workspace
-- it is (the caller's own, or a customer's, and that customer's email);
-- what has been catalogued, selected, collected and analysed through it;
-- and, for an imported channel, its automatic selection numbers.
--
-- The counts are aggregated once per table and joined, not counted per row,
-- and comments come from the precomputed `private.video_comment_stats`. The
-- function carries its own 30 s statement timeout, the 20261011000000
-- lesson. `admin_channels()` stays as it is for the search box and the
-- tests that read it.

create or replace function public.admin_channels_console()
returns jsonb
language plpgsql stable security definer
set search_path=''
set statement_timeout = '30s'
as $$
declare
  uid uuid := (select auth.uid());
  result jsonb;
begin
  if uid is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode='42501';
  end if;

  with st as (select * from private.admin_channel_states()),
  vids as (
    select v.workspace_id, v.channel_id, count(*) as videos,
           coalesce(sum(s.total), 0) as comments,
           coalesce(sum(s.analysed), 0) as analysed
      from public.videos v
      left join private.video_comment_stats s
        on s.workspace_id = v.workspace_id and s.video_id = v.id
     group by v.workspace_id, v.channel_id),
  sel as (
    select workspace_id, channel_id, count(*) as selected
      from public.video_selections
     group by workspace_id, channel_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'workspace_id', c.workspace_id,
           'workspace_name', w.name,
           'mine', w.created_by = uid,
           'owner_email', u.email,
           'external_channel_id', c.external_channel_id,
           'title', c.title,
           'handle', c.handle,
           'state', st.state,
           'last_ok_at', st.last_ok_at,
           'last_error', st.last_error,
           'last_run_at', st.last_run_at,
           'catalogued_at', c.catalogued_at,
           'videos', coalesce(vids.videos, 0),
           'selected', coalesce(sel.selected, 0),
           'comments', coalesce(vids.comments, 0),
           'analysed', coalesce(vids.analysed, 0),
           'auto_initial', a.initial_count,
           'auto_daily', a.daily_cap)
         order by w.created_at, c.id), '[]'::jsonb)
    into result
    from public.channels c
    join public.workspaces w on w.id = c.workspace_id
    left join auth.users u on u.id = w.created_by
    join st on st.channel_id = c.id
    left join vids on vids.workspace_id = c.workspace_id and vids.channel_id = c.id
    left join sel on sel.workspace_id = c.workspace_id and sel.channel_id = c.id
    left join private.channel_auto_selection a
      on a.workspace_id = c.workspace_id and a.channel_id = c.id;
  return result;
end $$;

revoke all on function public.admin_channels_console() from public, anon;
grant execute on function public.admin_channels_console() to authenticated;
