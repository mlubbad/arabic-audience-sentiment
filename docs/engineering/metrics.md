# Quality metrics

Updated weekly by Claude. Every figure names its source. "Not measured" means no tool exists
yet, not zero.

## Baseline: 2026-09-28 (main at `b075003`)

| Metric | Value | Source | Target |
| --- | --- | --- | --- |
| `main` CI (`verify`) green, last completed runs | 0 / 2 (runs 144, 146 red; 145 cancelled) | GitHub Actions "Credential-free checks" | 100% |
| Deploys shipped while a gate was red on the same commit | 3 of the last 3 completed deploys (runs 59, 60, 62: Security red on all 3, `verify` also red on 60 and 62) | GitHub Actions "Deploy Preview", "Security", "Credential-free checks" | 0 |
| Open critical / high review findings | 4 / 7 | 2026-09-26 project review | 0 / 0 |
| Unit tests (web + contracts) | 983 passed / 983 | `npm test`, run 2026-09-26 | all pass |
| DB tests (PGlite) | 408 passed / 408 | `npm run test:db`, run 2026-09-26 | all pass |
| Worker tests | 285 passed, 1 failed (live-network test) | `npm run worker:test`, run 2026-09-26 | all pass, no network |
| e2e | 124 passed, 1 failed, 5 skipped | CI run 36056131047 | all pass |
| SQL functions redefined ≥ 3 times, with no current-state reference | 27 (worst: `commit_batch` ×11, `claim_job` ×10, `dashboard_snapshot_impl` ×10) | `git grep` over `supabase/migrations` | snapshot exists (G-5) |
| Non-test source files > 400 lines | `Dashboard.tsx` 1,174 · `WorkspaceCard.tsx` 1,052 · `Account.tsx` 1,040 · `data.ts` 992 · `Catalogue.tsx` 821 · `HistoricalImportModal.tsx` 635 · `AdminServicesPage.tsx` 628 | `wc -l` | shrinking; no new ones |
| Inline `style={{}}` in TSX | 73 | `git grep` | 0 in new code |
| `any` / `ts-ignore` / `noqa` | 1 / 1 / 4 | `git grep` | ≤ baseline, each with a reason |
| Line coverage (web / worker) | not measured | no coverage tool (G-3) | baseline, then never decreasing |
| Python functions with type hints | not measured | no type checker (G-4) | `mypy --strict` on new modules |
| Sentiment macro-F1, 3-class / 4-class (production model CAMeLBERT-DA) | 0.708 / 0.523, Mixed F1 0.000 | `docs/evaluation/model-comparison.md` (313 rows, 1 channel, 1 annotator) | ≥ 0.75 on a held-out set (project gate, `docs/labelling-guide.md:132`) |
| Hours since last successful collection | not monitored | no alerting configured | alert at a threshold the owner chooses |

## Team (starts with the first reviewed PR)
| Agent | PRs reviewed | First-pass approvals | Avg review rounds | Scope violations |
| --- | --- | --- | --- | --- |
| Codex | 0 | — | — | — |
| Gemini | 0 | — | — | — |
