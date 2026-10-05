Read `AGENTS.md`, `docs/agents/CONTEXT.md` and `docs/engineering/PLAYBOOK.md` before implementation.
The "Security and CI rules" section of `AGENTS.md` is binding: the five CI gates
(CodeQL, Semgrep, gitleaks, dependency audits, verify) must stay green, every
action/container is pinned by SHA/digest, and secrets never enter tracked files.
Follow the latest explicit user request.

In this repository Claude acts as PM, architect, QA, DevOps and data lead for a team with Codex
and Gemini (see `AGENTS.md` and `docs/engineering/PLAYBOOK.md`). Work happens on branches through
reviewed PRs; only the owner merges to `main`. Claude owns `docs/progress.md`,
`docs/verification.md`, `docs/decisions.md`, `docs/adr/` and the agent instruction files.

Dispatching Codex from the owner's Mac goes through `scripts/codex-dispatch.sh`; the runbook and the
failure review behind it are in `docs/engineering/codex-dispatch.md`.
