# Multi-agent protocol — closed

Ran 2026-09-13 from commit `5e9094f`. Ended the same day at `f3632ad`, when the two other
agents stopped for good. Kept as a record of what it was, what it caught, and why it ended.

## What it was

Four lanes, each a separate git worktree on its own branch, with one writer per area:

| Lane | Branch | Owned |
| --- | --- | --- |
| worker | `codex/agent-a-worker` | `workers/python/**` |
| platform | `codex/agent-b-platform` | `apps/web/**`, `tests/e2e/**`, most of `packages/contracts/src/**` |
| schema | `codex/agent-c-schema` | `supabase/**` |
| integration | `codex/coordination-integration` | shared contracts, root tooling, shared docs, merges |

`packages/contracts/src/index.ts` and `src/jobs.ts` were **coordinated**: the barrel and the
worker-facing contract are where two lanes meet, so neither lane changed them unilaterally.
`scripts/check-ownership.mjs` enforced the table and a `.githooks/pre-commit` hook ran it,
picking the lane from the branch name.

## What it was worth

The guard refused three commits, and each time the change belonged in another lane. That is
the honest case for it: it was not decorative while there were multiple writers.

The lane split also shaped the code in a way that outlived it. Splitting `contracts/index.ts`
into domain modules happened so two lanes could work without a round trip, and the result is
better organised than the 438-line file it replaced. `sync.ts` is application schema and
`jobs.ts` is worker protocol because the protocol had to be stable for the other lane —
a distinction still worth keeping.

## Why it ended

The worker and schema lanes never produced a commit. Work assigned to them was taken on
directly after the user reassigned it, and committed on integration so those lanes could
rejoin by merging rather than by reconciling a rewritten branch. They never did.

With one writer the protocol was pure overhead. Every cross-cutting change had to land on
integration anyway, and the guard was a no-op there by construction — `violations()` returned
nothing for the integration lane, so it only ever checked that the branch name was spelled
right. Keeping it would have meant maintaining a branch whitelist that refuses commits on
`main`.

## What replaced it

One branch, `main`, in the original checkout. The worktrees are removed and the lane branches
are deleted; every commit they held is an ancestor of `main`, so nothing was lost.

`scripts/check-secrets.mjs` stays — it never had anything to do with lanes.

`docs/agent-reports/platform.md` is kept as the detailed log of the lane that did the work.
The worker, schema and integration reports were stubs describing tasks that were never
started, and would have read as instructions to agents that do not exist.
