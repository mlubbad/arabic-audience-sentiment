# Paste this into the current Claude Code session

We are switching to coordinated parallel work with Codex. Preserve all your current work. Finish/checkpoint the current change in the original checkout; do not reset or stash it. Then read:

`/Users/mlubbad/Documents/Codex/SentimentAnalysis-worktrees/integration/docs/coordination/README.md`

Your prepared worktree is:
`/Users/mlubbad/Documents/Codex/SentimentAnalysis-worktrees/platform`
Branch: `codex/agent-b-platform`.

First compare your original checkout's HEAD with the prepared worktree. The prepared baseline includes `5e9094f` (usage display). If you have newer commits, report their SHAs and changed paths to the integrator in `docs/agent-reports/platform.md`; do not discard them or blindly replay them over the worktree. Keep working in only one directory and acknowledge when you have moved.

Read AGENTS.md, the complete handoff and docs/coordination/{README,tasks}.md in your worktree. You own apps/web (except its package manifest), supabase, tests/e2e, and docs/agent-reports/platform.md. Codex owns workers/python. Shared contracts, root configuration, Node manifests/lockfiles and central docs belong to the integrator. Request shared changes through your lane report; do not edit the other lane.

Start with P1: keep fixture behavior isolated even when Supabase Auth is configured. Then draft the required I1 worker batch contract for P2; continue independent work while the integrator publishes it. Add new migrations rather than changing the baseline migration. Test your changes and run `node scripts/check-ownership.mjs platform` before handoff. Commit only your owned files and report SHAs, actual test results and next work in your lane report. Do not merge into integration yourself.

The original private/no-paid-services and honest fixture/live evidence constraints remain. No need to wait for credentials for local implementation. Coordinate browser tests (port 5173) with the integrator and avoid simultaneous full-suite runs.
