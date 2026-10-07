-- Give the dashboard's two live reads the 30 s statement timeout they were
-- meant to have.
--
-- `private.dashboard_aggregates_impl` and `private.dashboard_comments_impl`
-- carry `SET statement_timeout = '30s'`, but PostgREST only applies ("hoists")
-- a statement_timeout set on the function the RPC names, applied per
-- transaction. The RPCs name the public wrappers, which set none, so both
-- reads ran under the `authenticated` role's default (8 s on Supabase) and
-- failed with 57014 whenever the database was slow, most often while a sync was
-- writing (owner's screenshots, 2026-10-06 and 2026-10-07). A SET inside the
-- callee cannot extend a timeout already armed for the calling statement.
-- `public.dashboard_snapshot` already sets 30 s on itself and is unchanged.
--
-- ALTER FUNCTION ... SET changes only the setting; the bodies, owners,
-- SECURITY DEFINER and grants stay as they are.

alter function public.dashboard_aggregates(uuid, jsonb) set statement_timeout = '30s';
alter function public.dashboard_comments(uuid, jsonb) set statement_timeout = '30s';
