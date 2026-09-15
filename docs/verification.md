# Verification

## 2026-09-14 — Private preview deployment and live origin verification

Deployed to private preview hosting (`app.sky-develop.net`, origin `91.204.209.217`) via `npm run deploy:preview`:

| Probe / Request | Actual result |
| --- | --- |
| `GET /` without basic auth | **401 Unauthorized** (private protection strictly enforced) |
| `GET /` with basic auth | **200 OK** |
| `GET /index.html` | **200 OK** (803 bytes) |
| `GET /fixtures/dashboard.json` | **200 OK** (11,283 bytes) |
| `GET /landing/arabic-bold.ttf` | **200 OK** (229,352 bytes) |
| `GET /robots.txt` | **200 OK** (26 bytes) |
| `GET /dashboard` (SPA route fallback) | **200 OK** (serves `index.html`) |
| `GET /sync` (SPA route fallback) | **200 OK** (serves `index.html`) |
| `GET /account` (SPA route fallback) | **200 OK** (serves `index.html`) |
| `GET /.htaccess` | **403 Forbidden** (direct configuration access prevented) |
| `GET /assets/report-KE-usfQc.css` | **200 OK** (19,393 bytes) |
| `GET /assets/Dashboard-MT9GcQVq.js` | **200 OK** (231,257 bytes) |
| `GET /assets/index-BuQPClQp.js` | **200 OK** (509,440 bytes) |
| Stale asset cleanup | 8 obsolete bundles deleted via FTP DELE (`gone`) |

## 2026-09-14 — Comment confidence score display and live test alignment


Node 22.14.0, Python 3.12.10. Verified on `main`:

| Command / observation | Actual result |
| --- | --- |
| `npm run check` | Pass: lint, format, typecheck, Deno check, 225 unit tests, 139 SQL tests, 127 Python tests, Vite build, secret scan |
| `E2E_PORT=5350 npm run test:e2e` | 68 passed in 59.5s |
| `E2E_LIVE_PORT=5355 npm run test:e2e:live` | 1 passed in 3.9s; workspace switching and sign-out isolation verified with new navigation destinations |

## 2026-09-14 — Arabic NLP sentiment engine and text normalization verification


Node 22.14.0, Python 3.12.10. Verified on `main`:

| Command / observation | Actual result |
| --- | --- |
| `pytest tests/test_sentiment.py tests/test_transformer.py` | 27 passed; verified Arabic normalization, tatweel/tashkeel stripping, elongation reduction, 4-class prediction and error handling |
| `npm run worker:test` | 127 passed in 0.67s across 14 test suites |
| `npm run worker:lint` | Ruff: All checks passed! |
| `npm run check` | Full check passed: lint, Ruff, format, typecheck, Deno check, 225 unit tests, 135 SQL tests, 127 Python tests, Vite build and secret scan |
| `E2E_PORT=5340 npm run test:e2e` | 68 passed in 1.0m (Chromium E2E suite covering app shell, dashboard, landing, and mobile UX) |

## 2026-09-14 — Internal UI redesign and Sync identity boundary


All commands used Node 22.14.0 via `PATH=/Users/mlubbad/.nvm/versions/node/v22.14.0/bin:$PATH`.
The browser suites started their own Vite servers on the indicated ports with
`reuseExistingServer: false` and `--strictPort`.

| Command / observation | Actual result |
| --- | --- |
| `E2E_PORT=5334 npm run test:e2e -- tests/e2e/app-shell.spec.ts --reporter=line` before the mobile filter control | Failed waiting for `إظهار الفلاتر`; after implementation, 1 passed |
| `npm run check` first attempt | Lint, format, typecheck and Edge Function check passed; 3 server-rendered Dashboard identity unit tests failed because `window` was read during state initialization |
| `npm test` after guarding browser-only viewport access | 150 passed in 19 files |
| `npm run check` after the fix | Passed: lint, Ruff, format, typecheck, Deno check, 150 unit, 126 SQL, 124 Python tests, Vite build and secret scan |
| `E2E_PORT=5335 npm run test:e2e -- --reporter=line` first full run | 47 passed, 2 failed: old mobile navigation test bypassed the new menu, and the disconnected-worker test expected obsolete machine-specific copy |
| `E2E_PORT=5335 npm run test:e2e -- tests/e2e/dashboard.spec.ts --grep 'mobile shell\|states plainly' --reporter=line` | 2 passed after updating those assertions to the intended UX |
| `E2E_PORT=5335 npm run test:e2e -- --reporter=line` final full run | 50 passed in 41.6s, including mobile filter disclosure, callback and 404 recovery |
| `E2E_LIVE_PORT=5336 npm run test:e2e:live -- --reporter=line` | 1 passed; fake local Auth/API responses proved the Sync workspace choice appears before any snapshot and tenant A's comments never paint under tenant B or after sign-out |
| Desktop screenshots at 1280×800; mobile browser pass at 390px | Account, Sync and Dashboard hierarchy inspected; hero title/description stacking corrected; mobile menu, filter disclosure and horizontal-overflow assertion passed |
| `npm run check` and `E2E_PORT=5335 npm run test:e2e -- tests/e2e/app-shell.spec.ts --reporter=line` after the mobile spacing adjustment | Full check passed again with the same counts; 2/2 targeted browser tests passed. A 390px Sync screenshot confirmed the reduced empty space in the health card |
| `npm run format:check`, `npm run build`, and `E2E_PORT=5335 npm run test:e2e -- tests/e2e/app-shell.spec.ts --reporter=line` after styling the no-Auth account fallback | All passed; 2/2 browser tests. The credential-free account state was inspected in a 1280px screenshot |

The live-mode browser test intercepts a local fake Supabase origin. It does **not** prove
that the redesigned pages work against the deployed project's Auth, PostgREST, OAuth or
worker. The dashboard and operations sample remain sanitized fixtures for a visitor. No
deployment or real-model validation was performed in this increment.

## 2026-09-14 — Dashboard identity, video choices, and honest introduction

On `0ea0ca0` plus the shared working-tree changes (Claude Code was editing the new report and model path concurrently), Node 22.14.0:

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run apps/web/src/Dashboard.identity.test.ts --reporter=dot` before the identity fix | 2 failed initially: a previous tenant's comment rendered under the next workspace and after sign-out. After adding the pending-workspace case, 3 failed; the new case showed the fixture path while a signed-in workspace list was still loading |
| `npx vitest run apps/web/src/session.test.ts --reporter=dot` before the workspace-loading fix | 1 failed: a signed-in user was initially reported as having finished loading before the workspace request began |
| `E2E_PORT=5332 npm run test:e2e -- tests/e2e/dashboard.spec.ts --grep 'actual pending fetch\|video filter offers'` before the copy/video fixes | Both failed: the hero reported zero while a request was held, and the selector lacked the unfamiliar video id supplied by the test fixture |
| `npx vitest run apps/web/src/session.test.ts apps/web/src/Dashboard.identity.test.ts --reporter=dot` after the fix | 4 passed |
| `E2E_PORT=5332 npm run test:e2e -- tests/e2e/dashboard.spec.ts --grep 'Arabic fixture shell filters\|actual pending fetch\|video filter offers'` after the fix | 3 passed |
| `npm run check` | Passed: lint, format, typecheck, Edge Function check, 140 unit tests, 116 SQL tests, 108 worker tests, build, and secret scan |
| `E2E_PORT=5332 npm run test:e2e` initial full run | 47 passed, 1 failed: review history was reopened before the invalidated snapshot had refreshed |
| `E2E_PORT=5332 npm run test:e2e -- tests/e2e/dashboard.spec.ts --grep 'history says who reviewed'` after keeping the correction form open until refresh | 1 passed |
| `E2E_PORT=5332 npm run test:e2e` final full run | 48 passed (52.5s) |
| `npx vitest run apps/web/src/Dashboard.identity.test.ts apps/web/src/dataSource.test.ts --reporter=dot` after retaining the workspace selector and showing its name | 12 passed; the new selector/name assertion was observed failing before implementation |
| `npm run test:e2e:live` | 1 passed (3.8s): fake local Auth/PostgREST responses, A then delayed B, then sign-out; A's text was absent during B loading and after sign-out |

The identity test renders the real Dashboard component with a controlled previous query result, so it asserts the user-visible absence of another tenant's text. The dynamic-video and loading tests run the actual Vite UI against sanitized fixtures. The separate live-mode browser test signs in through a local fake API and delays the second workspace's response; it exercises the actual UI and query lifecycle without external credentials. It is **mocked integration**, not proof against a deployed Supabase project. Model inference against real comments and the corrected private deploy also remain unproven by these checks.

## 2026-09-14 — Landing asset and current-state copy

At `0ea0ca0` plus the landing working-tree changes, with concurrent uncommitted live-dashboard work outside this increment:

| Command / observation | Actual result |
| --- | --- |
| `E2E_PORT=5322 npm run test:e2e -- tests/e2e/landing.spec.ts` | 2 passed (5.5s), including working links, FAQ, mobile navigation, accessibility and image loading |
| `npx prettier --check apps/web/src/Landing.tsx apps/web/src/landing.css tests/e2e/landing.spec.ts` | Passed after formatting the landing test |
| `npx eslint apps/web/src/Landing.tsx tests/e2e/landing.spec.ts` | Passed |
| `npm run build` | Passed, 171 modules transformed, 2.65s |
| Chromium screenshots at 1440px and 390px | Full page visually inspected; original bright glass chart sits in the hero without clipping |
| `shasum -a 256 apps/web/public/landing/audience-growth-original.png` | `5f800bc3d9fb7e2004c5de245653021f123f2a4cedbf29f7aee8e6ca5f22cdbe` |

Formatting checks initially found wrapping issues in the landing test and then the illustration mask rule; both were corrected before the final passing checks. This increment did not re-run the full repository suite or redeploy the site, because the signed-in dashboard is being edited concurrently. The 65 live comments and tenant boundary were verified by the other development session, as described in the user-supplied handoff; this landing verification did not independently exercise its live OAuth, worker, model or authenticated dashboard path.

## 2026-09-13 — Marketing landing and route integration

Node 22.14.0; load average sampled at 3.13 / 3.30 / 3.25. Code reviewed against `cffb9fa` plus the landing working-tree changes. Concurrent Python/OAuth commits are outside this increment.

| Command / observation | Actual result |
| --- | --- |
| `npm run check` after final code changes | Pass: lint, formatting, typecheck, 107 unit tests, 98 SQL tests, 91 worker tests, build and secret scan |
| `E2E_PORT=5322 npm run test:e2e` after route integration and lazy loading | 47 passed (45 existing dashboard cases + 2 landing cases), 50.7s |
| `E2E_PORT=5322 npm run test:e2e -- tests/e2e/landing.spec.ts` after final illustrative-chart/copy changes | 2 passed, 5.9s; includes chart/comment filter agreement, FAQ, audience tabs, account and dashboard navigation, reload, mobile menu, keyboard skip link, image loading, and 320/390/768/1440px overflow checks |
| Visual inspection | Chromium screenshots at 1440px desktop and 390px mobile; inspected hero, Arabic hierarchy and full-page section layout |
| Build output | Landing entry JS 272.93 kB (86.85 kB gzip); Dashboard, Account and Supabase emitted as separate deferred chunks |

The first full browser run had one failed landing test: an exact text locator included the decorative FAQ `+` and could not match. It was corrected to target the semantic summary element. The other 46 tests passed on that run; all 47 passed on the rerun. No application failure was hidden by increasing a timeout.

Evidence is local/fixture-backed. No live YouTube, model, account session, or remote deployment was validated by this landing work. `.htaccess` protection was preserved; `noindex` metadata was added. Asset/reference provenance is in `docs/landing.md`.

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
| `npm run check:functions` | Pass — `deno check` on the three Edge Function entry points |
| `npm test` | Pass — **83 tests, 10 files** |
| `npm run test:db` | Pass — **103 tests, 11 files** |
| `npm run worker:test` | Pass — **94 tests, 11 files** |
| `npm run build` | Pass |
| `npm run check:secrets` | Pass |
| `npm run test:e2e` | Pass — **47 tests, Chromium** (45 dashboard, 2 landing) |

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
| Accept a prediction for a comment absent from the batch | 1 |
| Accept the same comment twice in one batch | 1 |
| Flatten the golden fixture back to the pre-split shape | 3 |
| Hash a prediction over different text than its comment row | 1 |
| Accept an adapter returning fewer verdicts than rows | 1 |
| Let a failed analysis finish the run as succeeded | 1 |
| Commit an empty prediction list, as before the wiring | 1 |
| Go back to never writing analysis parameters | 2 |
| Drop parameters from the prediction-to-run join | 1 |
| Fingerprint an analysis without its settings | 1 |
| Prune a connection that is still in flight | 1 |
| Reuse one nonce for every sealed grant | 1 |
| Accept a grant with no refresh token | 1 |
| Return Google's error body as the reason | 2 |
| Trust the first channel when an account has several | 1 |
| Overwrite the stored refresh token on renewal | 1 |
| Retry a revoked grant instead of ending it | 1 |
| Treat an expired token as a blocked channel | 1 |
| File comments-disabled as an access refusal | 1 |
| Send the API key alongside the bearer token | 1 |
| Leave the prune job executable by tenants | 1 |
| Show a verdict about text the comment no longer has | 1 |
| Turn unknown engagement into zero on the live read | 1 |
| Leave the platform parent id unresolved | 1 |
| Let a configured project alone flip the data source | 4 |
| Let the browser suite inherit the machine's .env.local | 1 |
| Report accuracy as the headline instead of macro F1 | 1 |
| Skip classes the model never predicts | 1 |
| Count an unclear gold row as a model error | 1 |
| Use the normal approximation for the interval | 1 |
| Purge the text but leave the author | 1 |
| Let a purge take the prediction with it | 2 |
| Stop a refresh clearing the purge marker | 3 |
| Ignore the retention window and purge everything | 1 |
| Trust the server's answer without parsing it | 1 |
| Show the model's answer in the labelling sheet | 1 |
| Stop neutralising spreadsheet formulas in the sheet | 1 |
| Drop unanalysable rows without counting them | 1 |
| Let the booster reuse estimate rows | 1 |
| Sample uniformly instead of proportionally by video | 1 |
| Match the loopback redirect by substring instead of host | 1 |
| Accept any http redirect URI | 2 |
| Send the verifier instead of its challenge | 1 |
| Store the OAuth state raw instead of hashed | 1 |
| Allow an http redirect URI | 1 |
| Drop the verifier charset and length check | 1 |

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
| Real HTTP between the worker and the edge handler | `end_to_end.test.ts` now runs the real handler against the real SQL with a payload the real Python client produced, so the two no longer only meet through stand-ins. What is still untested is an actual network hop and a deployed Edge Function runtime |
| Database behaviour beyond SQL and RLS | PGlite runs the real SQL and RLS but is not Supabase |
| Concurrent overspend | PGlite is single-connection, so two simultaneous transactions cannot be staged. The row lock is the mechanism; the tests prove no *sequence* exceeds an allowance |
| Sentiment model quality | No model downloaded, no inference run, no benchmark. No accuracy figure is claimed anywhere |
| Legacy import and the topic-count discrepancies | Source CSVs and amendment file missing; no reconciliation performed |
| CI | `.github/workflows/ci.yml` exists but has never executed — there is no remote |
| Deployment | The **front end only** is deployed, at `app.sky-develop.net`, behind a password and serving fixtures. No Edge Function, no worker, no live data path is deployed |
| Spreadsheet behaviour | Formula neutralisation is verified as bytes in the file. No spreadsheet application was opened |
| Final dashboard styling | Original dashboard HTML, ZIP and brand assets not supplied |

## The seam test, and what it found

`supabase/tests/end_to_end.test.ts` drives the real edge handler against real migrations in
PGlite, using a batch payload generated by the real Python client and committed as a golden
fixture. A Python test re-derives that fixture, so a change on either side fails loudly
rather than letting the two languages drift.

Writing it found three defects that every previous test had missed, because each side was
being tested against a stand-in for the other:

1. **Python and JavaScript hashed the same payload differently.** Python renders an integral
   float as `1.0`, JavaScript as `1`, so identical content produced two digests and a
   legitimate replay would have been refused as a `batch_conflict`. The client now
   canonicalises numbers the way JSON does.
2. **The handler could not recognise a real database refusal.** It matched `error.code`
   against its own vocabulary, but a Postgres driver puts SQLSTATE there and the label in the
   message. Every refusal was arriving as a 500. The unit test had injected
   `{ code: "lease_lost" }`, which no real driver produces.
3. **`commit_batch` and `worker_finish` disagreed about who ends a job.** The commit set a
   terminal status from the batch outcome while finish required the job to still be running,
   so a worker that committed its last batch and then declared its result was refused with
   `lease_lost`. Section 10 makes finish the explicit final result and forbids an automatic
   success, so the commit is now progress only: if a worker dies after its last batch the job
   stays running and its lease lapses, which is a retry rather than a silent completion.

## What the contract-shape pass found

Two more defects, both of the same kind as the three above: a rule that existed only on the
side free to ignore it.

4. **A batch could be charged for analyses it never stored.** `reserve_usage` meters from the
   prediction list; the prediction insert then joins those rows to `comments`, and a
   prediction naming a comment the batch never delivered found no match and was dropped —
   after the charge. Probed directly: one comment and two predictions in, one prediction
   stored, **two** `usage_events` written, the second keyed
   `analysis:youtube:c-ghost` for a comment that does not exist. The call returned success.
   The I1 contract has forbidden this since it was written; nothing server-side applied it.
   `commit_batch` now refuses such a batch whole, before any write, so a malformed batch
   costs no rows, no receipt and no units.

5. **The shared contract described a message nothing sends.** `CommitBatchSchema` was one flat
   object holding the envelope fields and the payload fields together. The client posts
   `{job_id, lease_token, batch_key, payload_hash, payload}` — envelope around payload. The
   seam test had been spreading the payload into the envelope fields before parsing, so the
   reshaping in the test was doing the adapting and the mismatch could never fail. This is
   why the edge handler "does not parse against the contract": it could not. The schema is
   now split into `BatchPayloadSchema` and `CommitBatchSchema`, and the golden fixture holds
   the request body captured from the real client rather than a payload the TypeScript side
   re-wrapped by hand. Flattening that fixture back to the old shape now fails three tests;
   before the split, the flat shape was the only one that parsed.

   The same change exposed a smaller falsehood in the fixture: its checkpoint was
   `{"page": 1}`, a shape `ControlPlane.commit_batch` never produces. The real one is
   `{"cursor": …}`, which is also what the runner resumes from.

The handler still does not validate the body against the contract. That is now a deployment
question rather than a shape mismatch — the contracts package imports Zod, and the edge
function has no `deno.json` or import map, so module resolution cannot be verified without a
project. It is not a correctness gap: every rule the contract states is enforced in SQL,
which is the layer that meters and the only one a worker cannot bypass.

## Analysis reaching the server path

The sentiment package existed and was tested, and nothing used it. `run_once` collected rows
and committed them with an empty prediction list, so a configured analyzer produced no stored
labels at all — the server path could not have produced a sentiment figure for anything.

`server/analysis.py` now builds the prediction records a batch carries, and `run_once` takes
an analyzer and labels each batch before committing it, so rows and the verdicts about them
land in one transaction. The golden fixture's predictions are now produced by the real
analyzer instead of being written by hand, which means the seam test commits analyzer output
through the real handler into real SQL and checks what came back: two verdicts stored, one
`succeeded` with a label and one `unsupported` with none, one billable unit, and every
prediction joined to its comment on a matching `content_hash`.

**The analyzer is `DeterministicTestAnalyzer`, which is not a model.** It labels by an
explicit marker character and performs no language understanding. What is now verified is the
wiring — that a verdict reaches the database attached to the right row and the right text, and
that an unanalysable row is recorded as `unsupported` rather than invented as neutral. Model
selection, download and any accuracy figure remain blocked on the notebooks and the labelled
set, and no accuracy figure is claimed anywhere.

Two behaviours are worth naming because they are the failure-becomes-success pattern:
an adapter returning fewer verdicts than rows is refused rather than zipped (which would
leave later rows silently unanalysed), and a batch whose analysis fails keeps its collected
rows but can no longer finish `succeeded` — an exhausted source that was not fully labelled
is `partial`.

## Two recorded gaps, closed

**`analysis_runs.parameters` was never written.** The column existed with a `'{}'` default and
the run-identity index named it, so every run looked identically configured whether or not it
was. The worker had settings to report all along — a model card carries `max_length` — and
dropped them on the way. An unwritten column inside a unique index is worse than an absent
one: the index claims the identity accounts for settings, so a reader trusts a distinction
that is not being made. Settings now travel on each prediction, are stored on the run, and are
part of `analysis_key`, because a prediction is unique on that key and two analyses of one
comment differing only in their settings would otherwise collide with the second silently
discarded.

The prediction-to-run join now matches on parameters too. The first version of that test
counted rows and passed under the mutation that removed the join condition — the count was
right and the *linkage* was not, so a verdict could be filed under the wrong run. The test
now asserts which run each verdict points at, and the mutation fails it.

**`private.oauth_states` was never pruned.** Every connection attempt left a row permanently:
who began linking which client, and when. Nothing read them again. `private.prune_oauth_states`
removes consumed and expired states outside a retention window and never touches an unconsumed
state that has not expired, because that is a connection in flight. Security never depended on
retention — consume already requires the row to be unconsumed and unexpired, so a pruned row
and a consumed row refuse a replay identically, which is asserted rather than assumed.

No schedule is attached. Scheduling belongs to a deployed project, which does not exist; what
is committed is the operation.

## The live dashboard read

The dashboard had no live path at all. `data.ts` pinned the mode to
`sanitized_fixture` with nothing able to change it, so the filters, the aggregates, the
export and the corrections all ran over a JSON file.

`public.dashboard_snapshot(w)` assembles the same object the fixture is, from the tables
under RLS, and `LiveSnapshotSchema` shares its field definitions with `FixtureSchema` — the
two modes cannot drift into producing different shapes from equivalent rows. The SQL test
parses the result with that shared schema and then runs the shared `snapshot()` over it, so
the aggregation path is literally the same one fixture mode uses.

Verified against real migrations and real RLS: the shape parses, an unparseable like count
stays null, a reply names its parent by internal id, a prediction whose comment has since
been edited is not returned as the effective label, another tenant's workspace id is refused
rather than answered with an empty snapshot, and an anonymous caller is refused.

**One mutation survived, and is recorded rather than hidden.** Removing the `has_role` check
from `dashboard_snapshot_impl` does not fail any test, because `private.usage_summary_impl`
independently raises `forbidden` for a non-member and is called on every read. The suite
therefore proves tenant isolation but does not prove that particular line. The check is kept
— a read should authorise at its own entry point rather than depend on which sub-call raises
first — but the claim made for it here is only what the tests support.

On the client, live is two conditions and not one: a configured Supabase project **and** an
explicit `VITE_DASHBOARD_SOURCE=live`. A configured project alone must never turn fixture
rows into live data, because a correction against a fixture id and a fixture workspace would
then be addressed to a real server and reported as saved. Making the mode depend on
configuration alone fails four tests, which is the intended result.

`snapshot()` no longer returns `mode: "sanitized_fixture"`. It aggregates rows and cannot
know where they came from; the claim was dead code that stayed true only because no live read
existed.

**Not verified:** no HTTP request has been made to a deployed project. The SQL is exercised in
PGlite and the client is exercised against a mocked `rpc`, so what is untested is PostgREST
between them — argument marshalling, the JSON it returns, and Auth.

## PKCE and the authorization redirect

Recorded as blocked on Google credentials, and most of it was not: only the code exchange and
`channels.list` need them. Everything up to the redirect needs none to be correct.

`supabase/functions/_shared/oauth-start.ts` generates the verifier and the state, records the
state's hash with the verifier, and builds the Google authorization URL. Pure, with injected
config, randomness and data layer, so it runs without a deployed project.

Checked against the RFC's own worked example: the S256 challenge for the verifier in RFC 7636
appendix B is asserted to equal the value the RFC prints. A drift there would be rejected by
Google as `invalid_grant`, which does not say what is wrong.

The verifier is stored raw while the state is stored only as a hash, and the asymmetry is the
point: the state travels back through the browser, so a readable copy in the database would be
enough to forge a callback, whereas the verifier never leaves the server and the protocol
requires it at the exchange. It lives in `private.oauth_states`, which has no tenant grants, is
single use, expires in ten minutes and is pruned. A tenant cannot read it and cannot call
consume; both are asserted.

The state is written before the URL is handed out, so a callback can never arrive for a state
we failed to record. `oauth_start` refuses a verifier outside RFC 7636's length and character
rules, because the exchange cannot check that later — by then a weak verifier has been used.

**A test caught a real property while being written.** The first random stub returned the same
bytes on both calls, which made the verifier and the state identical and put the verifier in
the URL. No CSPRNG does that, so the stub was wrong rather than the code — but the assertion
that the verifier never appears in the URL is kept, and an explicit check that the two values
differ was added beside it.

A real OAuth client, configured on 2026-09-13, immediately found a defect in this: the
redirect check refused anything that was not `https://`, which blocks local development
outright. Google documents the loopback exception, and a code delivered to `127.0.0.1` never
traverses a network, so there is nothing on the wire to intercept. The check is now an
allowlist of hosts rather than a scheme test — written that way because a substring test for
`127.0.0.1` would have accepted `http://127.0.0.1.evil.test`, which is worse than no check at
all. Both of those mutations are in the table above.

**Not written, and genuinely blocked:** the token exchange, `channels.list(mine=true)`, the
redirect page, and token encryption at rest. These need a Google client id and secret and a
registered redirect URI. No authorization URL has been opened and no code has been exchanged.

## The human evaluation set

No accuracy figure can exist without one, so the sampler and the sheets are built even
though the labelling itself is blocked on the corpus and on people.

Two samples, drawn for two jobs and deliberately not pooled. The **estimate** set is a
proportionally stratified random sample whose selection does not depend on what any comment
says — the only one an accuracy figure may come from. The **booster** set over-selects
comments carrying an Arabic contrastive marker (لكن، بس، رغم، مع ذلك), because Mixed lives
behind those and a uniform draw from a corpus of mostly short praise contains almost none of
it. Selecting on content and then measuring accuracy over the result reports the sample and
not the corpus, so the key file records which set every row came from and the two are
disjoint by construction.

The sheet is blind: no model prediction, no existing label, no author, no like count, no
video. A labeller who can see the model's answer is no longer an independent measurement of
it. Replies carry the text they answer, because "لا أوافق" is not sentiment about anything
until you know what it answers.

Exclusions are counted rather than dropped, duplicate texts collapse but keep their
multiplicity so the estimate can be reweighted to the raw comment stream, and a round that
comes out smaller than requested reports the shortfall — a quietly smaller round changes the
confidence interval without anyone noticing. Every round is reproducible from its seed.

The sheet is written with a BOM and CRLF so Excel opens Arabic as Arabic, and cells are
neutralised against spreadsheet formula injection using the same rule as the dashboard
export — these files are opened in Excel by people who are not developers.

`docs/labelling-guide.md` carries the label definitions, the Arabic edge cases, the
independence and adjudication protocol, and the rule that agreement must be reported: without
a kappa there is no way to separate model error from label noise.

## First live run against a deployed project

2026-09-13. A Supabase development project (`ykqugctewsqvevhyqtbi`, Postgres 17.6.1,
ap-south-1) was linked and all **13 migrations applied**. Until this point the schema had
only ever run in PGlite. It applied clean, in order, with no edits — the first evidence that
what the tests run is what a real Postgres accepts.

Tenant isolation was then probed **over real HTTP through PostgREST**, as an anonymous caller
holding the publishable key, because that is the boundary a stranger actually reaches:

| Request | Result |
| --- | --- |
| `GET /rest/v1/comments`, `workspaces`, `memberships` | 401, SQLSTATE 42501 |
| `GET /rest/v1/jobs` | 401 — no grant exists at all |
| `GET /rest/v1/connection_status` | 401 — the view is security_invoker, so it inherits the refusal |
| `GET /rest/v1/oauth_states` | 404 — the `private` schema is not exposed by PostgREST |
| `POST /rest/v1/rpc/dashboard_snapshot` | 401, permission denied for function |
| `POST /rest/v1/rpc/usage_summary` | 401, permission denied for function |

This retires one specific caveat: the grants and the schema separation hold in a deployed
Supabase and not only in an embedded Postgres. It does **not** retire the others.

**Authenticated paths, partly verified 2026-09-13** by the operator signing up on the deployed
preview with a real mailbox — which is how this got tested at all, since GoTrue rejects
reserved test domains and guessing at domains to get past that would risk mailing a live
address. Confirmed live: the `bootstrap_personal_workspace` trigger fires on a real GoTrue
signup and creates the workspace named مساحة العمل الشخصية; an authenticated member reads
their own workspaces through PostgREST and sees only those; and `create_workspace` succeeds
as that member. None of this could run in PGlite, which has no GoTrue.

**Member-vs-member isolation, verified live 2026-09-13.** With the service-role key, a second
tenant was created through the Auth admin API and signed in. Against the deployed project,
over HTTP, as a real authenticated user:

| Probe | Result |
| --- | --- |
| Does the bootstrap trigger fire for a second user | Yes — their own personal workspace |
| Can B list A's workspaces | `[]` |
| Can B read A's dashboard by asking for it directly | **403, SQLSTATE 42501 `forbidden`** |

That is the property the whole tenancy model exists for, and it is now proven against a real
PostgREST with two real users rather than inferred from PGlite. It was tested by asking
directly, not by checking that a control was hidden.

**The handler and the SQL have now spoken over a real network hop.** Three Edge Functions are
deployed — `worker`, `oauth-start`, `oauth-callback` — and answered from the live project:

| Request | Result |
| --- | --- |
| `POST /worker/worker/claim`, no credential | 401 `invalid_worker_credential` |
| Same, with a credential never issued | 401, **the same shape** — nothing distinguishes them |
| `POST /worker/worker/typo` | 404 `not_found`, not a malformed-request error |
| `GET` on a POST-only route | 405 |
| `POST /oauth-start` with no session | 401 `unauthenticated` |
| `GET /oauth-callback` with no code | an Arabic page, 400, no stack trace |

The second row is the one that matters: that request reached the database. The handler split
the bearer, hashed it, called `svc_worker_claim` through PostgREST, and SQL refused it. Until
today each side was only ever tested against a stand-in for the other.

PostgREST exposes `public` only, so the functions had no route to any `private` primitive —
the handlers were complete and unreachable. Six `svc_*` wrappers now publish exactly what the
functions call, revoked from anon and authenticated and granted to `service_role` alone.
Putting `private` on the API instead would have published every internal function to anyone
holding any key. None of the wrappers takes a workspace, which is asserted against
`pg_get_function_arguments` rather than trusted.

**The connect flow is verified up to the human click.** Against the deployed project, as a
freshly created account behaving exactly as a new user would:

| Step | Result |
| --- | --- |
| Sign up, then read the workspace and client the account was given | One of each |
| `POST /functions/v1/oauth-start` with that session | 200, a Google authorization URL |
| Parameters | `response_type=code`, `code_challenge_method=S256`, `access_type=offline`, `prompt=consent`, the deployed callback as `redirect_uri`, the youtube.readonly scope |
| Is the verifier in the URL | **No** — 43-char state and challenge only |
| Fetching that URL from Google | **200, redirected to Google's own sign-in** |

The last row is the one worth having. Google did not answer `redirect_uri_mismatch`,
`invalid_client` or `access_blocked`; it echoed `app_domain=https://ykqugctewsqvevhyqtbi.supabase.co`
and asked the visitor to sign in. The configuration is validated by Google itself, without a
human clicking anything.

**Still unverified:** the exchange and everything after it — a code, a token, a channel
identity, a sealed row. That needs a person to sign in to Google and approve, which is the one
step that cannot be automated from here. And the live dashboard read returning real comment
rows, since no channel has been collected.

## A filename bug the first real push found

Two migrations were named `20260913240000` and `20260913250000` — hour 24 and hour 25, which
are not times. PGlite never noticed, because the suite only sorts filenames, and the numbers
sort correctly either way. The Supabase CLI parsed every other migration into a timestamp and
echoed those two back as raw strings.

Renamed to `20260913233000` and `20260913234500` before the first push, which was the last
moment it was possible: a filename is frozen once the migration is applied anywhere real.

## A test that was a property of the laptop

`npm run test:e2e` failed 1 of 45 on a machine with a Supabase project configured, and passed
on one without. The test asserts the account screen's "Supabase is not configured" notice —
an honest claim, but only while nothing is configured, so `apps/web/.env.local` was silently
deciding the result.

A suite that passes or fails depending on the developer's environment is worse than one that
fails everywhere: it looks green where it is meaningless and red where it is correct, and
neither reading is trustworthy.

Vite's `envDir` now comes from `VITE_ENV_DIR`, and the browser suite points it at `tests/e2e`,
which holds no `.env` files. The app under test is therefore configured by the suite and not
by the machine. Verified both ways: 45/45 with a live project configured in `.env.local`, and
removing the override reproduces exactly the original 1-of-45 failure on exactly that test.

The configured half of that branch is not covered here. It is exercised by the deployed
preview, where a real signup succeeded, and by the `authMessages` unit tests.

## Scoring a model, and the ways a score flatters

The evaluation set exists to answer one question, and the obvious way to answer it is
wrong. A model can reach 0.80 accuracy on a corpus that is mostly praise while never once
identifying a negative comment — and negative is what a customer pays to find. The
candidate model this project started from reports that exact shape: accuracy 0.80, macro
F1 0.65.

`labelling/score.py` therefore reports **macro F1** as the headline and treats accuracy as
context. Four decisions in it are each a way the number could have flattered a broken
model, and each is mutation-checked:

- a class the model **never predicts** scores zero and still counts in the average, rather
  than dropping out of it — which is precisely how a model that cannot find negatives
  produces a respectable mean;
- a class **nobody labelled** does not have a zero invented for it, which is the mirror
  error;
- `unclear` gold rows are **coverage, not error** — a human who could not tell is not
  evidence about the model;
- rows with no prediction are **reported, not skipped**, because a model measured only on
  the rows it managed is measured on the part it found easy.

The interval is Wilson, not the textbook normal approximation. That mutation initially
**survived**, because the test only checked 20/20 and 0/20, where both methods agree. The
approximation breaks *near* the edge — at 19/20 it returns an upper bound of about 1.045 —
and a rare class lands exactly there. The test now checks 19/20 and 1/20, and the mutation
fails.

Cohen's kappa returns **undefined** rather than a number when every rater used a single
category. The statistic is 0/0 there: reporting 1.0 would read as "perfect agreement, trust
these labels" and 0.0 as "no better than chance", and neither is true. A test and the
implementation disagreed about this, and both were wrong.

The scorer exits non-zero below the gate (macro F1 ≥ 0.75), so it can sit in a pipeline.

**No model has been scored.** Nothing has been downloaded and no figure is claimed. What
exists is the instrument.

## Comment text now has a deadline; the analysis of it does not

YouTube's developer terms require API data refreshed or deleted within 30 days, while derived
results may be kept. The schema had no way to express that difference: every comment ever
collected would have sat in the table indefinitely. That is a compliance problem, and a
personal-data problem for commenters who never agreed to anything.

Done now because it is cheap now — three nullable columns and a function. After a workspace
holds real comments it is a migration over customer data with a deletion deadline attached.

`private.purge_comment_text(retain interval default '30 days')` removes the text and the
author from comments not seen inside the window, and keeps the row, its content hash, its
dates, and the sentiment prediction about it. So every aggregate still computes and a purged
comment still counts — only its text is gone.

Refresh is the other half of the rule and does not depend on a writer remembering it: a
trigger clears the purge marker on any write that brings text back, so a re-collected comment
is simply no longer purged. A check constraint keeps the marker and the text from
disagreeing.

Two judgements worth naming. `likes_value` is kept and `likes_raw` is not: the verbatim string
the source displayed is content, the parsed number is a metric feeding an aggregate. And a
write that sets both text and marker is *corrected* rather than refused — refusing would fail
a legitimate re-collection of any row older than thirty days, which is the ordinary case.

Downstream, absence is not emptiness. Search never matches a purged row rather than matching
it loosely; the export writes that the text was removed and carries the purge date, instead of
a blank cell that would read as a comment nobody wrote; and the dashboard renders a marker.
The live read returns `content_purged_at` and a null author rather than coercing it to an
empty string, which would read as an anonymous commenter.

No schedule is attached, for the same reason as the OAuth state prune: scheduling belongs to a
deployed project. What is committed is the operation.

## The landing page, and a review I should have done first

A landing page at `/` was added by the operator while I was working, and I committed it in
`a49596d` without reading it, because I used `git add -A`. That is the second time in this
session I have swept in a file I had not reviewed, and a marketing page is the worst place
for it: fabricated testimonials, invented accuracy figures and borrowed brand assets are
exactly what belongs on one and exactly what this project refuses to publish.

Audited after the fact. It is honest, and unusually so for marketing copy. It answers "is the
demo real channel data?" with *no, synthetic and clearly labelled*; "can I connect my channel
now?" with *not yet*; and "is sentiment analysis always accurate?" with *no*, naming sarcasm,
dialect and context, and stating that no accuracy figure has been adopted for a live model.
There are no testimonials, no customer logos and no invented metrics — the only large numbers
in the file are SVG coordinates. Fonts are self-hosted with their OFL licence alongside.

Covered by two browser tests: the demo filter, RTL, the FAQ, navigation through to the
dashboard and the account page, the mobile menu, the keyboard skip link, and no horizontal
overflow at 320, 390, 768 and 1440.

**Deployed and verified at the origin**, file by file: every asset 200 at its exact size, and
`.htaccess` 403 because Apache refuses to serve it. Through Cloudflare: 401 unauthenticated,
200 with credentials, and both SPA routes fall back correctly.

One thing to fix later: the hero image is 1.5MB, which is most of the page weight.

## Nobody could have connected a channel

`oauth_start` and `register_channel` both require a client belonging to the workspace, and
nothing in the product ever inserted into `public.clients` — not `create_workspace`, not the
personal-workspace trigger, not any RPC. A user could sign up, receive a workspace, and reach
a wall with no way past it. The connect step had been unreachable since the schema was
written, and it only surfaced when the live project was queried and came back with no clients
and no channels at all.

Every workspace now gets a client when it is created, named after it. For a single creator the
distinction never surfaces — their workspace is their client. For an agency it is the seam
that lets one workspace hold several brands, which is why the column exists.

**The backfill is verified live, not in the suite.** The suite applies every migration to a
fresh database before inserting anything, so it structurally cannot construct a workspace
older than the rule; a mutation removing the backfill from the migration fails nothing, and
the test that exists covers the statement's logic rather than its presence. What was checked
instead is the real thing: after applying to the live project, the three workspaces created
before this each have a client.

A foundation RLS test failed on this change because it asserted an exact list of visible
clients. The isolation it exists to check was unaffected — a second client appeared because
the product changed. It now asserts the property, that A's client is visible and B's is not,
which is what it meant all along.

## A browser test that had been racing all along

Applying the brand added a stylesheet link, and one test failed — deterministically, twice in
a row, so not flakiness. The cause was not the stylesheet.

The test holds the fixture request to observe the pending state, but StrictMode mounts twice
and it held only the *first* request; the second returned 503 immediately and settled the
query. Whether the loading indicator was ever observable came down to whether the assertion
arrived before that. It had been passing on scheduling for months, and a render-blocking
stylesheet delaying `goto` was enough to lose the race.

Every failing request is now held until released, so the pending state is a fact rather than a
window. The test also runs in 863ms instead of timing out at 5s.

Then the fonts were moved off Google and self-hosted, which removes the delay that exposed
this, the third-party request on every page load, and one more thing that can be unreachable.

## An asset cleanup that stopped covering the assets

The deploy removes superseded hashed files, and matched `index-*`. Code-splitting renamed the
chunks after their entry points, so `Dashboard-*.js` and `Account-*.js` accumulated silently —
two orphans were on the server before this was noticed. It now matches every file under
`assets/`, verified by a redeploy that removed exactly the two stale chunks and kept the five
current ones.

## A real consent round trip, and the three defects it found

The operator connected a channel through Google's consent screen. It got further than anything
before it: the state was consumed, the code was exchanged for tokens, and it failed at
`channels.list`. Three separate defects, none of which any test here could have found.

**CORS.** The button failed with a bare network error because the function sent no
access-control headers and answered `OPTIONS` with 405, so the browser refused to send at all.
Every curl check had passed, because curl does not enforce CORS. That is the whole lesson:
*verified with curl* was not *works in a browser*, and only a browser was going to find it. An
allowlist now, not `*` — these functions are reached with a user's token in a header, so a
permissive origin would let any page start a connection with a token it had obtained. An unset
allowlist permits nobody, which is the direction that fails safely.

**The result page could not be served.** Supabase rewrites a function's content-type to
`text/plain` with `nosniff` and will not serve HTML from its own domain, so the Arabic page
arrived as mojibake. The bytes were valid UTF-8 throughout; the header was the problem, and it
was not ours to set. The callback now redirects to `/connected` in the app, which is better
regardless: the person ends up inside the product rather than stranded on a `supabase.co` URL.

**`channel_lookup_failed` said nothing.** The refusal is almost certainly that YouTube Data
API v3 is not enabled in the Google Cloud project — consent and API access are separate, and
granting one does not switch on the other. The lookup now reads Google's machine-readable
reason, which is an enum carrying no request detail and no credential, and maps
`accessNotConfigured` to a sentence naming the one thing in the way, with a link to the page
that fixes it. Quota and missing scope are told apart from it, and anything unrecognised stays
generic.

The outcome travels from the function to the app as a **code, never a message**: a code is an
enum the app translates, while a message could carry a Google error body, and those quote the
request back.

## The entry points had no typechecker, and it cost a production 500

`tsconfig.json` excludes `supabase/functions/*/index.ts` because the Node compiler knows
nothing of `npm:` specifiers or the `Deno` global. The reasoning was that Deno checks them at
deploy. It does not: `supabase functions deploy` bundles without typechecking, so the
exclusion left them checked by nothing at all.

What shipped through that gap was a one-argument call to a two-argument function. `corsHeaders`
had gained an `allowed` parameter; one call site kept the old shape, `allowed` was `undefined`,
`.includes` threw, and every POST to `oauth-start` returned 500 with no CORS headers — which
the browser reports as `TypeError: Failed to fetch`, indistinguishable from the CORS problem
that had just been fixed. The preflight kept working, because that call site *had* been
updated, which made it look like a CORS fault rather than a crash.

`npm run check:functions` runs `deno check` over the three entry points and is part of
`npm run check`. Verified by reintroducing the exact bug: `TS2554: Expected 2 arguments, but
got 1`, exit 1.

Diagnosed in a real browser rather than by reasoning. `curl` could not reproduce any of it,
and the decisive measurement was that `/auth/v1/health` answered from the page while every
`/functions/v1/` call threw — which separated "cannot reach Supabase" from "this function is
broken".

## Three unasserted edits, and what they cost

Three string replacements in this session silently matched nothing, because the file had been
reformatted between writing and editing it. One of them deployed unchanged and cost three
round trips diagnosing a platform that was behaving correctly; one shipped the 500 above.
Every edit now asserts its anchor and its result, and the arity class is caught by a compiler
rather than by a person.

## A channel connected, and the first collection attempted

The operator connected a real channel — `UCRskvg-PG1BWLLhW-cm6_yA` — through Google's consent
screen. The whole round trip worked: state consumed once, code exchanged, identity read from
`channels.list(mine=true)`, tokens sealed, channel attached with status `connected`.

Collection then ran against it and was **blocked**, which is the correct outcome rather than a
failure: `commentThreads.list` answered 403 `insufficientPermissions`.

That is a scope problem, and it was only findable live. `youtube.readonly` is enough to read a
channel's identity and its uploads — both worked — and is refused for reading its comments.
Comment access sits behind `youtube.force-ssl`, which is **broader than this product needs**:
it permits writing and deleting comments, and nothing here calls a write endpoint. Google
offers no narrower grant, so the wider scope is requested and the fact is recorded rather than
buried.

Finding it at all required a change. The collector reported `source_access_denied` with no
reason, which told the operator only that something was refused. It now carries Google's own
name for the refusal — an enum, not prose, so it holds no request detail and no credential —
and the blocked job reads `source_access_denied:insufficientPermissions`. A blocked job with
no reason is a dead end for whoever has to act on it.

**What is verified:** a worker authenticating with a scoped credential, claiming a job over
HTTP from the deployed gateway, receiving a short-lived access token it never had the means to
mint, using it against the live YouTube API, and reporting a refusal honestly. **What is not:**
a single real comment in the database. The count is zero, and the reason is above.

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

## 2026-09-15 — the rail's ink, and two Arabic labels that came apart

`rail.test.ts` measures white-at-an-alpha over `#100d28`, the darkest point of the rail's own
background, and holds text to 4.5:1 and the destination icons to 3:1. It reads the alphas out
of `app.css` instead of repeating them. Three mutations were run against it and each failed
exactly one assertion: the caption ink back to α 0.38 (≈3.1:1), the icon column changed from
`20px` to `auto`, and the active bar's `inset-inline-start` changed to `inset-block-start`.

`dashboard.spec.ts`'s "no Arabic label is letter-spaced" caught two live regressions in
uncommitted work rather than in anything it was written for: `.app-shell .rp-page .rp-eyebrow`
had its `letter-spacing: 0` — which exists only to undo `report.css`'s 0.16em inside the app
shell — replaced with `0.03em`, and a caption I had just added carried 0.08em. A third,
`.app-plan-kicker` at 0.04em, is the same defect and no test sees it: the plan card renders
only to a signed-in reader. All three are now 0.

Gates after the change: lint 0, format 0, types 0, unit 0 (232 tests), e2e 0 (68 tests),
`check:secrets` 0.

Deployed to the private preview at 2026-09-15. Evidence is the FTP transfer log — 226 on every
file including `static/index-Dv2ALO_m.css`, the new bundle hash. The origin answers 401 on the
page and on that path and 403 on `.htpasswd_app`, but **the 401 proves only that basic auth is
in front**: a path that does not exist answers 401 too, so it is not evidence the new bundle
landed. The transfer log is.

## 2026-09-15 — audit phase two

Gates after `e01dc5e`: lint 0, format 0, types 0, `check:functions` 0, unit 0 (277 tests, 34
files), db 0 (140 tests against PGlite, including the new attach-with-names case and its
nameless-reconnect half), e2e 0 (74 tests, exit code checked from a log file, port 5199),
build 0, `check:secrets` 0.

What the browser suite cannot see, and what stands in for it: every signed-in surface touched
here — the workspace gate's four states, the owner's card with its steps and channel line,
the plan card — is rendered in a unit test from forced state or handed-in rows, since the
suite runs signed out with no Supabase. The card was extracted as a presentational component
for that reason; a first draft seeded `useState` by declaration index and was discarded as too
brittle to trust.

Measured, not asserted by test: the five step-state pills on their tints, lowest 5.23:1
(attention) and highest 7.97:1 (later); the plan note's warning and exhausted inks on the
rail's ground, 13.1:1 and 10.3:1. The main bundle before and after the plan card: 510.58 kB →
510.54 kB, after a first draft had taken it to 591.59 kB by importing the data module into
the shell.

Not verified: the live callback storing a name (needs the migration applied and a real
consent flow), and the owner's page against a real session — rendered from rows only.

## 2026-09-15 — migration 20260915080000 applied to the live project

`supabase migration list --linked` showed every local migration through `20260914200000`
already remote and this one alone pending, so the live body of `oauth_attach_channel_for`
was the one the tests built from. `db push --linked --dry-run` named the single file;
`db push --linked` applied it.

Probed over PostgREST as the publishable key, which is the boundary a stranger reaches:
`connection_status?select=title` answers 401 / 42501 (the column exists; Postgres reached
the privilege check) where `select=nope` answers 400 / 42703. `rpc/svc_oauth_attach_channel`
answers 401 / 42501 both with the seven names the deployed callback sends and with the nine
the new one sends — so the function resolved either way, and the deployed Edge Function is
not broken by the rebuild.

Not yet done: the Edge Function itself is not redeployed, so no name reaches the database
until it is; the column stays null and the page shows the labelled id.

## 2026-09-15 — oauth-callback redeployed, version 7

`npm run check:functions` clean, then `supabase functions deploy oauth-callback
--no-verify-jwt` — the flag because the live function ran with `verify_jwt: false` (a redirect
from Google carries no Supabase JWT) and a deploy without it would have turned that on.
`functions list` afterwards: version 6 → 7, `verify_jwt` still false, ACTIVE. A bare GET to
`/functions/v1/oauth-callback` answers 303 to `/connected?status=error&code=invalid_callback`,
which is the handler's own refusal of a callback with no code and no state — so the new
bundle is the one answering.

Not verified: a real consent round trip. The name is stored only when a channel owner goes
through Google again, and the one connected channel's owner has not yet.

## 2026-09-15 — the workspace in the address

Gates: lint 0, format 0, types 0, unit 0 (285 tests, 35 files), e2e 0 (74, port 5199, exit
code from a log file). The two dashboard page tests now render inside a `MemoryRouter`
because the page reads the address; the identity suite gained a case that opens the page by
link and one that opens it with a stranger's id.

In a browser, signed out, on the dev build: `/dashboard?ws=abc-123` renders the fixture
with the parameter intact; the rail's overview and operations links read
`/dashboard?ws=abc-123` and `/sync?ws=abc-123`, the account link `/account`; following the
operations link lands on `/sync?ws=abc-123`. Not driven in a browser: the signed-in half —
a remembered choice being written back to the address, and a choice from the select updating
it — because the suite has no session. Those paths are the pure `reconcileSelection`, tested
directly, and the hook is a shell over it.

## 2026-09-15 — preview deploy of c51f1f4

Built from a detached worktree at `c51f1f4`, not from the checkout: the working tree carried
another session's uncommitted edits to `app.css`, `landing.css` and `Landing.tsx`, and a
build there would have shipped them under this commit's name. The clean `dist` was copied
into `apps/web/dist` for the script to read.

Evidence is the transfer log: 27 files at 226, including `static/index-CEmKVrNK.js`
(511.09 kB) and `index-D9msRF2r.css`; the sweep then removed the eight superseded hashed
assets. Probing the origin proves nothing either way and this time proved it twice over: the
new bundle answers 401 (basic auth, as every path does) while the *previous* bundle
`index-Bp6sxIUa.js` still answers 200 — `server: cloudflare`, `age: 9641`, `immutable` — a
CDN cache hit for a file the host no longer has. A green probe on an old asset is not a
rollback and not a failed deploy; it is a cache.

`5c10eb5` (six indigo tints, `app.css` only) landed on `main` while the upload ran and is not
in this deploy.

## 2026-09-15 — migration 20260915110000 applied to the live project

`db push --linked --dry-run` named the one pending file; `db push --linked` applied it,
backfill and partial unique index included, without error — so the live table held no
channel with two connected grants, or the index would have refused. The entry point still
answers 401 / 42501 over PostgREST with the nine named arguments, so the `create or replace`
landed on the same signature.

Not verified: a re-link on the live channel (needs the owner's consent round trip).

## 2026-09-15 — app.css carries no raw colour

Baseline, from a script over the six layers with comments stripped, before any change:
style 0 · report 7 · app 56 (37 distinct; 14 equal to a token, 34 not; 12 within ΔE 3 of one)
· landing 95. After: style 0 · report 0 · app 0 · landing 95 (out of scope). `layers.test.ts`
asserts the three zeros and that no layer repeats a token's value; `rail.test.ts` now reads
`--plane-dark` from `brand.css`.

Contrasts measured where a value moved (WebAIM formula, same as `palette.ts`): focus border on
its own focused ground 4.50:1 (needs 3); warning ink `--color-warning` on `--warning-bg`
5.63:1 (was 6.86 / 8.61); white on the button's hover stop `--ml-indigo-500` 4.98:1 (was
6.29; 14px bold needs 4.5); rail secondary ink `--ml-indigo-300` on `--plane-dark` 9.00:1;
active bar 9.00:1 (was 6.33); kicker `--fg-on-brand` 15.09:1 (was 13.12); footer ink 10.52:1;
success pill 5.70:1. The warning strip's edge bars measure 2.04 and 2.66 and are marks beside
text that says the same thing — unchanged by this work and noted, not fixed.

Gates: lint 0, format 0, types 0, unit 0 (289), e2e 0 (74, port 5199, exit from a log file),
build 0. Screenshots of the overview at 1280px before and after each step were compared by
eye and are indistinguishable, which is the intent: the change is where the values live.

## 2026-09-15 — every gate on HEAD `3e62ee6`, from a clean worktree

Run in a worktree of HEAD alone, because the working tree carries another session's
in-flight edits: lint 0 · format 0 · types 0 · unit **303** (38 files) · db **142** (15 files,
PGlite) · worker **127** · browser **74** (port 5201, exit code from a log file) · build 0 ·
`check:secrets` 0 in the real checkout (273 files; in the worktree it tripped on the
node_modules symlink the worktree needed, an artefact of the setup, not of the code).

Against the earlier proof table's figures (unit 173, db 126, worker 124, browser 60): every
layer grew, none shrank.

The rail's two pieces are signed-in only and rendered in `RailState.test.ts` from forced
state; not driven in a browser. The three browser assertions in `dashboard.spec.ts` that
pinned the old "worker" sentences were updated to the new ones and pass.

## 2026-09-15 — English language support

Gates after `7478dc0`: lint 0, format 0, types 0, unit 0 (304 tests, 38 files), e2e 0 (78
tests, port 5199, exit code read from a log file), build 0, `check:secrets` 0.

Browser: `language.spec.ts` — Arabic by default; the switch flips `<html lang dir>`, the rail,
the document title and the switch's own label; a reload comes back in English; the landing
page stays Arabic afterwards; in English the rail caption regains tracking and the shell takes
the Latin face; at 375px the closed sheet is off-screen and opens on request, measured through
its transition. The other 74 tests are unchanged and still locate every control by its Arabic
name — which is the proof that the default did not move.

Unit: the store refuses an unknown stored value and survives storage that throws; the two
string sets carry the same keys, tables and list shapes, and no Arabic is left in the English
except the switch's own word; the English counts change the noun at one and only at one; the
workspace card renders in English from the same rows.

Bundle, `npm run build` before and after: main chunk 511.09 → 549.46 kB (150.03 → 161.18
gzipped), Dashboard chunk 231.50 → 222.53 kB, English 31.23 kB (10.71 gzipped) fetched only
when chosen. Net for an Arabic reader +29 kB raw. An intermediate build with both sets in the
main chunk measured 580.32 kB and was rejected.

Not verified: any signed-in surface in English against a real session (rendered from rows in
unit tests only), and screen-reader pronunciation of the switch's `lang`-tagged label.

## 2026-09-15 — preview deploy of ddb5081

Built from a detached worktree at `ddb5081`, as before, because the checkout still carries
another session's uncommitted `Landing.tsx` / `landing.css` / `landing.spec.ts`. Transfer
log: 30 files at 226, including `static/index-B5_hTwqU.js` (549,437 bytes) and the new
`static/en-CVnvERZx.js` (31,233 bytes) — the English strings as their own chunk, fetched
only when chosen; the sweep removed the nine superseded hashed assets of the previous
build. Origin probes are not evidence either way (basic auth answers 401 on every path, and
Cloudflare still serves a deleted asset from cache); the log is.

## 2026-09-15 — the empty overview

Unit 308 (38 files), browser 78 (port 5201, exit from a log file), lint 0, format 0, types 0.
The identity test forces a live source with no comments, a queued job and a connected channel
row, and reads done · done · in progress; with no channel row, next · later. `latestJobFromSync`
is tested over the five run statuses and the queue. Visual check: the rendered path injected
into the fixture overview's empty section at 1280px — pills, detail line and the two actions
lay out as the account card's do.

## 2026-09-15 — preview deploy of 95be0b4

Built from the checkout itself this time: the tree was clean at `95be0b4` (the landing work
is committed), so no detached worktree was needed. Transfer log: 31 files at 226 — every one
of the build's 31 — including `static/index-Dke0SM9B.js` (549,493 bytes),
`static/index-T93yXpfz.css` (58,945 bytes; the tokenised app layer and the landing's unified
system), and the two new chunks `RailState-D65vhTeh.js` (2,427) and `SetupPath-RvFaERm1.js`
(1,611). The sweep removed the ten superseded hashed assets of `ddb5081`'s build. Exit 0.
Origin probes are not evidence either way (basic auth answers 401 on every path); the log is.

What this preview carries that the last did not: the rail's workspace switch and collection
line, the page-level switches removed, the empty overview as the setup path, "the worker"
gone from reader-facing sentences, app.css with no raw colour, and the landing on the brand's
ink, accent, sentiment scale and a 13px type floor.

## 2026-09-15 — landing translation

Gates after `b956c64`: format 0, types 0, lint 0, unit 308/308, e2e 78/78 (port 5199,
exit code from a log file), build 0. `language.spec.ts` walks the choice from the landing
into the dashboard and asserts the demo comments keep `lang="ar" dir="rtl"` inside a
left-to-right page and the CTA's arrow turns with the text. Seen at 1280px in both
languages; the Arabic page is unchanged. English chunk 37.6 kB (12.9 gzipped); main
552.0 kB (161.7 gzipped).

## 2026-09-15 — preview deploy of c895e14

Built from a detached worktree at `c895e14` (the checkout was clean this time; the
worktree is kept as the habit). Transfer log: 31 files at 226, including
`static/index-D7tk0koE.js` (552,007 bytes) and `static/en-_fVKwHg5.js` (37,605 bytes,
now carrying the landing's English); the sweep removed the twelve superseded hashed
assets — twelve rather than nine because the other session's landing and dashboard
commits had re-hashed their chunks since the last deploy. The log is the evidence; the
origin's 401 and Cloudflare's cache are not.

## 2026-09-15 — the catalogue on the operations page

Gates at `96ee693` (CSS-only commit after): `npm run check` exit 0 (lint, format, types,
functions, unit 322/322 across 40 files, db, worker, build, secrets); `npm run test:e2e`
exit 0, 82/82 in 1.1 min on port 5173, exit code read from the log file. The four new
browser tests were run red first (`catalogue` test id not found, all four failing) and
green after. Two of the brief's expectations met the tree: "جُمع 5" for video-1 is the
server's count and the snapshot aggregate's 4 is not — fixed at the source, with a unit
test in `catalogue.test.ts` that counts an owner's reply; and the phone-width test's
tracking filter refused the −0.01em every `.rp-section h2` carries, so it applies the
suite's existing rule (positive tracking only). Seen at 1280px and 375px on the dev
server in fixture mode (`.screenshots/sync-catalogue-*.png`, untracked); the sticky
estimate bar sits at the viewport's foot on the phone. Not seen: the live catalogue
signed in — no session in this environment.

## 2026-09-15 — selective video sync, the whole feature (tasks 1–9, `ca86ed3`…`4abfd02`)

Every layer this feature touches, verified with real runs, not carried forward as a claim.

**Migrations** — three new files: `20260915130000_video_catalogue_and_selections.sql`
(catalogue columns on `videos`, `video_selections`, the two plan intervals, the backfill,
`due_videos`, `jobs_one_outstanding_discover`); `20260915131000_select_videos.sql`
(`select_videos`, `request_discovery`, `analysis_remaining`); `20260915132000_worker_catalogue_and_due_lists.sql`
(`claim_job` rebuilt to carry the job's own mode, `worker_due_videos`, `worker_commit_catalogue`,
`worker_video_finished`, `enqueue_scheduled`, `schedule_due_work`, `worker_tick`, `schedule_all`,
the four `svc_worker_*` wrappers, `oauth_attach_channel_for` rebuilt to enqueue a first
discovery). PGlite (`npm run test:db`): 17 files, 170 tests, all passing — the running total
across `selection.test.ts` (16: 6 from task 1, 10 from task 2) and `worker_catalogue.test.ts`
(8, task 3), on top of the pre-existing suite.

**Gateway** (`supabase/functions/_shared/worker-gateway.ts`, `supabase/functions/worker/index.ts`) —
`type`/`videos` on every claim response, `/worker/commit-catalogue`, `/worker/video-finished`,
`/worker/tick` routes, two new `STATUS` codes. `worker_gateway_handler.test.ts` (8 tests) and
the seam test in `end_to_end.test.ts` (4 tests, `liveDb` now implements all of `WorkerDb`
against real PGlite SQL) are part of the 170 above. `npm run check:functions` (deno check over
every function entry point): 0 errors.

**Worker (Python)** — `YouTubeAPI.catalogue()` (three-tab pagination, a 404 tab, a missing
`commentCount` mapped to `None`); `run_discover`/`_discover`, `run_backfill`/`_backfill`
rewritten to walk the server-supplied due list and report every video's end through
`video_finished`; `run_job` dispatches on lease type; `loop.serve` ticks every control on an
idle round. `npm run worker:test`: 141 tests, all passing (`test_catalogue.py` 6,
`test_discover.py` 5, `test_backfill.py` 7, `test_loop.py` 8, the rest unchanged). `npm run
worker:lint` (ruff): 0 findings.

**Contracts/web** — `packages/contracts/src/selection.ts` (`selectionEstimate`,
`CatalogueVideoSchema`, `filterCatalogue`, `fitNewest`); `apps/web/src/catalogue.ts`
(`mergeCatalogue`, `loadCatalogue`, `storedPerVideo`); `Sync.tsx` split into
`OperationsPanels.tsx` and `CataloguePanel.tsx`; the account card's sync button replaced with
a link to `/sync?ws=<id>`; `enqueue_sync` no longer called from the browser
(`grep -rn enqueue_sync apps/web/src` — no hits). 41 ar/en string keys added, parity held by
`tsc`.

**Full gates, run fresh from this clean tree** (`export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`
first; `lsof -i :4173 -i :5173` empty before each):

```
npm run check > /tmp/check.log; echo $?      → 0
npm run test:e2e > /tmp/e2e.log; echo $?     → 0
```

`check` (lint, format:check, typecheck, check:functions, test, test:db, worker:test, build,
check:secrets, in that order, `&&`-chained so any non-zero would have stopped it): lint 0,
format 0, types 0, functions 0, unit **325 tests / 41 files** (`vitest run --exclude
"supabase/tests/**"`), db **170 tests / 17 files**, worker **141 tests**, build 0 (main chunk
`index-rv5-ggUY.js` 553.74 kB / 162.24 kB gzipped, `en-Dqv1dEF_.js` 39.03 kB fetched only when
chosen, `Sync-DS6msJBp.js` 17.60 kB), `check:secrets` 0 (298 source files, plus built assets).
`test:e2e`: **82 tests**, port 5173 (no `E2E_PORT` override), exit code read from
`/tmp/e2e.log` via `echo $?`, not piped through `tail`; the four catalogue tests are among the
82 (`…:1609`, `…:1650`, `…:1672`, `…:1681` in `tests/e2e/dashboard.spec.ts`).

**Mutation checks, two.**

1. **The quota guard in `select_videos`** (Task 2 Step 5, from its report). The `raise
   exception 'quota_exceeded'` branch in `private.select_videos_impl` was deleted from a copy
   of `20260915131000_select_videos.sql`; `npx vitest run supabase/tests/selection.test.ts`
   went red on exactly the mutated behaviour — the call that should have been refused
   succeeded instead (`AssertionError: expected [Function] to throw error matching
   /quota_exceeded/ but got { ... "estimate": 40, "job_id": "393f69c0-...", "queued": true,
   "remaining_after": -10, ... }`), plus one cascading failure in the next test from the state
   the ungated call had written. The migration was restored from a backup and diffed
   byte-identical before the fix was re-verified green (16/16).
2. **The `next_check_at` reschedule in `worker_video_finished`** (this task, Step 3). In
   `supabase/migrations/20260915132000_worker_catalogue_and_due_lists.sql`, the
   `next_check_at = now() + make_interval(mins => iv)` line was removed from the `exhausted`
   branch's `update public.video_selections` statement, leaving `last_collected_at` and
   `last_outcome` updated but `next_check_at` untouched. `npx vitest run
   supabase/tests/worker_catalogue.test.ts` went red, 3 of 8 failing (the other two are
   downstream of the same fixture row staying due when it should not). The assertion that
   names the mutation directly:

   ```
   FAIL  supabase/tests/worker_catalogue.test.ts > worker catalogue and due lists >
     hands a collect claim its due list and nothing beyond the selection
   AssertionError: expected { last_outcome: 'exhausted', …(1) } to deeply equal
     { last_outcome: 'exhausted', …(1) }
   - Expected
   + Received
     {
       "last_outcome": "exhausted",
   -   "later": true,
   +   "later": false,
     }
   ```

   (`later` is the test's own comparison of the row's rescheduled `next_check_at` against the
   moment collection started — `false` because the mutated function left it unchanged, so the
   just-finished video was still due.) The file was restored from a backup made before the
   edit; `git diff --stat` was empty afterward (confirmed both immediately after restoring and
   again before staging this commit), and `npx vitest run
   supabase/tests/worker_catalogue.test.ts` was re-run green, 8/8. The mutation was never
   staged or committed.

**Seen in the browser.** Task 9's report names the screenshots taken in fixture mode at
1280px and 375px, `.screenshots/sync-catalogue-{1280,1280-full,375,375-full}.png` (untracked,
still present on disk in this checkout): the toolbar (search, four kind counts with live
counts, sort, select-view/clear/fit, refresh disabled in demo mode, the catalogue's age),
five rows newest-first including one with `تعليقات معطّلة` in the warning colour and an
unselectable checkbox, two rows reading a real collected count (`جُمع 5`/`جُمع 2`), the sticky
selection bar with a live estimate and the save button's enabled state, and at 375px a row
wrapping in three lines with the bar pinned to the viewport's foot. No new screenshots were
taken for this task — it changes no product code.

**Not verified — explicitly, and why.**

- **A live `discover`/`collect` run against the real channel.** This needs all three new
  migrations applied to the live Supabase project and the `worker` Edge Function redeployed
  with the gateway/index.ts changes from Task 5; neither has happened (see the pending items
  below and `docs/coordination/ACTIVE.md`). Every worker-side assertion above runs against
  PGlite or `httpx.MockTransport`, never the live YouTube API or the live database.
- **`select_videos` from a signed-in browser.** Task 9's report already recorded this gap
  (Concern 2): the fixture never exercises the live RPC call, so the `quota_exceeded` message
  match (`/quota_exceeded/.test(error.message)`) is type-checked only, not run against a real
  PostgREST response shape. No session exists in this environment to close that gap.
- **`pg_cron`.** The extension is not enabled on the live project and `schedule_all()` has
  never been scheduled or invoked outside the unit tests that call it directly; the worker
  loop's own `tick()` fallback is what has actually run, and only inside `test_loop.py`'s
  simulated queue.

## 2026-09-15 — the final review's five findings (`d7727a3`…`8998e35`)

Each finding was reproduced by a test written before the fix and watched fail for the
finding's own reason, then pass. Node `v22.14.0`; logs read from files, exit codes from `$?`.

**SQL** (`supabase/migrations/20260915140000_selection_accounting_and_backoff.sql`; each
replaced body copied from its current definition and diffed against it — the diffs show only
the named lines). `npx vitest run supabase/tests/{selection,worker_catalogue,dashboard_read}.test.ts`
before the migration existed: 7 failed / 28 passed —

- `refuses a second selection that fits alone but not with the first`: the second 4000 on a
  5000 plan was accepted (`{ job_id: null, queued: false, … }` where `quota_exceeded` was
  expected) and the response carried no `outstanding`.
- `a removal alone requests no collection and needs no plan`: `error: no_active_plan` on a
  remove-only call under a paused subscription.
- `says a running collection will not include the new video`: no `already_running` key.
- `reports the last collection as the last run, not a newer discovery`: `videos_seen: 0`
  (the discover run) where the collect run's `3` was expected.
- `a collect that failed is not re-enqueued for an hour`: the tick after a failed collect
  answered `{ collect: 1 }`.
- `answers the new plan intervals`: pilot `sync_interval` 0 where 30 was expected.

After: 35/35, and `npm run test:db` 17 files, 176 tests. The probes' numbers: first
selection of 4000 → `estimate 4000, outstanding 0, remaining_after 1000`; second 4000 →
refused, nothing written; then 900 → `estimate 900, outstanding 4000, remaining_after 100`;
swapping the first 4000 for the second in one call → `outstanding 900` (the removed
selection is not owed). A failed collect aged 45 minutes → tick `collect: 0`; aged 61 →
`collect: 1`; a succeeded job aged 45 minutes (past the 30-minute limit) → `collect: 1`.

Two existing tests moved with the pilot plan's new rate limit rather than with any
behaviour: the tick test and `connecting a channel queues its first discovery` now age the
earlier jobs past thirty minutes first, and `request_discovery queues one discover per
channel` ages the schema tests' `d1`; each is about dedupe, not the limit, and says so.

**Worker** (`workers/python/src/server/runner.py`, `tests/test_backfill.py`): the new test
drove a claim whose JSON carries no `videos` key at all; before the fix
`('succeeded', None)` where `('blocked', 'no_due_list')` was expected. After: `npm run
worker:test` 142 passed, `worker:lint` clean. An explicit `[]` still finishes `succeeded`
(the existing assertion, unchanged).

**Contract and panel** (`packages/contracts/src/selection.ts`, `apps/web/src/CataloguePanel.tsx`,
`strings/{ar,en}.ts`): `selectionEstimate` red on the missing `outstanding` (2 failed / 6
passed), green 8/8 — a selected video with 100 reported and 90 stored owes 10, so 31 more
fits 50 (`remainingAfter 9`) and not 40 (`exceeds`, `-1`); a selection being removed owes
nothing; an unknown count owes nothing. `savedFeedback` red as `is not a function`, green
4/4 across the four answers `select_videos` gives; the removal sentence is asserted to say
nothing about collection. `npm run typecheck` 0 — the two new sentences have English twins.

**Browser** (`tests/e2e/dashboard.spec.ts`, the catalogue block): run against the changed
panel before the assertions moved, the bar read `المحدد: 3 فيديو · حتى 21 تعليقًا · يتبقى
بعدها 5` where `حتى 18` / `يتبقى بعدها 8` were asserted — the fixture's stored selections
owe 3 (video-1 reports 7 and holds 5; video-2 reports 3 and holds 2; the brief's "4/2 stored
→ 4" counted video-1 from the dashboard's aggregate, which drops the owner's reply — the
server, `storedPerVideo` and the row's own `جُمع 5` count 5). The assertions now read 3
owed before anything is ticked (`حتى 3` / `يتبقى بعدها 23`), nothing owed once the stored two
are cleared (`حتى 0` / `يتبقى بعدها 26`), and 21 / 5 with video-3 ticked. 4/4 in isolation.

**Gates.** `npm run check > /tmp/check.log; echo $?` → 0 (lint and ruff clean, Prettier
clean, tsc 0, unit 41 files / 326 tests, db 17 / 176, worker 142, build, secrets).
`npm run test:e2e > /tmp/e2e.log; echo $?` → 0, 82 passed in 1.1 minutes, load average
under 5, nothing on 4173 or 5173 beforehand.

**Not verified.** The fourth migration is not applied to the live project (pending beside the
three before it in `docs/coordination/ACTIVE.md`); `already_running` has not been seen from
a signed-in browser against a real running job, and the backoff has not been watched across
a real hour — both are PGlite-only, like the rest of this feature's server side.


## 2026-09-15 — the first live run of selective sync, and what it found

Pushed by the user in this order: migrations `20260915130000`–`140000` (`db push --linked`,
four applied, nothing else pending), `supabase functions deploy worker --no-verify-jwt`
(version 8 → 9, `verify_jwt` false), then `20260915150000` after the first tick answered
`control_plane_error:42501` — `private.plan_limit` had been revoked from tenants on
2026-09-13 and never granted to `service_role`, which the new security-invoker worker
functions run as. `worker_catalogue.test.ts` now runs every `svc_*` entry point under
`set role service_role`; without the grant it fails 4/9 with `permission denied for
function plan_limit`, with it 9/9.

`POST /worker/tick` with each credential, after the grant: personal workspace
`{discover: 1, collect: 0}` (nothing selected there), AJ360 `{discover: 1, collect: 1}` (the
39 backfilled selections were due at once). A second tick on each answered zeros — the
one-outstanding rule and, after the run, the pilot's new 30-minute `sync_interval`.

**Discovery is real.** Both `discover` jobs succeeded through the deployed gateway and the
live YouTube API: the personal channel 12 videos in 4 s; **AJ360 4,456 videos in 78 s
(2,194 videos · 2,253 shorts · 9 streams)**, `channels.catalogued_at` set, every row `open`.
The handoff's "194" was a much smaller snapshot. A single unpaged PostgREST read of
`videos` answered exactly 1,000 rows and no error — the final review's "can wait" item was
load-bearing after all. `catalogue.ts` now reads `videos` and `video_selections` in pages of
1,000 by a stable key until a short page (`68ddf99`); the unit test drives 1,456 rows through
two ranges and an exact 1,000 through a second, empty one, and is red without the paging.

**The collect was not ours.** AJ360's `collect` was claimed at 20:17:36Z — two minutes
before this session's worker came up at 20:19:53Z — walked 30 *recent uploads* (the old
`build_plan` survey; the checkpoint's `done` list is their external ids), committed 418
comments, finished `succeeded`, and called `video-finished` for none of them: the 39
selection rows kept the backfill's `next_check_at`. `worker_seen` keeps advancing on both
workspaces every ~60 s while no worker runs on this machine (`pgrep`, `launchctl`, `crontab`
all empty): **an instance of the pre-selection worker, holding both credentials, is running
somewhere else.** Until it is stopped or the credentials are revoked it will keep claiming
collects and reading the channel's newest uploads regardless of the selection.

`video-finished` itself works: a probe job queued directly, claimed through the gateway
with a live lease (39 due videos handed down, access token present), one call for
`0271170f…` → `last_collected_at` now, `next_check_at` +24 h, `last_outcome` exhausted, in
1.1 s. The probe job and its run row were then deleted. Two `worker_job`-guarded routes
called with a *dead* lease hung for over two minutes before answering 500
`control_plane_error` rather than 409 `lease_lost` in ~1 s; `worker_tick` (no lease) answers
in 0.8 s. `lease_lost` is raised with SQLSTATE `40001`, which PostgREST treats as a
serialization failure and retries with backoff. Latent since 2026-09-13; not hit by any
worker so far because a live worker holds a live lease. Recorded, not fixed here.

**Model load on this Mac.** transformers 4.57 refuses `torch.load` on torch 2.2.2 (the last
x86_64 macOS build) and the pinned CAMeL revision ships only `pytorch_model.bin`. The same
tensors were re-saved as `model.safetensors` inside the HF cache for that revision
(`b0df630d…`, 436,362,324 bytes, 202 tensors), the stale `.no_exist` marker removed, and the
loop runs with `HF_HUB_OFFLINE=1`: same model id, same revision, same analysis key; two
probes scored 0.99 positive / 0.99 negative. A local-cache workaround, not a repository
change; any machine with torch ≥ 2.6 needs none of it.

Not verified: a `collect` run by the *new* worker over a due list end to end (the old
worker took the only one); `select_videos` from a signed-in browser (the web bundle is not
deployed yet); pg_cron.

## 2026-09-15 — the old worker retired, and the first collect by the new one

Nothing on this machine ran the old worker (`ps` over every user, `launchctl`, `crontab`,
Docker, tmux/screen: nothing), while `worker_seen` kept advancing on both workspaces every
~60 s with this session's loop stopped. So the credentials were rotated: two new ones
registered through `svc_register_worker_credential` (labels `rotated-2026-09-15`), the
retire route added as `20260915160000` (tested in PGlite under `set role service_role`: the
other active credential of the workspace is revoked, the named one kept, the other
workspace untouched, the revoked one refused at claim; `keep_at_least_one` and
`unknown_credential` refused), pushed by the user, then `svc_retire_worker_credentials`
called once per workspace (`1` retired each). Probed at the gateway afterwards: the old pair
answers `401` on `/worker/tick`, the new pair `200`. The old worker, wherever it is, has
polled into a 401 since 20:45Z and can claim nothing.

The new loop was started on the new pair (`HF_HUB_OFFLINE=1`, camelbert-da, two tenants).
Its own idle tick enqueued AJ360's `collect` at 20:47Z, once the pilot's 30-minute
`sync_interval` since the previous collect had passed — `{collect: 0}` on every earlier
tick, which is the throttle working. The run: claimed 20:48:44Z, finished 20:52:20Z,
`succeeded`, `videos_seen: 38, comments_collected: 462, complete: true` — **38 is the due
list exactly** (39 selections minus the one the probe had already rescheduled), not the
channel's newest uploads. All 38 selection rows carry `last_collected_at` inside the run,
`last_outcome: exhausted`, and `next_check_at` on 2026-09-16; the next tick answers
`{collect: 0, discover: 0}`, because nothing is due until then. `comments` gained 2 rows
since 20:45Z: 2 genuinely new comments on the 38 videos; the other 460 were already stored
and cost nothing again — the idempotent metering the pricing page promises.

Live and verified now: discover (both channels), collect over a server-supplied due list,
`video-finished` scheduling the next check, the tick's throttle, credential rotation.
Still not verified: `select_videos` from a signed-in browser (the web bundle with the
paging fix, `68ddf99`, is not deployed yet), pg_cron.

## 2026-09-16 — the deployed catalogue, seen

The user ran `npm run build && npm run deploy:preview`. Every chunk the served `index.html`
references (`index-EyYl8MHZ.js`, `Sync-DEqfL_0d.js`, `Account-…`, `Dashboard-…`,
`PlanCard-…`, `RailState-…`, `SetupPath-…`, `i18n-…`, `syncHealth-…`, `workspace-…`), the
CSS and `fixtures/catalogue.json` were fetched back over basic auth and compared with the
local `dist` byte for byte: identical, so what the host serves is the build of `e81af96`,
paging included (`range(` and `catalogue_unavailable` present in the served Sync chunk).

A false alarm first: opening the host as `https://user:pass@host/sync?demo=1` in the in-app
browser gave a blank page with React error #321 and a `removeChild` NotFoundError on every
route, while the identical bytes rendered under `vite preview`. The `<script type="module">`
resolved against the credentialed URL, the chunks' own imports resolved against the plain
one, and the browser instantiated the entry module twice — two Reacts. With the credentials
cached and a plain URL the page renders: the catalogue first, five fixture rows, the
disabled row unselectable, "المحدد: 2 فيديو · حتى 3 تعليقًا · يتبقى بعدها 23". Nothing to
fix in the product; a real visitor enters the password in the browser's prompt.

Not verified from here: the signed-in AJ360 page with its 4,456 rows (no session in this
environment, and the Claude in Chrome extension is not connected), and pg_cron's first tick
at :17 (nothing is due before 2026-09-16 ~20:50Z, so a successful tick leaves no row to
see; `cron.job_run_details` in the SQL editor is the evidence).
