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
