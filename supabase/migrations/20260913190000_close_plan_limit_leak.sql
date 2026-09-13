-- private.plan_limit was security definer and executable by `authenticated`
-- with no role check inside it, so any signed-in user could read any
-- workspace's plan limits by passing that workspace's id. Every other definer
-- function exposed to tenants decides for itself whether the caller is
-- entitled; this one never did.
--
-- It is only ever called from inside register_channel_impl and
-- enqueue_sync_impl, which are themselves definer and run as the owner, so
-- revoking from tenants does not affect them.
revoke all on function private.plan_limit(uuid,text) from public, anon, authenticated;
