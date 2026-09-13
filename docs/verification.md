# Verification

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
| `npm test` | Pass — **83 tests, 10 files** |
| `npm run test:db` | Pass — **100 tests, 11 files** |
| `npm run worker:test` | Pass — **91 tests, 11 files** |
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

**Still unverified:** a real OAuth consent round trip (no code has been exchanged), and the
live dashboard read returning real comment rows, since no channel has been collected.

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
