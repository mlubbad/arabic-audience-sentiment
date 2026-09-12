# Verification

Run 2026-09-12 on macOS 24.6.0 (darwin, x86_64), Node 22.14.0, npm 10.9.2,
Python 3.12.10, uv 0.11.11. Every command below was executed in this workspace and the
result recorded is the observed output, not an expectation.

The machine default is Node 26 / npm 11, which `engine-strict=true` correctly rejects.
All commands were run with Node 22.14.0 first on `PATH`, matching `.nvmrc`.

## Clean installation

| Command | Result |
| --- | --- |
| `rm -rf node_modules apps/web/node_modules packages/contracts/node_modules && npm ci` | Pass — 237 packages, 0 vulnerabilities |
| `rm -rf workers/python/.venv && uv sync --frozen` (in `workers/python`) | Pass — 9 packages resolved from `uv.lock` |
| `npm audit --audit-level=low` | Pass — 0 vulnerabilities |
| `npx playwright install chromium` | Pass — browser present |

## Checks

All of the following were run after the clean install above.

| Command | Result |
| --- | --- |
| `npm run lint` | Pass — ESLint clean; Ruff "All checks passed!" |
| `npm run format:check` | Pass — all matched code files use Prettier style |
| `npm run typecheck` | Pass — no `tsc` diagnostics |
| `npm test` | Pass — 10 tests, 2 files |
| `npm run test:db` | Pass — 8 tests |
| `npm run worker:test` | Pass — 23 tests, 4 files |
| `npm run build` | Pass — 146 modules; `index.js` 478.09 kB (151.76 kB gzip), `index.css` 6.29 kB |
| `npm run check:secrets` | Pass — 61 source files plus built assets |
| `npm run test:e2e` | Pass — 6 tests, Chromium |
| `npm run worker:collect -- --source fixture …` | Pass — status `succeeded`, 2 unique comments, coverage declared as source traversal only |

`npm run check` runs everything except `test:e2e` in one command, and passed end to end.

`format:check` deliberately excludes Markdown: `docs/input-inventory.md` records the SHA-256
of the two supplied specification files, and both hashes were re-verified unchanged after this
work.

## What each test actually proves

### Contract and snapshot tests (`npm test`, 10)

- scopes to one workspace before counting, and excludes stale and unanalysed rows from the
  sentiment denominator
- treats date ranges as half-open `[from, to)` and counts unknown dates as their own category
- prefers the newest human review matching the *current* `content_hash`, so a review of
  older text cannot override a current prediction
- searches every matching row before paginating, and applies filters to every aggregate
- keeps aggregates stable across pages
- rejects reversed date ranges, oversized page sizes, and a "succeeded" prediction with no label
- refuses to treat legacy amendments as human truth or a failed model result as Neutral
- walks every page with `limit: 1` until `next_cursor` is null, visiting each row exactly
  once and reporting the same total on every page
- rejects a cursor that the current filters no longer contain, rather than silently returning
  the first page
- `authorize()` checks identity and current membership independently — a valid token for the
  wrong workspace, and a valid member with the wrong role, are both rejected

### Direct SQL tenant-isolation tests (`npm run test:db`, 8)

- a member of workspace A cannot read, update, or list storage objects belonging to B
- a viewer cannot promote their own role or insert into a workspace; an owner cannot move a
  row to another workspace or set a channel to `connected`
- composite foreign keys reject a cross-workspace child row even when inserted by a
  privileged role that bypasses RLS
- anonymous reads fail, and no authenticated role can read `private.oauth_connections`
- `create_workspace` grants the caller ownership and rejects an unauthenticated call
- `enqueue_sync` enforces role and tenant and returns the same job for a repeated key
- every Auth user is bootstrapped with a personal workspace; `register_channel` enforces
  role, client tenancy, and channel-id format, and creates channels as `public_unverified`
- `claim_job` hands the same job to exactly one caller; an expired lease cannot commit; a
  repeated batch key is idempotent and a conflicting payload for that key is rejected

### Worker tests (`npm run worker:test`, 23)

- **Durability (8):** resume from a committed checkpoint; changed text keeps a prior version
  while a likes-only change does not; two connections competing for one job produce exactly
  one claim; a stale lease cannot write; an invalid row rolls back both rows and checkpoint;
  retries are bounded and then marked `retry_exhausted`
- **YouTube adapter (5):** explicit reply pagination across pages with checkpoint resume and
  no repeated thread request; 403/429 → `blocked` and 5xx → `failed`, never exhaustion; the
  API key never appears in an error; malformed JSON and an SSRF-shaped video id are rejected
- **Sentiment (8):** HTML is stripped for analysis without losing negation, emoji, or dialect
  letters, and encoded markup cannot reappear; empty and markup-only text is `skipped`;
  unmarked text is `unsupported`, never guessed Neutral; Mixed is a first-class label;
  `Prediction` rejects inconsistent status/label pairs and out-of-range scores; the registry
  refuses moving refs such as `main`, and malformed or duplicated label mappings; a
  three-class candidate reports `supports_mixed == False` instead of a misleading 0%
- **CLI (2):** a fixture run writes a manifest whose coverage wording is source traversal
  only, and a re-run does not duplicate rows; `--source youtube-api` without a key fails
  instead of producing a successful empty run

### Browser tests (`npm run test:e2e`, 6)

- the shell renders `dir="rtl"`, labels itself as synthetic data, filters to a real subset,
  shows a genuine empty state, and resets correctly
- a held request shows a real pending state; a 503 produces an error with a working retry and
  no data on screen; the retry then succeeds. The route handler gates on a flag rather than a
  request index because React StrictMode issues two initial fetches — confirmed by probe, not
  assumed
- at 390×844 the page does not scroll horizontally, and the account screen states honestly
  that Supabase is not configured
- cursor pagination walks page 1 → 2 → back to 1 with no repeated row, leaves every aggregate
  unchanged, disables each arrow at the ends, and returns to page one when a filter changes
- a slow response for abandoned filters does not overwrite a newer screen. The held request
  was released and its `continue()` resolved, so it genuinely completed in flight rather than
  being cancelled — verified by probe before the assertion was trusted
- when the dataset shrinks so the cursor names a missing row, the view rebuilds from page one,
  says so, and re-disables "previous"

## Not verified — do not represent these as working

| Area | Why it is unverified |
| --- | --- |
| Live YouTube collection | No API key, no live request ever issued. Adapter tested only against synthetic HTTP responses |
| Google OAuth | Not implemented; no client credentials |
| Deployed Supabase | No project URL or key. GoTrue, PostgREST, Storage HTTP, and Edge Function deployment are untested |
| Database behaviour beyond SQL/RLS | PGlite runs the real SQL and RLS but is not Supabase. The test file creates minimal stand-in `auth`/`storage` objects |
| Sentiment model quality | No model downloaded, no inference run, no benchmark. No accuracy figure is claimed anywhere |
| Legacy import and the handoff's topic-count discrepancies | Source CSV and amendment file missing; no reconciliation performed |
| CI | `.github/workflows/ci.yml` exists but has never executed — no Git remote and no commit yet |
| Deployment | Nothing deployed; no URL exists, private or otherwise |
| Final dashboard styling | Original dashboard HTML, ZIP, and brand assets not supplied |
