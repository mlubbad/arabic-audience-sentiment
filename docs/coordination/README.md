# Two-agent development protocol

Established 2026-09-13 from commit `5e9094f` (includes the platform agent's usage-display work).
This protocol changes coordination, not the product's private/no-paid-services constraints.

## Working directories and ownership

| Role | Branch | Directory | Writes |
| --- | --- | --- | --- |
| Integrator (this Codex task) | `codex/coordination-integration` | `/Users/mlubbad/Documents/Codex/SentimentAnalysis-worktrees/integration` | Shared contracts, root tooling/Node manifests and locks, shared docs; reviewed merges |
| Worker implementation (Codex) | `codex/agent-a-worker` | `/Users/mlubbad/Documents/Codex/SentimentAnalysis-worktrees/worker` | `workers/python/**`, `docs/agent-reports/worker.md` |
| Platform implementation (Claude Code) | `codex/agent-b-platform` | `/Users/mlubbad/Documents/Codex/SentimentAnalysis-worktrees/platform` | `apps/web/**` except its package manifest, `supabase/**`, `tests/e2e/**`, `docs/agent-reports/platform.md` |

The original `/Users/mlubbad/Documents/Codex/SentimentAnalysis` checkout is a transition area owned by Claude until its current work is checkpointed. Codex never edits its product files. Once Claude acknowledges migration to the platform worktree, keep the original checkout read-only until the user selects it for a handoff. Do not reset, stash, clean or overwrite another agent's changes.

Worktrees isolate files and Git indexes, but share branches and objects. Never check out, reset, rebase, delete or force-update another role's branch. No symlinked node_modules, virtual environments, raw datasets or browser profiles between worktrees. No concurrent agents in the same worktree, even on different features.

## One writer per feature and shared interface

Read `tasks.md` before beginning. Only work on the tasks assigned to your lane. The integrator assigns/reassigns tasks; an agent never self-assigns another lane's task. No two agents implement the same feature. Cross-review is read-only and can happen in parallel.

`packages/contracts/**`, Node package manifests/lockfile, root configs, CI, AGENTS.md, CLAUDE.md, this protocol and shared progress/verification/decisions are integrator-owned. Need a schema or dependency change? Add a precise request to your lane report (name, payload, error behavior, compatibility and tests). Continue independent work. The integrator commits the shared interface first; both lanes merge that commit before depending on it. Do not make a competing copy of a shared contract.

Python manifest/uv.lock belong to the worker lane. Existing migrations are immutable for new work: platform adds new timestamped migrations; do not keep extending the initial migration now that multiple branches depend on it.

## Daily execution and handoff

1. At the beginning of EVERY command/edit, check your working directory. At task start run `pwd`, `git branch --show-current`, `git status --short`, and read AGENTS.md plus this protocol. Shell calls must specify the lane directory explicitly.
2. Record the task as active in your lane report; commit small coherent changes. Each report lists task ID, base commit, changed paths, commands/results, mocked/live distinction, requested shared changes and next task.
3. Run targeted checks while developing. Before handing off run `node scripts/check-ownership.mjs worker` or `platform`. It examines committed changes since the integration merge base, staged/unstaged changes and untracked files. This is a review guard, not an OS security boundary. Do not bypass it or relax ownership to make it pass.
4. Commit only your lane's files. Return the commit SHA and tests; no automatic merge and no direct push to another branch. Integration reads reports using `git show codex/agent-a-worker:docs/agent-reports/worker.md` and the equivalent platform command, so agents do not race over one status file.
5. Integrator reviews the diff and ownership, merges one branch at a time in the clean integration worktree, resolves conflicts with the relevant owner, runs the full checks and updates central progress/verification. A shared-contract conflict is a coordination defect, not something to resolve by choosing an entire side.
6. After an integrated batch passes, lanes merge `codex/coordination-integration` when clean. Do not rewrite reviewed history. If a merge fails, keep the lane isolated and report the exact conflict; do not touch the original checkout.

## Throughput without contention

- Two implementers maximum initially: one Python lane, one platform lane. Extra subagents may inspect/review read-only; new writing lanes require a distinct worktree and explicit task allocation by the integrator.
- Worker normally runs `npm run worker:test` / `worker:lint` (or equivalent uv commands). Platform runs targeted unit/SQL/browser tests. Integrator runs `npm run check` plus `npm run test:e2e` once per merged batch.
- Browser testing currently uses port 5173. Only platform or integration may run it, never both simultaneously. Check the other lane's report and active server first; stop only processes you started. Future distinct-port support is an integrator change, not a reason to edit shared config from a lane.
- Allow one heavy browser suite, model download/inference or full installation at a time on this laptop. Small independent tests and coding can overlap. Avoid repeated whole-suite runs with no new changes.
- Aim for reviewable task-sized commits and acceptance evidence, not token expenditure. No unlimited spend, paid resources, public publication or usage-limit changes are authorized by parallel work.

## External state

No agent deploys, applies remote migrations, changes secrets or sends messages externally merely because it owns a directory. Use the original authorization rules. Live Supabase/YouTube/OAuth/model validation remains a separate evidence category.

## Reference

[Official Codex worktree guidance](https://learn.chatgpt.com/docs/environments/git-worktrees) describes isolated parallel checkouts. These worktrees are standard local Git worktrees, created explicitly for cross-tool use; they are not new Codex sidebar tasks.

## Installed local commit guards

The two implementation worktrees and integration worktree use their own `core.hooksPath`
setting through Git's worktree-specific configuration. The original checkout's hook settings
are unchanged. `.githooks/pre-commit` runs the branch/path ownership check automatically.
Hooks can be bypassed by Git options, so this remains a cooperative boundary; all submitted
diffs are reviewed again by the integrator. The guard does not forbid work in unowned files
at filesystem level, which is why each agent must stay in its own directory.

When cloning this repository on another machine, hooks are not automatically installed.
After assigning the same lane branches, enable `extensions.worktreeConfig`, then configure
`core.hooksPath` with `git config --worktree core.hooksPath .githooks` separately inside each
lane. Do not apply this setting to an unassigned checkout.
