# Project instructions

> **Before writing anything, read `docs/coordination/ACTIVE.md`.**
> More than one agent works in this checkout — Claude Code, Antigravity, Codex —
> and they have no channel to each other. That file is the channel: who holds
> which paths, what collides silently, and the one mistake that permanently
> destroys work here (there is no git remote).

Read docs/Codex-Build-Handoff.md completely before implementation.
The latest explicit user instructions take precedence over historical proposals.

Build the Arabic-first, multi-tenant YouTube sentiment MVP described there.
Inspect existing code/assets first. Reuse the design and repair its data flow.
Use React/TypeScript/Vite + Chart.js, Supabase control functions/Postgres/Auth,
and a separate Python worker. Do not add FastAPI or extra infrastructure
without a concrete need recorded in docs/decisions.md.

Keep UI publication private. Do not enable paid services or real billing
without explicit approval. Never expose tokens or server keys in VITE_*.
Keep real raw datasets out of tracked source; use sanitized test fixtures.

All dashboard views and exports share the same filter and effective-label rules.
Preserve Mixed sentiment, timestamp precision, text versions, and provenance.
Treat collection failures as partial/failed, never as successful empty datasets.
Make ingestion, analysis, job retries, and metering idempotent.
Test tenant isolation against direct requests, not just hidden UI controls.

Proceed through M0–M6 with reviewable increments. Continue local work if external
credentials are missing. Distinguish mocked, fixture-tested, and live-tested flows.
Update docs/progress.md, docs/decisions.md, and docs/verification.md after milestones.
Use the repository's actual lint/build/test commands and report real results.
Do not stop at planning or leave clickable controls without working behavior.

## Security and CI rules — binding for every agent

Every PR runs five gates that must stay green: CodeQL (cross-file,
`security-extended`), Semgrep SAST (ERROR severity), gitleaks (full history),
npm/pip-audit (dependency CVEs), and `verify`. A red security check is a
blocker, not noise: fix the cause. Never bypass a gate — no `continue-on-error`,
no skip-workflow labels, no severity downgrades, no `--force` push to hide one.

Pin every `uses:` to a full commit SHA with the version in a comment, and pin
Docker containers by digest, never by tag. Resolve SHAs/digests from the
registry API, not from memory. New workflow files need: a least-privilege
`permissions:` block, `concurrency`, `timeout-minutes`, and
`persist-credentials: false` on checkout. Do not introduce `pull_request_target`
with checkout of untrusted code.

Secrets never enter tracked files — not in code, fixtures, docs, or plans.
`.env*` is gitignored (only `.env.example` is tracked). If gitleaks flags
test data, verify it is synthetic, then allowlist by exact fingerprint
(commit:file:rule:line) in `.gitleaksignore` — never by broad path exclusions.
New dependencies change the audit surface: npm production deps are gated by
`npm audit --omit=dev --audit-level=high`; the Python runtime is gated by
pip-audit over the exported `uv.lock`. Dependabot does not cover uv.lock —
refresh it manually with `uv lock --upgrade` and let CI verify.

Database rules stay as built: every `public` table has RLS enabled with
tenant-scoped policies (see the loop pattern in the foundation migration),
sensitive data lives in the `private` schema, and SECURITY DEFINER functions
set `search_path=''`. New tables follow the same pattern — RLS is not a
follow-up task.

CodeQL runs with `upload: never` because the repo is private without a Code
Security license; keep it that way unless the license exists. CodeQL/Semgrep
findings are fixed or explicitly dismissed with a written reason — never
silenced by ignore comments without one.

Before touching any `.github/` or security file: validate YAML, run the
locally-equivalent checks (`semgrep scan --metrics=off ...`,
`gitleaks detect --source .`), and confirm the workflow on a branch before
merging to `main`.

One writer, one branch: `main` in this checkout. The multi-agent worktree protocol ran
on 2026-09-13 and is closed; docs/coordination/README.md records what it was and why it
ended. Read docs/ONBOARDING.md before starting. Migrations are immutable once applied —
add a new timestamped file. Keep changes reviewable: small coherent commits carrying the
commands and results that back them.
