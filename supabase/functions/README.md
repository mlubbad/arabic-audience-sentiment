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


## Paddle webhook

`paddle-webhook/index.ts` is Paddle's notification destination. It runs with the service
role: the caller is Paddle, not a signed-in user, and the HMAC in `Paddle-Signature` over
the raw body is the authentication — checked before the body is parsed, 401
`bad_signature` otherwise. The event is understood by the pure handler in
`_shared/paddle.ts` (tested without a project in `supabase/tests/paddle_webhook.test.ts`)
and applied through the service-only `public.billing_*` wrappers of migration
`20260917051000`, which are the whole database surface the key reaches; a tenant role
calling any of them gets `permission denied` (`supabase/tests/billing_surface.test.ts`).

The workspace in an event is Paddle's `custom_data`, echoed from checkout, and is never a
right to write: `apply_billing_event` lands it on that workspace's billing root and refuses a
price it does not sell. Every decided outcome (`applied`, `duplicate`, `stale`, `unmapped`,
`ignored`) is a 200 so Paddle stops retrying; a database error is a 500 with a code and no
message, and Paddle retries it.

Secrets, set with `supabase secrets set` and never written in this repository:

| Secret | Read by | What it is |
| --- | --- | --- |
| `PADDLE_WEBHOOK_SECRET` | `paddle-webhook` | The notification destination's secret key, from Paddle's dashboard |
| `PADDLE_API_KEY` | checkout and portal functions (C4/C5) | A Paddle API key, server side only |
| `PADDLE_ENV` | checkout and portal functions (C4/C5) | `sandbox` or `production`, choosing the Paddle base URL |

Paddle sends no Supabase JWT, so the function is deployed without the gateway's JWT check —
`supabase config.toml` carries `[functions.paddle-webhook] verify_jwt = false` for the local
stack, and the deploy is `supabase functions deploy paddle-webhook --no-verify-jwt`. The
signature is the only auth, which is why the secret must be set before the URL is given to
Paddle: while it is unset the function answers 500 `not_configured` to every request rather
than verify against an empty key, and Paddle retries those once the secret is in place.
