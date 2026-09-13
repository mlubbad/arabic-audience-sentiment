# Verification

Run 2026-09-13 on macOS 24.6.0, Node 22.14.0, npm 10.9.2, Python 3.12.10, uv 0.11.11,
load average 2.80.

The machine default is Node 26 / npm 11, which `engine-strict=true` correctly rejects. All
commands were run with Node 22.14.0 first on `PATH`, matching `.nvmrc`.

## Checks

| Command | Result |
| --- | --- |
| `npm run lint` | Pass — ESLint clean; Ruff "All checks passed!" |
| `npm run format:check` | Pass |
| `npm run typecheck` | Pass — no `tsc` diagnostics |
| `npm run test:coordination` | Pass — 5 ownership-guard tests |
| `npm test` | Pass — **74 tests, 10 files** |
| `npm run test:db` | Pass — **47 tests, 5 files** |
| `npm run worker:test` | Pass — **39 tests, 5 files** |
| `npm run build` | Pass |
| `npm run check:secrets` | Pass |
| `npm run test:e2e` | Pass — 45 tests, Chromium |

`npm run check` runs everything except `test:e2e` and passed end to end.

## Method: mutation, not just passing

A test that cannot fail is not coverage. Every security or correctness guarantee claimed
below was checked by breaking the code and confirming a test caught it. Each mutation was
reverted and the suite returned to green.

| Mutation | Tests broken |
| --- | --- |
| Let a quota shortfall through instead of refusing the batch | 1 |
| Accept a reused batch key carrying a different payload | 1 |
| Allow an OAuth state to be reused | 1 |
| Drop the cross-workspace seizure check on channel claim | 1 |
| Drop the cross-workspace check on a leased job | 2 |
| Let a revoked worker credential through | 2 |
| Let a failed collection report success | 1 |
| Put the endpoint into a client error message | 2 |
| Pass the raw worker credential to the database | 1 |
| Return the internal error message from the edge handler | 1 |
| Open the audit trail to any member | 1 |
| Drop the import path scoping | 1 |
| Remove the lease-duration guard | 1 |
| Neutralise the retry backoff | 1 |

## What the suites prove

**Contracts (74).** One filter implementation drives views and exports, so they cannot
disagree. Half-open date ranges, unknown dates as their own category, the newest human review
matching the *current* text winning, stale and failed predictions excluded from the sentiment
denominator, cursor walking without repeats, CSV neutralising spreadsheet formulas on output
while the stored text is untouched, likes never weighting sentiment, plan thresholds on both
sides of each boundary, and a batch payload that carries no workspace field at all.

**Direct SQL (47).** Tenant isolation against direct statements rather than hidden UI:
foreign reads, updates, exports and storage objects all refused. No member can promote their
own role, move a row between workspaces, or set a channel to connected. Composite foreign
keys reject a cross-workspace child even when inserted by a role that bypasses RLS. Lease
fencing, idempotent checkpoints, atomic batch ingestion with metering, one unit per unique
comment ever, OAuth state that is hash-only and single-use, globally exclusive channel
claims, a worker gateway scoped by credential, plan limits on channels and sync frequency,
and an append-only audit trail owners alone can read.

**Worker (39).** Resume from a committed checkpoint without duplication, a changed text
keeping its prior version while a likes-only change does not, two connections competing for
one job producing exactly one claim, bounded retries, HTTP failures that never become
exhaustion, an API key that never appears in an error, and a control-plane client whose
payload hashes canonically so a legitimate replay is not mistaken for a conflict.

**Browser (45).** Arabic RTL, real loading/error/retry/empty states, pagination that never
changes an aggregate, a late response for abandoned filters unable to repaint a newer screen
(verified by holding a request, releasing it, and confirming it completed in flight),
corrections moving every panel together, exports matching the filters on screen, and an
accessibility pass: no unnamed control among 25, no skipped heading levels, no positive
tabindex, nothing focusable inside an aria-hidden subtree, status colours 5.93:1 to 7.62:1
against white.

## Not verified — do not represent these as working

| Area | Why |
| --- | --- |
| Live YouTube collection | No API key; no live request has ever been issued |
| Google OAuth exchange | Authorization URL, code exchange, PKCE, `channels.list` and the redirect page are not written. Only the server-side state and ownership logic exists |
| Deployed Supabase | No project. GoTrue, PostgREST, Storage HTTP and Edge Function deployment are untested |
| The edge handler and the SQL agreeing | Each is tested against a stand-in for the other. They have never spoken. **This is the most likely place for a real defect** |
| Database behaviour beyond SQL and RLS | PGlite runs the real SQL and RLS but is not Supabase |
| Concurrent overspend | PGlite is single-connection, so two simultaneous transactions cannot be staged. The row lock is the mechanism; the tests prove no *sequence* exceeds an allowance |
| Sentiment model quality | No model downloaded, no inference run, no benchmark. No accuracy figure is claimed anywhere |
| Legacy import and the topic-count discrepancies | Source CSVs and amendment file missing; no reconciliation performed |
| CI | `.github/workflows/ci.yml` exists but has never executed — there is no remote |
| Deployment | Nothing deployed; no URL exists, private or otherwise |
| Spreadsheet behaviour | Formula neutralisation is verified as bytes in the file. No spreadsheet application was opened |
| Final dashboard styling | Original dashboard HTML, ZIP and brand assets not supplied |

## Notes on running the suites

The browser suite is timing-sensitive. During this work the host reached load average 17 and
it failed intermittently — a different test each time, at 0-4% CPU, while `npm run check`
took 12m27s for 32s of work. The same code passed 12/12 in 11.6s once load fell. **Treat a
browser failure on a loaded machine as unproven and re-run before believing it.**

Playwright now fails closed rather than adopting a dev server it did not start: a server left
running by another checkout was silently serving a different build, and the suite was
exercising the wrong code. Set `E2E_PORT` to run two lanes at once.

`format:check` deliberately excludes Markdown: `docs/input-inventory.md` records the SHA-256
of the two supplied specification files, and both hashes were re-verified unchanged.
