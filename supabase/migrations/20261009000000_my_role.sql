-- The caller's own role in one workspace, for an Edge Function to authorize
-- against without calling the Auth server.
--
-- `channel-lookup` asked Auth `/user` who the caller was, then read
-- memberships. On 2026-10-05 that Auth call from the function returned an HTML
-- page instead of JSON (`AuthUnknownError`), so every search failed with
-- `forbidden:session` while the same token worked against PostgREST. PostgREST
-- verifies the token itself, so this one call authenticates the caller and
-- answers their role; `auth.uid()` is the verified subject, never a value the
-- request body names. No membership is a null answer, not an error.

create or replace function public.my_role(w uuid) returns text
language sql stable security definer set search_path='' as $$
  select m.role
  from public.memberships m
  where m.workspace_id = w
    and m.user_id = (select auth.uid())
$$;
revoke all on function public.my_role(uuid) from public, anon;
grant execute on function public.my_role(uuid) to authenticated;
