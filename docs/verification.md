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
| `npm test` | Pass — 27 tests, 4 files |
| `npm run test:db` | Pass — 18 tests |
| `npm run worker:test` | Pass — 23 tests, 4 files |
| `npm run build` | Pass — 146 modules; `index.js` 478.09 kB (151.76 kB gzip), `index.css` 6.29 kB |
| `npm run check:secrets` | Pass — 62 source files plus built assets |
| `npm run test:e2e` | Pass — 15 tests, Chromium |
| `npm run worker:collect -- --source fixture …` | Pass — status `succeeded`, 2 unique comments, coverage declared as source traversal only |

`npm run check` runs everything except `test:e2e` in one command, and passed end to end.

The browser suite is timing-sensitive. During this run the host reached a load average of
17 and the suite failed intermittently — a different test each time, at 0-4% CPU, with
`npm run check` taking 12.5 minutes for 32 seconds of work. Once load fell the same code
passed 12/12 in 11.6 seconds at 111% CPU. Only SQL and database tests changed in that round,
neither of which the browser suite loads. Treat a browser failure on a loaded machine as
unproven rather than as evidence either way, and re-run before believing it.

`format:check` deliberately excludes Markdown: `docs/input-inventory.md` records the SHA-256
of the two supplied specification files, and both hashes were re-verified unchanged after this
work.

## What each test actually proves

### Contract and snapshot tests (`npm test`, 27)

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
- a correction appends instead of replacing, leaves the input array untouched, and the newest
  correction matching the current text wins
- a correction moves the comment between sentiment buckets without changing the total, and
  brings a previously unanalysed comment into the denominator
- the `review_status` filter sees the correction through the same snapshot
- a correction against changed text is refused as `stale_comment_text`; an unknown comment,
  another workspace's comment, an empty reason and an unknown label are all refused
- an export contains exactly the rows the dashboard counted, ignoring the page size, and
  matches the dashboard total under video, search, sentiment and review-status filters
- an export never contains another workspace's rows
- the file records the effective label and its source: `model`, `human_review`, or `none` for
  a stale or missing prediction, whose `prediction_status` is still preserved
- every cell a spreadsheet would evaluate — leading `=`, `+`, `-`, `@`, tab or carriage
  return — is quoted and prefixed, and the input objects are byte-identical afterwards, so
  neutralising happens on output only
- quotes, commas and embedded newlines are escaped so the record count stays honest
- the file begins with a byte order mark, and the object name begins with the workspace id
  that the private bucket policy checks
- the 70% and 85% thresholds are checked on both sides of each boundary, and a zero allowance
  reads as exhausted rather than producing a division by zero
- a summary whose `remaining` does not follow from `used` and `allowance`, a negative `used`,
  and an unknown status are all rejected
- `authorize()` checks identity and current membership independently — a valid token for the
  wrong workspace, and a valid member with the wrong role, are both rejected

### Direct SQL tenant-isolation tests (`npm run test:db`, 18)

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
- `submit_comment_review` refuses a viewer, another tenant's comment, a blank reason, and a
  verdict whose content hash no longer matches; a second correction appends, and reviewer id
  and `human` provenance are taken from the session rather than the caller
- the review log cannot be written directly, so reviewer id cannot be forged and a tenant
  cannot claim `legacy_unverified` for its own verdict; UPDATE and DELETE are rejected even
  for a role that bypasses RLS
- a unique comment is metered once: a repeated reservation of the same keys covers them again
  but adds no units
- five keys requested against three remaining units yields a partial grant of three, and the
  next request grants nothing; the period total stops exactly at the allowance
- `historical_backfill` still grants after the analysis allowance is exhausted, and stops at
  its own separate budget
- metering is refused when the plan is paused, and when now() falls outside the billing period
- `commit_checkpoint` writes rows, checkpoint and meter together: a replayed batch key charges
  nothing more, and a batch larger than the remaining allowance is refused with
  `quota_exceeded`, leaving the usage count, the checkpoint and the batch receipt untouched
- `release_usage` returns only the unconfirmed reservation and leaves a confirmed charge intact
- `usage_summary` returns the same counts the reservation enforces, is readable by a viewer of
  its own workspace, and is refused for another tenant and for an unauthenticated caller
- `usage_summary` returns null for a workspace with no subscription, which is distinct from an
  exhausted allowance
- a tenant reads its own meter but cannot insert, update or delete a usage row, cannot call
  `reserve_usage`, and cannot raise its own plan limits
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

### Browser tests (`npm run test:e2e`, 15)

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
- a human correction replaces the model label for that row, marks it as human-reviewed, and
  moves the sentiment buckets while the total and denominator stay correct
- correcting a comment that had no usable prediction adds it to the denominator (4 → 5)
  without changing the comment total
- a correction written against text that changed meanwhile is refused with a plain-language
  conflict message, and nothing is recorded
- a real download with five of six rows on screen yields six data rows, a BOM and the expected
  header; narrowing the filter narrows the file to two rows
- the exported row carries the corrected label and `human_review`, not the superseded prediction
- a comment whose text is a spreadsheet formula renders literally on screen and is quoted and
  prefixed in the downloaded file
- the plan panel shows 74 of 100 used with 26 remaining in a warning state, while the separate
  backfill budget stays healthy
- a fully spent allowance escalates to an exhausted state and does not present itself as a data
  failure: the comment total is still correct
- a workspace with no activated plan says so explicitly and renders no budget bars at all

## Not verified — do not represent these as working

| Area | Why it is unverified |
| --- | --- |
| Live YouTube collection | No API key, no live request ever issued. Adapter tested only against synthetic HTTP responses |
| Google OAuth | Not implemented; no client credentials |
| Deployed Supabase | No project URL or key. GoTrue, PostgREST, Storage HTTP, and Edge Function deployment are untested |
| Database behaviour beyond SQL/RLS | PGlite runs the real SQL and RLS but is not Supabase. The test file creates minimal stand-in `auth`/`storage` objects |
| Sentiment model quality | No model downloaded, no inference run, no benchmark. No accuracy figure is claimed anywhere |
| Concurrent overspend | The subscription row lock is the mechanism, but PGlite runs a single connection, so two genuinely simultaneous transactions cannot be staged. What is proven is the accounting invariant: no sequence of calls exceeds the allowance. The race itself needs a real PostgreSQL with two connections |
| Correction persistence | The `submit_comment_review` RPC is tested in embedded PostgreSQL, but the browser has never called it. In fixture mode corrections are session-only and the UI says so |
| Export delivery | The file is built in the browser. No background export job, no Supabase Storage upload, and no short-lived signed link has been exercised. Only the object-name convention is tested |
| Spreadsheet behaviour | Neutralisation is verified as bytes in the file. No real spreadsheet application was opened to confirm how it renders them |
| Legacy import and the handoff's topic-count discrepancies | Source CSV and amendment file missing; no reconciliation performed |
| CI | `.github/workflows/ci.yml` exists but has never executed — no Git remote and no commit yet |
| Deployment | Nothing deployed; no URL exists, private or otherwise |
| Final dashboard styling | Original dashboard HTML, ZIP, and brand assets not supplied |

## Coordination baseline — 2026-09-13

Verified in `/Users/mlubbad/Documents/Codex/SentimentAnalysis-worktrees/integration`,
based on product commit `5e9094f`. Each worktree uses separate dependency directories.

- `npm ci --cache /Users/mlubbad/Documents/Codex/SentimentAnalysis/.cache/npm`: passed;
  237 packages installed, 0 audit vulnerabilities reported.
- `uv --directory workers/python --cache-dir /Users/mlubbad/Documents/Codex/SentimentAnalysis/.cache/uv sync --frozen`: passed, Python 3.12.10.
- Ownership regression tests first failed on missing implementation, then passed 3/3.
- `npm run check`: passed lint, formatting, typecheck, 3 coordination tests, 27 application
  unit tests, 18 SQL tests, 23 Python tests, build and secret-pattern scan.
- This verifies the coordination baseline. It does not change the earlier live-service
  limitations or establish that production ingestion/metering is complete.
- `npm run test:e2e`: passed 15/15 on the integration baseline (12.0 seconds).
- Real pre-commit probes in worker and platform: both rejected a staged synthetic file
  outside their lane, returned nonzero, and preserved HEAD. Probe files were removed and
  unstaged; subsequent allowed lane-report commits succeeded.
- Original checkout `core.hooksPath` remains unset. New worktrees each use `.githooks`
  through worktree-local config. Worker and platform readiness reports were merged serially;
  no product changes were merged as part of this coordination setup.
