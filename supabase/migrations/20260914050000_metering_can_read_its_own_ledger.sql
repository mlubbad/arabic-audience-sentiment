-- No worker could ever commit an analysis.
--
-- private.reserve_usage is security invoker — deliberately, so it carries the
-- caller's rights rather than the owner's — and it calls private.used_units to
-- read what the workspace has already spent. The foundation revokes execute on
-- every function in the private schema and then grants back a named list to
-- service_role. reserve_usage is on that list. used_units is not.
--
-- So the first real batch of predictions was refused with "permission denied
-- for function used_units", which reached the worker as a bare 500. Collection
-- never touched this path, which is why it went unnoticed until a model
-- actually produced something to store.
--
-- used_units stays revoked from tenants: it is security definer with no role
-- check of its own, and reads any workspace's ledger for whoever can call it.
-- service_role is the only caller that has any business with it.
grant execute on function private.used_units(uuid, text, timestamptz)
  to service_role;
