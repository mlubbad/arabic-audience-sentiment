-- private.oauth_states was never pruned.
--
-- Every connection attempt left a row behind permanently: consumed states,
-- states that expired unused, states from workspaces that have since
-- disconnected. Nothing read them again. A single-use table that only ever
-- grows is a retention decision made by omission, and the rows are not
-- nothing — each one records that a particular user began linking a particular
-- client at a particular time.
--
-- Security never depended on keeping them. Consume already requires
-- consumed_at is null and expires_at > now(), so a deleted row and a consumed
-- row both refuse a replay with invalid_state. The retention window exists for
-- operational diagnosis, not for correctness, which is why it is short and why
-- the default is stated here rather than left to a caller.
--
-- This is an operational job with no schedule attached: scheduling belongs to
-- a deployed project, which does not exist yet. What is committed here is the
-- operation, so the schedule is a one-line decision when there is somewhere to
-- attach it.

create function private.prune_oauth_states(retain interval default interval '7 days')
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  if retain < interval '0' then
    raise exception 'invalid_input' using errcode='22023'; end if;
  delete from private.oauth_states s
  -- An unconsumed state that has not expired is a connection in flight and is
  -- never touched, whatever the window says.
  where (s.consumed_at is not null and s.consumed_at < now() - retain)
     or (s.consumed_at is null and s.expires_at < now() - retain);
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function private.prune_oauth_states(interval) from public, anon, authenticated;
grant execute on function private.prune_oauth_states(interval) to service_role;
