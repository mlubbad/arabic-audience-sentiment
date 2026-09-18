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

## 2026-09-15 — the catalogue on the operations page (selective video sync, task 9)

`03491fc`…`01f09c6`. The operations page opens with the catalogue: what the channel
has, what each video costs against the plan's remaining analysis units, what is chosen.
`Sync.tsx` composes `Catalogue` (`CataloguePanel.tsx`) above `OperationsPanels.tsx`, the
health/plan/attempts panels moved out unchanged — the page still holds the one snapshot
and the one job read and hands the values down. The "request sync" button is gone from
both pages: the account card's `sync-<id>` is a link to `/sync?ws=<id>` reading
«اختر الفيديوهات», and `enqueue_sync` is called from nowhere in the browser. Two things the
brief did not anticipate: `Catalogue.tsx` cannot sit beside `catalogue.ts` on this
filesystem (`./Catalogue` resolves to the loader for tsc and Vite alike), hence the file
name; and "collected" is counted from the source's rows (`storedPerVideo`), not the
snapshot's `videos` aggregate, because that aggregate drops the channel's own replies and
`select_videos` counts every row — the fixture's video-1 read 4 one way and 5 the other.
The six strings for the old button are retired; the two empty states that pointed at it
now name the catalogue.

## 2026-09-15 — selective video sync, the feature as a whole

The catalogue is now what starts a collection, not a single all-or-nothing button. A reader
opens a channel's catalogue on the operations page, searches and filters it by title, kind
and recency, sees each video's reported comment count against the plan's remaining analysis
units, and chooses which videos to collect — the estimate moves live as the selection
changes, and saving over the remaining quota is refused with the reason shown beside the
disabled button rather than allowed and charged. A video already collected keeps its
comments and costs nothing to keep; one whose comments are switched off shows a pill and
cannot be ticked. Once saved, a selected video stays live: the worker re-checks it on the
plan's interval for new comments until it is deselected.

Underneath, discovery is a new job type. `YouTubeAPI.catalogue()` walks a channel's three
upload-tab playlists (videos, shorts, streams), tolerating an absent tab as empty rather than
as a failure, and records each video's title, kind, count and thumbnail — a missing comment
count is stored as unknown, never as zero. The server learns `comments_state` from two
places now, not one: discovery infers `disabled` from an absent count, and a collection that
hits YouTube's own `commentsDisabled` refusal confirms it directly. `select_videos` is the
one RPC that writes a selection, refusing another tenant's video, a video with comments off,
or a selection the remaining `comment_analysis` units cannot cover, and it enqueues the next
collection itself rather than leaving the reader to ask for one. A `collect` job still
carries no video list — the worker asks for its due list at claim time, computed
server-side from `video_selections`, so mid-run additions are picked up by the next run
without a second job and the tenant cannot widen what a job touches. `worker_video_finished`
records each video's own outcome — exhausted, blocked, or held for retry — separately from
the job as a whole, which is what lets one job cover many videos honestly. A daily tick,
`schedule_due_work`, enqueues a fresh discovery when a channel's catalogue has gone stale and
a collection when any selected video is due; it runs from the worker's own idle loop today
(`worker_tick`, no extension needed) and is also callable from `pg_cron` once the live
project's owner turns that on.

On the page: `Sync.tsx` (510 lines) split into `CataloguePanel.tsx` (the new section) and
`OperationsPanels.tsx` (health, plan, attempts — moved, not rewritten), so the catalogue
leads the operations page and the diagnosis panels that were already there follow it
unchanged. The old "request sync" button is gone from both the account card and the
operations page; the account card's third step is now a link straight to the catalogue.

What still waits: three migrations and the redeployed `worker` Edge Function they depend on
have not gone to the live Supabase project, so no discovery or collection has run against
the real channel yet, and `select_videos` has not been exercised from a signed-in browser.
`pg_cron` is not enabled; the fallback tick is what would run live today. All three are the
user's decisions to make, not this task's to take — see `docs/verification.md` and
`docs/coordination/ACTIVE.md` for what that leaves unverified and pending.

## 2026-09-15 — the final review's five findings

A whole-branch review of selective video sync confirmed five defects with PGlite probes, and
each is fixed with the test that failed first (`d7727a3`, `a2eacbe`, `8998e35`; one new
migration, `20260915140000_selection_accounting_and_backoff.sql`, no shipped file edited).
The quota check in `select_videos` priced only the call's own additions, so two selections
that each fit alone were both accepted against the same units; it now counts what every
stored selection still owes, before it writes, and the bar on the operations page says the
same figure. The operations page called the newest sync run of any mode the last run, so a
finished discovery read as a collection that found nothing; only collect runs count now. A
collection that failed was re-enqueued on every idle tick while the pilot plan had no rate
limit; a failed, blocked, partial or cancelled job now rests an hour, and the pilot plan
rate-limits at thirty minutes. The worker finished a collect lease that carried no due list
as a success; it is blocked as `no_due_list` now, while an empty list is still a channel
with nothing due. And a save reported "collection requested" while a collection was already
running — a run whose list was fixed when it was claimed — or when nothing was added at
all; the panel now says which of four things happened, in both languages. A removal alone
also reads no plan, so a paused tenant can deselect.


## 2026-09-16 — the catalogue turns pages, links out, and plays here

The first live catalogue was 4,456 rows in one list. It is now fifty to a page, client-side
over the filtered and sorted rows (`pageOf` in `catalogue.ts`), with a pager under the list
and a jump box past two pages; a search, kind or sort change returns to page one. The
selection is not paged — a tick survives a page change and the bar counts every one — and
"اختر المعروض" became "اختر هذه الصفحة", bounded by what is on screen. Each row links to the
video on YouTube (`/shorts/` for a short, `/watch` otherwise, new tab, `noopener`), and
pressing the thumbnail or the title opens a dialog with the privacy-enhanced embed
(`youtube-nocookie.com`, autoplay), the kind and count, the link, and a close; the iframe
exists only while the dialog is open. Esc and the backdrop close it. Seen at 1280px and
375px on the dev server; two browser tests (a routed 120-row catalogue for the pager; the
link targets and the player on the fixture) join the suite.

## 2026-09-16 — the worker is a service

`544c4ae`, `bf5386b`. A launchd agent, `com.skydevelop.sentiment-worker`, with `RunAtLoad`
and `KeepAlive`: the loop still exits on its own after thirty idle minutes "for a clean
restart", and launchd is now the thing that restarts it, thirty seconds later. It cannot
run from `~/Documents` — macOS keeps background agents out of it and the first attempt
answered "Operation not permitted" on the script itself — so it runs from a detached
checkout under `~/Library/Application Support/sentiment-worker/checkout`, with its own venv
(`--group inference`, the runtime the default install leaves out on purpose) and a copy of
`.env.local`. `scripts/worker-service-update.sh` is the one way that checkout moves: it
detaches it at the working checkout's HEAD, syncs, copies the credentials, reinstalls the
plist and bootstraps. What this is: a worker that comes back after its own exit, after a
kill, and after a login. What it is not: hosted — a sleeping laptop is still a stopped
worker, and the hosting blocker keeps that half.

## 2026-09-16 — topic classification, the feature as a whole

A comment now has a second dimension besides sentiment: one primary topic, drawn from a
per-workspace taxonomy of ten seeded defaults (question, religious remark, praise, criticism,
request, discussion, personal story, humour, promotion, other), classified by Gemini
(`gemini-2.5-flash`, prompt `p1`) and correctable by a human the same way a sentiment label
is. Three migrations carry it: `20260916010000_a_comment_has_a_topic.sql` adds
`workspace_topics` (seeded per workspace, `private.seed_default_topics`), `topic_predictions`
and `topic_reviews` (append-only, mirroring `submit_comment_review`'s shape via
`submit_topic_review`), `workspaces.topic_taxonomy_version`/`active_topic_key` and the
trigger that adopts the first successful classification as the workspace's active model/
prompt pair, `set_workspace_topics` (untouched by any screen yet), and a `topic_classification`
metering kind with `plans.topic_units` (pilot `5000`).
`20260916011000_the_worker_classifies_topics.sql` adds `worker_topics_due` (comment text,
parent text or an explicit "parent unavailable" note, the taxonomy, and the workspace's
active model/prompt pair so a worker on the wrong one is told `active: false`) and
`worker_commit_topics` (upserts over a `failed` verdict only, meters
`topic_classification` once ever per comment, taxonomy-version-scoped), and extends the tick
to enqueue `analyse` jobs alongside `collect`. `20260916012000_the_dashboard_reads_topics.sql`
adds `topics`, `active_topic_key` and per-comment `topic_prediction`/`topic_reviews` to the
snapshot the dashboard reads.

The worker gained a `topics` package (`workers/python/src/topics/{protocol,deterministic,
analysis,gemini}.py`): a `TopicClassifier` protocol, a deterministic test double, `classify()`
turning due rows into the records `worker_commit_topics` accepts, and the Gemini adapter
itself — the key only in the `x-goog-api-key` header, the response constrained to the
taxonomy's own keys by a JSON schema enum so the model cannot name a topic nobody chose.
`server/runner.py` gained `run_topics` and dispatches `run_job` on job type `analyse`,
finishing `blocked`/`no_topic_classifier` when no classifier is configured and
`blocked`/`topic_model_not_active` when the configured one is not the workspace's active
pair — "skipped" was the design's word but not one the job status vocabulary has.
`server/gateway.py` gained `topics_due`/`commit_topics`; `server/loop.py` gained
`--topics {none,deterministic-test,gemini}` reading `GEMINI_API_KEY`; `.env.example` and
`workers/deploy/README.md` document the variable. The edge function's shared gateway
(`supabase/functions/_shared/worker-gateway.ts`) and `worker/index.ts` route
`/worker/topics-due` and `/worker/commit-topics`, reading nothing the database does not
already scope.

`packages/contracts/src/topics.ts` adds `effectiveTopic`, `applyTopicReview` and the
`UNCLASSIFIED` sentinel (`__unclassified`); the dashboard filter gained a `topics` key and
`topic_counts`; the CSV export gained `effective_topic, topic_source, classification_key`
columns; the fixture was updated to carry topic data. On the dashboard: a Topics card (bar
chart plus an unclassified line, and a not-run state when no taxonomy version has gone
active yet), a Topic filter beside the existing ones, a per-row chip showing the effective
topic and a "تصحيح بشري" marker when a human has corrected it, a topic correction mode on
each row (button text "تعديل الموضوع" — the sentiment correction flow's own wording, reused
rather than duplicated), a history panel with topic-vs-sentiment dimension labels, a Sync
job-kind entry for `analyse` and six new Gemini/topic error codes, and a third budget line
on the operations page for `topic_classification`. `tests/e2e/dashboard.spec.ts` gained an
appended block for all of this (append-only, per the file's own convention).

Commit range: `0866318`…`1b4ed30` (`git log --oneline 03b6c3f..1b4ed30`). What still waits,
entirely the user's decision: the three migrations and the edge function's new routes have
not been applied or deployed to the live Supabase project, and no `analyse` job has run
against it — the Gemini key on file was refused by Google in Task 1's smoke call
(`403 API_KEY_SERVICE_BLOCKED`, the API restriction in the Google Cloud console, not a key
or endpoint failure), so a live run would fail immediately even if deployed. Everything
above is fixture- and unit-tested only; see `docs/verification.md` for the counts and what
each gate showed.

## 2026-09-16 — topic classification, the final review's eleven findings

The whole-branch review of `0866318`…`cf84011` found nothing Critical, five Important items
at the retry/quota seam between `run_topics`, the Gemini adapter and the server RPCs, and
six Minor ones. All eleven are fixed in this wave; the three migrations `20260916010000`–
`012000` are still applied nowhere, so `20260916011000` was edited in place rather than
followed by a fourth file.

**The seam.** `run_topics` (`workers/python/src/server/runner.py`) now classifies and
commits each due list in slices of 25 rows, with a heartbeat before each slice; the batch
key is `sha256("{round}:{slice offset}:{sorted ids}")[:32]`, so a same-set retry after a
Gemini outage in a later round is a new batch, not a `batch_conflict`, while a replay of
the very same slice still replays. A round in which no verdict was final (`succeeded`,
`skipped`, `unsupported`) ends the job `partial` there — nothing stored can shrink the due
list, and asking again would only re-send the same rows up to the 50-round bound, which
stays. A due answer carrying `blocked` finishes the job `blocked` with that code before any
model call.

**Paid before the plan check.** `worker_topics_due` reads the remaining
`topic_classification` allowance (new `private.topic_units_remaining`: no subscription, or
one inactive or outside its period, is zero) and hands over only as many rows *that would
cost a unit* as remain. A row costs nothing when its comment was charged before — a
taxonomy edit re-classifies for free, as `reserve_usage`'s once-ever rule already says — or
when its text is purged (recorded `unsupported`, never sent), and those ride outside the
cap; this is a deliberate refinement of the finding's `least(limit, remaining)`, which
would have blocked a workspace at its allowance from a free re-run after a taxonomy edit.
When nothing can be handed over, nothing remains, and `topics_pending` is still true, the
answer is `blocked: 'quota_exceeded'` with no rows and no taxonomy.

**Deploy order.** The worker service and the `worker` Edge Function must be updated
*before* the three migrations are pushed: a worker built before this feature treats any
job that is not `discover` as a collection, and handed an `analyse` job it would walk the
empty due-video list its claim carries and mark the job `succeeded` having classified
nothing. `workers/deploy/README.md` carries this under "Order of a deploy that adds a job
type". As a guard, `private.worker_due_videos` is rebuilt in `20260916011000` to raise
`invalid_job_type` for any job whose type is not `collect`, so a gateway that did ask on
such a worker's behalf is refused rather than answered.

**Safety-blocked chunks.** `gemini.py` sends the four harm categories at `BLOCK_NONE` —
the request classifies the audience's text and generates nothing — and, when a chunk of
more than one item comes back with no candidate or unparseable, splits it once in half and
classifies each half; a half that fails again fails as before.

**Seams tested.** `tests/e2e/dashboard.spec.ts` (append-only) gained a test that serves
the fixture with `active_topic_key: ""` and asserts the not-run text, no chart, no topic
filter, no chips, no topic-correction button. `supabase/tests/end_to_end.test.ts` drives
`/worker/topics-due` and `/worker/commit-topics` through `handleWorkerRequest` into PGlite
with the Python client's own body shapes and the batch key `run_topics` derives.

**Minor.** The Topic filter in `Dashboard.tsx` is gated on `active_topic_key`, not on the
taxonomy's presence (every workspace has one from its first day). `docs/decisions.md` now
says key and description are sent to Google, not the name. The design spec's
`topic_source` vocabulary is `model|human_review|none`, matching `label_source` and the
code. `coverage_summary.topics_stored` counts only final verdicts. The gateway refuses a
`max_rows` that is present but not a positive integer. `docs/verification.md` records the
`npm run check` gates at this head.

## 2026-09-16 — topic classification, the re-review's two corrections

Two corrections to the entry above, from the coordinator's re-review of the fix wave.
The batch key `run_topics` derives is salted with the lease token —
`sha256("{lease_token}:{round}:{slice offset}:{sorted ids}")[:32]` — so a re-claimed job,
whose round 1 repeats the first attempt's round 1 with different verdicts, starts afresh
instead of hitting `batch_conflict`; within one lease a replay still replays. And the
quota window in `worker_topics_due` no longer drops a free row that sorts behind more
costing rows than remain: the predicate is `not costs or spent <= remaining`, so a free row
is handed over wherever it sorts. While there: a workspace with no active plan (or one
outside its period) is now told `blocked: 'quota_exceeded'` with *no* rows, free ones
included, because `reserve_usage` would refuse every record at commit; a plan with nothing
left still hands the free rows over.

2026-09-16, later: the topic layer is on the live project — edge function, the three
migrations, and the preview build (`1c9c4eb`) — in the recorded order. The dashboard now shows
"لم يُشغَّل تصنيف الموضوعات بعد" until a classifier runs; the first `analyse` job was blocked
`no_topic_classifier`, as designed. Remaining to see topics: lift the key's API restriction in
the Google Cloud console, export `GEMINI_API_KEY` from `scripts/worker-service.sh`, restart the
service. `docs/verification.md` has the byte-level checks.

## 2026-09-16 — a failed sentiment verdict is retried

`private.commit_batch` stored predictions with `on conflict ... do nothing` on the natural
key (workspace, comment, text, analysis key). A verdict that failed took that key, so the
retry that finally succeeded was dropped — after `reserve_usage` had already charged for
it, and without the insert-only `adopt_first_analysis` trigger ever seeing a success. The
topic layer had the identical defect and fixed it in `20260916011000`; `docs/decisions.md`
had recorded the sentiment twin as a known follow-up.

`supabase/migrations/20260916020000_a_failed_verdict_is_retried.sql` rebuilds
`commit_batch` from its *current* definition — `20260914070000`, which carries the
`sync_runs` open/accumulate block, not `20260913220000` as first thought — with one change:
the predictions insert's conflict clause becomes `do update ... where
public.sentiment_predictions.status = 'failed'`, so only a failure is ever overwritten. A
companion `adopt_first_analysis_on_update` statement trigger lets a retry that is the
channel's first success be adopted, exactly as `adopt_first_topic_classification_on_update`
does for topics. The diff of the function body against `20260914070000` is that one clause.

`supabase/tests/prediction_retry.test.ts` (four tests, harness copied from
`ingestion.test.ts`) commits a `failed` verdict, then the same comment/hash/key `succeeded`,
and asserts the row now reads `succeeded`, is charged once, and is adopted; then a later
`failed` and a later `succeeded` with a different label leave it untouched. Three of the
four were seen red against the unfixed function before the migration was written — the
row still `failed`, the channel still unadopted — and all four pass after it. `npm run
test:db`: **207 passed, 21 files** (202 before). Mutation and gate results are in
`docs/verification.md`.

## 2026-09-16 — the videos section turns pages

The dashboard's videos section rendered every video the filters admit in one list. The
fixture has two, the pilot channel has enough to make the section a wall of cards, and
the user asked for 25 a page (`https://app.sky-develop.net/dashboard?ws=…`).

`s.videos` is built in memory by the snapshot from the filtered rows, so paging is a
slice, not a request: `apps/web/src/videoPaging.ts` (`pageSlice`, clamped so a filter that
shrinks the list under a reader on page four lands on the last page that still exists),
a `videoPage` state in `Dashboard.tsx` that `applyFilters` and `reset` clear alongside
the comments cursors, and a `.pager` nav under the list — the comments pager's markup and
CSS — rendered only when there is a second page. Turning a page scrolls `#rp-videos`
back into view. Two new strings in `strings/ar.ts` and `strings/en.ts`
(`videosPagerLabel`, `videosPageState`); the buttons reuse `previousPage`/`nextPage`.

Tests: `videoPaging.test.ts` (six, mutation-checked) and two e2e blocks appended to
`tests/e2e/dashboard.spec.ts` that clone the fixture across 30 videos. Results in
`docs/verification.md`.

## 2026-09-16 — plans v2 in the database (Part A)

The single hand-activated `pilot` plan is replaced by a seven-row ladder, all in
`public.plans`, four migrations landing Part A of `docs/superpowers/plans/
2026-09-16-plans-and-paddle-billing.md`:

`supabase/migrations/20260917010000_plans_v2.sql` adds `segment`, `price_monthly_cents`,
`price_yearly_cents`, `workspaces_limit`, `insight_reports`, `internal`, `self_serve`,
`sort_order`, `provider_prices`, `title_ar`/`title_en` to `plans`, and inserts `free`,
`creator`, `creator_plus`, `agency`, `media`, `enterprise`, `owner` — the last with every
limit `null` and `internal = true`, guarded by a check that only an internal plan may spell
its limits that way. `pilot` is kept, not dropped, and re-marked `internal`/`segment =
'internal'` so it drops out of the public catalogue without disturbing its one subscriber.
`subscriptions.status` gains `past_due`; `subscriptions.billing_workspace_id` plus
`private.billing_root(w)` let a client workspace's every limit read (`plan_limit`,
`create_workspace_impl`'s new workspace-limit check, `register_channel_impl`'s channel
count) resolve through the workspace that actually pays. New workspaces default to `free`,
not `pilot`.

`supabase/migrations/20260917020000_usage_grants.sql` adds the `usage_grants` table (one
pack = extra units on the same budget, valid to `period_end + 30 days`, idempotent on
`(source, provider_ref)`) and rebuilds `reserve_usage`, `used_units`, and
`usage_summary_impl` to sum across every workspace billing through the same root and to
add what packs granted on top of the plan's own allowance.

`supabase/migrations/20260917030000_platform_admin.sql` adds `private.platform_admins` (a
row in a private table, not a role claim), `public.is_platform_admin()`, and the three
admin-gated RPCs: `set_workspace_plan` (writes the billing root, propagates to every
workspace copying its subscription from that root, one `audit_events` row per call),
`admin_workspaces` (a listing, no screen reads it yet), and `grant_pack` (a manual top-up
through the same `private.grant_units` a Paddle webhook will use later, so a gifted pack and
a bought one are the same row shape).

`supabase/migrations/20260917040000_plan_catalogue.sql` adds `public.plan_catalogue()` —
signed-out readable, filters out every `internal` row — and extends `usage_summary` with
`plan`, `provider`, `billing_interval`, `cancel_at_period_end` so the account page can name
the subscription's plan and payment state, once something reads it.

The gates that answer the meter's own figure (`analysis_remaining`, `topic_units_remaining`)
were fixed in a follow-up commit (`aaf6422`) after review found they disagreed with
`reserve_usage` on three points: which plan a `past_due` subscription reads, whether granted
packs count, and how "no ceiling" is spelled for arithmetic — `null` can't be subtracted
from, so `owner` answers `2147483647` (`int4` max) there while the same fact is `-1` in the
`packages/contracts` zod schemas and `null` in the `plans` row itself. A second review round
(`d9be4b1`) added the test the first review flagged as missing: `set_workspace_plan` called
on a client workspace, proving it writes the root once and every copy follows, not five
separate audit rows.

Everything above is PGlite-tested, nothing live-tested: `npm run test:db` — **236 tests
passed across 25 files**. **The live Supabase project has not received these four
migrations.** No platform admin row exists anywhere yet, live or fixture. Applying them to
the live project and seeding the first admin (`engmlubbad@gmail.com`) is deferred by the
controller to a separate step; this entry covers Part A's database work only.

Parts B (pricing page, account plan panel, `/admin` screen, all reading `plan_catalogue()`
and `usage_summary` client-side) and C (Paddle checkout, webhook truth, customer portal,
sandbox-to-live gate) are not started. `docs/pricing.md` was rewritten to the v2 ladder in
this same session; `docs/decisions.md` carries the six pricing/payment decisions and the
tax reasoning for choosing Paddle over Stripe direct.

## 2026-09-16 — Parts B and C: pricing page, plan panel, admin page, Paddle sandbox

The web app gained `/pricing` (two segments, yearly switch, anchor, contact CTAs for
`media`/`enterprise`), a plan panel on the account page (limits, renewal, past-due and
cancellation notices, upgrade / manage / top-up / contact), and `/admin` for platform
admins (every workspace, set plan, grant pack). Billing: `billing_events` applied once per
event under a per-root advisory lock and never backwards; a seven-day past-due sweep to
`free` on pg_cron; the `paddle-webhook` and `billing-portal` functions; a price-sync script
that writes Paddle's ids into the tables and creates nothing twice; checkout through
Paddle.js with the workspace in `custom_data`. Six migrations, the admin seed, the sandbox
catalogue and both functions are on the live project (see `docs/verification.md`). Live
keys are not set; `PADDLE_ENV=sandbox` everywhere, and switching is a separate approval.
Open: the webhook secret, the client token, the sandbox walk-through, and the final
whole-branch review.

## 2026-09-16 — plans v2 / Paddle: the sandbox walked, a real payment, the final review's fix wave

What closed after the previous entry: the webhook secret and the client token were set on the
project and in the bundle; the sandbox was walked end to end against the deployed functions
(every webhook outcome, the pack, the stale event, past-due, the sweep, the portal); and a
real sandbox payment on the pricing page moved the root and its client together, its cancel
came back on its own, and the owner plan was restored through the admin RPC — all in
`docs/verification.md`.

The final whole-branch review found nine things, fixed in three commits (`a8e18c5`, `758edca`,
and this one). One migration, `20260917060000_cancel_drops_to_free.sql`, rebuilds each function
from its latest definition: a `subscription.canceled` or `.paused` webhook writes the free plan
to the root and every client row instead of a status the gates refuse (the customer could not
spend even the free hundred); `private.subscription_open` carries the seven-day past-due grace
for the meter and both gates, which had disagreed on the period; `plan_limit` raises
`no_active_plan` instead of answering null — which now means "no ceiling" — for a root with no
live plan; a subscription event naming a Paddle subscription other than the one the root is live
on is recorded as `conflict` and moves nothing; `set_workspace_plan` refuses over a live Paddle
subscription unless `override` is passed and then keeps the link; and the workspace limit counts
client workspaces, the home left out (the individual rows go to 0 clients). The pricing page
sends a workspace already on Paddle to the portal rather than a second checkout; the admin page
has the override checkbox and its sentence; every synced price is `tax_mode: "external"`, and a
found price without it is PATCHed — the first real invoice had shown both lines tax-inclusive.
`docs/decisions.md` carries each decision, including Ruling 17 (Paddle.js without SRI, accepted).

Results: `npm run test:db` 279 passed across 29 files; `npm test` 412 across 49; `scripts` 23;
Playwright `pricing` + `app-shell` 8; `npm run check` green (the run is in the fix report under
`.superpowers/sdd/2026-09-16-plans-and-paddle-billing/final-fix-report.md`).

What remains before live keys are set:
1. **Server-minted checkout** — the transaction created by an edge function from the caller's
   session, so `custom_data.workspace_id` is never the browser's word (the `conflict` outcome is
   the guard until then; `docs/decisions.md`).
2. **The tax-mode PATCH run against the sandbox** by the controller (`node --env-file=.env.local
   scripts/paddle-sync-prices.mjs`), so the seven existing prices read `external`; then one more
   sandbox payment to see an invoice with tax on top.
3. **The `pilot` rename** with bilingual titles shown by locale, and the rail card printing the
   plan's title rather than its key.
4. The `20260917060000` migration itself is not on the live project yet: `supabase db push`
   after the controller's review, then the admin page's override against the live owner rows.

## 2026-09-16 — plans are named, not keyed

`pilot` is titled «شريك مؤسِّس» / "Founding Partner" (the key stays: five applied
migrations and every early subscription reference it). The rail card, the plan panel and
the admin select all show `title_ar`/`title_en` by the reader's locale — the admin page
through a new admin-only `admin_plan_catalogue()` that includes the internal plans. The
`planTitle` string and `INTERNAL_PLAN_KEYS` are gone. A plan granted for a century says
«بلا تاريخ انتهاء» instead of a renewal year. Applied live and seen on the preview.

## 2026-09-16 — the legal pages: privacy policy and terms

Two documents at `/privacy-policy` and `/terms`, in both languages, outside the app shell
like `/pricing`, linked by title from the landing footer, the pricing footer, the app-shell
footer and each other (`LegalLinks`, one component). The text lives in
`apps/web/src/legal/{ar,en}.ts` — not in `strings/`, whose `Loosen` admits no nesting and
whose bundle every visitor carries — and is held to the code it describes: the two scopes
`oauth-start` asks for, the thirty-day `purge_comment_text`, classification on our own
servers with no model provider, Paddle as merchant of record with tax-external prices, the
seven-day past-due grace, cancel dropping to free. The privacy policy carries what YouTube
API Services requires of a client (Google Privacy Policy, YouTube ToS, the revoke page, the
Limited Use sentence) and links each provider's own policy — Supabase, Paddle, Google,
Cloudflare — where it names them; the terms carry the cancellation and refund terms Paddle
checks for. The "who we are" line is Sky Develop and its site — no person's name or
mailbox, at the owner's instruction. Section ids match across languages (tested), inline
links are `[label](https://…)` only.

## 2026-09-16 — the public face is open, the product keeps its password

`.htaccess` now authorises through `<RequireAny>`: a request whose URI is `/`, `/pricing`,
`/privacy-policy` or `/terms`, or a file under `/static/`, `/fonts/` or `/landing/`, or
`/robots.txt`, is marked `public` by `SetEnvIf` and needs no password; the SPA rewrite to
`/index.html` is an internal redirect that carries the mark as `REDIRECT_public`, which
the second `Require env` reads. `/index.html` is deliberately not public by name, so
`/dashboard`, `/account`, `/sync`, `/admin` and `/fixtures/*` still challenge. Held by
`htaccess.test.ts`, which runs the file's own patterns against both lists.

## 2026-09-16 — the live check compares comment counts before it reads

`worker_video_counts` on the server, `/worker/video-counts` on the gateway,
`comment_counts` on the YouTube adapter and a counts step at the head of the worker's
collection loop: fifty videos' `statistics.commentCount` for one unit, and only the videos
whose count moved since their last exhausted read are paged. A failure of that step reads
everything as before. Live on the owner's channel: the second pass over 100 videos cost
two units and read nothing (`docs/verification.md`). This is what makes `agency` and
`media` live intervals affordable in YouTube quota (`docs/pricing-consultation-2026-09-16.md`
§5.1). `docs/youtube-quota-extension.md` holds the quota-extension application, ready to
submit once the legal pages are public.

## 2026-09-16 — three doors on a workspace card

Disconnect the channel (two presses; revokes the grant and cancels queued work through the
existing `oauth_disconnect`), rename (`rename_workspace`, owner-only, audited), and retire
(`retire_workspace`): not a deletion — at the owner's instruction nothing collected is ever
dropped. Retiring removes every member, revokes the leaving owner's Google grant, cancels
pending jobs, and moves the workspace under the platform owner's root with `retired_from`
and `retired_at` recorded; a person's last workspace cannot be retired. Actual deletion of
personal data stays the request-by-email path the privacy policy states. Live-walked on
the preview (`docs/verification.md`).

## 2026-09-16 — the ui/ component layer, and its first real user

`docs/superpowers/plans/2026-09-16-ui-foundation.md`'s seventeen tasks are done. Sixteen
headless components now live under `apps/web/src/ui/` — Dialog, Tabs, Tooltip, Popover,
DropdownMenu, Select, Switch, Checkbox, RadioGroup, Slider, Progress, Accordion,
Collapsible, Separator, Toast and Table among them — each with its own unit tests, built on
Radix primitives wrapped for this app's own styling and Arabic-first RTL. `DirectionProvider`
wires `dir="rtl"`/`dir="ltr"` from the existing locale store down through every Radix
primitive that reads ambient direction, mounted once at the app root, so a component
written against the layer needs no per-instance direction prop.

Task 17 is the payoff: `AdminPage.tsx`'s plan picker inside `WorkspaceRow` — a real,
already-shipped `<select>` feeding the `set_workspace_plan` mutation — now renders through
`Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` from Task 13, proving the
component layer against a real interaction and a real mutation before any later phase builds
on it. The pack-kind `<select>` two lines below, and every other page's native controls,
are untouched — one swap, not a sweep; `WorkspaceRow`'s state (`plan`, `setChosenPlan`,
`options`, `pending`, `keys`) is unchanged, only the rendered control moved. A new string,
`adminPlanPicker` (`"اختر خطة"` / `"Choose a plan"`), is the trigger's `aria-label`, replacing
the implicit label association the native `<select>` got for free from the wrapping
`<label>` — Radix's trigger is a `button`, not a form control a `<label>` associates with.
`apps/web/src/AdminPage.test.tsx` proves the picker shape directly against `ui/Select`
(self-contained — it does not stand up `AdminPage`'s Supabase/react-query data layer), and
`tests/e2e/app-shell.spec.ts` gained one appended block confirming `/admin` still renders its
signed-out forbidden state with the new import present. `npm run check` is green end-to-end
(`docs/verification.md`). Landed as `f94cd90`.

## 2026-09-16 — the preview password is gone; the site is public

At the owner's explicit instruction, `.htaccess` no longer carries Basic Auth. It used to
gate everything but the landing, `/pricing` and the two legal documents behind
`AuthType Basic` / `AuthUserFile .htpasswd_app`; that block (and the `SetEnvIf`/
`RequireAny` split built for it) is removed entirely, so `/dashboard`, `/account`, `/sync`,
`/admin`, `/connected` and the fixtures answer without a challenge like everything else did
already. The status-guarded cache-control rule stays — it now guards a 404 the same way it
used to guard the 401 that caused the 2026-09-15 outage, and nothing about removing the
password removes that risk. `X-Robots-Tag: noindex, nofollow` is unchanged: the site is
open to anyone with the link, not indexed by a search engine. `htaccess.test.ts` now
asserts the file carries no `AuthType`, `AuthUserFile`, `Require`, `SetEnvIf` or
`.htpasswd` reference at all, rather than asserting the password is kept.

## 2026-09-16 — correcting the ui/ component layer's own record

The entry above this one, dated the same day, names the wrong sixteen components: RadioGroup, Slider,
Progress, Accordion, Collapsible and Separator were never built — the spec (`docs/superpowers/specs/
2026-09-16-ui-foundation-design.md`) explicitly defers all six. The sixteen that were actually built are
Button, Card, Skeleton, Badge, Input, Textarea, Checkbox, Switch, Tooltip, Dialog, Popover, DropdownMenu,
Tabs, Select, Toast and Table. The same entry also said `DirectionProvider` was "mounted once at the app
root" — it was mounted only around the signed-in shell (`AppLayout`) until the final whole-branch review
caught it; it now wraps the true root (`main.tsx`'s `DirectionRoot`, alongside `ToastHost`), so every route —
including the signed-out landing, pricing and legal pages — gets Direction context too. Caught by the plan's
own final review.

## 2026-09-16 — the app-shell plan lands: the rail's two controls move to `ui/`, and the mobile menu learns to hold focus

`docs/superpowers/plans/2026-09-16-app-shell.md`'s five tasks are done. `SessionControl`
(`0bb18b6`) came out of `main.tsx` into its own `apps/web/src/SessionControl.tsx`, purely a
move so it could be tested in isolation — `main.tsx` lost 60 lines, the component gained a
file. `d97e009` then rebuilt it on `ui/DropdownMenu`: the reader's email above an account
link and a sign-out item, the trigger a plain `button` so `app.css`'s existing rail-pill rule
still dresses it with no new selector needed; `SessionControl.test.tsx` carries 7 jsdom tests
against the new shape. `b87abef` moved `RailState.tsx`'s `WorkspaceSwitch` off a native
`<select>` onto `ui/Select`, re-targeting `app.css`'s `.app-rail-workspace select` rule to
`.ui-select-trigger` with its declarations kept verbatim and a `--focus-halo` focus ring
added; the two static-option test cases that lived in `RailState.test.ts` moved to a new
`RailState.test.tsx` (3 jsdom tests) since `ui/Select` needs a DOM, while `RailState.test.ts`
keeps its single-workspace, source-scan and `CollectionState` cases. `3ea6d17` closed the
plan: the inner app's mobile menu now moves focus to the rail's first link when it opens and,
on `Escape`, closes and returns focus to the toggle that opened it — `main.tsx` gained an
effect and a keydown handler, `tests/e2e/app-shell.spec.ts` gained one appended block, whole
file 8/8.

Deliberately left alone, per the plan: the rail's structure, `DESTINATIONS`, the
announcement bar, `LanguageSwitch`, `CollectionState`/the plan card, and tooltips on
icon-only nav items (pitched during planning, dropped — nothing icon-only actually needed
one). `npm run check` (lint, format:check, typecheck, check:functions, unit tests 72 files/
492 tests, db tests 31 files/297 tests, worker tests 195, build, check:secrets) and the whole
Playwright suite (98/98, including the whole `app-shell.spec.ts` file at 8/8) are both green
post-merge (`docs/verification.md`).

## 2026-09-17 — on-page SEO for the public face: `/en` addresses, prerender, metadata, and the copy rewritten to be found

On the owner's explicit request for a full on-page review of the landing page and its
attachments. The whole account is `docs/seo.md`; this is the record of what landed.

- **Every public page has two addresses.** `/`, `/pricing`, `/privacy-policy`, `/terms` in
  Arabic; the same under `/en` in English (`publicPaths.ts`, one table both renderers read).
  The address decides the language — `Landing`, `Pricing` and `LegalPage` take `locale` from
  the route and read `useStrings(locale)` — and reading a page sets the stored preference, so
  the product opens in the language the reader was reading. On a public page the language
  switch is a link to the twin address, with the other language's strings fetched before it
  moves. Every link to a two-language page goes through `publicPath`, swept by test.
- **Every public page renders its own head** (`PageHead.tsx` from `seo.ts`): title,
  description, robots, canonical, `hreflang` × 3, Open Graph, Twitter, JSON-LD
  (`Organization`, `WebSite`, `WebPage`, `SoftwareApplication`; `FAQPage` on the landing;
  `Offer` per self-serve plan on the pricing page from the catalogue rows). `index.html`
  carries none of these any more.
- **The public pages are prerendered.** `npm run build` now ends in `scripts/prerender.mjs`:
  a Vite SSR bundle of `entry-prerender.tsx` renders the eight addresses into
  `dist/<path>/index.html`, writes `sitemap.xml` and `robots.txt`, keeps the empty template
  as `dist/app.html` for the shell's routes, and checks every output before exiting 0.
  `main.tsx` hydrates when the root has markup. Three real mismatches were found with the
  development React bundle and fixed (locale before render, the lazy page's `Suspense`
  boundary, the `ToastHost` sibling); the eight pages and the shell's fallback now hydrate
  clean. The pricing page is rendered with the catalogue read at build time and embeds it
  for hydration. `.htaccess` serves `<path>/index.html` for `/<path>` without a redirect and
  falls back to `app.html`.
- **One flag for indexing.** `VITE_SITE_PUBLIC=true` turns the robots meta, `robots.txt` and
  the `X-Robots-Tag` header together at build time; the site stays `noindex` until the owner
  sets it. `VITE_SITE_URL` is the origin every absolute address carries.
- **The copy, both languages.** Rewritten around a keyword map (`docs/seo.md` §2): the
  search phrase in the title, the description, the H1, the section headings and the FAQ
  title, once each and in sentences. Eight FAQ entries where there were four. No accuracy
  figure, no customer count, no price outside the catalogue — `seo.test.ts` sweeps for all
  three. The pricing page's H1 says what is priced.
- **Images.** The hero is the same picture as a 29 kB WebP (the 1.19 MB PNG stays in
  `public/landing/` as the provenance original, unreferenced) with a descriptive alt; a
  1200×630 JPEG share image is cropped from it.
- Tests: `seo.test.ts`, `publicPaths.test.ts`, `prerender.test.ts`, `LegalPage.test.ts`
  (routes), `tests/e2e/seo.spec.ts`; the landing, pricing and language browser tests follow
  the new copy and addresses. Results in `docs/verification.md`.

## 2026-09-17 — a workspace can be deleted, not only retired

`docs/superpowers/plans/2026-09-17-workspace-delete.md`, tasks 1-3.

`7b89510` (fix `1fc0a82`, prettier reflow `1a826b5`): migration
`supabase/migrations/20260917100000_delete_workspace.sql`. `retire_workspace` now refuses
the platform owner's own workspace (`owner_cannot_retire`) — retiring it would leave the
platform without an admin home. New `admin_workspace_footprint(w)` counts what a delete
would take with it; new `delete_workspace(w)` is admin-only and refuses `last_workspace`,
`billing_root`, and a Paddle subscription that is `active` or `past_due`
(`paddle_subscription_active`), then deletes across 27 tables leaves-first in one
transaction and records `workspace_deleted` on the admin's own home workspace, not the one
just removed. 6 new PGlite cases in `supabase/tests/workspace_lifecycle.test.ts`;
`npm run test:db` 302/302 at the time.

`50f78c1`: `Account.tsx` reads `useIsPlatformAdmin` and passes no `onRetire` to
`WorkspaceCard` when the viewer is the platform admin, so the retire door does not render
for a workspace that cannot be retired anyway. `Account.entry.test.ts` gained the hook mock.

`4ca5ea2` (fix `777499d`): `DeleteWorkspaceDialog.tsx` — a third lever, «حذف نهائي», on the
admin table. It is the app's first real `ui/Dialog`: shows the footprint the RPC would take,
requires the workspace's own name typed back before the delete button enables, refuses to be
dismissed while the RPC is in flight (the fix), maps each refusal to a sentence, and toasts
on success. 12 new strings in both `strings/ar.ts` and `strings/en.ts`; 7 jsdom tests.

**The migration has not been pushed to the live Supabase project.** This plan does not push
it — that is the operator's decision, recorded pending in `docs/coordination/ACTIVE.md`.
`npm run check` and verification detail are in `docs/verification.md`.

## 2026-09-17 — correction: why the platform owner cannot retire, and the right test count

The 2026-09-17 entry above misstates `owner_cannot_retire`'s reason and the PGlite count it
added. The real reason, from the migration's own comment: the platform owner has nobody to
hand a workspace to but themself — `retire_workspace`'s guard is `me = keeper` where
`keeper := private.platform_owner()`, so it fires for every workspace the owner holds, not
because retiring would leave the platform without an admin home (the platform owner is not
going anywhere; retiring just relocates one workspace's membership to them, which is a
no-op when they are already both ends of it). And the count was 5 new cases, not 6 —
297 → 302, as `npm run test:db`'s own tally at the time confirms.

A same-day fix wave (`.superpowers/sdd/2026-09-17-workspace-delete/final-fix-report.md`)
added one further case — a client workspace whose billing root is on Paddle is deletable,
only the root itself is refused — bringing the total to 303/303.

## 2026-09-17 — the workspace list is one query, so a delete reaches the rail

Deleting a workspace on the admin page left it in the rail's workspace switch until the
tab reloaded. `useWorkspaces` (`session.ts`) held a private `useState` copy per reader — the
rail, the dashboard, the plan card, the pricing page — and nothing could invalidate a
`useState`. The same gap hid behind rename and retire on the account page: the card
changed, the switch did not.

`useWorkspaces` now reads through react-query under `["workspaces", userId]`
(`workspacesKey`), same return shape as before, so no consumer changed. `AdminPage`'s delete
and `Account`'s create / rename / retire invalidate the `["workspaces"]` prefix. `session.test.ts`
and `Account.entry.test.ts` render under a `QueryClientProvider`; unit 8 files / 43 tests for
the touched readers, typecheck and lint clean. Not walked in a signed-in browser (no seeded
admin fixture yet — the standing gap).

## 2026-09-17 — landing rebuilt on the design system

`docs/superpowers/plans/2026-09-17-landing-redesign.md`, tasks 1–11, `b4d6dcf`…`b8439b2`;
spec `docs/superpowers/specs/2026-09-17-landing-redesign-design.md`.

The home page is no longer its own hand-written markup and one 1300-line stylesheet. Eight
sections — Hero, Why, Demo, Benefits, Audience, Trust, FAQ, Closing — compose under the
same `PublicShell` the pricing and legal pages already wear (Task 4, same day), each
carrying its own small `landing/*.css` file. `Landing.tsx` and `landing.css` are deleted;
the new tree lives under `apps/web/src/landing/`.

**File map.** `landing/{Hero,Why,Demo,Benefits,Audience,Trust,Faq,Closing}.tsx` and their
`.css` files; `landing/ProductWindow.tsx` — the landing's one picture of the product, drawn
from `ui/` parts, still for the hero and interactive for the demo, one shared arithmetic in
`demoData.ts`; `landing/useReveal.ts`, the scroll-reveal hook; `public/PublicShell.tsx` +
`public/public.css` (Task 3 — header, sheet menu, footer, shared by all three public
pages); `pricing.css` / `legal.css` (Task 4 — the pricing and legal bodies moved verbatim
off the old `landing.css`); `ui/Accordion.tsx` (new primitive, `@radix-ui/react-accordion`
exact-pinned) and `ui/Dialog`'s new `variant="sheet"` (Tasks 1–2).

**Vitals** (Pixel 5 emulation, median of 3 runs; full matrix and methodology in
`.superpowers/sdd/2026-09-17-landing-redesign/vitals.txt`), LCP element `H1.hero-title` in
every cell, before and after:

| | before (`77d90fc`) | after |
|---|---|---|
| LCP, unthrottled | 96ms | 132ms |
| LCP, 4× CPU throttle | 280ms | 408ms |
| CLS | 0 | 0 |

CLS passed (tied at 0). LCP missed the "after ≤ before" budget under both CPU conditions —
the same element paints later, not a heavier one replacing it (1.375× unthrottled, 1.457×
at 4×, a consistent ratio rather than noise). Waived rather than chased further this task;
the reasoning and the PENDING follow-up are in `docs/decisions.md` and
`docs/coordination/ACTIVE.md`.

**CSS budget.** Source-isolated comparison (`esbuild --minify` on each file standalone, the
same minifier Vite uses): the old `landing.css` minifies to 25406 bytes; the ten new
`landing/*.css` files plus `public/public.css` minify to 13073 bytes summed. 13073/25406 =
**51.5%** against a ≤60% budget — PASS.

**e2e rewritten, and why.** `tests/e2e/landing.spec.ts`'s contrast test's readiness marker
moved from `.lp-donut` (gone with the illustration) to `[data-testid="product-window"]`,
and its colour parser gained `color(srgb r g b)` support — this build serializes any
`color-mix()` result that way, which the old `rgb(0-255)`-only parser silently misread as
near-black on both sides of a contrast ratio (a measuring-instrument fix, the assertion
itself unchanged). `tests/e2e/seo.spec.ts`'s hero-alt assertion moved from
`.lp-hero-art img[alt]` to `.lp-hero-figure figcaption`, because the alt sentence now
describes `ProductWindow` from a caption, not an image. `brandMark.test.ts`,
`Landing.identity.test.ts` and `publicPaths.test.ts` were repointed from the old single
`Landing.tsx` / `landing.css` to the split `landing/**` tree; `LegalPage.test.ts`'s footer
scan now reads `public/PublicShell.tsx`, where the public footer lives now. Two real
product defects surfaced only once the new code was served on a real route rather than
tested in isolation — the mobile sheet's anchor scroll landing on the wrong place, and a
contrast failure on the primary CTA and the sentiment badges — both fixed the same day;
detail in `.superpowers/sdd/2026-09-17-landing-redesign/task-10-report.md`.

**Deferred, not missed:** a dead 650px override in `pricing.css`, left for phase 5's
pricing-body redesign; `ProductWindow`'s example comment rows keyed by label rather than an
id; `sharesFor`'s missing zero-guard (unreachable with the demo's fixed denominators);
tabs without a matching panel still carry `aria-controls` pointing at no element (Radix's
own default markup, not written by this task); no `Landing.entry`-style page test for an
admin flash banner, because nothing on the public landing shows one.

`npm run check` — lint, format:check, typecheck, `check:functions` (deno), unit (85 files /
548 tests), db (31 files / 303 tests), worker (195 tests), build (8 prerendered pages),
secrets (521 source files plus built assets) — all green, 2026-09-17.
`docs/verification.md`'s dated entry for this work is deferred: that file carries a
concurrent session's uncommitted changes and was left untouched.

## 2026-09-17 — landing redesign, final-review fix wave

Fourteen findings from a whole-branch review that served the built `apps/web/dist` and
probed it with Playwright, JavaScript on and off. The code in `5131a66`, the build guard in
`074431a`, these records in the commit after. Brief and report in
`.superpowers/sdd/2026-09-17-landing-redesign/final-fix-{brief,report}.md`.

**The critical one: `/pricing`, `/privacy-policy` and `/terms` painted unstyled, then
reflowed.** Both pages are `lazy()` routes, and both imported their own stylesheet — so Vite
emitted `pricing.css` and `legal.css` with the lazy chunks, and the prerendered HTML linked
only the entry's CSS. Before the branch the two pages imported the eager old `landing.css`
and never noticed. Now `main.tsx` imports both stylesheets after the landing's (the page
files no longer import them, with a comment saying where they went), and
`scripts/prerender.mjs` reads the stylesheets each written page links and fails the build
unless the pricing page's carry `.pricing-card` and the legal pages' `.legal-contents` —
tried with the imports removed: the build exits 1 on `/pricing`. While adding that guard:
`written.push({ ...route, file, page })` had been spreading the HTML string over
`route.page` (the kind), so every kind-specific check in the prerender — the home page's
`FAQPage`, the pricing page's `offers`, embedded catalogue and cards — was a no-op. Fixed;
all of them pass live now.

**Type and face.** `/en` lost `.landing:lang(en) { font-family: var(--font-latin) }` in the
move to `public.css` and set in the Arabic face, ignored the preloaded Readex files, then
swapped (CLS 0.037); restored. `public.css`'s copied `.landing h2` size outranked the spec's
`landing.css` rule by bundle order, and the landing's `h1`/`h2` element rules leaked onto the
pricing and legal pages (the pricing H1 measured 66px, the landing hero's clamp). The sizes
are now `.lp-page h1`/`.lp-page h2` (Landing passes `pageClassName="lp-page"`); `public.css`
keeps only margin, weight and the Arabic `letter-spacing: 0`. Measured on the preview at
1280: landing h2 43.52px / lh 58.75px on `/` and `/en`, pricing H1 51.2px (its own
`clamp(34px, 4vw, 52px)`), legal `.legal` max-width 720px, `/en` H1 and body `"Readex Pro"`.

**Correction to the 2026-09-17 "landing rebuilt" entry above:** the `@media (max-width:
650px)` block in `pricing.css` (`.pricing-page .lp-nav { display: flex }` /
`.lp-header-cta { display: inline-block }`) was recorded there as a *dead* override deferred
to phase 5. It was live: same specificity as `public.css`'s hides and later in bundle order,
so at ≤650px the pricing header showed the inline links, the account CTA and the sheet
button together. Deleted; the pricing header now matches the landing's at 390px (one
header, the sheet button alone — `shots/pricing-390-js.png`).

**Smaller.** The sheet's same-section-twice pick did nothing (`location.hash = h` with the
hash unchanged is a no-op) — it now calls `scrollIntoView` on the target in that case, with a
unit test that spies on `HTMLElement.prototype.scrollIntoView` (where `vitest.setup.ts`
supplies it; jsdom has none). Sheet links are `text-decoration: none` again (the dialog is
portaled outside `.landing`). The demo's five filter tabs no longer carry `aria-controls`
to ids that exist nowhere (`aria-controls={undefined}` on the trigger; Radix spreads user
props last) — the Audience section's two tabs keep theirs, their panels exist. The
Benefits section drops its `aria-label` (it was the first card's tag). The announcement
band's language pill gets its `0.9rem` start margin back.

**A Playwright project for the build.** `playwright.config.ts` now has two projects —
`default` (everything but `public-build.spec.ts`) and `public-build` (that file alone, at
`http://127.0.0.1:4175`) — and two `webServer` entries: the dev server as before, and
`npm run build && vite preview --port 4175`. `tests/e2e/public-build.spec.ts` reads five
addresses with JavaScript off (one `h1`, the page's own body class, `.pricing-cards`
`display: grid`, `.legal`'s max-width read from `legal.css`, no visible box past either
viewport edge) and, JavaScript on, the H1 face on `/en` and `/`. Getting that project to
mean anything took one more fix: `vite preview` probes no extensions and answers
`/pricing` with `index.html` — the prerendered *landing* — so a first draft that looked for
`.pricing-cards` "where present" passed on the wrong page. `apps/web/vite.config.ts` gives
the preview server `public/.htaccess`'s two rewrites (`<path>/index.html` for a
prerendered address with or without its slash, `app.html` for anything that is not a file),
and the spec names which page each address must be.

Verification: `npx vitest run apps/web/src/{public,landing,ui}` 28 files / 81 tests; whole
unit suite 85 files / 549 tests; typecheck, lint, format:check green; `npm run build` with
the guard; `test:e2e` landing + pricing + legal + seo 15/15 on the dev server, `--project
public-build` 6/6 on the preview.

## 2026-09-17 — the beta label comes down

The operator declared the product out of beta. «معاينة خاصة · نسخة تجريبية» / "Private preview ·
beta" is gone from the announcement band on the app shell (`main.tsx`) and the public shell
(`PublicShell.tsx`), and the five sentences that repeated the claim were rewritten without it:
the app footer note, the sign-up lead, the account page's trust note, the landing FAQ's lead
and its "can I connect my channel now?" answer, and the public footer (now «مشاعر الجمهور · من
سكاي ديفيلوب»). The dashboard's «معاينة تجريبية» eyebrow stays: it names the visitor's fixture
data, not the product's state. Left deliberately untouched, for the operator: the privacy
policy and the terms (`apps/web/src/legal/ar.ts:46,166` and the English twins) still say the
service is in private preview — a legal-text change with its own `dateModified`.
Typecheck, 12 string-sensitive unit files (45 tests), build + prerender guard, and the
landing / seo / app-shell browser suites (18) green.

2026-09-17, same day: the legal documents follow. The privacy policy's scope paragraph, the
terms' "the service and its state" paragraph and the founding-partner clause no longer say
the service is in a private preview or a beta; what they still say — synthetic data is marked,
features may change, availability is not guaranteed, the founding-partner plan is a grant —
stays. Both documents' `updated` date moves to 2026-09-17 (one constant per language, the
parity test holds them equal). Legal unit tests 21/21, legal + seo browser suites green.

## 2026-09-17 — checkout is minted server-side, closing the gap that blocked live Paddle keys

The one item this entry's own 2026-09-16 billing note flagged as required before live keys:
"the transaction created by an edge function from the caller's session, so `custom_data.
workspace_id` is never the browser's word." Until now `apps/web/src/paddle.ts` opened
Paddle.js with `customData` built from client state, and the webhook trusts
`custom_data.workspace_id` completely once an event names a known price — so any signed-in
caller reaching the checkout button could name any workspace's id and have Paddle apply a
plan, or a customer ref, against it.

`8933d77`: `public.billing_assert_owner(w uuid)` (`20260917120000`, mirrors
`billing_customer_ref` exactly — `private.has_role(w, array['workspace_owner'])`, granted to
`authenticated` alone). New function `paddle-checkout` (same shape as `billing-portal`: the
caller's own token, never the service key) calls it, then Paddle's `POST /transactions` with
`custom_data.workspace_id` fixed server-side and the buyer's email from their verified
session, never the request body, and answers only a transaction id. `openCheckout` now asks
this function first and opens `Paddle.Checkout.open({ transactionId })` — no `items`, no
`customData`, nothing left for the browser to put a different workspace into. `paddle-webhook`
is unchanged: `custom_data.workspace_id` is safe to trust now because nothing reaches it
except through this authorized path.

Pure decision in `_shared/paddle-checkout.ts` (6 cases), a PGlite case added to
`billing_surface.test.ts` (owner passes, analyst/stranger/anon refused — 9/9 in that file),
`paddle.test.ts` rewritten for the mint-then-open flow (13/13). `npm run check` green
(lint, typecheck, check:functions including the new Deno function, `npm test` 549/549,
`npm run test:db` 310/310, check:secrets). Migration pushed live and the function deployed
(`supabase functions list` shows `paddle-checkout` v1, `verify_jwt: true`, matching
`billing-portal`). Verified against the live project with a real session: the owner's own
workspace with a real synced sandbox price minted a real transaction (`txn_01m2q0rjy72gbjp
22svfvt5s07`, 200); a workspace the caller does not own answered 403 `forbidden`; a
malformed price id answered 400 `invalid_request` before either the database or Paddle was
asked.

What remains before live keys, per the same 2026-09-16 list: the tax-mode PATCH run against
the sandbox plus one more sandbox payment to confirm the invoice shows tax (item 2). Items 1
(this entry) and 4 (the `20260917060000` migration) are done — that migration matched
`local`/`remote` in `supabase migration list --linked` before this session touched anything
today. Setting `PADDLE_ENV=production` and the live API key, webhook secret and client
token themselves is the owner's own action — this session has no access to those values and
does not ask for them in chat.

## 2026-09-17 — the tax-mode fix confirmed with a real sandbox payment, through the new server-minted checkout

The last item on the 2026-09-16 "before live keys" list: item 2's PATCH had already run (dry
run against sandbox: `0 tax modes fixed` across all 8 plans/prices; `GET /prices/
pri_01m2n5f7ndvs8vx7ax73bd4b5p` confirms `tax_mode: external` directly against Paddle) —
what was missing was the payment that proves it. The owner's own workspace is on the
internal `owner` plan (unlimited, no self-serve actions), so a probe user
(`tax-fix-probe-…@sky-develop.net`, the same shape as the prior session's `connect-probe-…`)
got a real `free`-plan workspace with the pack's "إضافة 10,000 تعليق" button showing.

The checkout — opened through today's `paddle-checkout` function, not the old client-built
`customData` — showed **Subtotal $5.00 · VAT $1.00 · Due today $6.00** before payment: tax
added on top, not extracted from an inclusive $5.00 as the pre-fix bug did. Paid with
Paddle's sandbox test card end to end; the completed transaction
(`txn_01m2q53nx0en40f9tda4v4yf1y`) confirms the same figures server-side (`tax_rate: "0.2"`,
`subtotal: 500`, `tax: 100`, `total: 600`, `fee: 80`, `earnings: 420`) and carries
`custom_data.workspace_id` matching the probe's own workspace — proof the server-minted
value, not a client one, is what reached Paddle. The webhook applied it: the account page's
comment-analysis budget moved from 100 to 10,100 within seconds, no manual step. The probe
workspace was then deleted from `/admin` (0 channels, 1 member — nothing else attached).

Both halves of the last open item are done. Nothing on the 2026-09-16 "before live keys"
list remains outstanding; setting `PADDLE_ENV=production` and the live API key, webhook
secret and client token is the owner's own action, as before.

## 2026-09-17 — the dashboard rebuilt: one page in `dashboard/`, sticky filters, sections on the design system

Twelve tasks (`docs/superpowers/plans/2026-09-17-dashboard-redesign.md`, spec
`docs/superpowers/specs/2026-09-17-dashboard-redesign-design.md`), commits `4566718`
(Task 1) through `07e9ccd` (Task 12's own) — `git log --oneline 47c2882..HEAD` for the full
range. The old single-file `apps/web/src/Dashboard.tsx` is gone; the page is now
`apps/web/src/dashboard/Dashboard.tsx`, composed of `FilterBar.tsx` / `ActiveFilters.tsx` /
`filters.ts` / `Labelled.tsx` / `useMediaQuery.ts` (the sticky bar and its state), `PageStates.tsx`
(loading/empty/error skeletons), `Hero.tsx`, `SectionNav.tsx`, `Provenance.tsx` (the page's
head), `Summary.tsx`, `Videos.tsx`, `Voice.tsx`, `Timing.tsx`, `ChartFigures.tsx`, `People.tsx`,
`Compare.tsx`, `Engaged.tsx`, `Comments.tsx` / `CommentsTable.tsx` / `ReviewDialog.tsx` (the
eleven report sections), plus the shared `chartOptions.ts`, `splitBar.ts`, `format.ts`, and a
`.css` file per section beside `dashboard.css`. `apps/web/src/dashboard/noReportCss.test.ts`
guards the split: no `dashboard/*.tsx` may import `report.css` or carry an `rp-*` class, and
`main.tsx` must lazy-load `./dashboard/Dashboard`, not the old path. `report.css` itself is not
deleted — `/sync`, the catalogue panel and `/admin` (Operations) still load it, unmoved by this
plan; retiring it there is phase 4, noted as pending in `docs/coordination/ACTIVE.md`. The
`.ui-split` rule the split bars use (`Videos.tsx` over the analysed+unanalysed total,
`Compare.tsx` over the analysed count alone so its bar and printed percentages agree in one
cell) was lifted into `apps/web/src/ui/ui.css` in Task 1 and the landing's `ProductWindow`
switched to it the same commit, so the primitive has two callers from day one, not one.

**The browser suite**, `tests/e2e/dashboard.spec.ts` and `tests/e2e/app-shell.spec.ts`, ends at
86/86 (78 dashboard tests — the pre-existing 76 plus two new: the sticky bar stays in the
viewport after a 2500px scroll, and at 390px the filters open as a sheet with no page overflow
at 320/390/768 — plus 8 app-shell tests). Getting there meant moving all 31 `getByLabel(...)
.selectOption(...)` call sites in `dashboard.spec.ts` onto Radix `ui/Select`, through one
`pick(page, label, option)` helper (plus `nativeMirror`, `offered`, `openPopover` /
`openMore` / `openPeriod`, `applyFilter` — all in the file's first ~45 lines) rather than
patching each site by hand; the full old-selector → new-selector mapping, line by line, with
the reasoning for each, is in `.superpowers/sdd/2026-09-17-dashboard-redesign/task-11-report.md`.
The short version: `.rp-*` class selectors became `.db-*` or `getByTestId(...)`; four
controls moved behind a «المزيد» popover so their `selectOption` calls gained an `openMore`
first; the date mode select lives inside the period popover and needs `openPeriod`; and the
`toHaveValue` reset-assertion on native selects became `toContainText` against the trigger's
displayed option text, since a button trigger has no `.value` to read.

**Screenshots** are under `.superpowers/sdd/2026-09-17-dashboard-redesign/shots/`:
`dashboard-desktop.png` (1280, full page), `dashboard-desktop-scrolled.png` (the sticky bar with
a filter applied, chips visible inside the pinned pane), `dashboard-desktop-more.png` («المزيد»
open), `dashboard-review.png` (the correction dialog), `dashboard-390.png` /
`dashboard-390-full.png` / `dashboard-390-sheet.png` (phone width, the sheet open),
`filterbar-scrolled.png` and `videos-split.png` (working shots from Tasks 2 and 6). None of
this touched `.screenshots/` at the repo root, which is a different, untracked directory this
plan never wrote to.

**Two incidents**, recorded here honestly rather than folded into the task list above them:
Task 2's implementer ran `git push origin main` on its own initiative, against the plan's
"push at the end" — no harm done (nothing deploys on a push to this remote, and the pushed
state was check-green), but every dispatch after it said "never push" explicitly, and this
task (12) was told the same. Task 9's implementer ran `git stash` to take a baseline
measurement, touching the checkout while another session's `docs/verification.md` sat
uncommitted in it — forbidden by `docs/coordination/ACTIVE.md`'s own rules; verified
afterwards that the stash list was empty and the other session's 22-line diff was intact, so
no work was lost, but the practice is now spelled out as off-limits in every later brief: a
baseline is a `git worktree add` in `/tmp`, never a stash on a shared checkout.

**Deferred, so they are not lost**: the pinned filter bar wraps its action buttons to a second
row at 1280px width, making the pinned pane 154.5px tall (`useActiveSection`'s rootMargin is
tuned to that number; a narrower action row could bring it under ~72px and is worth a later
pass); `ChartEmpty`'s bold lead sentence runs into the sentence after it with no space (JSX
whitespace bug, confirmed real, not yet fixed); the Timing section's `2fr 1fr 1fr` grid leaves
the hourly/weekday cards about 180px wide at 1000px of content width; the comparison table's
new `onPick` on each row has no e2e coverage; the review dialog's × reuses
`S.adminDeleteClose` rather than a generic `close` string key, which belongs in `strings/`
once that file is open to new keys in a later phase; and `report.css` keeps its dashboard-era
dead rules until phase 4 removes the whole file from the pages that still load it.

**Task 12 itself**: `apps/web/src/dashboard/Comments.tsx`, `ReviewDialog.tsx` and
`ReviewDialog.test.tsx` failed `prettier --check` since Task 11's fix wave (noted there as a
deferred item) — `npx prettier --write` on exactly those three files, `npx vitest run
apps/web/src/dashboard` held at 57/57 before and after, committed alone as `07e9ccd`. Then
`npm run check`, green end to end: lint (eslint + `ruff check .`), format:check, typecheck,
`check:functions` (deno check on the edge functions), `npm test` 94 files / 597 tests, `npm run
test:db` 32 files / 310 tests, `npm run worker:test` 195 pytest tests, `npm run build` (8
prerendered pages, `Dashboard-*.js`/`Dashboard-*.css` chunked separately from the `report.css`
that still ships for `/sync`/`/account`/`/admin`), `npm run check:secrets` (575 source files
plus built assets). `git status` throughout this task showed only the other session's modified
`docs/verification.md` and the untracked `.screenshots/`; neither was staged, edited or
touched.

## 2026-09-17 — the dashboard's final-review fix wave: one bar row, a measured pinned height, the phone's reachable filters

Correction to the entry above: the dashboard has **eight** report sections (`SECTIONS` in
`SectionNav.tsx`: summary, videos, voice, timing, people, compare, engaged, comments), not
eleven — the eleven counted files, three of which (`ChartFigures.tsx`, `CommentsTable.tsx`,
`ReviewDialog.tsx`) are parts of a section, not sections. Also recorded from the same review,
none of them changed here: the spec asked for `.db-section { padding-block }` and the page
delivers the spacing as `gap` on `.db-page`; the phone sheet's search `Input` is rendered
inside the `Dialog` portal, outside the `<form>`, so Enter there submits nothing (the sheet's
own «تطبيق» button is the path); the `Videos` card is `role="button"` wrapping an `<h3>`,
pre-existing and kept because an e2e reads `aria-pressed` back off the card itself; and commit
`094b328` in the branch range is the other session's docs note, not part of this plan.

The whole-branch review (probed at 1440/1280/1100/1000/900/768/390/320) found twelve items;
all are fixed in this wave. On a phone the shell's «القائمة» button and the bar's «الفلاتر»
button pinned in the same inline-start corner and the shell's won every tap once the reader had
scrolled — the compact bar now lays out `justify-content: flex-end` (`filter-bar.css`, ≤900px),
verified with `elementFromPoint` at 390 scrolled 800, and the e2e sheet test scrolls first and
clicks by `page.mouse` at the button's box centre (a locator click auto-scrolls the button back
into an unpinned position, which is why it never caught this); the amended test fails on the
old CSS. The bar's height is now measured, not assumed: a `ResizeObserver` in `FilterBar`
writes `--db-pinned-h` on the root and reports the number to `Dashboard`, `.db-section`'s
`scroll-margin-top` reads the variable, and `useActiveSection` rebuilds its observer from the
number whenever it changes (the baked `-163px` rootMargin is gone). Section anchors and the
videos pager's `scrollIntoView` therefore land under the bar at whatever height it has. The
bar itself is one row at ≥1100 (72px pinned; 141px with the chips row) and two at 1000
(124px): the five buttons are `size="sm"`, the two always-visible selects hide their visible
label in the pinned bar only (`Labelled`'s `labelHidden`; the trigger keeps its `aria-label`,
so every `getByLabel` still resolves; the sheet keeps visible labels), and the widths are
tighter than the review's ruled numbers because at 1100 the shell leaves the bar 788px inside
its padding — search `flex: 1 1 120px`, `.db-field { min-width: 128px }`, 8px gaps. The
`ChartEmpty` lead no longer runs into its sentence: one class, `.db-missing` in `dashboard.css`
(`strong { display: block }`), `.db-chart-empty` deleted, Voice's and People's hand-written
copies replaced by `ChartEmpty` and their duplicate CSS removed. Timing's grid is the weekly
trend full-width over two halves (`1fr 1fr`, first child spanning), which gives the hourly
card 336px at 1000 — the ≥360px the review hoped for is not reachable there, since the content
column is 688px wide at that viewport. The phone sheet's button is now the `DialogTrigger`, so
Escape hands focus back to it (asserted in `FilterBar.test` and in the e2e). `Loading` no longer
draws a second hero and a second bar under the real ones. `ActiveFilters` lost its dead
zero-chips branch and `scope` prop. `splitBar.ts`'s docstring says what is true — each caller
picks its denominator — and the Videos bar's spoken label now gives shares over `analysed`,
matching every printed percentage on the page (`legendMeasured` always speaks a percentage, so
"counts only" was not available without a new string). Verified: `npx vitest run
apps/web/src/dashboard apps/web/src/ui` 30 files / 114 tests, `npm run typecheck`, `npm run
lint`, `npm run format:check`, and `npm run test:e2e -- tests/e2e/dashboard.spec.ts
tests/e2e/app-shell.spec.ts` 86/86.

## 2026-09-17 — the demo reads like a real channel, and the browser suite proves it

Requested after the dashboard rebuild: no visitor-facing «بيانات اصطناعية» / «مؤلف اصطناعي 1» /
«فيديو اصطناعي ١» anywhere. Four tasks (`docs/superpowers/sdd/2026-09-17-demo-data/`):

**One content module, one generator, two fixtures.** `apps/web/scripts/demo-content.mjs`
authors a channel («عالم التقنية مع سالم»), its 6 videos, its commenters and its 44 comments —
in Gulf, Maghrebi, Egyptian, Levantine, Iraqi and Sudanese dialects, plain data with a dialect
tag per row — as the single source of truth. `apps/web/scripts/make-demo-fixture.mjs`
(`npm run demo:fixture`) builds both fixtures from it, so hashes, ids and timestamps stay
consistent and an edit is a content edit, not JSON surgery: `apps/web/public/fixtures/
dashboard.json`, the **demo** a visitor's browser reads by default (44 comments, 1 of them the
channel's own reply — excluded from the summary's denominator like every channel-owner row
always was — 6 videos, ~12 replies, 2 unanalysed rows, 1 stale-hash row, 2 rows with an unknown
date or likes count, topic predictions and a handful of human reviews); and
`apps/web/public/fixtures/e2e-dashboard.json`, the existing 7-row **test kernel** re-skinned
with new human-visible strings only — same ids, counts, likes, dates, flags, reply/owner
structure, comment types and topics, so the 76+ existing `dashboard.spec.ts` assertions kept
their exact arithmetic through the words changing under them (commit `97ed318`). `data.ts`
reads the fixture path from `VITE_FIXTURE_DASHBOARD ?? "/fixtures/dashboard.json"`;
`playwright.config.ts` points both its web servers at the e2e kernel, so every existing spec
keeps reading it untouched and only a visitor's real browser (or a test that deliberately
intercepts the path) ever sees the demo.

**Words.** The provenance badge and the six prose strings that named the fixture now say
«بيانات توضيحية» / "illustrative data" — never «اصطناعي» — and the retired word is gone from
`apps/web/src/**` (excluding `legal/`, out of scope), both fixture JSON files, and every
`tests/e2e/*.ts` spec, enforced by a new repo-wide scan,
`apps/web/src/noSyntheticWords.test.ts`. The landing's four demo comments
(`apps/web/src/landing/demoData.ts`) are now one authored line per dialect (Gulf, Maghrebi/
Algerian, Egyptian, Levantine) instead of four generic sentences — see `docs/landing.md`.

**The demo smoke test.** `tests/e2e/demo.spec.ts` (new, 2 tests) stays in the suite's default
project — sharing the same dev server as every other spec — but intercepts
`**/fixtures/e2e-dashboard.json` and answers it with `/fixtures/dashboard.json` instead (a
`route.fetch({ url })` + `route.fulfill({ response })` pair, the same technique
`dashboard.spec.ts` already uses to rewrite a fixture in flight, aimed at a different file).
It is the only spec in the suite that reads the demo fixture rather than the kernel. It pins:
the hero's «قراءة 43 تعليقًا» and `getByTestId("total")` = "43" (44 authored comments minus the
excluded owner reply, read off the running page rather than assumed), 6 cards under
`#rp-videos`, the «بيانات توضيحية» badge, no «اصطناع» anywhere in `body` text (written across
two concatenated string literals so the assertion itself does not trip the new repo-wide scan,
which treats `tests/e2e/*.ts` as reader-facing rather than exempting it the way `*.test.ts`
files are), no horizontal overflow at 390, and — widening the page to 50 rows so nothing is
hidden behind pagination — one visible comment from each of three dialect groups: Moroccan
(«واش كاين فرق كبير بين 17 برو و16 برو فالكاميرا ولا غير التسويق؟»), Iraqi («عاشت ايدك، هاي أول
مرة أشوف شرح مختصر ومفيد بنفس الوقت»), Egyptian («السعر ده مبالغ فيه جدًا، مفيش حاجة جديدة
تستاهل الفرق كله»). `npm run test:e2e -- tests/e2e/demo.spec.ts`: 2/2.

**Screenshots.** `npm run dev -w @sentiment/web -- --port 5175 --strictPort`, no
`VITE_FIXTURE_DASHBOARD` set so the default path serves the demo, full-page captures at 1280
and 390 saved to `.superpowers/sdd/2026-09-17-demo-data/shots/`. Inspected in crops: the hero,
badge and summary tiles read cleanly (43/40/3/3/30, «بيانات توضيحية» in an orange warning
badge); the two video cards visible above the fold carry real-looking titles («مراجعة آيفون 17
برو بعد شهر من الاستخدام», «أفضل 5 تطبيقات مجانية لتنظيم وقتك») with plausible per-card counts;
the comments table shows realistic Arab names and handles across countries (نورة القحطاني,
@abu_faisal, يوسف بن عمر, @khadija.tn, @omar.dz, @3li_iq, @karim_casablanca, @rashid_om — the
handle suffixes doubling as a country cue) and all three pinned dialect lines render correctly,
including an inline 😂 emoji inside RTL text with no garbling. The 390 capture wraps every card
and table row within the viewport with no overflow, on the full 22.8k-px page.

**Deferred:** `docs/verification.md` — `git status --short docs/verification.md` was non-empty
(another session's in-flight edit) at the start of this task and remains so; its dated entry
for this work is deferred, not skipped, per the standing rule in `docs/coordination/ACTIVE.md`.
**Also noted, not fixed:** `npm run check` stops at `format:check` on three files this task did
not write and that carry no uncommitted changes — `apps/web/src/noSyntheticWords.test.ts`,
`apps/web/src/strings/ar.ts`, `apps/web/src/strings/en.ts` (one line each, e.g. `ar.ts`'s
`accountTryDashboardLead` wraps to two lines under the current Prettier where the committed
version is one) — pre-existing drift from an earlier task's commit, not introduced here. Every
other step passed run individually: lint, typecheck, `check:functions`, unit (626 tests, only
the one `noSyntheticWords` failure this task caused and then fixed), `test:db`, `worker:test`,
build, `check:secrets`. The next session touching those three files should run
`npx prettier --write` on them.

2026-09-17, closing the demo-data plan: the last three sentences from the placeholder family
followed — the overview eyebrow «معاينة تجريبية» is «مثال توضيحي», the provenance strip says
«مساحة عمل توضيحية» and «N تعليقًا مؤلَّفًا للتوضيح، لا يمثل جمهورًا حقيقيًا» (English twins
likewise); one unit assertion and one browser assertion that quoted the old words follow.
Three files left unformatted by an earlier task reflowed. `npm run check` green (unit 96/626,
db 310, worker 195, build, secrets); dashboard + demo + landing browser suites 85/85.

## 2026-09-17 — Google sign-in: the door opens by configuration, One Tap greets `/account`

Three tasks (`docs/superpowers/plans/2026-09-17-google-signin.md`, design in
`docs/superpowers/specs/2026-09-17-google-signin-design.md`). **The Google door was already
drawn and disabled** — `authProviders.ts` renders it, `Account.tsx`'s `startProvider` already
calls `signInWithOAuth`. Opening it is a configuration change, not new code:
`VITE_AUTH_PROVIDERS=google` (now in `.env.example`) is what turns the existing button live.
**One Tap is new**: `useGoogleOneTap` (`apps/web/src/googleOneTap.ts`) loads Google Identity
Services from its own `<script>` once, shared across every hook instance so two mounts never
inject it twice, hands Google the SHA-256 hash of a random nonce and keeps the raw value for
`supabase.auth.signInWithIdToken` — the same raw/hashed split `oauth-start.ts` already uses for
PKCE, so a credential Google mints for this browser's prompt cannot be replayed against a
different nonce. It prompts on the account page's signed-out screen only, never the landing or
the dashboard's fixture view. Two new build-time env keys: `VITE_AUTH_PROVIDERS` and
`VITE_GOOGLE_CLIENT_ID` (the client id is public by design; the secret lives only in Supabase's
own provider configuration). Commits `0102bea` (design), `fb16e08` (plan), `898d2d2` (the hook
and its tests), `5c2f9ca` (the door and the account wiring), `6e2ac2e` (this task's two
hardenings, below).

**Security review (opus, focused on the auth code: nonce construction, token handling, hook
lifecycle) came back clean on `fb16e08..5c2f9ca`** — nothing it called blocking — with two
minor findings folded into this records task as hardening rather than a fourth task, since both
were small and touched the same two files the review had just read:

- The One Tap gate read `!session` before `getSession()` had resolved, so a signed-in visitor's
  first paint could still fire the prompt — and its fetch — for the moment before the real
  session came back. `Account.tsx` now tracks a `sessionRead` state, set once
  `getSession().then(...)` answers, and the hook's `enabled` gate waits for it.
- A failed GSI script load was cached forever in `googleOneTap.ts`'s module-level `loading`
  promise: one bad load and no later mount would ever try again without a full page reload. The
  script's own `onerror` now clears `loading` and removes the dead tag before rejecting, so the
  next mount gets a fresh attempt. A new `googleOneTap.test.ts` case dispatches `error` on the
  injected tag and confirms a second hook mount injects a new one rather than reusing the stale,
  forever-rejected promise.

**Tests.** Tasks 1–2's own report: 28/28 across `googleOneTap.test.ts` (5),
`Account.entry.test.ts` (10), `authProviders.test.ts` (9), `Account.setup.test.ts` (4); a live
dev server on port 5175 confirmed the Google button enabled with no closed-reason sentence and
the GSI script tag present (`.superpowers/sdd/2026-09-17-google-signin/shots/account-google.png`,
gitignored). This task's hardening adds one more `googleOneTap.test.ts` case and re-runs all
three files clean (24/24). `npm run check` at the close of this task is green in full: lint,
format:check, typecheck, `check:functions` (deno), unit (97 files / 633 tests), db (32 files /
310 tests), worker (195 tests), build (8 prerendered pages), secrets (591 source files plus
built assets).

**PENDING, the operator's: a real Google account against the deployed host.** Everything above
is unit-tested and, for the door and the script-injection gate, dev-server-verified locally —
no e2e, because Google's own UI cannot be driven headlessly (recorded as out of scope in the
design). Verify on `https://app.sky-develop.net/account` after the next deploy: the Google
button opens Google's consent screen and completes a sign-in; a signed-out visit shows the One
Tap prompt and a credential signs in; a signed-in visit does not show it.

Deferred, per the standing rule in `docs/coordination/ACTIVE.md`: `docs/verification.md` —
`git status --short docs/verification.md` was non-empty (another session's in-flight edit) at
the start of this task and remains so; its dated entry for this work is deferred, not skipped.
`docs/deployment.md` was left alone too, on inspection rather than by the same rule: it
mentions specific `VITE_*` names in prose (`VITE_DASHBOARD_SOURCE`, `VITE_SITE_PUBLIC`) but
carries no table or list of build env vars to append the two new ones to.

## 2026-09-17 — operations and admin redesigned; `report.css` retired

Eight tasks (`docs/superpowers/plans/2026-09-17-ops-admin-redesign.md`, design in
`docs/superpowers/specs/2026-09-17-ops-admin-redesign-design.md`), BASE `13265c8`, commits
`0d6f51f`…`e3642af` (14 commits, this records entry the fifteenth). The dashboard redesign had
left `/sync`, the catalogue panel and `/admin` still on `report.css`, out of that plan's scope
(`docs/coordination/ACTIVE.md`'s **PENDING: phase 4**); this plan carried them onto the same
`ui/`-primitive pattern and closed that pending item.

**Shared ground moved first.** `dashboard/dashboard.css` → `apps/web/src/pages.css`, the `db-*`
rhythm every signed-in page now shares; `dashboard/PageStates.tsx` (+ its CSS and test) →
`apps/web/src/pageStates/`. `dashboard/Labelled.tsx` and `dashboard/useMediaQuery.ts` moved into
`ui/`, since a `ui/` primitive must not depend on a page's own stylesheet: `Labelled`'s
`db-field` class became `ui-field`, defined in `ui/ui.css` rather than `pages.css`.
`ui/Checkbox` gained an optional `hideLabel`; `ui/DialogContent` gained an optional
`closeTestId` for its built-in corner close button.

**`/sync` moved into `apps/web/src/ops/`** whole: `Sync.tsx`, `Catalogue.tsx` (the catalogue
panel, on `ui/Tabs`/`ui/Checkbox` with a real per-video checkbox), `CataloguePreview.tsx` (the
YouTube preview, on `ui/Dialog` rather than a native `<dialog>`), `SelectionBar.tsx` (the save
bar, now a sticky card), `SyncHealth.tsx`, `PlanBudgets.tsx`, `BudgetMeter.tsx` (a
`role="progressbar"` div replacing the native `<progress>` the panels used to paint, styled from
`--ml-indigo`/`--color-warning`/`--color-danger` by `budgetState()`), `Attempts.tsx`, `ops.css`
and `catalogue.css`. All 27 `cat-*` test ids and every operations-page test id the old
`OperationsPanels.tsx` carried were kept (`sync-panel`, `plan-panel`, `budget-${event_type}`,
`attempts`, `jobs-failed`, …), most now living on `Card`/`Badge`/`Button` markup instead of
`rp-*` classes. The old `opsDemoTag` string («معاينة تجريبية») is gone; the page reuses
`dashDemoTag` («مثال توضيحي»), the same demo label the dashboard already wears. Two e2e
assertions that read a native `<progress>` element were rewritten against the new bar — the one
class of e2e change this phase allowed, because the control itself changed from a browser
element to a `ui/` one, not because a behaviour changed.

**`/admin` moved into `apps/web/src/admin/`**: `AdminPage.tsx` (the gate, the head, and the
live/demo data source) and `WorkspaceRow.tsx` (the row, split out — its own form state, its own
plan/pack levers) on `ui/Table` + `ui/Select` + `ui/Checkbox` + the toast system, plus
`admin.css`. A wide table row that used to overflow the content column at 1280 next to the rail
is now one `<tbody>` per workspace across two `<tr>`s (values, then a `colSpan` levers row); a
`useMediaQuery` breakpoint switches to cards under 760px. `callServer` now maps the picker's
`plan_key` onto the RPC's `plan` argument.

**A demo mode**, `apps/web/src/admin/adminDemo.ts`: a pure reducer (`reduceAdminDemo`) over six
illustrative workspaces (`apps/web/public/fixtures/admin.json`) that throws the same
`{message, code}` shape a PostgREST error carries for exactly the refusals the SQL enforces —
`paddle_subscription_active`, `billing_root`, `last_workspace`, `no_active_plan`,
`unknown_plan`, `invalid_months` — so `adminErrorMessage` renders the identical sentence the
live page would. `/admin?demo=1` runs the reducer instead of Supabase; `DeleteWorkspaceDialog`
gained injectable `onConfirm`/`readFootprint` props so its confirm step (which the demo has no
server to count against) works without an RPC.

**`report.css` (1316 lines) is deleted.** Its only remaining reader, `/account` (and
`WorkspaceCard.tsx`/`PlanPanel.tsx`/`SetupPath.tsx` under it), got its own `account.css` (494
lines) — every block that page still matches, copied verbatim in the old file's order: the
`.rp-page` scope, the hero banner (`.rp-hero`, `.rp-eyebrow`), the section frame (`.rp-section`,
the reading-measure cap), `.rp-card`, the `.rp-missing` state, the forms-inside-the-system block
(with the dead `.history li`/`.budgets li` shapes and the live plan-budget progress-bar
colouring), `.empty-actions`/`.plan-actions`, the row action (`.rp-page td button`), and the way
in — `.auth-card`/`.auth-or`/`.auth-providers`/`.auth-switch`/`.auth-link` and
`.account-trust*`. Everything else in the old sheet went with it for good, because no page
matches it any more: the report-page banner's pills and nav (`.rp-pills`, `.rp-pill`, `.rp-nav`,
`.rp-nav-links`, `.rp-scope`, `.rp-scope-filtered`, `.rp-scope-chip`), the KPI grid
(`.rp-grid*`, `.rp-metric*`), the insight callouts (`.rp-insight*`), the figures and bar charts
(`.rp-figures*`, `.rp-figure*`, `.rp-bar*`, `.rp-bar-inline`, `.rp-hero-split`), the donut/topic
charts and legend (`.rp-chart*`, `.rp-legend`, `.rp-swatch`), the tab strip (`.rp-tabs`), the
video list (`.rp-videos`, `.rp-video-*`), the people leaderboard (`.rp-people`, `.rp-person*`,
`.rp-rank`), the comment feed (`.rp-comments`, `.rp-comment*`, `.rp-chip*`), the provenance strip
(`.rp-provenance*`) and the filter bar (`.rp-filters*`) — all report-page furniture no
`ui/`-era page renders any more. The guard that used to live at
`dashboard/noReportCss.test.ts` moved to `apps/web/src/noReportCss.test.ts` and now walks the
whole tree rather than one directory, with an allow-list of exactly the four files
(`Account.tsx`, `WorkspaceCard.tsx`, `PlanPanel.tsx`, `SetupPath.tsx`) permitted to import
`account.css` or carry an `rp-*` class, each marked "until phase 5". `layers.test.ts`'s
raw-colour check now reads `account.css` in `report.css`'s place. `PlanPanel.tsx` still draws a
native `<progress>` — phase 5 is where it adopts `BudgetMeter` like every other page.

**Tests.** `tests/e2e/admin.spec.ts` is new, 7 tests, driving the real `/admin?demo=1` page (six
rows, a plan set, a Paddle refusal overridden, a pack granted and refused, the billing root kept
against a delete attempt, a free row deleted down to five rows, six cards with no horizontal
overflow at 390). Full e2e is now 114 tests (107 carried + 7 new); `test:e2e:build` is 6 and
unaffected. `npm run check` at the close of this task is green in full: lint, format:check,
typecheck, `check:functions` (deno), unit (102 files / 708 tests), db (32 files / 310 tests),
worker (195 tests), build (8 prerendered pages), secrets (609 source files plus built assets).

Deferred, per the standing rule in `docs/coordination/ACTIVE.md`: `docs/verification.md` —
`git status --short docs/verification.md` was non-empty (another session's in-flight edit) at
the start of this task and remains so; its dated entry for this work is deferred, not skipped.

## 2026-09-18 — the account page rebuilt on `ui/`: one meter, a demo that needs no session, and the last `rp-*` rule gone

Eight tasks (`docs/superpowers/plans/2026-09-17-account-redesign.md`, design in
`docs/superpowers/specs/2026-09-17-account-redesign-design.md`), BASE `2f128d3`, commits
`dc7b513`…`b95f7a2` (this records entry closes the phase), interleaved on `main` with another
session's OAuth work (`b3001ae`, `9135a6c`, `7dd0086`, `bf0c3a7`, `7714683`, `0a4c1f0`, and the
formatting fix `9867c0d`) — none of it touched here. The ops/admin redesign had left `/account`
on its verbatim, `report.css`-derived stylesheet, out of that plan's scope
(`docs/coordination/ACTIVE.md`'s **PENDING: phase 5**); this plan recomposed it on `ui/` and
closed that pending item.

**`apps/web/src/account/` is the new home**: `Account.tsx`, `AuthEntry.tsx`, `Unavailable.tsx`,
`WorkspaceCard.tsx`, `ConfirmDialog.tsx`, `PlanPanel.tsx`, `CreateWorkspace.tsx`,
`accountDemo.ts` and `account.css`, replacing the old top-level `Account.tsx`, `WorkspaceCard.tsx`,
`PlanPanel.tsx` and the verbatim `account.css`. `ui/BudgetMeter` moved out of `ops/` (classes
renamed `db-meter*` → `ui-meter*`) so `/sync` and `/account` share the one meter instead of
`PlanPanel` drawing a second, native `<progress>`. `SetupPath.tsx` was restyled onto its own
`setup-path.css`, tokens only. `ui/Button` gained `outline`/`link` variants and `ui/Card` gained
`asChild`, both consumed by the new account components.

**A demo mode**, `apps/web/src/account/accountDemo.ts`: a pure reducer (`reduceAccountDemo`)
over three fixture workspaces (`apps/web/public/fixtures/account.json`) that throws the same
`{message, code}` shape a PostgREST error carries for the refusals the server enforces —
`invalid_name`, `last_workspace` — the idiom `admin/adminDemo.ts` established last phase.
`/account?demo=1` runs the reducer instead of Supabase; newly minted workspace ids continue the
fixture's hex sequence from `…a3` (`…a4`, `…a5`, …) rather than a letter scheme that would have
run out. Two new strings, `accountDemoLead` and `demoExternalNote`, cover the demo's lead line
and the "would leave for Google/Paddle here" note standing in for `beginConnect`/`openPortal`/
`openCheckout` when there is no real session to hand off to.

**Tests.** `tests/e2e/account.spec.ts` is new, 9 tests, driving the real `/account?demo=1` page
(three cards, three plan-panel meters, rename, disconnect, retire down to one card then refused,
create a fourth workspace, the connect/top-up external note, narrow-viewport layout, and the
no-demo case falling back to `account-unavailable`). Full e2e is now 123 tests (114 carried + 9
new); `test:e2e:build` stays 6. `Account.setup.test.ts` moved its two open-dialog assertions into
`WorkspaceCard.test.tsx` — a portal-rendered dialog doesn't show up in the page's own static
markup, only in the card component that owns it. `PlanPanel`'s `<article>` picked up a
`db-plan-body` class and a five-property reset once `style.css`'s bare `article` rule was found
painting it a bordered white box it never asked for.

**The verbatim `account.css` (494 lines) is deleted**, and `app.css` shrank 1286 → 755 lines
(−531): every `.app-shell .rp-*` block plus the account/workspace-list/setup-steps/history rule
families that had no reader left once `account/` composed its own page. `locale.css` and
`pageStates/page-states.css` each lost a few dead rules pointing at the same retired classes.
`noReportCss.test.ts` lost its allow-list entirely (it used to name the four files still
permitted an `rp-*` class "until phase 5") and gained a second assertion: no `.css` file
anywhere under `apps/web/src` may contain the substring `.rp-`, not as a selector and not inside
a comment.

**Tallies at the close of this task.** `npm run check`, run stage by stage after the chained
command stopped mid-way (see below): lint, format:check, typecheck, `check:functions` (deno)
clean; unit (`npm test`) 105 files / 786 tests, of which `apps/web` alone is 94 files / 669
tests; db (`npm run test:db`) 32 files / 310 tests, with one timeout in
`usage_grants.test.ts` — a file this phase never touched — isolated and rerun three times,
passing 13/13 every time once the default 30s cap was raised, while an external LLVM build
(`clang++` compiling `llvm-project` under `/private/tmp`) held this machine's load average at
25–100 on 16 cores throughout; worker (`npm run worker:test`) 195 tests; build 8 prerendered
pages; secrets 622 source files plus built assets. Full detail, including the same host-load
caveat against the e2e counts above, is in `docs/verification.md`'s dated entry.

**Parked for a later fix wave**, confirmed rather than re-asserted from task 7's report: `grep`
against `apps/web/src --include='*.tsx'` shows no component wearing `style.css`'s bare
`.workspace-list`/`.link-button*`/`.budgets`/`.rename-form`/`.disconnect-confirm`/`.history`
selectors any more — `ops/PlanBudgets.tsx` wears the namespaced `db-budgets` class and
`account/PlanPanel.tsx` wears `db-plan-budgets`. These rules were dead weight, pending the
final fix wave; the fix wave (`.superpowers/sdd/2026-09-17-account-redesign/final-fix-report.md`)
deleted them from `style.css`.

## 2026-09-18 — the owner's plan no longer refuses every video selection

Reported from the live host with screenshots: the owner (plan `owner`, no ceiling) ticking
videos on `/sync` read «الاختيار يتجاوز ما تبقى من الحصة؛ ألغِ بعضه أولًا.» with the save
disabled, and «اختر الأحدث بما يناسب الحصة» ticked nothing. The cause, reproduced on the
contract before any change: `usage_summary` reports a plan with no ceiling as `remaining: -1`
— `BudgetSchema`'s own convention, so the panels can say «بلا حدود» rather than invent a
number — and `selectionEstimate` (`packages/contracts/src/selection.ts`) subtracted the
selection's cost from that -1 as if it were a count. Every selection came out negative,
`exceeds` was true, and `Catalogue.tsx`'s save guard held; the fit button was handed
`Math.max(0, -1 - owed)`, i.e. nothing. The server was never involved:
`private.analysis_remaining` answers `2147483647` for a null allowance, so `select_videos`
would have accepted whatever the browser let through.

`699bbba`: `selectionEstimate` reads -1 as the contract's "no ceiling" — `remainingAfter`
null, `exceeds` false, and a new `unlimited` flag in its result, so no caller decides what -1
means on its own again; `SelectionBar` prints `pricingUnlimited` («بلا حدود», the one key for
that sentence) where «يتبقى بعدها …» went; `Catalogue`'s fit hands `fitNewest` `Infinity` for
such a plan, so everything priceable fits and the disabled or unpriced videos still stay off.
Tests first, each watched red: two contract cases in `selection.test.ts`, one component case in
`Catalogue.test.tsx`, one browser case appended to `tests/e2e/dashboard.spec.ts` with the e2e
fixture's analysis budget overridden to -1/-1. Tallies and the deploy state are in
`docs/verification.md`'s entry of the same date.

**The deploy is built and waiting for a hand.** The live host serves the build of `46ec419`
(proved: a fresh build of that commit produced the identical entry `index-BmIMt0s_.js`), and
`main` has since taken phase 6's tour, which is not meant to ship yet. So the fix was
cherry-picked onto a detached worktree at `46ec419` and built there (`index-CxI1oaAs.js`);
the upload itself (`scripts/deploy-preview.sh`) was refused by the Claude Code auto-mode
guard as a production deploy and is left to the operator — see the verification entry.

**Found alongside, diagnosed, not fixed** — a second signed-in tenant on `creator_plus` sees
«الجمع متوقّف الآن — لا شيء يعمل» over one queued discover job. Two things, both in the
verification entry: the worker holds one scoped credential per workspace
(`WORKER_CREDENTIAL`, `WORKER_CREDENTIAL_WS2`), so a self-serve workspace has no worker at
all until the operator mints one; and one of those two credentials has been refused
(`invalid_worker_credential`) every minute since 2026-09-17 01:23 local. The fix — a
platform-wide credential, or per-workspace provisioning — is the owner's decision, pending.

## 2026-09-18 — the onboarding tour: a browser suite closes phase 6

`apps/web/src/tour/` (tasks 1–4 of `docs/superpowers/plans/2026-09-18-onboarding-tour.md`):
`tourSteps.ts` (`TOUR_VERSION`, `TOUR_STEPS`, `stepsFor(phone)`), `tourState.ts`
(`readTour`/`writeTour`/`clearTour`/`wantsTour`), `useTour.ts` (the machine),
`TourProvider.tsx` (context, auto-start, the lazy layer), `TourWelcome.tsx`, `Tour.tsx`
(veil + Radix `Popover` card, room-aware placement), `TourEntry.tsx` (the rail's replay
button), `tour.css`, plus their tests; 24 string keys in `strings/{ar,en}.ts`; `data-tour`
attributes on `main.tsx` (`rail`, `rail-menu`), `account/WorkspaceCard.tsx` /
`account/CreateWorkspace.tsx` (`workspace`), `SetupPath.tsx` (`setup`), `ops/Catalogue.tsx`
(`catalogue`), `ops/SelectionBar.tsx` (`selection`), `dashboard/FilterBar.tsx` (`filters`),
`dashboard/SectionNav.tsx` (`sections`) — no other page behaviour changed, no existing
`data-testid` moved.

**The seven steps**, in order: the rail (`rail`, or `rail-menu` under 900px, on whichever
page the tour started on) → the first workspace card (`workspace`, `/account`) → that
workspace's setup path (`setup`, `/account`) → the video catalogue (`catalogue`, `/sync`) →
the selection bar (`selection`, `/sync`) → the filter bar (`filters`, `/dashboard`) → the
section nav (`sections`, `/dashboard`). A step whose anchor never appears within 1.5s is
skipped forward rather than shown against nothing; the last step missing ends the tour as
"seen" the same way finishing does.

**The storage rule.** One `localStorage` key, `tour:v${TOUR_VERSION}` (`tour:v1`), holding
`"seen"` (finished or skipped) or `"dismissed"` (`tour-later`/✕/Escape from the welcome);
anything else — wrong shape, a foreign version, a throwing store — reads back as `null`, the
same "ask again" degradation `locale.ts` already uses. A signed-in or demo visitor on one of
the three tour pages with `readTour() === null` meets the welcome once, automatically;
`?tour=1` clears the memory and starts regardless, then drops itself from the address so a
reload does not restart it; the rail's «الجولة التعريفية» starts it from any memory state.
`playwright.config.ts` seeds every project's `storageState` with `tour:v1=seen` so the
welcome never sits over what an unrelated test came to press — `tests/e2e/tour.spec.ts` is
the one file that opts back out.

**The lazy chunk**, measured off the real build (task 2's own number was against a
placeholder `Tour.tsx` standing in for the chunk before task 3 built the actual layer):
`dist/static/Tour-*.js` 4.59 kB (gzip 2.01) + `Tour-*.css` 1.09 kB (gzip 0.56), a separate
chunk fetched only once the machine leaves `idle`; the eager `index-*.js` sits at 776.90 kB
(gzip 235.42), matching task 2's own measured delta for the provider + entry + storage
(+4.43 kB / +1.42 gzip over the pre-tour baseline) — the welcome/card/veil never rode the
main bundle.

**`tests/e2e/tour.spec.ts`** (task 4, four tests, `storageState` reset to empty and
`reducedMotion: "reduce"` so the veil's smooth `scrollIntoView` never races an assertion):
the full walk — welcome → start → all seven steps across `/dashboard`, `/account`, `/sync`
and back, each step awaited on `tour-progress`'s text and the lit `[data-tour-active]`
element rather than counted clicks — → finish → `tour:v1 === "seen"` → a fresh visit opens no
welcome → the rail's replay reopens it; dismissing the auto-started welcome with `tour-later`
→ `"dismissed"`, and a reload still shows no welcome; at 390×844, step 1 lights
`rail-menu` and the card fits the screen (`boundingBox().width ≤ 358`, `scrollWidth ≤ 390`);
Escape on step 3 ends the tour as `"seen"` with no card left open. No page or tour code
needed a fix — all four passed on the first run against tasks 1–3's code.

**e2e totals.** `tests/e2e/tour.spec.ts` alone: 4/4. Full `npm run test:e2e`: 128/128 (124
carried + 4 new) — one run surfaced 8 failures, every one the first, heaviest test of its
spec file (`account`, `admin`, `app-shell`, two in `dashboard`, two in `demo`, `landing`),
the same cold-compile-under-host-load pattern `docs/verification.md`'s 2026-09-18
account-redesign entry already documents; a clean rerun (load average down from ~20–32 to
~7–20) passed 128/128 in 2.5 minutes, and every one of the eight also passed in isolation
before that. `npm run test:e2e:build`: 6/6, unchanged.

**`npm run check`**, one clean foreground run: lint (eslint + worker `ruff`) clean;
`format:check` clean; `typecheck` clean; `check:functions` (deno) clean; unit (`vitest run
--exclude "supabase/tests/**"`) 110 files / 860 tests; `test:db` 33 files / 316 tests;
`worker:test` 195 passed; `build` 8 prerendered pages; `check:secrets` 642 source files plus
built assets, clean.

**After the records:** `b88c8e8` — the catalogue's play glyph (`catalogue.css`) keeps a
physical `border-left` so the triangle points right in Arabic too; a player's control is not
mirrored with the text.

**Phase 6 (the in-app onboarding tour) is closed — the eight-phase pre-launch redesign is
complete.** See `docs/coordination/ACTIVE.md`'s dated entry for what, if anything, is still
open from earlier phases.

## 2026-09-18 — a platform worker credential: one credential serves every workspace

Design `488bcd2` (`docs/superpowers/specs/2026-09-18-platform-worker-credential-design.md`),
plan `58b092f`, two corrections `12e8658`; the work `3a42c1c`, `900b83d`, `4afd4fc`, `aae712e`.
One new migration, `supabase/migrations/20260918130000_a_platform_worker_credential.sql`:
`worker_credentials.workspace_id` may be null, and null is a platform credential;
`worker_workspace` answers null for it; `claim_job(null)` claims across workspaces oldest-first
and records the poll as a `worker_seen` row for every workspace; `worker_job` answers the job's
own workspace and refuses only a scoped mismatch; the three grant functions and `worker_tick`
read null as every workspace (the platform tick sums `discover`, `collect` and `analyse` over
every active subscription and adds `workspaces`); `svc_register_platform_worker_credential`
and `svc_retire_platform_worker_credentials` are the service-role doors; a workspace's last
scoped credential may be retired while a platform one is live. Nothing above SQL changed —
gateway, Edge Function, Python worker, service script, contract, UI. A new PGlite suite,
`supabase/tests/platform_worker.test.ts` (10 cases, pgcrypto installed in `extensions` as
Supabase has it, so the registration door hashes for real), each case watched red first, and
three mutation proofs — in `docs/verification.md`'s entry of the same date.
`workers/deploy/README.md` and `.env.example` now recommend the platform credential.

**Not yet on the live project.** The migration is committed and pushed to the repository
only. The rollout is the operator's, in this order: `npx supabase db push --linked`; register
with `select public.svc_register_platform_worker_credential('<openssl rand -hex 32>',
'platform-2026-09-18')` over `npx supabase db query --linked`; `.env.local` →
`WORKER_CREDENTIAL=<that secret>`, delete `WORKER_CREDENTIAL_WS2` and
`WORKER_CREDENTIAL_NEW_ID`; `sh scripts/worker-service-update.sh` (the log should say
`tenants=1`, then claim the `creator_plus` tenant's discover job within a minute); retire the
owner's scoped credential with `select
public.svc_retire_worker_credentials('d0c3b9fc-b813-439e-a32b-71dd357f0bb4', '{}')`. Until
then the worker serves the owner's workspace alone on `WORKER_CREDENTIAL_WS2`, the
`creator_plus` tenant's discover job stays queued, and the refusals on the deleted workspace's
credential continue.

**Closing the morning's entry:** the owner-plan selection fix (`699bbba`) is on the live host,
shipped by the operator's hand from the worktree at `46ec419` + `699bbba` — the host serves
`static/index-CxI1oaAs.js`, verified; the worktree is removed. Detail in the verification entry.

## 2026-09-18 — the platform worker credential is live

Rolled out by the operator's hand, in the order the entry above lists, between 12:5x and 13:00
local: `npx supabase db push --linked` applied `20260918130000` («Finished supabase db push»);
`svc_register_platform_worker_credential(…, 'platform-2026-09-18')` answered
`7abfe195-b3d4-4fe6-9527-7d4f4b022bf2`; `.env.local` now holds that one `WORKER_CREDENTIAL`
(`_WS2` and the id lines gone); `scripts/worker-service-update.sh` moved the service checkout
to `277913a` and restarted it — `worker up, model=camelbert-da, tenants=1, topics=gemini` at
12:59:53, and not one `invalid_worker_credential` since, where the log had carried one a minute
for a day and a half; `svc_retire_worker_credentials('d0c3b9fc…', '{}')` retired the owner's
scoped credential (`1`) — the empty keep the new guard allows while a platform credential is
active, exercised live. The two scoped credentials are history: the deleted workspace's never
had a row to retire.

**One mishap on the way, recorded because the next rollout can meet it:** the step-4 `sed` was
run with the literal placeholder `<السر>`, then the service was restarted on it; the `<` broke
`. ./.env.local` in the service script and launchd spun on `syntax error near unexpected token
'newline'` for about three minutes, with the live scoped credential already deleted from both
copies. The registered secret was recovered from the terminal's own scrollback, written into
`.env.local`, and the service restarted on it. Lesson, now in the notes: hand the operator one
command that generates, registers and writes the secret, never a placeholder to fill by hand.

**Not yet read back:** the `creator_plus` tenant's discover job as `succeeded`, and its page
reading «متصل» — a read-only query is with the operator; the runner logs nothing on a
successful discover, so the log's silence after «worker up» is the expected shape.
