Read `AGENTS.md`, `docs/ONBOARDING.md`, and `docs/Codex-Build-Handoff.md` before implementation.
The "Security and CI rules" section of `AGENTS.md` is binding: the five CI gates
(CodeQL, Semgrep, gitleaks, dependency audits, verify) must stay green, every
action/container is pinned by SHA/digest, and secrets never enter tracked files.
Follow the latest explicit user request. The former multi-agent worktree protocol is closed; work on `main` in this checkout and use the dated entries in `docs/progress.md` and `docs/verification.md` for current status.
