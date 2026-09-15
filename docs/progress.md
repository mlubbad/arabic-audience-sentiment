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

## 2026-09-15 — the rail reads as a navigation

The rail's three destinations each sized themselves to their own label, so no two icons shared
a vertical edge. The cause was `.app-nav` — the removed top bar's own rule, a centred
`inline-flex` row — still applying to its replacement, along with a mobile block that
positioned the nav absolutely and painted it white inside a dark sheet. Both removed. The
navigation is now a two-column grid with a fixed 20px icon column, with a group caption and a
hairline under the lockup and above the foot. `rail.test.ts` is new; see `verification.md`.

## 2026-09-15 — audit phase two: the tool stops pitching and starts saying where you are

Five commits on `main`, `2cd5eec`…`e01dc5e`, against items 3–6, 8 and 9 of the UX audit.
Phase one (the shared workspace selection, the menu button's grid row) was already committed
by the other session as `0e818c5`.

- **One box for the four questions on the way in.** `WorkspaceGate.tsx` renders loading,
  failed, no-workspace and choose for both the overview and the operations page; the two used
  to answer them in different markup. The seventh instance of "one meaning, two
  implementations". A source-level test refuses either page its own chooser again.
- **The three steps, with a state each.** `setup.ts` holds the sentences the visitor already
  read and `setupProgress` places a workspace on them from the channel row and its newest job.
  The owner's card shows them; the visitor's list reads the same array.
- **The channel by name.** Nothing had ever stored one — the callback asked YouTube for
  `part=id`. It now asks for the snippet; migration `20260915080000` adds `channels.title`,
  rebuilds `svc_oauth_attach_channel` with two defaulted name parameters, and keeps stored
  names across a nameless reconnect. **Not applied to the live project.** The account page
  reads the view with `select *` so a build ahead of the migration still shows channels.
- **Feedback where the action was.** One `message` string for the page became a scoped note
  rendered inside the form or card that produced it.
- **The rail's plan card carries the figure.** `usage_summary` for the chosen workspace,
  analysis budget remaining, coloured by the operations page's thresholds; lazy, so the
  landing bundle did not grow.
- **Page heads, not heroes.** Inside the shell `.rp-hero` is flat on the page ground, names the
  page and the workspace, and the pitch sentences are gone.

Still open from the audit: the selection is not in the URL (item 1's remainder), and the CSS
layer count (item 7) — the honest measure there is how many rules override the token layer,
not the line count.

## 2026-09-15 — the address carries the workspace

The remainder of the audit's first finding. `?ws=<id>` on the overview and the operations
page. `workspaceUrl.ts` holds the rules as pure functions: the address wins and is
remembered; a remembered choice is written back to the address; an id in the address is a
claim that `workspaceState` still checks against the account's own list. The hook in
`workspaceSelection.ts` applies them; the two pages own the address (`route: true`), the
rail's plan card only reads. The rail's links to the two scoped pages carry the current
`?ws=`; the link to the account page does not, because that page reads no such parameter.
Opening `/dashboard?ws=B` renders B; opening it with an id outside the list asks, and does
not fall back to a guess — both rendered in the identity test inside a `MemoryRouter`.

## 2026-09-15 — audit item seven: the layers above the tokens

Measured first, and the measurement changed the diagnosis. The audit said four layers write
over the token layer; `style.css` carried no raw colour at all, `report.css` seven (all
`#fff`), and `app.css` 56 uses of 37 values — the whole of the problem inside the tool.
`landing.css` carries 95 and is the marketing page's, loaded only by it, and open in another
session; not touched.

Worked down in four commits, `981c84a`…`ef66d20` and the one after: 21 repeats of a token's
value (all seventeen `color: #fff` were white ink on a dark plane, now `--ink-on-dark`); six
indigo drifts within ΔE 3 whose meaning matched; three families that had no token and got one
(`--plane-dark`/`-2`, the warning strip's four, `--success-100`) and two inks the brand had
already named; and the last fourteen, which were decisions — the primary button repainted from
another framework's indigo into the brand's, the rail's mark and its active bar onto the
brand's steps, five pale borders, two inks. Every contrast that could move was measured before
it did; the lowest is the button's hover at 4.98:1.

`app.css` and `report.css` now carry no raw hex outside comments; `layers.test.ts` holds it
there and keeps the backlog mechanism with an empty set. The rail's alphas stay as
`rgba(255,255,255,α)` on purpose: `rail.test.ts` measures them, and it now reads the ground
from the token rather than a copy. The line count went *up* by 21 (comments); the measure that
means something went from 56 to 0.

## 2026-09-15 — the rail carries state; "the worker" leaves the reader's sentences

`3e62ee6`. Two of the three decisions left after the audit's numbered items. The rail now
holds the workspace (a name, or a select when there is a choice) above the navigation and the
collection line in the foot — the operations page's own health sentence, read from the same
`syncHealth` and the same string table, so a test asserts the two agree by construction. The
operations page's own switch is removed; it now reads the overview's cache entry under the
overview's key instead of fetching the source again under its own. Every reader-facing
sentence that said "عامل الجمع" now says what is true of the collection — running, or stopped
with nothing running — in both locales; the term survives only in the attempt log's forensic
lines.

**Not done, and why:** the overview's own switch is still in `Dashboard.tsx`, and the audit's
"empty state is the setup path" (the numbered steps in place of the charts when a workspace
has no comments yet) is also in `Dashboard.tsx` — and another session was rewriting that file
in the working tree while this was being made (its dashboard-strings pass; my edit to it was
overwritten once, at 16:34). Both wait for that pass to land. The `RailState.test.ts` case
"is the only switch" says so in its comment and checks the operations page only.

Committed from the index alone: `ar.ts` and `en.ts` carried that session's uncommitted hunks
beside mine, so mine were staged by rebuilding each file from HEAD, and the result was
verified in a throwaway worktree of HEAD plus the staged diff before committing.

## 2026-09-15 — the interface speaks English

Five commits, `f9b2840`…`7478dc0`, taken over from the Antigravity session that claimed the
feature in ACTIVE.md and stopped before writing code. Arabic stays the default and the
source of truth; nothing an Arabic reader sees moved.

- **`locale.ts`** — a module store like `workspaceSelection.ts`, not a context: Arabic unless
  asked, never inferred from the browser, remembered under `audience.locale`, validated on
  the way back in, written onto `<html lang dir>` before paint and only while the shell is
  mounted (the landing page stays Arabic).
- **`strings/ar.ts` → `strings/en.ts`** — the Arabic is the key set; the English is typed
  against it, so a missing line fails `tsc` and nothing ever shows a key name. Counted
  sentences are functions; code tables and word lists are typed to carry the same shape.
  English is a separate chunk fetched only when chosen.
- **Every module that owned a sentence now owns a map from a code to a key** and takes the
  strings as an argument: `authMessages`, `authProviders`, `connect` (which returns a code
  now, not a message), `setup`, `planWords`, `jobFeed`, `dataSource`, `connectResult`,
  `analytics`, `i18n`. The merge rule in `explain()` and the three invariants — one source
  for the setup sentences, the legend from `measurable`, no number in the trust panel — hold
  in both languages.
- **The switch** names the other language in that language and sits in the announcement
  bar: the rail foot, where it was first put, is 34px below the fold at the top of the page.
- **`locale.css`** — the only CSS, kept out of `app.css` which another session held: the
  Latin face and the eyebrow tracking under `:lang(en)`, and the phone-width sheet's hide
  transform mirrored, which the first English render at 375px showed as a dark band.

Not translated: `Landing.tsx` (another session's uncommitted work on it; Arabic by design
for now), and stored data — workspace names, video titles, the fixture reviewer's name.

## 2026-09-15 — the empty overview is the setup path; the overview's switch goes

`54b15a4` and the commit after. The two pieces that waited for the dashboard-strings pass:
the overview's own workspace select is gone (the rail has the one), and a workspace with no
comments yet sees the three steps with a state each where the charts will be — `SetupPath`,
extracted from the account card so both draw the same list; the second step from a small
`connection_status` read, the third from the sync state the source already carries, through
`latestJobFromSync`. This closes the audit's five architectural decisions; the numbered
problems were closed earlier today. The fixture never has an empty workspace, so the browser
suite cannot reach this state; it is rendered in the identity test from forced cache entries
and was checked visually by injecting the rendered path into the fixture page.

## 2026-09-15 — the landing page follows the language choice

`b956c64`, once the session holding `Landing.tsx` had committed (`95be0b4`). The last
Arabic-only surface reads the shared strings through the same hook, sets the document
language while mounted, and carries the switch in its bar; a choice made there reaches the
shell and back. The demo comments stay Arabic as data, tagged `lang="ar" dir="rtl"`; arrows
and digits follow the language; `landing.css` places with logical properties now.
