# Control functions

M2 exposes role-checked SQL RPCs `create_workspace`, `enqueue_sync`, `register_channel` and `submit_comment_review`. Calls use the user's Supabase session; no browser service key is required.

The shared TypeScript helper in `_shared/authorization.ts` validates Auth using `getUser` and checks current membership. It is dependency injected for credential-free tests. This is a helper, not a deployed Edge endpoint.

`submit_comment_review` takes the reviewer identity and the `human` provenance from the
session, never from the caller, and rejects a verdict whose content hash no longer matches
the stored comment. The review log is append-only in the database: a trigger rejects UPDATE
and DELETE even for a role that bypasses RLS, so a correction history cannot be rewritten.

Worker claim/heartbeat/checkpoint SQL lives in the private schema, with no authenticated execution grant. A future HTTP gateway must validate a separate scoped worker credential and derive the allowed workspace server-side before calling these primitives. Never give a worker the service-role key or accept a requested workspace as authorization. No worker HTTP endpoint is exposed in this increment.

Real OAuth start/callback, token handling, lease-guarded ingestion/metering and export endpoints remain later milestones. `commit_checkpoint` commits a checkpoint receipt only; it does not claim to implement production batch ingestion or quota metering.

## Worker gateway

`_shared/worker-gateway.ts` is the seam between the Python worker and the SQL control
plane. It authenticates a scoped worker credential, hashes it before anything reaches the
database, and translates database refusals into the exact status codes the worker client
distinguishes: 401 unknown or revoked credential, 403 another tenant's job, 409 lease lost or
batch conflict, 429 quota exceeded, 400 malformed batch or outcome. Anything unrecognised is
a 500 carrying a code and no message, because a driver error can quote the connection string
and the credential with it.

It never reads a workspace from the request. Which tenant a worker may touch is derived from
its credential inside the database, and a `workspace_id` in the body is simply not looked at.

The handler is pure and takes an injected data layer, so it is tested without a deployed
project. **It is not yet deployed and has never served a real request**: binding it to a
Supabase Edge Function route, and wiring the data layer to the `private.worker_*` functions
with the service role, is the remaining step and needs a project.

