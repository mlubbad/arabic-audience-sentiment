# 0004. Edge functions deploy from main, in the gated deploy job
Status: proposed
Date: 2026-10-19

## Context
- `deploy.yml` deploys the web app and the migrations of every verified `main` commit. Edge
  functions (`supabase/functions/*`) were never part of it. The owner deployed them by hand with
  `supabase functions deploy`, and `AGENTS.md` kept agents away from that command.
- That drifted. On 2026-10-19 the production `worker` was v35 from 2026-10-16 20:07 UTC. Since
  then main had changed it five times (#143, WO-20's `/worker/commit-channel`, WO-23). So every
  YouTube discover ended `partial channel_profile_commit_failed`, and channel profiles and stats
  stayed empty for two days. The owner deployed v36 by hand at 07:19 UTC, and the first profile
  landed at 07:42.
- The same day, the Management API showed that eight other functions were older than the last main
  change to them or to `_shared/`. Read-only dry run of `scripts/deploy-functions.mjs`, 2026-10-19:

  | Function | Production `updated_at` | Last main change (`54402a0`, #171) |
  | --- | --- | --- |
  | paddle-webhook | 2026-09-16 13:11 | 2026-10-18 16:59 |
  | billing-portal, paddle-checkout | 2026-09-19 21:30 | 2026-10-18 16:59 |
  | oauth-start, channel-lookup, oauth-callback, oauth-complete | 2026-10-13 06:34–07:47 | 2026-10-18 16:59 |
  | admin-users | 2026-10-17 20:47 | 2026-10-18 16:59 |

- Production runs `verify_jwt = false` on `worker`, `oauth-start`, `oauth-callback` and
  `paddle-webhook`, but `config.toml` declared it only for `paddle-webhook`. A deploy that leaves
  the flag out can switch the gateway's JWT check on, and that would lock out the worker's
  credential and the OAuth redirect. Getting it right depended on the owner remembering
  `--no-verify-jwt` for each of those functions.
- Migrations already go out through this job, using the `SUPABASE_ACCESS_TOKEN` secret. A function
  deploy uses the same credential, in the same job, for the same commit.

## Decision
- **The gated deploy job deploys functions.** In `deploy.yml`, the step "Deploy changed edge
  functions" runs after "Apply remote database migrations" and before the frontend upload, so new
  routes exist before a page calls them. It runs `npm run functions:deploy`
  (`scripts/deploy-functions.mjs`) with the same gate, `environment: production`, concurrency group
  and timeout as the rest of the job. Nothing on a branch or a pull request can reach it.
- **Stale, not "changed in this push".** A function is deployed when the newest commit on main's
  first-parent line touching `supabase/functions/<name>/`, `_shared/`, `deno.json` or `deno.lock`
  is newer than the function's `updated_at` in production, or when production doesn't have the
  function at all. If a deploy fails or never runs, the next one catches up without anyone keeping
  a list. Any change to `_shared/` redeploys every function. That's coarse but safe, because
  redeploying unchanged code changes nothing a caller sees.
- **The repository's CLI, bundled by Supabase.** The step runs `npx --no-install supabase` (the
  exact `devDependencies` version, installed by `npm ci`) with `--use-api` and an explicit
  `--project-ref`. It never pulls an edge-runtime container by tag, and it needs no Docker on the
  runner. The token reaches the CLI through its environment, never through argv or the log.
- **`verify_jwt` is declared, not remembered.** Every function has a
  `[functions.<name>] verify_jwt` entry in `supabase/config.toml` that matches production.
  `scripts/deploy-functions.test.ts` fails CI when a function has none. Before deploying anything,
  the step compares each declaration with production and refuses the whole run on a mismatch.
  Turning the check on or off for a function stays the owner's decision, made by hand. A
  `false` declaration deploys with `--no-verify-jwt`.
- **Verified, then compared again.** For each deployed function, the step reads
  `GET /v1/projects/{ref}/functions/{slug}` back. `updated_at` must have moved, `status` must be
  `ACTIVE`, and `verify_jwt` must equal the declaration. Then it lists every function again, and the
  job fails if any is still older than main. Functions that run in production but have no folder on
  main are named in the log, never deleted (no `--prune`).
- **Agents still never deploy.** They don't run `supabase functions deploy` or
  `npm run functions:deploy`. A function reaches production when the owner merges to main. The owner
  may still deploy by hand, for example to change `verify_jwt` or to run a branch build. The next
  main deploy replaces a hand-deployed branch build only if main changed the function after it.

## Consequences
- **Easier:**
  - A merged function change goes live in the same run as its migrations, or the run fails.
  - The worker can't fall days behind its gateway again without the deploy going red.
  - `npm run functions:check` (read-only, needs the owner's token) answers "is production behind
    main?" in one command.
- **Harder:**
  - Merging is now also a function release. A broken function on main reaches production in that
    run, the same way a broken migration already does. CI's `deno check` (`npm run check:functions`)
    and the tests are the only gates in front of it.
  - Every `_shared/` change redeploys all nine functions, about a minute of deploy time.
- **First run:** the first main deploy after this ADR merges releases the eight stale functions in
  the table above, each at main's code. Their own folders haven't changed since their last deploy.
  What changes is the `_shared/` modules they bundle. They need no function secret that production
  doesn't already have. The one name production lacks, `YOUTUBE_API_KEY` (read by `channel-lookup`
  since 2026-09-19), is unchanged by this release.
- **Watch:**
  - **The staleness rule compares time, not bytes.** If someone deploys a branch build by hand
    after main last changed that function, it's newer than main, so the job and
    `functions:check` treat it as current until main changes that function again. The Management API
    exposes `ezbr_sha256` of the deployed bundle, but no local bundle hash to compare it with. The
    rule covers the drift seen so far: production older than main.
  - **No separate drift job.** Only this job and the owner can change a production function. This
    job ends by checking every function, so drift can come only from a hand deploy. A scheduled
    check would put the Management token in a second workflow to catch the one case the time rule
    can't see anyway.
  - **`environment: production` has no branch policy today** (no protection rules, no deployment
    branch policy, 2026-10-19). That is not new: the same secrets already reach migrations and the
    FTP upload. But the job holding them now does more, and restricting the environment to `main` is
    the owner's setting to change.
