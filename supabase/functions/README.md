# Control functions

M2 exposes role-checked SQL RPCs `create_workspace`, `enqueue_sync`, `register_channel` and `submit_comment_review`. Calls use the user's Supabase session; no browser service key is required.

The shared TypeScript helper in `_shared/authorization.ts` validates Auth using `getUser` and checks current membership. It is dependency injected for credential-free tests. This is a helper, not a deployed Edge endpoint.

`submit_comment_review` takes the reviewer identity and the `human` provenance from the
session, never from the caller, and rejects a verdict whose content hash no longer matches
the stored comment. The review log is append-only in the database: a trigger rejects UPDATE
and DELETE even for a role that bypasses RLS, so a correction history cannot be rewritten.

Worker claim/heartbeat/checkpoint SQL lives in the private schema, with no authenticated execution grant. A future HTTP gateway must validate a separate scoped worker credential and derive the allowed workspace server-side before calling these primitives. Never give a worker the service-role key or accept a requested workspace as authorization. No worker HTTP endpoint is exposed in this increment.

Real OAuth start/callback, token handling, lease-guarded ingestion/metering and export endpoints remain later milestones. `commit_checkpoint` commits a checkpoint receipt only; it does not claim to implement production batch ingestion or quota metering.
