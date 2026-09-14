# Progress

## 2026-09-14 — Private preview deployment and origin verification

The updated production front-end bundle (including the new Arabic sentiment engine wiring, confidence scores display, and sidebar navigation) was deployed to private hosting (`app.sky-develop.net`, origin `91.204.209.217`) via `npm run deploy:preview`. All files uploaded successfully over FTP, and 8 obsolete asset chunks were cleanly removed. Probing the origin over HTTP confirmed that HTTP Basic Auth is strictly enforced (401 without auth, 200 with credentials), all static assets and fixtures return 200 with exact sizes, SPA fallback functions on all routes (`/dashboard`, `/sync`, `/account`), and `.htaccess` remains blocked with 403.

## 2026-09-14 — Comment confidence scores displayed on sentiment chips


Model prediction confidence scores (`class_scores`) are now visibly presented on comment sentiment chips across the dashboard (both cards and table views), showing the exact percentage measured by the active model (e.g. `(85٪)`). Human reviews continue to be explicitly attributed with `مراجعة بشرية` and supersede model predictions. The live browser suite was aligned with the redesigned sidebar navigation destinations, and all 68 Playwright tests plus live mode passed cleanly.

## 2026-09-14 — Arabic NLP sentiment engine and text normalization enhancements


The Python worker's sentiment analysis pipeline (`workers/python/src/sentiment/`) was upgraded with specialized Arabic text preprocessing and multi-model support:
- Added Arabic text normalization helpers (`normalize_arabic_text`, `strip_tatweel`, `strip_tashkeel`, `reduce_elongation`) in `preprocess.py` to handle kashida/tatweel, diacritics, and character elongation while strictly preserving emojis, dialect words, and negation particles (`مش`, `ما`, `لم`, `لن`, `لا`, `ليس`).
- Upgraded `load_pinned` in `transformer.py` to accept registered candidate model names as strings or `ModelCard` instances, with strict validation against model config (`verify_mapping`).
- Added full support for the four-class AraBERT candidate (`PRAli22/AraBert-Arabic-Sentiment-Analysis`) with its first-class `mixed` sentiment label, alongside CAMeLBERT-DA and MARBERT variants.
- Extended `manual_run.py` and `loop.py` to support all registered candidates dynamically via `--model`.
- Added unit tests for Arabic normalization, tatweel/tashkeel stripping, elongation reduction, and 4-class prediction simulation.
- All checks passed: `npm run check` (127 Python tests, 225 unit tests, 135 SQL tests, lint/format/typecheck clean) and `npm run test:e2e` (68/68 Playwright tests passed).

## 2026-09-14 — Internal pages redesigned around the landing identity


The dashboard, account, synchronization, OAuth result and unknown-route pages now share an
Arabic RTL application shell with the landing's mark, type, indigo action color, navigation,
announcement and footer. Report banners, cards and filter layout are more compact and
consistent. The account page pairs sign-in with an honest three-step explanation; its
workspace list has a real loading state. The synchronization page groups health and limits,
keeps the job log distinct, and names the selected workspace. Connection and missing-page
states have working recovery links. On narrow screens the long report filter form is closed
initially, with a labelled button to open it, so the summary is reachable sooner.

The Sync route now waits for a signed-in creator's accessible workspaces and requires a
choice when several are available. It never displays the sanitized operations fixture as a
substitute for a signed-in workspace whose list is loading or failed; switching workspace or
identity remounts the read. This follows the same source-truth rule already applied to the
dashboard. The landing route's sections and marketing styling were left intact.

Local checks passed: `npm run check` (150 unit, 126 SQL, 124 Python tests plus lint,
format, typecheck, Edge Function check, build and secret scan),
`E2E_PORT=5335 npm run test:e2e -- --reporter=line` (50/50 Chromium tests), and
`E2E_LIVE_PORT=5336 npm run test:e2e:live -- --reporter=line` (1/1 with a fake
local Auth/API origin). Desktop screenshots
at 1280px and a mobile browser navigation pass were inspected. This increment was not
deployed; the live signed-in dashboard still needs a real browser walkthrough against the
private project. See the new entry in `docs/verification.md`.

## 2026-09-14 — Dashboard identity and source-truth repair

The dashboard now waits for the signed-in user's own workspace list before reading comments. Changing account or workspace remounts the report, clearing an open correction and its filters; the query key includes the user and workspace, and placeholder rows are reused only inside that same identity. An unavailable workspace list no longer causes a silent switch to the fixture. The creator can switch between accessible workspaces after choosing one, and the source strip displays its name. The video selector uses the videos in the workspace's source data, including titles where available, rather than two fixture ids. The report introduction does not display a zero while loading or claim topic analysis. A browser test with a local fake Auth/API origin proves that delayed B data and sign-out do not display A's comments; an authenticated walkthrough against the deployed Supabase project remains outstanding. The review-history refresh race found by the full browser suite was corrected so the correction form closes after the new snapshot arrives.

## 2026-09-14 — Marketing landing copy and asset correction

The landing's supplied third-party hero PNG was removed from tracked source and replaced with an original generated illustration. Its primary indigo accent now matches the product brand token. The landing copy reflects the witnessed private OAuth connection and 65 real comments collected for a pilot channel, while explicitly stating that live dashboard integration and real-model validation remain in progress. These are copy/asset changes, not a claim that the current deployed page or signed-in dashboard has passed a live browser walkthrough. The current private deployment still needs the corrected asset after the concurrently edited dashboard settles. See `docs/landing.md` and the current verification entry.

The older milestone sections below preserve their as-of dates; their statements that no live collection had occurred are superseded by the 2026-09-14 collection result recorded in the Claude Code handoff and this entry. Do not use the older missing-input table as the current credential inventory.

## 2026-09-13 — Arabic marketing landing implemented

The requested reference-inspired landing is now the `/` route, with working links to `/dashboard` and `/account`, mobile navigation, an authored sentiment example whose chart and comments filter together, audience tabs, and FAQ. Arabic typography is self-hosted; existing dashboard/account code loads on demand. Desktop/mobile visual review and browser navigation checks passed locally. The marketing example remains illustrative and the page discloses the incomplete live setup. No public publication or remote deployment was performed in this increment. See `docs/landing.md` and the dated verification entry for details.

Updated 2026-09-13. Status words are used strictly:
**implemented** = code exists and its tests pass; **fixture-tested** = verified only against
sanitized synthetic data; **blocked** = cannot proceed without a named missing input.

**Nothing here has run against live YouTube, Google OAuth, a real sentiment model, or any
deployment.** As of 2026-09-13 the schema *has* been applied to a real Supabase development
project and anonymous isolation probed over HTTP; every authenticated path remains untested. Every "implemented" below means verified in
embedded PostgreSQL, in Node, or in a browser against fixtures. The list of what that
excludes is at the end of `verification.md` and is the honest limit of this work.

## M0 — scaffold and reproducibility (complete)

Monorepo, pinned manifests and both lockfiles, placeholder-only `.env.example`, documented
commands, CI restricted to credential-free checks, clean install verified from lockfiles.
CI has never executed: there is no remote.

## M1 — collection primitives (unblocked parts implemented)

| Item | Status | Notes |
| --- | --- | --- |
| Collector protocol | implemented | "Exhausted" means the source stopped returning rows, never that everything was retrieved |
| YouTube Data API adapter | fixture-tested | Explicit reply pagination, tested against synthetic HTTP only. **Never run against live YouTube.** Authenticates with an API key *or* an OAuth access token; the token path needs no API key and reads a connected channel directly |
| Refusals told apart | implemented | Comments disabled is the video's answer (`explicitly_disabled`), quota comes back tomorrow (retryable), an expired token asks to be renewed, and a refusal is none of those |
| Durable local spool | implemented | Lease fencing, heartbeats, bounded retries, rows and checkpoint in one transaction |
| Queue semantics | implemented | Lease bounds, batch limits, exponential backoff, both routes to a terminal job |
| Failure is never success | implemented | 403/429 → blocked, 5xx → retryable failure, malformed JSON → invalid response |
| Sentiment interfaces | implemented | Pinned-revision registry, preprocessing, a deterministic test analyzer that is **not a model** |
| Catalogue import, live discovery, model inference | **blocked** | Needs the ZIP, the CSVs, an API key, the notebooks |

## M2 — secure SaaS foundation (complete)

Composite tenant keys, RLS resolved from `auth.uid()` through a non-exposed helper, lease
tokens withheld from the tenant projection, role-checked RPCs, personal workspace bootstrap,
private storage scoped by workspace UUID, append-only review log, usage metering with
reservation, plan limits. Isolation is tested through direct SQL, not hidden UI controls — and as of 2026-09-13 also
against the deployed project over HTTP with two real users: a second tenant cannot list the
first's workspaces and is refused `forbidden` when asking for their dashboard directly.

## M3 — ingestion and analysis (server path complete)

| Item | Status | Notes |
| --- | --- | --- |
| Worker batch contract (I1) | implemented | Rows addressed by platform id; **no workspace field exists** in the payload |
| Atomic ingestion (P2) | implemented | Rows, predictions, checkpoint and meter in one transaction; a batch that cannot be paid for in full is refused whole |
| Replay safety | implemented | `batch_key` plus payload fingerprint: identical replay is a no-op, a reused key with different rows is a conflict |
| Metering | implemented | One unit per unique comment, ever. Retries, reimports, likes refreshes and re-analysis after an edit are free |
| Worker gateway (P3) | implemented | Scoped credential, never the service role; the tenant comes from the credential |
| Worker lifecycle | implemented | Explicit terminal result; nothing promotes a job to succeeded on its own |
| Python control-plane client | implemented | Canonical payload hashing; only an exhausted source maps to succeeded |
| Edge handler | **deployed and answering** | `worker`, `oauth-start` and `oauth-callback` are live on the project. The gateway refuses an unknown credential *from the database*, over HTTP, which is the seam that was untested all along |
| Legacy import and reconciliation | **blocked** | Needs the original CSVs and the amendment file |
| Analysis in the server path | implemented, fixture-tested | `run_once` labels each batch before committing, so rows and verdicts land in one transaction. Verified end to end with the **deterministic test analyzer, which is not a model** |
| Real model inference | **blocked** | Needs the notebooks and ~600 human-labelled comments. No accuracy figure is claimed |

## M4 — dashboard (complete; live read implemented, never served over HTTP)

One filter contract drives every panel and the export. Cursor pagination with stale-response
safety, human corrections with verdict history, CSV export with formula-injection
neutralisation, plan limits with early warning, video comparison on per-video denominators,
sync health classified into ten states, engagement ranking that never lets likes weight
sentiment. Arabic RTL throughout, keyboard-navigable, no figure carried by colour alone.

Fixture mode is isolated from configured Auth: a correction made against fixture rows can
never be sent to a live RPC, and the UI says so on screen. Live mode requires a configured
project **and** an explicit `VITE_DASHBOARD_SOURCE=live`, so configuration alone cannot flip
the data source.

`public.dashboard_snapshot` assembles the same object the fixture is, and the read and write
paths branch on one data mode so they cannot disagree about which they are in. Verified
against real SQL and RLS, and against a mocked client; **no HTTP request has been made to a
deployed project**, so PostgREST between the two is untested.

## M5 — OAuth (server half implemented)

| Item | Status | Notes |
| --- | --- | --- |
| State lifecycle | implemented | Hash-only storage, bound to user/workspace/client, 10 minutes, single use. Spent states are prunable; no schedule until there is a project to attach one to |
| Callback cannot be redirected | implemented | Consume returns the binding rather than accepting one; there is no workspace argument to forge |
| Channel ownership | implemented | Connected claim is globally exclusive; a public_unverified row is upgraded in place so pilot data carries over |
| Revocation | implemented | Moves to reconnect_required and cancels dependent jobs; never falls back to scraping |
| PKCE and the authorization URL | implemented | S256 checked against the RFC 7636 worked example; verifier stored server-side only, state stored as a hash, state written before the redirect is issued |
| Code exchange, channels.list, token sealing, refresh | implemented, **never run live** | Pure handler with injected transport. The channel comes from `channels.list(mine=true)`, the verifier from the stored state, tokens are AES-GCM sealed with a fresh nonce per grant |
| Deployed callback route | implemented | `/functions/v1/oauth-callback` renders an Arabic result page; refusals carry a code and no detail |
| Connect button in the product | implemented | Shown only where it can work — a workspace with a client and no connected channel — because a button that always fails is worse than none |
| A real consent round trip | **needs a person** | Everything up to Google's sign-in page is verified live. Approving is a human step |

## M6 — private pilot (front end deployed, journey incomplete)

The built front end is live at `app.sky-develop.net` behind HTTP basic auth, not indexed, and
serving sanitized fixtures. `docs/deployment.md` covers it.

What a pilot still needs: a live dashboard a signed-in creator can actually read, which means
selecting their own workspace rather than the synthetic one the app starts with; a persisted
correction and an export against that data; a second tenant proving isolation; and a deployed
worker endpoint. None of those exist yet, so there is no complete creator journey.

## Exact missing input per blocked task

| Blocked task | Exact input required |
| --- | --- |
| Legacy import and the handoff's topic-count reconciliation | Original comments CSV/data files, plus the classification amendment file |
| Catalogue verification (35 + 157 + 2 = 194) | `SpecTech-YouTube-MVP-Package.zip` with its manifest and JSONL catalog |
| Final dashboard styling | Standalone dashboard HTML, the dashboard ZIP, and the brand assets |
| Live public collection | A YouTube Data API key placed server-side |
| Authenticated paths, Storage, Edge Functions, and proving the edge handler and SQL agree over HTTP | The project's service-role key. The project is linked and all 13 migrations are applied; anonymous isolation is verified over HTTP. Creating a test user needs admin access, because GoTrue rejects reserved test email domains |
| OAuth code exchange and live connection | Google OAuth client id/secret, registered redirect URI, test-user authorization. PKCE and the authorization URL are implemented and need none of these |
| Model selection and any accuracy claim | The two model notebooks and ~600 independently human-labelled comments. The sampler, the blind labelling sheets and the protocol are built (`docs/labelling-guide.md`, `npm run label:draw`); what is missing is the human labelling itself and the notebooks |
| Private pilot deployment | Sites access with a verified private mode |

## Retention

Comment text and author are removable after 30 days by `private.purge_comment_text`, keeping
the row and its analysis so aggregates still compute. Required by YouTube's developer terms
and by any sensible reading of PDPL/GDPR, since a comment is personal data belonging to the
commenter and not to the customer. No schedule is attached yet; a deletion path driven by a
tenant request is still to build.

## Known limitations

- Database evidence is PGlite. It runs the real SQL and real RLS but **is not** GoTrue,
  PostgREST, Storage HTTP, or a deployed project.
- Concurrent overspend is not provable here: PGlite runs a single connection, so two
  simultaneous transactions cannot be staged. The row lock is the mechanism; what the tests
  prove is that no *sequence* of calls exceeds an allowance.
- The edge handler and the SQL now meet in `end_to_end.test.ts`, over a request body captured
  from the real Python client. What remains untested is an actual network hop and a deployed
  Edge Function runtime.
- The handler does not validate the body against the shared contract. The shapes now match, so
  this is a deployment question — the contracts package imports Zod and the function has no
  import map — not a correctness gap: every rule the contract states is enforced in SQL.
- Video titles are absent from the contract, so the comparison labels by identifier.
- The dashboard is a neutral functional shell. Final styling waits on the original assets.

## Coordination

A four-lane worktree protocol ran on 2026-09-13 and is closed. The worker and schema lanes
never produced a commit; the work assigned to them was taken on directly and committed on
integration. Everything is now on one branch, `main`, in the original checkout — every commit
the lane branches held is an ancestor of it, so nothing was lost. The guard and its hook are
removed. `docs/coordination/README.md` records what the protocol was, the three commits it
correctly refused, and why it ended.
