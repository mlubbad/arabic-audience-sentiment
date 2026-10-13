# Project context for agents (read this instead of the long docs)

Kept under 200 lines on purpose. If something here is wrong, say so on your work order;
Claude fixes this file.

## 1. What the product is
Arabic-first, multi-tenant SaaS. A creator or organisation connects channels (YouTube,
Facebook pages and Instagram accounts via OAuth, or public YouTube/X/TikTok/Telegram/
Facebook/Instagram channels). A worker collects comments, classifies
sentiment (Positive, Negative, Neutral, Mixed) and topics, and a dashboard shows them with
filters, human corrections and CSV export. Plans and billing run through Paddle. The UI is RTL
Arabic first, with English.

## 2. How a comment flows
```
Python worker      workers/python/src/server/loop.py → runner.py
  collectors/*       fetch comments (official APIs incl. Meta Graph, or Apify / Bright Data scrapers, Telethon)
  sentiment/*        CAMeLBERT-DA (3-class), pinned revision, preprocessing strip-html-arabic-norm-v2
  topics/*           Gemini (prompt p1) or TypeSafe
      │  HTTPS, bearer = platform worker credential (never a workspace id)
Edge function      supabase/functions/worker → _shared/worker-gateway.ts
      │  hashes the bearer, routes claim / heartbeat / commit-batch / finish
Postgres           public.* RPC wrappers → private.*_impl (SECURITY DEFINER, search_path='')
      │  commit_batch writes comments + predictions in one transaction, meters usage idempotently
Web app            apps/web/src/data.ts → React Query → dashboard/, account/, ops/, admin/
```
Scheduling: pg_cron `sentiment-tick` hourly enqueues due work; the worker polls `claim`.

## 3. Where things live
| Path | What |
| --- | --- |
| `apps/web/src/` | React 19 + Vite + Chart.js. `data.ts` decides fixture vs live data. `strings/ar.ts`, `strings/en.ts` hold all UI text |
| `apps/web/src/dashboard/` | Live dashboard (server-side aggregates) |
| `apps/web/src/account/`, `ops/`, `admin/` | Workspaces and channels, sync/catalogue/import, platform admin |
| `packages/contracts/src/` | Zod schemas. `jobs.ts` = worker↔DB wire contract (changes need Claude's sign-off). `snapshot.ts` = fixture-mode aggregation |
| `supabase/migrations/` | 100+ timestamped SQL files, applied in filename order, immutable |
| `supabase/functions/` | Deno edge functions: `worker`, `oauth-start`, `oauth-callback`, `paddle-*`, `billing-portal`, `channel-lookup`. Logic lives in `_shared/` |
| `supabase/tests/` | Vitest + PGlite (real Postgres in-process): real migrations, real RLS |
| `workers/python/src/` | `collectors/`, `sentiment/`, `topics/`, `server/` (control-plane client), `labelling/` (evaluation) |
| `workers/python/tests/` | pytest; `fixtures/golden_batch.json` is produced by the Python client and consumed by the TS seam test (regenerate, never hand-edit) |
| `tests/e2e/` | Playwright against the fixture shell (no live services) |
| `scripts/` | secret scan, deploy, migration apply, ops helpers |
| `docs/engineering/PLAYBOOK.md` | Team rules and code standards (binding) |
| `docs/adr/` | Architecture decisions |

## 4. Commands (Node 22.14+ <23, npm 10, Python 3.12 via uv)
| Command | Use |
| --- | --- |
| `npm ci` and `uv --directory workers/python sync --frozen` | install |
| `npx vitest run path/to/file.test.ts` | one web/contracts/DB test file (fast; use while working) |
| `uv --directory workers/python run --frozen pytest tests/test_x.py` | one worker test file |
| `npm run lint` / `npm run typecheck` / `npm run format:check` | static checks |
| `npm test` | web + contracts unit tests |
| `npm run test:db` | all PGlite database tests (~75 s) |
| `npm run worker:test` / `npm run worker:lint` | worker tests / Ruff |
| `npm run check` | everything except e2e (~3–5 min). Run once before asking for review |
| `npm run test:e2e` | Playwright (~3 min). Starts its own dev server; refuses one already running |
| `git config core.hooksPath .githooks` | one-time: enable the pre-commit hook (prettier/eslint/ruff on staged files; bypass with `--no-verify`) |

Traps:
- `npm run dev -- --port X` is silently ignored. Playwright uses `E2E_PORT`.
- `getByLabel` is a substring match; selects carry an explicit `aria-label`.
- PGlite is single-connection, so it can't prove concurrency.

## 5. Invariants (breaking one is a defect even if tests pass)
1. **Tenant from credential, never from the request.** No endpoint trusts a workspace id it is sent without a membership check in SQL.
2. **Failure never becomes success.** A collection that fails or stops early is `partial`, `failed` or `blocked`, never `succeeded`/`exhausted` with zero rows.
3. **Unknown is never zero.** Missing likes, views, counts → `null`/`None`, shown as "—". A missing date is `null` with precision `unknown`, never now().
4. **A malformed batch is refused whole**, never filtered.
5. **Metering happens where the spend happens**, idempotently.
6. **Commit is progress, not completion.** `commit_batch` checkpoints; `worker_finish` sets the terminal status.
7. **Mixed is a first-class label.** Skipped, failed and stale predictions never become Neutral and never enter the denominator.
8. **Migrations are immutable.** Add a new file.
9. **A test that can't fail isn't coverage.** Prove each new test goes red on the old code.
10. **Test the seam, not the stand-in.** Bugs live at boundaries (TS↔SQL argument names, Python↔JS number types).

## 6. Finding the current definition of a SQL function
Until the schema snapshot (work order G-5) lands, the **last** `create or replace function` in
filename order is the live one. Many functions are redefined 5–11 times (`commit_batch`,
`claim_job`, `dashboard_*_impl`). Find the live body with:
```
git grep -niE "create (or replace )?function private\.commit_batch\(" -- supabase/migrations | tail -1
```
Case is inconsistent (some migrations use uppercase), so keep `-i`.

## 7. Environments
- There is one Supabase project, and it is production. There is no staging project yet.
- `app.sky-develop.net` is the live site.
- Tests never touch either: PGlite and Playwright fixtures only.

## 8. Known-stale documents (don't trust without checking the code)
- `docs/coordination/ACTIVE.md` and `docs/coordination/README.md`: the old multi-agent protocol.
- `docs/agent-reports/*`.
- `docs/implementation-plan.md` (M0 era).
- `docs/deployment.md`: says there's no edge function and no worker, and that the site is password-protected. All false now.
- `docs/superpowers/plans/*`: write-once plans; the features shipped.
- `docs/ONBOARDING.md` §2 test counts (from 2026-09-14).
- `README.md` "Status" line.

## 9. Open work
The status board is GitHub issue #7. Security and correctness findings from the 2026-09-26
review are being fixed as work orders WO-1 … WO-6. Don't "fix" something that belongs to
another open work order; mention it on your issue instead.
