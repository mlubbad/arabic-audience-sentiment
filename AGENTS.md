# Project instructions

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

One writer, one branch: `main` in this checkout. The multi-agent worktree protocol ran
on 2026-09-13 and is closed; docs/coordination/README.md records what it was and why it
ended. Read docs/ONBOARDING.md before starting. Migrations are immutable once applied —
add a new timestamped file. Keep changes reviewable: small coherent commits carrying the
commands and results that back them.
