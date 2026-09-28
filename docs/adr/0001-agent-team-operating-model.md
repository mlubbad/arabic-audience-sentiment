# 0001. Agent team operating model
Status: proposed
Date: 2026-09-28

## Context
- Between 2026-09-21 and 2026-09-24, feature work landed directly on `main`. `main` deploys to
  production on every push, and the last 3 completed deploys (runs 59, 60, 62) shipped while the
  Security workflow was red on the same commit (2 of them with `verify` red too).
- The 2026-09-26 review found 4 critical and 7 high findings. Among them: committed credentials,
  cross-tenant data copying, and collection failures recorded as success.
- An earlier multi-agent protocol (2026-09-13) ended because agents overwrote each other's work
  in one checkout with no remote.
- There is now a GitHub remote, branch protection is being enabled (WO-0, #8), and the owner
  wants Claude to lead two engineering agents: Codex (limited token budget) and Gemini (larger budget).

## Decision
- **Roles.** Claude is PM, architect, QA, DevOps and data lead. Codex and Gemini implement.
  The owner merges and owns everything that touches money, accounts or production.
- **Work orders.** Work is specified as GitHub issues. Each one lists owned paths and a
  migration timestamp range, so two agents never edit the same files.
- **Isolation.** Each agent works in its own git worktree and branch, and delivers through a PR.
  Only the owner merges. Agents never deploy or apply migrations.
- **Review.** Claude reviews every PR by re-running the checks on the branch, not by reading
  the PR text.
- **Budget-aware sizing.** Codex gets small, pre-digested, high-stakes changes. Gemini gets
  breadth.
- **Shared docs.** `docs/progress.md`, `docs/verification.md`, `docs/decisions.md`, ADRs and
  the agent instruction files are edited by Claude only.
- **Rules location.** Team rules live in `AGENTS.md` (entry point),
  `docs/engineering/PLAYBOOK.md` (details) and `docs/agents/CONTEXT.md` (short project brief
  that replaces reading the long logs).

## Consequences
- **Easier:** parallel work without collisions; every change is reviewed and CI-gated; agents
  start faster on a short brief.
- **Harder:** more ceremony per change, and the owner becomes the merge bottleneck. Claude's
  review turnaround sets the pace.
- **Risk:** the agents can't be forced to follow the rules. Branch protection, CI gates and
  review are the enforcement.
- **Watch:** first-pass approval rate and review rounds per agent (`docs/engineering/metrics.md`),
  used to resize work orders.
- **Supersedes** the "one writer, one branch: `main`" rule in the previous `AGENTS.md`.
