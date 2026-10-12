# Project instructions (every agent: Codex, Gemini, Claude)

> **Read first, in this order, and nothing else until your work order tells you to:**
> 1. `docs/agents/CONTEXT.md`: the project in under 200 lines (layout, commands, invariants).
> 2. `docs/engineering/PLAYBOOK.md`: team rules, Definition of Done, code standards, review checklist.
> 3. Your work-order issue on GitHub (linked from the tracker issue #7).
>
> Do **not** read `docs/progress.md`, `docs/verification.md`, `docs/superpowers/**`,
> `docs/coordination/**` or `docs/agent-reports/**` unless your work order names a section.
> They are long historical logs. Reading them wastes your budget and several parts are stale.

## Team and how work flows

| Role | Who | Owns |
| --- | --- | --- |
| Owner, final approver | Mohammed (@mlubbad) | Product decisions, money and accounts, merging, production deploys and migrations, credential rotation |
| PM, architect, QA, DevOps, data lead | Claude Code | Work orders, architecture decisions (`docs/adr/`), reviews, quality gates, the canonical docs |
| Precision engineer | Codex | Small, high-stakes, fully specified work orders |
| Volume engineer | Gemini | Refactors, test suites, UI, worker restructuring, investigations |
| DX / schema-tooling engineer | VS Code | Local tooling, schema snapshots, editor-driven config and DX chores |
| Reviewer & GitHub-native chore engineer | GitHub Copilot | First-pass PR reviews; small, fully-specified, low-risk chores it owns end to end |

**GitHub Copilot** is the team's automated first-pass reviewer and small-chore agent. It reviews
every PR before Claude's PM review (its findings are advisory — Claude still runs the binding
review and the owner still merges). For build work it takes only self-contained, fully-specified,
low-risk chores (added test coverage, docs, mechanical refactors, config/dependency hygiene) on a
`copilot/wo-N-slug` branch → one PR, like everyone else. It **never** touches security-critical or
cross-cutting code: not `.github/workflows/**`, the five CI gates, SHA/digest pins or secrets
(Claude/DevOps + Codex own those); not OAuth, DB security or RLS (Codex); not large features
(Gemini); not the Claude-owned docs. Because its coding agent runs in GitHub Actions and consumes
Actions minutes, it holds build chores while the account is out of minutes and does review-only
work (which costs no Actions minutes) until the quota resets. The owner's GitHub Education benefit
is active (Copilot Student plan, 2026-10-04): it is auto-model-selection only and excludes
third-party agents, and whether its coding agent and code review are enabled for this repository
is confirmed by the owner in the repository's Copilot settings before the first chore is assigned.

Work arrives as a **GitHub issue (work order)**. You build it on your own branch, open a PR,
and Claude reviews it. Only the owner merges. The playbook has the details; the short form is:

- One work order → one branch (`<agent>/wo-N-slug`) → one PR (`WO-N: …`, body starts `Closes #N`).
- Touch only the paths your work order lists as owned. Ask on the issue before touching anything else.
- **Never push to `main`, never merge, never deploy, never apply migrations remotely.**
- Paste real command output. For every new test, show that it fails on the old code.
- Blocked by a sandbox or a permission? Report it verbatim and stop. Never route around it: no
  `GIT_DIR`, no second repository under `/tmp`, no browser automation in place of a blocked CLI.
  (When Claude dispatches Codex locally, `scripts/codex-dispatch.sh` owns every git write and
  the PR; see `docs/engineering/codex-dispatch.md`.)
- `docs/progress.md`, `docs/verification.md`, `docs/decisions.md`, `docs/adr/`, `AGENTS.md`,
  `CLAUDE.md` and `GEMINI.md` are edited by Claude only, so they never conflict between agents.

## Product rules

Build the Arabic-first, multi-tenant audience-sentiment product (YouTube, X, TikTok, Telegram).
Inspect existing code first; reuse the design and repair its data flow. Stack: React/TypeScript/Vite
+ Chart.js, Supabase (Postgres, Auth, Edge Functions) and a separate Python worker. Do not add
FastAPI or other infrastructure without an accepted ADR in `docs/adr/`.

Do not enable paid services or real billing without the owner's explicit approval. Never expose
tokens or server keys in `VITE_*`. Keep real raw datasets out of tracked source; use sanitized
fixtures.

All dashboard views and exports share the same filter and effective-label rules.
Preserve Mixed sentiment, timestamp precision, text versions, and provenance.
Treat collection failures as partial/failed/blocked, never as successful empty datasets.
Unknown is `null`/`None`, never 0 and never "now".
Make ingestion, analysis, job retries, and metering idempotent.
Test tenant isolation against direct requests, not just hidden UI controls.
Distinguish mocked, fixture-tested, and live-tested flows. Use the repository's actual
lint/build/test commands and report real results.

## Security and CI rules — binding for every agent

Every PR runs five gates that must stay green: CodeQL (cross-file,
`security-extended`), Semgrep SAST (ERROR severity), gitleaks (full history),
npm/pip-audit (dependency CVEs), and `verify`. A red security check is a
blocker, not noise: fix the cause. Never bypass a gate — no `continue-on-error`,
no skip-workflow labels, no severity downgrades, no `--force` push to hide one.
The gates run when a PR is opened as ready or marked ready for review, on every
push after that, and on `main`; a **draft** runs none (a rule from the billing
block of 2026-10-10, kept for the queue and the noise now that the repository is
public). Run `npm run check` locally while drafting, and mark
the PR ready only when you want the gates to judge it.

Pin every `uses:` to a full commit SHA with the version in a comment, and pin
Docker containers by digest, never by tag. Resolve SHAs/digests from the
registry API, not from memory. New workflow files need: a least-privilege
`permissions:` block, `concurrency`, `timeout-minutes`, and
`persist-credentials: false` on checkout. Do not introduce `pull_request_target`
with checkout of untrusted code.

The repository is **public** (owner's decision, 2026-10-10, confirmed 2026-10-12):
every commit, issue, PR and workflow log is readable by anyone. So no self-hosted
runner may be registered on it (ADR 0002), workflow logs must never print a
secret or a customer's data, and the next rule is doubly binding.
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

CodeQL runs with `upload: never`, a setting from when the repository was private
without a Code Security license. The repository has been public since
2026-10-10, so the upload would be free; changing it is the owner's call, not a
side effect of another PR. CodeQL/Semgrep
findings are fixed or explicitly dismissed with a written reason — never
silenced by ignore comments without one.

Before touching any `.github/` or security file: validate YAML, run the
locally-equivalent checks (`semgrep scan --metrics=off ...`,
`gitleaks detect --source .`), and confirm the workflow on a branch before
merging to `main`.

## Branches, migrations and deployment

- `main` is protected and deploys to production (`app.sky-develop.net` plus the one Supabase
  project). Changes reach it only through a reviewed PR merged by the owner.
- Migrations are immutable once merged. Add a new timestamped file inside the timestamp range
  your work order gives you. Never edit an existing migration.
- Continuous deployment runs from `.github/workflows/deploy.yml` on `main`. Agents never run
  `npm run deploy:preview`, `npm run db:migrate:remote`, `supabase db push` or
  `supabase functions deploy`, and never call live paid services from tests.
- Keep changes reviewable: small coherent commits carrying the commands and results that back them.
