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
| `npm test` | Pass — **83 tests, 10 files** |
| `npm run test:db` | Pass — **64 tests, 7 files** |
| `npm run worker:test` | Pass — **60 tests, 9 files** |
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
| Leave the prune job executable by tenants | 1 |
| Show a verdict about text the comment no longer has | 1 |
| Turn unknown engagement into zero on the live read | 1 |
| Leave the platform parent id unresolved | 1 |
| Let a configured project alone flip the data source | 4 |
| Trust the server's answer without parsing it | 1 |

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
| Deployment | Nothing deployed; no URL exists, private or otherwise |
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
