# A platform worker credential (design)

2026-09-18. One worker credential that serves every workspace, so a workspace created by
a signup is collected without an operator minting, installing and restarting anything.
Chosen by the owner over per-workspace provisioning after a signed-in `creator_plus`
tenant sat on «الجمع متوقّف الآن — لا شيء يعمل» with a discover job that no worker could
ever claim. The change is SQL only: the gateway, the Edge Function, the Python worker, the
service script, the contract and the UI keep their shape.

## Decisions taken in conversation

- **Platform, not provisioning.** The alternative — register a scoped credential for each
  new workspace, add a `_WS3` to the service script, restart — repeats per customer and
  was declined.
- **One migration, nothing above it changes.** The wire contract never carries a
  workspace: the worker sends a bearer and job ids, and the database derives the tenant.
  So a credential that resolves to "any workspace" needs no gateway, worker, contract or
  UI change.
- **Liveness through the table that exists.** A platform worker's poll asks every
  workspace for work, so the poll is recorded as a sighting of every workspace in
  `public.worker_seen`. `dashboard_snapshot`'s `worker.connected` and the ops panel read
  that table already; neither changes.
- **Fairness: oldest due first.** Across workspaces the claim orders by `not_before, id`,
  exactly as it does within one. `enqueue_scheduled` already bounds a channel to one
  outstanding job per type, so no tenant can queue deep enough to starve another.
- **Scoped credentials keep working.** Nothing about them changes except one guard:
  retiring a workspace's last scoped credential is allowed once an active platform
  credential exists, because the workspace is not left without a worker.

## What exists

`private.worker_credentials(token_hash, label, workspace_id not null, status)` binds a
credential to one workspace (`20260913160000`). `private.worker_workspace(token_hash)`
updates `last_seen_at` on the active row and returns its `workspace_id`, raising
`invalid_worker_credential` when nothing matched. Six functions call it directly:
`worker_claim` (→ `claim_job(w)`), `worker_job` (the lease guard every job-bound call
runs first: `lease_lost` if the lease is gone, `forbidden` if the job's workspace is not
the credential's, else returns `w`), `worker_channel_grant`, `worker_store_grant`,
`worker_mark_revoked` (`20260914010000`), and `worker_tick` (→ `schedule_due_work(w)`,
`20260915132000`). Every other worker function — heartbeat, commit-batch, finish,
due-videos, commit-catalogue, video-finished, video-counts, topics-due, commit-topics —
takes its workspace from `worker_job`'s return value.

`private.claim_job(w)` (`20260915132000`) records the sighting in `public.worker_seen`
(one row per workspace, `on conflict do update`), fails jobs past their attempts, and
claims the oldest due job of that workspace with `for update skip locked`, opening a
`sync_runs` row. `dashboard_snapshot_impl` (`20260916012000`) reports
`worker.connected` as "this workspace's `worker_seen` row is younger than three
minutes" and `last_heartbeat_at` as that row's time.

Registration is `svc_register_worker_credential(secret, label, w)` (`20260914012000`),
which hashes the secret with sha256 and requires an existing workspace; retirement is
`svc_retire_worker_credentials(w, keep)` (`20260915160000`), which revokes the
workspace's other active credentials and refuses an empty `keep` with
`keep_at_least_one`. `delete_workspace` (`20260917100000`) deletes the workspace's
credentials by `workspace_id`. `scripts/worker-service.sh` joins `WORKER_CREDENTIAL` and
an optional `WORKER_CREDENTIAL_WS2` into the loop's comma-separated list; the loop takes
one `ControlPlane` per credential in turn. On 2026-09-17 a test workspace was deleted
through the new door and took one of the two live credentials with it; the worker has
been refused on it every minute since, while the other still serves the owner's
workspace. `pg_cron` runs `private.schedule_all()` hourly (`20260917110000`).

## Approach

One new file, `supabase/migrations/20260918130000_a_platform_worker_credential.sql`.
Every `create or replace` in it is a whole-body rewrite from the function's current
definition, named at each, with only the change described — never from an older draft.

### Schema

`alter table private.worker_credentials alter column workspace_id drop not null`, with a
column comment: null is a platform credential, which serves every workspace. The FK,
the unique `token_hash`, and the status check stay. `delete_workspace`'s
`delete … where workspace_id = w` leaves platform rows alone by construction.

### `worker_workspace` — null means every workspace

Rebuilt from `20260913160000:22-30`. The update-returning now also returns a marker so
"no active row" and "an active platform row" are told apart: it raises
`invalid_worker_credential` only when no row matched, and returns null for a platform
row. The six direct callers are rebuilt to read null as "any workspace":

- **`worker_claim`** (`20260913160000:32-36`): unchanged text, because `claim_job` itself
  learns the null.
- **`claim_job(w)`** (`20260915132000:4-60`): the sighting upsert becomes
  `insert … select id, now() from public.workspaces` when `w` is null (every workspace;
  the platform worker asked them all) and the single-row upsert otherwise; the reaper
  and the claim predicate become `(w is null or workspace_id = w)`; the order, the
  lock, the `sync_runs` row and the returned row are the same text. A claimed job's
  `workspace_id` is the job's own, which is what the gateway's `dueVideos`, the grant
  and every later call key on.
- **`worker_job(token_hash, j, t)`** (`20260913160000:40-49`): `lease_lost` as before;
  `forbidden` only when `w is not null and owner <> w`; returns `owner` — the job's
  workspace — in both cases (for a scoped credential that is `w`, as today).
- **`worker_channel_grant`** (`20260914010000:14-30`): the join keeps
  `jb.workspace_id = c.workspace_id`; the credential predicate becomes
  `(w is null or c.workspace_id = w)`.
- **`worker_store_grant`** (`20260914010000:32-39`): `where id = connection and (w is
  null or workspace_id = w) and status = 'connected'`.
- **`worker_mark_revoked`** (`20260914010000:44-50`): `where id = j and (w is null or
  workspace_id = w)`.
- **`worker_tick`** (`20260915132000:196-199`): a scoped credential still returns
  `schedule_due_work(w)`; a platform credential loops over the workspaces of active
  subscriptions — the same set `schedule_all()` walks — summing the two counters, and
  returns `{discover, collect, workspaces}`. `schedule_all()` and its `pg_cron` schedule
  are untouched.

### Registration and retirement

- `private.register_platform_worker_credential(secret, label)` +
  `public.svc_register_platform_worker_credential(secret, label)`: the same
  `weak_credential` check (32+ characters), inserts with `workspace_id null`, returns
  the id. Service role only, like its scoped sibling.
- `private.retire_platform_worker_credentials(keep uuid[])` +
  `public.svc_retire_platform_worker_credentials(keep)`: revokes every active platform
  credential not named; `keep_at_least_one` on an empty list, `unknown_credential` on a
  name that is not an active platform credential. Rotation is register-then-retire, as
  for scoped ones.
- `private.retire_worker_credentials(w, keep)` rebuilt from `20260915160000:12-30`: an
  empty `keep` is refused with `keep_at_least_one` **unless** an active platform
  credential exists; everything else is the same text.

### What does not change

`supabase/functions/_shared/worker-gateway.ts`, `supabase/functions/worker/index.ts`,
`workers/python/**`, `scripts/worker-service.sh` (the optional `_WS2` stays: a scoped
extra credential is still a valid deployment), `packages/contracts/**`, `apps/web/**`,
`dashboard_snapshot_impl`, `schedule_all`, `delete_workspace`. The `worker_seen`
comment stays true: the last time a worker asked this workspace for work.

## Testing

A new PGlite suite, `supabase/tests/platform_worker.test.ts`, on the same bootstrap as
`worker_gateway.test.ts` (roles, `auth.uid()`, every migration in order, two
workspaces A and B with a channel and an active plan each, a third workspace C with no
jobs, one scoped credential for A, one platform credential registered through the new
service-role entry point, one revoked platform credential):

1. Registration returns an id whose row has `workspace_id` null; a 31-character secret
   is refused `weak_credential`.
2. The platform credential claims A's older job, then B's; each returned row's
   `workspace_id` is the job's own; after the first claim `worker_seen` has a fresh row
   for A, B **and** C.
3. `worker_heartbeat`, `worker_finish` on B's job succeed with the platform credential;
   A's scoped credential is still `forbidden` on B's job (the existing suite proves the
   rest of the scoped behaviour).
4. `worker_channel_grant` with the platform credential returns B's connection for B's
   job; `worker_mark_revoked` marks B's channel; a job whose channel has no connection
   is `channel_not_connected`.
5. `worker_tick` with the platform credential returns `{discover, collect, workspaces}`
   with `workspaces` equal to the number of active subscriptions; with the scoped
   credential it returns `{discover, collect}` as before.
6. `dashboard_snapshot` read as B's owner reports `worker.connected` true after the
   platform claim, with no scoped credential for B in existence.
7. The revoked platform credential is `invalid_worker_credential`;
   `svc_retire_platform_worker_credentials` with the live one in `keep` revokes the
   other, with an empty list is `keep_at_least_one`, with a scoped id is
   `unknown_credential`.
8. `svc_retire_worker_credentials(A, '{}')` is allowed while a platform credential is
   active and revokes A's scoped one; the same call with every platform credential
   revoked is `keep_at_least_one`.

Mutation, recorded in `docs/verification.md`: with `(w is null or …)` reverted to
`workspace_id = w` in the claim predicate, case 2 must fail; with the all-workspaces
sighting reverted to the single row, case 2's C assertion and case 6 must fail.

The existing suites (`worker_gateway`, `worker_catalogue`, `worker_video_counts`,
`worker_topics`, `lease_recovery`, `end_to_end`, `workspace_lifecycle`) must stay
green unchanged: they are the proof that scoped credentials still behave.

## Rollout, by the operator's hand

The auto-mode guard refuses live reads, pushes and deploys from this session, so these
are handed over as commands, in this order, after the migration is committed and pushed:

1. `npx supabase db push --linked` — the one new migration.
2. Register: `select public.svc_register_platform_worker_credential('<64 hex from openssl
   rand -hex 32>', 'platform-2026-09-18')` over `npx supabase db query --linked`.
3. `.env.local`: `WORKER_CREDENTIAL=<that secret>`; delete `WORKER_CREDENTIAL_WS2` and
   `WORKER_CREDENTIAL_NEW_ID`.
4. `sh scripts/worker-service-update.sh` — copies the env, restarts; the log should say
   `tenants=1`, then claim the `creator_plus` tenant's discover job within a minute.
5. Retire the owner's scoped credential: `select
   public.svc_retire_worker_credentials('d0c3b9fc-b813-439e-a32b-71dd357f0bb4', '{}')`.
6. `/sync` for the new tenant reads «متصل» and the catalogue fills once discover runs.

## Out of scope

Round-robin fairness across tenants, per-tenant rate isolation, more than one platform
worker (already safe: `for update skip locked`), and any change to what a scoped
credential may do.
