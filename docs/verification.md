# Verification

## 2026-10-09 — Dashboard: filter chips follow the applied filters, not the draft

Owner request (2026-10-09). The chips (`ActiveFilters`) and the phone trigger's count were built from the bar's draft `useState`s, so picking «تعليقات أصلية فقط» showed «مُصفّى: التعليقات فقط» before «تطبيق الفلاتر» while every figure still described all comments. Removing a chip also re-applied the whole bar, so an unapplied draft entered the read with it. Now `appliedValues(filters, limit)` (`apps/web/src/dashboard/filters.ts`) reads the applied `Filters` back for `chipsFor`, and `withoutChip(filters, key)` removes one condition from the applied filters while `onClear` resets the matching control. «المزيد من المرشحات (N)» stays a draft count on purpose: it describes the controls behind the popover, one of which may be set but not applied; the chips say what is applied.

| Command / observation | Actual result |
| --- | --- |
| New e2e tests on the old code (`-g "chip"`) | 2 failed: active-filters visible before apply (`toBeHidden` got "visible"); after removing the video chip with an unapplied «تعليقات أصلية فقط» draft, total `4` (expected `6`). |
| Same tests with the fix (`-g "chip\|narrowed to"`) | 4 passed. |
| `npx vitest run apps/web/src/dashboard/filters.test.ts` | 9 passed (5 new: `appliedValues` for the unfiltered read, every condition read back including the picked day, no period chip under `date_mode: "unknown"`; `withoutChip` leaves the other conditions, clears both period bounds). |
| Mutation: `appliedValues` ignores `replies` | 2 failed. |
| `npm run check` | exit 0: unit 1221, DB 551, worker 297 passed; build and secret scan passed. |
| `npm run test:e2e` | 128 passed, 5 skipped. |
| Browser, 1280×800, fixture dev server | picked «تعليقات أصلية فقط», not applied: no chip, total 43, «المزيد من المرشحات (1)»; after «تطبيق الفلاتر»: «مُصفّى: التعليقات فقط», total 40. |
| Browser, 375×812 | same draft in the sheet, closed without applying: trigger «الفلاتر» (no count), no chip, total 43. |

Not changed: the effect that clears a sentiment no longer measurable still calls `applyFilters`, so it can apply other drafts with it; noted on the PR as a follow-up.
## 2026-10-09 — The «المزيد» popover covered «تطبيق الفلاتر» (the «separates replies» flake)

`tests/e2e/dashboard.spec.ts` › «separates replies from top-level comments» failed on main after #101 (run 37907015476: `total` expected 2, received 4), and the failed check skipped Deploy Preview. It never failed on the owner's Mac (40 runs on 6 workers, 200 runs on 16, CPU throttled up to 20× through CDP), so it was diagnosed on the Linux runner through a draft PR (#104) whose temporary commits ran an event-logging copy of the test. Those commits are not in the merged history.

**Root cause, a product bug.** The desktop filter bar wraps to two rows, and the break fell between «المزيد» (row 1) and «تطبيق الفلاتر» / «إعادة ضبط الفلاتر» (row 2). The popover opens off its trigger's row, so it lay over both actions: at 1280×800 the apply button (161,426, 99×44) sat under the popover (0,424 → 294,800), and a hit test at its centre returned the popover's `<label for="f-topic">الموضوع</label>`. A reader pressing «تطبيق» with the popover open pressed that label; the period popover covered the actions the same way. The test passed only when Playwright's click retries ("…intercepts pointer events", then scroll alternatives) moved the sticky bar before floating-ui repositioned the popover. When the reposition landed between the hit check and the mouse events, `mouseup` hit the popover, no `click` reached the button, and nothing was applied (total stayed 6 or 4). When it landed before every check, the click hung. Ruled out along the way: a stale closure or batched update (the draft reached the combobox, and fixture totals are a synchronous `useMemo` of `filters`); a slower result overwriting a newer one (no async read in fixture mode); Radix Select or Popover swallowing the click; a click-through to the trigger under the closing listbox (Chrome sends that `mouseup` to `body`, no `click`); scrollbar width (Playwright launches headless Chromium with `--hide-scrollbars` everywhere).

**Fix.** `FilterBar.tsx` puts the period trigger, «المزيد» and the actions in one non-wrapping group (`.db-filterbar-tail`), so the actions always share the popover triggers' row. The test itself is unchanged: it was right to expect a press on «تطبيق» to apply.

| Command / observation | Actual result |
| --- | --- |
| Diagnostic, unfixed, Linux runner: event-logging copy of the test, 80 repeats on 6 workers (CI run 37912538296) | 27 failed / 53 passed. Every failure logged `hit=LABEL"الموضوع"` at the apply button with the popover open over it, the draft already in the combobox, and the total unchanged. |
| Same layout, local hit test after the Select closes | `layerPE=none hit=HTML` until the popover's stale `pointer-events:none` cleared ~69 ms later, then `hit=LABEL` for good; `DEBUG=pw:api` shows the locator click retrying on "`<label for="f-topic">` … intercepts pointer events" until a scroll retry exposed the button. |
| New e2e «an open filter popover never covers the bar's own actions», on the old layout | Failed at once: `ar 901px, popover 0, action 0` (the period popover already covered «تطبيق»). |
| Same test with the fix | Passed: both popovers × both actions × 901, 1024, 1280, 1440, 1920px × Arabic and English, asked of `document.elementFromPoint`. |
| Fixed, Linux runner, cold dev server: the real test ×80 and the instrumented copy ×80 in one run, 6 workers (CI run 37913450336) | 159 passed, 1 failed. The instrumented copy: 80/80. The one failure was the real test's first `goto` (line 552, `total` not found in 5 s) in the first batch of six, while that batch took 14–17 s per test against the just-started Vite server, a cold start rather than the filter race. |
| Fixed, Linux runner, one single-worker warm-up then the real test ×120 on 6 workers (CI run 37914710745) | 106 passed, 14 failed, all 14 at line 552, the first `goto` (`total` not found in 5 s); none at either apply. Six browsers and the dev server on the runner's 4 vCPUs put the median test at 17.4 s (about 2 s on the Mac); the warm-up did not help, since each `playwright test` starts its own Vite server. The same initial-load timeout appeared before the fix (diagnostic run 1: 3 of 40). |
| **A/B on the Linux runner, one job, same config** (CI run 37915856398): a temporary config importing `playwright.config.ts` with `expect.timeout` 30 s, so the slow first render above is not counted (a lost click never recovers, so the longer wait cannot hide the race); the real test on 6 workers, then `main`'s `FilterBar.tsx` and `filter-bar.css` swapped in | **Fixed: 120 passed, 0 failed (7.9 min). Unfixed: 5 failed, 75 passed**, all at the filter steps: two hung on the apply click (line 547), one total stayed 6 (554), one stayed 4 (557), one timed out on the next combobox after a lost apply (line 10). |
| Stress copy (logs and evaluates before the click, which made the race likelier: 27/80 unfixed) ×80 on 6 workers, macOS, fixed | 80 passed. |
| New test ×30 on 6 workers, macOS | 30 passed. |
| `npx playwright test tests/e2e/dashboard.spec.ts -g "separates replies" --repeat-each 80 --workers 6` (macOS) | 80 passed (39.4s); also 120 passed twice, and 200 passed on 12 workers. The Mac never reproduced the flake before the fix either, so these runs show no regression, not the fix. |
| `npx playwright test` (full e2e, macOS) | 127 passed, 5 skipped of 132 on nine runs (main had 125 passed, 1 failed, 5 skipped; +1 is the new test). One further run printed 126 passed, 5 skipped: one test failed there, and which one is not known, because that output was cut to its last two lines. |
| Layout at 1280×800 Arabic and 901×800 English, popover open | Search and both selects on row 1; period, «المزيد», «تطبيق», «إعادة ضبط» together on row 2; the popover opens above them; no horizontal overflow (`scrollWidth − innerWidth = 0`, bar `scrollWidth − clientWidth = 0`). Bar is two rows at every width measured, 1100–1920px; the CSS comment that claimed one row from 1280px is corrected. |
| `npx vitest run apps/web/src/dashboard` | 14 files, 70 tests passed. |
| `npm run check` | exit 0: lint, format, typecheck, functions; unit 1199, DB 540, worker 297 passed; build and secret scan passed. After merging main (#102, #103, #105): exit 0, unit 1216, DB 551, worker 297; full e2e 127 passed, 5 skipped of 132. Again after #106: exit 0, unit 1218, DB 555, worker 297; full e2e 127 passed, 5 skipped; the flaky test 80/80 on 6 workers. |
| Not fixed here | The bar's «مُصفّى:» chips are built from the draft values, so they name a choice before «تطبيق» is pressed; filed as its own task. On a 4-vCPU runner with 6 workers, the dashboard's first render can miss the default 5 s `expect` (above); the normal CI run uses fewer workers and passed with it, so it is noted, not changed. |

## 2026-10-09 — Owner console phase 2, step 3: the accounts page

Owner request (2026-10-09: "ابدأ صفحة الحسابات والمساحات"). One migration (`20261020000000_admin_accounts.sql`): `private.user_profiles.is_test` and `admin_set_user_test` (audited); `admin_accounts()` (one row per account: who, when, suspended / admin / test, workspaces stood in and created, channels in those created, and the home workspace's plan through its billing root; own 30 s timeout); `admin_user_detail` now says `is_test`. `/admin/users` becomes "Accounts and workspaces": sections for all / customers / test accounts / admins with counts, a folded search over email, name and organisation, plan and holdings per row, and the account file gains the test-account switch. The tab is now «الحسابات»; the e2e demo test clicks it by exact name («أنواع الحسابات» contains the word).

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run supabase/tests/admin_account_file.test.ts` | 17 passed (4 new): the customer with name, one channel, at least three seats and two owned workspaces, the owner as admin; the test mark set and cleared, shown in the file and the history, the kept details untouched; a ban in force shows as suspended; non-admin refused both calls. |
| Mutations: `is_test` always false; `suspended` always false | `1 failed` each. |
| `AdminUsersPage.test.tsx`, `AccountFile.test.tsx` | 4 and 13 passed: sections and counts, a test account with its tags and no plan, a folded Arabic name search (ساره → سارة); the file's test switch sends the mark. |
| First local e2e run | `admin.spec.ts` › users tab: strict-mode violation, «الحسابات» matched two links. Exact match; `admin.spec` + `app-shell.spec` 16 passed. |
| `npm run check` | exit 0: unit 1218, DB 555, worker 297 passed; build and secret scan passed. `npm run db:snapshot:check`: exit 0. |

## 2026-10-09 — Owner console phase 2, step 2: bulk actions on the channels console

Owner request (2026-10-09: "ابدأ الإجراءات الجماعية"). One migration (`20261019000000_admin_bulk_channel_actions.sql`): `admin_request_channel_work(uuid[], 'collect'|'discover')` queues work only where it can run (not paused, nothing of that kind queued or running, and for a collection at least one selected video) and answers queued / skipped; `admin_set_auto_selection(uuid[], initial 0–200, daily 0–100)` sets the numbers, creating them in the name of the workspace's creator where there were none. Both admin only, up to 500 channels, audited per channel. The page: a checkbox per row and one for every channel shown; a bar with collect now, refresh catalogue, pause (confirming press), resume, automatic selection numbers, CSV export (byte-order mark, formula-safe), clear. Bulk delete is not here: it waits for the owner's own decision.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run supabase/tests/admin_console_overview.test.ts` | 18 passed (4 new): collect queued for the two channels with selections, skipped for one with none and one paused, and skipped when already queued; latest trail row `channel_collect_requested` by the owner; a catalogue run queued; numbers 10 / 3 set on a channel that had none and one that had, the new one in the workspace creator's name; bad kind, 201 initial, non-admin refused. |
| Mutations: paused not skipped; collect without selections not skipped; numbers in the caller's name | `1 failed` each. |
| `AdminChannelsPage.test.tsx`, `channelsConsole.test.ts` | 11 and 8 passed (6 new): two rows selected, one collect request for both, the skipped count said; select-all over the shown rows, pause only after the confirming press; numbers out of range keep the button off, in range sent; a refusal named; CSV header and row, quoting, and a leading `=` neutralised. |
| `npx playwright test` locally (Chromium 1194, uncommitted config) | 126 passed, 5 skipped. |
| `npm run check` | exit 0: unit 1216, DB 551, worker 297 passed; build and secret scan passed. `npm run db:snapshot:check`: exit 0. |
| #103 on main | Deploy Preview 37911502794: migrations applied, frontend deployed, live check passed. |

## 2026-10-09 — Owner console phase 2, step 1: pausing a channel's collection

Owner approval (2026-10-09: "ابدأ بإيقاف الجمع واستئنافه"). One migration (`20261018000000_channel_pause.sql`): `channels.paused_at` / `paused_by` (a mark, not a change of `status`, so resuming needs no memory); `admin_set_channels_paused(uuid[], bool)` (admin only, up to 500 channels, cancels queued jobs on pause, one audit row per channel changed); `schedule_due_work` and `auto_select_videos` rebuilt from 20261012000000 with one guard each; `admin_channel_states()` names `paused` first; `admin_console_overview()` counts it. A member can still sync by hand. The channel panel pauses after a confirming press and resumes in one.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run supabase/tests/admin_console_overview.test.ts` | 14 passed (4 new): pause cancels the one queued collect, the home counts 1 paused / 0 collecting, the trail's latest row is `channel_paused` by the owner, a second pause changes nothing; the scheduler queues no collect for a paused stale channel and one after resume; the automatic selection picks 0 while paused and 1 after; non-admin `forbidden`, anon `permission denied`, empty list `invalid_request`. |
| Mutations: scheduler filter dropped; selection guard dropped; queued-job cancel disabled | `1 failed` each. |
| `AdminChannelsPage.test.tsx`, admin suites | 7 passed (2 new: pause needs the confirming press; resume is one press and a refusal is named); admin suites 189 passed. |
| `npx playwright test` locally (Chromium 1194, uncommitted config) | 126 passed, 5 skipped. |
| `npm run check` | exit 0: unit 1210, DB 547, worker 297 passed; build and secret scan passed. `npm run db:snapshot:check`: exit 0. |
| Known limits | A job cancelled by the pause holds the next one of its kind back for up to an hour after resume (`enqueue_scheduled`'s 60-minute rule). Between the migration and the new frontend landing, the old home page refuses the overview's new `paused` key (strict contract); the deploy lands both minutes apart. |

## 2026-10-09 — Owner console phase 1b: the channels console at `/admin/channels`

Owner request (2026-10-09: "ابدأ لوحة القنوات"). One migration (`20261017000000_admin_channels_console.sql`): `admin_channels_console()` gives every channel its state from `private.admin_channel_states()` (the home's own), the workspace and whose it is (the caller's, or a customer's and their email), catalogued / selected / collected / analysed counts aggregated once per table (comments from `private.video_comment_stats`), and the automatic selection numbers; its own `statement_timeout=30s`. `admin_channels()` is unchanged (the search box and its tests read it). The page: state chips with counts, account filter, folded search, four orders (trouble first by default), all in the address (`?state=&owner=&q=&sort=`), and a side panel with the way into the workspace and next / previous. The home's state counts now link to `/admin/channels?state=…`. Read only; bulk actions and a pause state are phase 2.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run supabase/tests/admin_console_overview.test.ts` | 10 passed (3 new): each of the seven channels carries the state the home counts, the failing one its error, the healthy one 1 / 1 / 100 / 90 and 20 / 5; a customer's channel is `mine: false` with the customer's email and no automatic selection; non-admin `forbidden`, anon `permission denied`; `statement_timeout=30s`. |
| Mutations: `mine` always true; `selected` always 0 | `1 failed` each. |
| `channelsConsole.test.ts`, `AdminChannelsPage.test.tsx`, `AdminHomePage.test.tsx` | 6, 5, 6 passed: address read with fallbacks and written minimally; trouble-first, most-comments and longest-since-collection orders; state, account and folded search filters; state counts over account and search only; the page lists trouble first with error and counts, opens on the home's state link and rewrites the address on a chip, narrows to customers and to a search, says when nothing matches, and the panel walks next / previous with the way into the workspace. |
| `npx playwright test` (whole suite, locally, with the container's Chromium 1194 by `launchOptions.executablePath` in an uncommitted config) | 126 passed, 5 skipped. First local e2e run in this container. |
| Main after #101 merged (run 37907015476) | `Browser tests` failed on `dashboard.spec.ts` › "separates replies from top-level comments" (expected 2, got 4); Deploy Preview skipped. The same tree passed on the PR. Reproduced locally: 6 failed in 40 with six workers. Waiting for the combobox to show the choice before applying did not cure it (6 in 40 again), so it may be a product race, not only test timing; reverted, and filed as its own task. Claude cannot re-run jobs (403). |
| `npm run check` | exit 0: unit 1208, DB 543, worker 297 passed; build and secret scan passed. `npm run db:snapshot:check`: exit 0. |

## 2026-10-09 — Owner console phase 1a: the home at `/admin`, and Ctrl+K

Owner approval (2026-10-09: "ابدأ المرحلة 1 من واجهة المالك"). Phase 1 is split: 1a (this) is the home and the search box; 1b is the channels console. `/admin` is now the home; the workspaces table moved to `/admin/workspaces` (its tab, and the e2e demo path, follow). One migration (`20261016000000_admin_console_overview.sql`): `private.admin_channel_states()` names each channel's state once (cataloguing, collecting, failing, new, waiting, stale, healthy, first that applies), and `admin_console_overview()` reads the home in one call with its own `statement_timeout=30s`. The funnel sums `private.video_comment_stats`, never `comments`. No quota meters: no table measures YouTube or Apify units yet.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run supabase/tests/admin_console_overview.test.ts` | 7 passed: seven imported channels, one per state, each counted once; attention lists failing before stale with error and workspace; funnel 3 / 3 / 140 / 100 from the stats; latest audit row first with its actor; worker queue 2 queued; non-admin `forbidden`, the states helper unreadable by `authenticated`, anon `permission denied`; `proconfig` carries `statement_timeout=30s`. |
| Mutations: stale window 48 h → 96 h; failing rule dropped; timeout removed | `2 failed`; `2 failed`; `1 failed`. |
| `AdminHomePage.test.tsx`, `AdminCommandPalette.test.tsx`, `AdminUsersPage.test.tsx` | 6, 5, 3 passed: tiles, states in trouble-first order, attention with `/dashboard?ws=` link, activity in words, empty attention sentence, demo reads nothing; Arabic letter forms folded (أ/ا, ى/ي, diacritics); every word must match; Ctrl+K opens, Enter on a channel goes to its workspace, an account goes to `/admin/users?u=`, which opens its file. |
| Existing admin suites after the palette joined the tab strip | 166 passed. |
| `npm run check` | exit 0: unit 1199, DB 540, worker 297 passed; build and secret scan passed. `npm run db:snapshot:check`: exit 0. |
| Not checked here | The page in a browser against the live project (no session in the container); CI's e2e runs the moved demo path and the forbidden path at `/admin`. |

## 2026-10-09 — `admin-users`: the account file's actions that need the auth admin API

Owner approval (2026-10-09, "نفّذ الخطة كما هي"): a reset link the owner hands over, suspension and its lifting, a manual email confirmation, and an email change. #99 (account file and phase 0) merged as `2a6e2c6`; its Deploy Preview run applied the migrations and the live site check passed, before this work was pushed.

New Edge Function `admin-users` (the owner deploys it: `npx supabase functions deploy admin-users`, with the gateway's JWT check on) and one migration (`20261015000000_admin_user_actions.sql`: `admin_user_target`, and `admin_record_user_action` learning five actions). The decision is `supabase/functions/_shared/admin-users.ts`, tested without a project. Who may ask is `admin_user_target`, run with the caller's own token; the service key is used only after it answers, and only for `auth.admin`.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run supabase/tests/admin_users_handler.test.ts` | 10 passed: suspend `876000h` / lift `none`, each recorded; never the caller or another admin (409, no Auth call); reset link lands on the app's own `/reset-password`, refused for a foreign or missing origin and for a person with no email; manual confirmation; email trimmed, lower-cased, marked confirmed; `email_exists` → `email_taken`, any other Auth or driver text → `unavailable`; malformed body refused before any call; database `forbidden` / `user_not_found` passed on; an action whose trail row failed answers `recorded: false`. |
| Mutations: admin guard dropped; origin check dropped | `1 failed` each. |
| `npx vitest run supabase/tests/admin_account_file.test.ts` | 13 passed (3 new: `admin_user_target` names email, admin and self; refuses non-admin and anon; the trail accepts the five actions). |
| `adminUserAction.test.ts`, `AccountFile.test.tsx` | 6 and 11 passed: caller's token, gateway 404 read as "not deployed", known refusals named, others `unavailable`; suspension needs a confirming press; a ban in force offers the lift; email change only when typed twice the same; handed link shown with its warning; "not recorded" said. |
| `npm run check:functions` | `admin-users/index.ts` checks under Deno. |
| `npm run check` | exit 0: unit 1187, DB 533, worker 297 passed; build and secret scan passed. `npm run db:snapshot:check`: exit 0. |
| Not verified here | Supabase Auth's behaviour on the live project: the recovery link's lifetime, whether a ban ends an open session at once, and the `email_exists` code. Each is the owner's first live try after deploying. |

## 2026-10-09 — The account file and password recovery (admin users page)

Owner request (2026-10-09): full management of customer accounts from the owner's side: their details, plan, password help. Owner's choice the same day: build it inside the current users page first, then move it into the new owner console. One migration (`20261014000000_admin_account_file.sql`: `private.user_profiles`, `admin_user_detail`, `admin_update_user_profile`, `admin_record_user_action`), no Edge Function. Suspension, owner-made links and email changes need the auth admin API and wait for an `admin-users` function the owner deploys.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run supabase/tests/admin_account_file.test.ts` | 10 passed: detail with sign-in facts, empty details, every seat; unknown user `user_not_found`; non-admin `forbidden`, anon `permission denied`; save trims and clears blanks, lands in history; 121-character name `profile_too_long`; `private.user_profiles` unreadable by `authenticated`; reset recorded, unknown action refused; a role change through `update_workspace_account_role` shows in history and the owner's seat is refused. |
| Mutations: history without `membership` rows; profile edit not audited | `1 failed`; `1 failed`. |
| `AccountFile.test.tsx`, `ResetPassword.test.tsx`, `AdminUsersPage.test.tsx` | 6, 6, 2 passed. Reset request uses `redirectTo` `/reset-password` and answers the same whether the email has an account; mismatched passwords refused before any call; a recovery landing on `/` is taken to `/reset-password`. |
| Mutation: recovery landing pattern broken | `1 failed`. |
| Found on review before push: `AdminAuditEventSchema` required a workspace id, and the account file's events have none | the audit page would have refused every read after the first profile edit. Contract now allows null (the page never read the field); a DB test parses `admin_audit()` through the contract. Mutation (back to required): `1 failed`. |
| First run of `Account.entry.test.ts` after adding the "forgot" link as a router `Link` | 7 failed: the sign-in surface renders outside a router there. Now a plain `<a>`; 7 passed. |
| `npm run check` | exit 0: unit 1176, DB 520, worker 297 passed; build and secret scan passed. `npm run db:snapshot:check`: exit 0. |
| `npm run test:e2e` | not run in Claude's container (Chromium build mismatch); CI's e2e job is the evidence. |

## 2026-10-09 — Automatic selection runs as the catalogue run finishes (admin console phase 0)

Owner observation (2026-10-09): an imported workspace showed 0 selected videos after its catalogue was in. Cause: only the scheduler ran the selection, hourly at :17 or when the worker is idle, and after a bulk import the worker is busy for hours. Fix: one migration (`20261013000000_auto_select_on_catalogue.sql`), a trigger on `jobs` that runs `private.auto_select_videos` when a `discover` job goes from queued/running to `succeeded`/`partial`, and queues the collection of what it selected. No Edge Function change.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run supabase/tests/admin_import_channel.test.ts` | 15 passed. New: a failed catalogue run selects nothing; marking the run `succeeded` selects the latest 20 and queues one collect with no scheduler tick. |
| First draft: one `if auto_select_videos(...) > 0 and has_due_videos(...)` | 20 selected, 0 collect queued: `has_due_videos` is stable and did not see selections made in the same statement. Split into two statements; passed. |
| Mutations: trigger fires on `partial` only; enqueue skipped | `2 failed`; `1 failed`. |
| `npm run test:db` / `npm run worker:test` | 510 passed / 297 passed. |

## 2026-10-09 — Bulk channel import for the platform owner (`/admin/import`)

Owner request (2026-10-09): import a CSV of YouTube channels, one workspace per channel named after it, collection started, and no channel the account already holds imported twice. Follow-up decision the same day: never select a channel's whole catalogue; select its latest 20 videos once the first catalogue run is done, then add videos it publishes later, at most 5 a day. Built by Claude; one migration (`20261012000000_admin_import_channel.sql`), no Edge Function change: lookups reuse the deployed `channel-lookup`.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run supabase/tests/admin_import_channel.test.ts` | 8 passed: workspace named after the channel, owner membership, `public_unverified` channel, queued `discover` job, billing to the home workspace, audit row; second import → `exists`; channel held in another workspace of the account → `exists`; another user's copy does not block; long title cut to 120; bad id / platform refused; a refused row leaves no workspace; non-admin `forbidden`, anon `permission denied`. |
| Mutations on the migration: dedupe `if found` → `if false`; admin gate dropped | `2 failed / 6 passed`; `1 failed / 7 passed`. |
| Parser on the owner's file (`… - Sheet1.csv`, two ranked side-by-side blocks) | 100 channels, rank order 1→100, 0 duplicates, 0 rejected; all 100 are name searches → 10,000 lookup units. |
| Automatic selection (`supabase/tests/admin_import_channel.test.ts`, 6 more) | nothing while the catalogue run is queued; latest 20 after it (no channel posts, no closed comments), one collect queued; back catalogue never added later; new videos at most 5 per 24 h; a deselected video is not chosen again; channels not imported untouched. |
| Mutations on the selection: discover-job guard, deselect memory, watermark, initial batch excluded from the cap, scheduler hook | each fails its tests (`3`, `1`, `2`, `1`, `2` failed). The first draft counted the initial 20 against the daily cap, so no new video would ever have been added; the cap test caught it before push. |
| First run of `npm run test:db` after redefining `schedule_due_work` | 16 failed in `worker_catalogue` / `worker_topics`: `permission denied for function auto_select_videos` (the gateway runs the scheduler as `service_role`). Granted like its sibling helpers; then 509 passed. |
| `npm run check` | exit 0: unit 1162, DB 509, worker 297 passed; build and secret scan passed. `npm run db:snapshot:check`: exit 0. |
| `npm run test:e2e` in Claude's container | not run: the container's Chromium build does not match the pinned Playwright (`chromium_headless_shell-1243` missing). CI's `e2e` job is the evidence. |

## 2026-10-06 — WO-16 (PR #90), dispatcher follow-up fix (#91), parallel CI (#92)

**WO-16: service health from records** (Codex; two rounds). The first head `49f696d` mapped a platform with no success in 7 days and only `cancelled` runs to `healthy`; a probe at that head returned `healthy` where `degraded` was expected. Round 2 (`05c6fe8`) fixed it and both optional findings. Merged as `668c4ed`.

| Command / observation | Actual result |
| --- | --- |
| `npm run check` at `49f696d` (Claude's worktree; Codex's sandbox stopped at `check:functions` with npm cache `EPERM`) | exit 0: unit 1117, DB 493, worker 297 passed; build and secret scan passed. |
| `npm run check` at `05c6fe8` | exit 0: unit 1118, DB 494, worker 297 passed. `npm run db:snapshot:check`: exit 0. |
| Mutations at `49f696d`: platform from `sync_runs.source`; `running` rows counted; 7-day window dropped; quota match disabled; `problems_7d` ignored | Each fails its suite. `least(10, …)` → `least(1000, …)` survived (no cap test). |
| Mutations at `05c6fe8`: restore the `last_success_at != null &&` guard; `least(1000, …)` | `1 failed / 22 passed` and `1 failed / 3 passed`. |
| Deploy Preview run 37537588123 on `668c4ed` | `Applying migration 20261010000000 … ✓ applied successfully`; `app.sky-develop.net serves /static/index-CX27Rv6V.js`. |

**Dispatcher follow-up rounds (#91).** Two WO-16 follow-up rounds stopped before any edit: Codex tried to read issue #88 through a local Composio CLI and the sandbox refused it (`EPERM` on `~/.composio/tool_definitions/GITHUB_GET_AN_ISSUE.json`). The follow-up prompt now names `docs/agents/work-orders/$wo.md` and forbids GitHub reads; `codex-constraints.md` rule 5 says the same. Next round: Codex read only the mirror and pushed `05c6fe8`. `npx vitest run scripts/codex-dispatch.test.ts`: 5 passed.

**Parallel CI (#92).** The single `verify` job took ~11 min (run on `1591491`: `npm run check` 6m07s, then `test:e2e` 3m50s). It now runs as `static`, `unit`, `db` and `e2e` in parallel, with `verify` needing all four.

| Command / observation | Actual result |
| --- | --- |
| PR #92 run on `810b07a` | static 1m27s, unit 2m40s, db 3m34s, e2e 4m47s; `verify` passed at 4m53s after start (was ~11 min). |
| `npx vitest run scripts/ci-workflow.test.ts` | 3 passed. Mutations: drop `check:functions` from the workflow → 1 fails; drop `e2e` from `needs` → 1 fails. |
| CodeQL on the same runs | JS ~3m20s, Python ~2m30s, in parallel; never on the critical path. |
| Deploy upload (`scripts/deploy-preview.sh`, run 37537588123) | ~2.4 s per file, one file at a time: ~3.5 min uploading and ~1.5 min removing stale files. The next deploy-speed lever. |

## 2026-10-04 — Codex dispatch: sandbox facts, watcher, dispatcher dry run

All from a clone in `/tmp/aas-src` (the bridge session's own checkout was unreadable, see
`docs/progress.md`).

| Command / observation | Actual result |
| --- | --- |
| `codex --version` via the ChatGPT.app bundle | `codex-cli 0.159.2`; `codex exec --help` lists `-s workspace-write`, `--approve-for-me`, `--json`, `-o`. |
| Smoke test: `codex exec -s workspace-write -c sandbox_workspace_write.network_access=true` in a standalone clone, prompt = `git fetch origin main; git switch -c …` | Codex's own report: `git fetch origin main` → exit `255`, `error: cannot open '.git/FETCH_HEAD': Operation not permitted`; it stopped as instructed. Proves `.git/` is read-only under `workspace-write` even when `.git` is inside the workspace (not a worktree artefact). Claude Code's classifier allowed this launch form. |
| Same smoke test, after `git rm .agents/skills .agents/skills.json` | No `Exceeded skills context budget` event in the JSON log (it was the first event of every earlier run). |
| `npx vitest run scripts/codex-watch.test.ts` | 7 passed. |
| Mutation: remove `\bGIT_DIR=\|\bgit\s+init\b` from `FORBIDDEN_PATTERNS` | 1 failed / 6 passed (the test that replays run 1's `/tmp` bare-repo command); restored → 7 passed. |
| Live watcher, fake Codex writing JSONL then `GIT_DIR=/tmp/x git fetch` | `!! FORBIDDEN (git repository outside the workspace) … !! stopping codex (pid …)`; watcher exit 3 after 4 s; the fake process was killed. Clean log with `turn.completed` → exit 0. The first attempt exited 0 immediately: the entry guard compared `/tmp/…` with node's realpath `/private/tmp/…`; fixed with `realpathSync` on both sides. |
| `CODEX_DRY_RUN=1 scripts/codex-dispatch.sh WO-13 72 codex/wo-13-dry-run` | Cloned `.codex-workspace/`, `codex/wo-13-dry-run @ 239979d (origin/main)`, printed the exact `codex exec` command and the full prompt (task line + constraints). First attempt failed on macOS bash 3.2 (`bad substitution` on a `$(cat)` inside a heredoc inside `$( )`); the prompt is now built with `printf`. |
| `npx vitest run scripts` | 4 files, 48 passed. |
| `npm run format:check`; `npx eslint scripts`; `bash -n scripts/codex-dispatch.sh` | All matched files use Prettier code style; no eslint findings; syntax OK. |
| `npm run check:secrets` | Passed (832 source files, plus built assets). |
| `gh --version` after install from `gh_2.102.0_macOS_arm64.zip` | sha256 `da922c20…c337e` matched `gh_2.102.0_checksums.txt`; `gh version 2.102.0 (2026-09-30)`; `gh auth status`: not logged in (owner action). |
| PR #74 merge, read with `git ls-remote` and a depth-5 fetch | `main` = `239979d` "Merge pull request #74", parents `c609150` and `021d21b`. |
| `git commit` with `core.hooksPath .githooks` on macOS (`/bin/bash` 3.2.57) | Before the fix: `.githooks/pre-commit: line 15: mapfile: command not found`, `line 16: staged: unbound variable`; no commit was created. After replacing `mapfile` with a `read -d ''` loop: the hook ran prettier and eslint over the staged files and the commit landed. |

## 2026-10-06 — Admin services page: styles on direct load; cards claim only what is measured

With the function restored, the owner's screenshot of `/admin/services` showed two problems.

**Unstyled page.** `admin.css` and `pages.css` were imported only by `AdminPage.tsx`. Each admin sub-page is its own lazy chunk, so opening one directly painted without layout. Both stylesheets now import in `AdminShell.tsx`, which every admin page renders through; the build emits `AdminShell-*.css`.

**Cards that said more than the readings.**
- "All core services operational" was shown with 2 of 15 services measured. When some are unmeasured, the card now reads "healthy in 2 of 15 services that report readings".
- "Monitored services: 15" was the total. It now shows the monitored count, with the total and the unmonitored count underneath.
- The latency subtitle "2 / 15 healthy" now says how many services the average comes from.
- "Critical quotas: 0" was shown with no quota measured. It now shows "—" and "quotas are not measured yet", and its two hard-coded Arabic strings moved to `ar.ts`/`en.ts`.
- The live report inherited the demo's `quota_total` (1,024 MB database, 100-job queue) and drew it as a real limit. Live services now carry `quota_total: null`.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run apps/web/src/admin` | 13 files, 97 passed (new: live-shape card test, `quota_total` null, styles guard). |
| Mutation: drop `import "./admin.css"` from the shell | 1 fails. |
| Mutation: live report inherits demo `quota_total` | 2 fail. |
| Mutation: old "all services operational" sentence | 1 fails. |
| `npm run check` | Exit 0: web 142 / 1105, DB 59 / 490, worker 297, secrets clean. |

## 2026-10-05 — Restore `admin_services_health` in production

The admin services page showed `read:unexpected:Error`. The network response was `404` with
`proxy-status: PostgREST; error=PGRST202`: no such function. The owner's read-only check in the SQL
editor returned `migration_recorded = 1, function_exists = 0` for `20260924160000`, and a comparison of
all 82 public functions in the schema snapshot against `pg_proc` found only this one missing. The
deploy runner skips recorded versions, so only a new migration brings it back. The page had hidden
this since at least 2026-09-24 by falling back to demo data, which #82 removed.

Migration `20261009010000_restore_admin_services_health.sql` re-creates the 20260924160000 body
unchanged (`diff` identical) as `create or replace`. Every admin read now throws
`DashboardRpcError("live_unavailable", { code })`, so the page shows `read:live_unavailable:<code>`
instead of `unexpected`.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run supabase/tests/admin_services_health.test.ts` | 3 passed: restores after a drop, no-op when present, still refuses a non-admin and anon. |
| `npx vitest run apps/web/src/admin` | 12 files, 93 passed. |
| Mutation: admin reads back to `throw error` | 1 of 9 in `adminRead.test.ts` fails. |
| `npm run check` | Exit 0: web 141 / 1101, DB 58 / 483, worker 297, secrets clean. |
| `npm run db:snapshot` then `db:snapshot:check` | No snapshot change (same function); exit 0. |

Not established: how production came to record the version without the function.

## 2026-10-05 — Channel lookup authorizes through `my_role`, not Auth `/user`

The deployed `channel-lookup` logged `forbidden:session` with `AuthUnknownError: Unexpected token
'<', "<html>\r\n<h"... is not valid JSON`: the function's `auth.getUser()` call to Auth `/user`
got an HTML page, while the same ES256 token worked against PostgREST from the browser. Supabase's
support assistant reported no incident, the gateway accepting the token, and no matching Auth log
entry. Root cause at Supabase is not established here.

The function no longer calls Auth. `public.my_role(w)` (migration `20261009000000_my_role.sql`)
returns the caller's own role in one workspace; PostgREST verifies the token and `auth.uid()` is the
verified subject. A `PGRST3xx` error or `42501` (anon, which may not execute it) reads as
`forbidden:session`, any other error as `forbidden:membership_read`, no owner/analyst role as
`forbidden:role`. `paddle-checkout` still calls `getUser()` but only to prefill the buyer email and
continues without it; left as is.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run supabase/tests/my_role.test.ts supabase/tests/lookup_access.test.ts` | 11 passed. |
| Mutation: drop `m.user_id = auth.uid()` | 4 of 11 fail. |
| Mutation: grant `my_role` to anon | 1 of 11 fails. |
| Mutation: `42501` not a session error | 1 of 11 fails. |
| Mutation: `viewer` may name a channel | 1 of 11 fails. |
| `npm run check` | Exit 0: web 141 / 1100, DB 57 / 480, worker 297, `deno check` of every function, secrets clean. |
| `npm run db:snapshot:check` | Exit 0. |

Not done here: the migration reaches the project through the CI deploy; the owner deploys the
function with `npx supabase functions deploy channel-lookup --project-ref ykqugctewsqvevhyqtbi`.

## 2026-10-05 — Channel search shows its error code

From the cloud checkout of `claude/keen-keller-skwwpm` at `b94a8d4`, Linux. Every lookup failure
without its own sentence used to read "تعذّر البحث عن القنوات. حاول من جديد."; the owner could not
tell a lapsed reader token from a refused key or an unreachable function without DevTools. The
generic sentence now carries the code (the function's `code`, else `http_<status>`, else the client
error class), isolated with FSI/PDI so it keeps its order in Arabic. Only `[A-Za-z0-9_.:-]{1,64}` is
echoed.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run apps/web/src/account/channelLookupError.test.ts` | 8 passed. |
| Mutation: generic branch back to `S.addChannelFailed` | 2 of 8 fail. |
| Mutation: drop the `http_<status>` fallback | 1 of 8 fails. |
| `npm run check` | Exit 0: web 141 files / 1100 tests, DB 55 / 469, worker 297, secrets check clean. |

Not verified here: the live failure itself. The owner's next search shows which code it is.

### Follow-up: the three `forbidden` refusals get their own codes

The owner's DevTools showed `403 {"code":"forbidden"}`, and the function log had only boot and
shutdown lines. Legacy API keys are still enabled (owner's screenshot), so a disabled anon key is
ruled out. `channel-lookup` now answers `forbidden:session` (`getUser` refused),
`forbidden:membership_read` (the memberships read failed) or `forbidden:role` (not owner or analyst),
and logs the code with the error's name, code and message. The decision lives in
`supabase/functions/_shared/lookup-access.ts`.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run supabase/tests/lookup_access.test.ts` | 6 passed. |
| Mutation: membership-read error reported as `role` | 1 of 6 fails. |
| Mutation: `viewer` allowed to name a channel | 1 of 6 fails. |
| `npm run check` (includes `deno check` of every function) | Exit 0: web 141 / 1100, DB 56 / 475, worker 297, secrets check clean. |

Not done here: deploying the function. CI does not deploy Edge Functions; the owner runs
`supabase functions deploy channel-lookup`.

## 2026-10-05 — Dispatcher follow-up rounds continue the branch

From the cloud checkout of `claude/keen-keller-skwwpm`, Linux, bash 5.

| Command / observation | Actual result |
| --- | --- |
| `npx vitest run scripts` | 5 files, 53 passed (`codex-dispatch.test.ts` 5/5, two new base-selection cases against a bare remote). |
| Mutation: step 2 back to `switch -C "$branch" origin/main` | "continues an existing branch from its own tip" fails (1 of 5). |
| `bash -n scripts/codex-dispatch.sh`, `format:check`, `eslint`, `tsc --noEmit`, `check:secrets` | Clean. |

Not verified here: a real follow-up run on the Mac (`gh pr view` / `gh pr edit` against GitHub). The next review round on a Codex PR is that test.

## 2026-10-05 — Dispatcher runs no repository hook outside the sandbox (PR #75 fix)

From a cloud worktree of `claude/codex-dispatch-hardening`, Linux, bash 5.

| Command / observation | Actual result |
| --- | --- |
| Before the fix: throwaway repo with this branch's `.githooks`, `core.hooksPath .githooks`, a planted `node_modules/.bin/prettier`, then step 6's `git commit` verbatim | The planted file ran: `ESCAPED: "ran OUTSIDE the sandbox as root"`. |
| `npx vitest run scripts` after the fix | 5 files, 51 passed (new `codex-dispatch.test.ts` 3/3). |
| Mutation: step 6 back to `git commit --quiet` | 2 of 3 fail, including the planted-hook test (the hook ran). |
| Mutation: `config core.hooksPath .githooks` restored | 1 of 3 fails. |
| `bash -n scripts/codex-dispatch.sh` | Clean. |

Not verified here: the macOS `workspace-write` read scope with network on (review item 2 on #75).
That needs the canary check on the Mac.

## 2026-10-03 — Deploy target, build configuration and live verification

| Command / observation | Actual result |
| --- | --- |
| Deploy #98 log (before the fix) | Every file `226`; the sweep removed only previous **CI** chunks (`index-Bu5SonCp.js`, …), never the live `index-Bl0nMJSR.js`, so the upload went to a folder the site does not serve. |
| DirectAdmin file manager (owner screenshot) | `public_html` last written 2026-09-24 (its `robots.txt` was 188 B; CI ships 26 B); a stray `en/` sat in `/home/u101542/`. |
| Deploy #99 (after the scoped FTP account) | Upload `226` per file; the sweep removed `index-Bl0nMJSR.js`, `Connected-DCxcLaz3.js`, `vendor-react-Cjl6uT9N.js` and the rest of the stale live build. |
| Deploy #100 (`3af5cfd`, #57) | `Verify the live site serves this build` passed in 1 s. |
| Deploy #101 (`a807eab`, #58, Variables not yet set) | Stopped at the build: `Missing required repository variable: VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`. No migration ran and nothing was uploaded. |
| Deploy #102, attempt 1 | Blocked before the upload: `Secret scan failed in: …Connected-…js, …connect-…js, …index-…js, …pricing-…js` (the first key value matched a secret pattern). Nothing was uploaded. |
| Deploy #102, attempt 2 | Build `vendor-supabase-BMz9DMJ_.js` **226.10 kB** (was 0.00 kB); every upload `226`; `app.sky-develop.net serves /static/index-C2uKPfyQ.js`. |
| `npx vitest run scripts/deploy-workflow.test.ts scripts/verify-deploy.test.ts` | 18 passed. Mutations: weakening the entry comparison fails the incident test; feeding a `VITE_*` value from `secrets.` fails the workflow test. |
| `npm audit` (local, after the lockfile bump) | `found 0 vulnerabilities` (was 1 high: `brace-expansion` 1.1.18 via `eslint` → `minimatch@3`, dev-only). `npm run lint`: all checks passed. |

## 2026-09-24 — Deep Audit, Root-Cause Elimination for Scheduler/Worker Quota Lifecycle & Platform Admin Services Dashboard

| Command / observation                           | Actual result                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web unit tests: `npm test`                      | **128 test files passed, 981 tests passed (100% green)**, including all 6 tests in `AdminServicesPage.test.tsx` verifying services health rendering, KPI cards, filters, and diagnostics dialog.                                             |
| Database test suite: `npm run test:db`          | **45 test files passed, 408 tests passed (100% green)**, including all 14 tests in `worker_topics.test.ts` verifying topic re-analyses and the unblock lifecycle.                                                                              |
| Python worker test suite: `npm run worker:test` | **282 tests passed in 4.40s (100% green)**, including new test `test_gemini_credits_depleted_ends_the_job_blocked`.                                                                                                                            |
| Python worker linter: `npm run worker:lint`     | All checks passed cleanly (0 errors).                                                                                                                                                                                                           |
| Web linter: `npm run lint`                      | ESLint passed cleanly with 0 errors, 0 warnings.                                                                                                                                                                                                |
| Code formatting: `npm run format:check`         | 100% verified with Prettier (all matched files formatted).                                                                                                                                                                                      |
| TypeScript typecheck: `npm run typecheck`       | Passed cleanly (`tsc --noEmit`, 0 errors).                                                                                                                                                                                                      |
| Edge functions check: `npm run check:functions` | 7 edge functions passed `deno check`.                                                                                                                                                                                                           |
| Production build & prerender: `npm run build`   | Built in 1.27s; 8 prerendered static pages generated cleanly; 0 build errors.                                                                                                                                                                   |
| Secrets scan: `npm run check:secrets`           | Secret-pattern checks passed across 776 source files and built assets (0 secrets detected).                                                                                                                                                     |
| Repository check gate: `npm run check`          | **100% green exit code 0** across all gates.                                                                                                                                                                                                    |
| Remote database migration: `npm run db:migrate:remote` | Applied migrations `20260924160000_admin_services_health.sql` and `20260924171000_fix_scheduler_and_quota_lifecycle.sql` to live remote Supabase instance `[ykqugctewsqvevhyqtbi]`. All migrations applied cleanly.                          |
| Platform monitor: `./scripts/monitor.sh`       | **100% OK**: REST 200, gateway 204_no_work, leases none, failures none, worker seen 0m ago, freshness 0h old, site 200, overall=ok (exit code 0).                                                                                             |
| Worker service daemon: `./scripts/worker-service-update.sh` | LaunchAgent active with PID, model loaded (`camelbert-da` + `gemini-3.6-flash`), active and processing jobs.                                                                                                                                   |

## 2026-09-24 — Dynamic Plan Limits Management & Admin Dashboard Enhancement

| Command / observation                           | Actual result                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web unit tests: `npm test`                      | **127 test files passed, 972 tests passed (100% green)**, including 4 tests in `EditPlanLimitsDialog.test.tsx` verifying form values, dynamic aliases, and unlimited toggles.                                                                   |
| Database test suite: `npm run test:db`          | **45 test files passed, 407 tests passed (100% green)**, including all 10 tests in `historical_import_and_plans.test.ts` verifying `update_plan_limits` updating channels, topic units, members, workspaces, and setting unlimited limits.    |
| Python worker test suite: `npm run worker:test` | **281 tests passed in 4.47s (100% green)**.                                                                                                                                                                                                    |
| Python worker linter: `npm run worker:lint`     | All checks passed cleanly (0 errors).                                                                                                                                                                                                           |
| Web linter: `npm run lint`                      | ESLint passed cleanly with 0 errors, 0 warnings.                                                                                                                                                                                                |
| Code formatting: `npm run format:check`         | 100% verified with Prettier (all matched files formatted).                                                                                                                                                                                      |
| TypeScript typecheck: `npm run typecheck`       | Passed cleanly (`tsc --noEmit`, 0 errors).                                                                                                                                                                                                      |
| Edge functions check: `npm run check:functions` | 7 edge functions passed `deno check`.                                                                                                                                                                                                           |
| Production build & prerender: `npm run build`   | Built in 1.19s; 8 prerendered static pages generated cleanly; 0 build errors.                                                                                                                                                                   |
| Secrets scan: `npm run check:secrets`           | Secret-pattern checks passed across 769 source files and built assets (0 secrets detected).                                                                                                                                                     |
| Repository check gate: `npm run check`          | **100% green exit code 0** across all gates.                                                                                                                                                                                                    |
| Remote database migration: `npm run db:migrate:remote` | Applied migration `20260924140000_dynamic_plan_limits_enhancement.sql` to live remote Supabase instance `[ykqugctewsqvevhyqtbi]`. Database up to date (94 migrations applied, 0 pending).                                                |
| Preview host FTPS deploy: `npm run deploy:preview`     | Successfully built bundle and uploaded all static assets, HTML pages, fonts, and cleaned up obsolete hashed chunks over FTPS with exit code 0 (`app.sky-develop.net`).                                                                         |

## 2026-09-24 — Audience Interaction Metrics & Storytelling with Data Integration

| Command / observation                           | Actual result                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web unit tests: `npm test`                      | **127 test files passed, 971 tests passed (100% green)** across contracts and web components.                                                                                                                                                   |
| Database test suite: `npm run test:db`          | **45 test files passed, 404 tests passed (100% green)**, including all 5 tests in `interaction_metrics_and_storytelling.test.ts` testing interaction columns, storytelling aggregates, and video deduplication adoption.                       |
| Python worker test suite: `npm run worker:test` | **281 tests passed in 4.37s (100% green)**, verifying `youtube_api.py` extracting views, likes, descriptions, category, author avatars, channel links, and reply counts.                                                                      |
| Python worker linter: `npm run worker:lint`     | All checks passed cleanly (0 errors).                                                                                                                                                                                                           |
| Web linter: `npm run lint`                      | ESLint passed cleanly with 0 errors, 0 warnings.                                                                                                                                                                                                |
| Code formatting: `npm run format:check`         | 100% verified with Prettier (all matched files formatted).                                                                                                                                                                                      |
| TypeScript typecheck: `npm run typecheck`       | Passed cleanly (`tsc --noEmit`, 0 errors).                                                                                                                                                                                                      |
| Edge functions check: `npm run check:functions` | 7 edge functions passed `deno check`.                                                                                                                                                                                                           |
| Production build & prerender: `npm run build`   | Built in 1.16s; 8 prerendered static pages generated cleanly; 0 build errors.                                                                                                                                                                   |
| Secrets scan: `npm run check:secrets`           | Secret-pattern checks passed across 766 source files and built assets (0 secrets detected).                                                                                                                                                     |
| Repository check gate: `npm run check`          | **100% green exit code 0** across all gates.                                                                                                                                                                                                    |
| Remote database migration: `npm run db:migrate:remote` | Applied migration `20260924010000_interaction_metrics_and_storytelling.sql` to live remote Supabase instance `[ykqugctewsqvevhyqtbi]`. Database up to date (93 migrations applied, 0 pending). Verified interaction columns present.         |
| Preview host FTPS deploy: `npm run deploy:preview`     | Successfully built bundle and uploaded all static assets, HTML pages, fonts, and cleaned up obsolete hashed chunks over FTPS with exit code 0 (`app.sky-develop.net`).                                                                         |
| Playwright E2E test suite: `npm run test:e2e`          | **124 tests passed (100% green)** across all 12 spec files in 1.5m.                                                                                                                                                                            |

## 2026-09-23 — Omnichannel Historical Data Backfill & Import and Dynamic Admin Plan Limits

| Command / observation                           | Actual result                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web unit tests: `npm test`                      | **127 test files passed, 971 tests passed (100% green)**, including all new test suites for `HistoricalImportModal.test.tsx` (5 tests), `historicalCsvJson.test.ts` (13 tests), `EditPlanLimitsDialog.test.tsx` (3 tests), and `historical.test.ts` (6 tests). |
| Database test suite: `npm run test:db`          | **44 test files passed, 399 tests passed (100% green)**, including all 8 tests in `historical_import_and_plans.test.ts` testing admin RPC permissions, plan boundaries, job enqueueing, external record importing, and isolated quota metering. |
| Python worker test suite: `npm run worker:test` | **279 tests passed in 4.53s (100% green)**, including all tests in `test_backfill.py` verifying historical flag handling and watermark-based comment extraction.                                                                               |
| Python worker linter: `npm run worker:lint`     | All checks passed cleanly (0 errors).                                                                                                                                                                                                           |
| Web linter: `npm run lint`                      | ESLint passed cleanly with 0 errors, 0 warnings.                                                                                                                                                                                                |
| Code formatting: `npm run format:check`         | 100% verified with Prettier (all matched files formatted).                                                                                                                                                                                      |
| TypeScript typecheck: `npm run typecheck`       | Passed cleanly (`tsc --noEmit`, 0 errors).                                                                                                                                                                                                      |
| Edge functions check: `npm run check:functions` | 7 edge functions passed `deno check`.                                                                                                                                                                                                           |
| Production build & prerender: `npm run build`   | Built in 1.39s; 8 prerendered static pages generated cleanly; 0 build errors.                                                                                                                                                                   |
| Secrets scan: `npm run check:secrets`           | Secret-pattern checks passed across 763 source files and built assets (0 secrets detected).                                                                                                                                                     |
| Repository check gate: `npm run check`          | **100% green exit code 0** across all gates.                                                                                                                                                                                                    |
| Remote database migration: `npm run db:migrate:remote` | Applied migration `20260923180000_historical_data_import_and_dynamic_plans.sql` to live remote Supabase instance `[ykqugctewsqvevhyqtbi]`. Database up to date (92 migrations applied, 0 pending). |
| Preview host FTPS deploy: `npm run deploy:preview`     | Successfully built bundle and uploaded all static assets, HTML pages, fonts, and cleaned up obsolete hashed chunks over FTPS with exit code 0.                                                                 |
| Playwright E2E test suite: `npm run test:e2e`          | **124 tests passed (100% green)** across all 12 spec files in 1.5m.                                                                                                                                             |

## 2026-09-23 — YouTube Data API Quota Optimization & Incremental Watermark Early Stopping

| Command / observation                           | Actual result                                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python worker test suite: `npm run worker:test` | **276 tests passed in 4.38s (100% green)**, including all 3 new unit tests verifying inline replies extraction, overflow fallback, and watermark early stopping. |
| Python worker linter: `npm run worker:lint`     | All checks passed cleanly (0 errors).                                                                                                               |
| Database test suite: `npm run test:db`          | **43 test files passed, 392 tests passed (100% green)**.                                                                                            |
| Web unit tests: `npm test`                      | **122 test files passed, 937 tests passed (100% green)**.                                                                                           |
| Web linter: `npm run lint`                      | ESLint passed cleanly with 0 errors, 0 warnings.                                                                                                    |
| Code formatting: `npm run format:check`         | 100% verified with Prettier.                                                                                                                         |
| TypeScript typecheck: `npm run typecheck`       | Passed cleanly (`tsc --noEmit`, 0 errors).                                                                                                          |
| Edge functions check: `npm run check:functions` | 7 edge functions passed `deno check`.                                                                                                               |
| Production build & prerender: `npm run build`   | Built in 1.25s; 8 prerendered static pages generated cleanly; 0 build errors.                                                                       |
| Secrets scan: `npm run check:secrets`           | Secret-pattern checks passed across 744 source files and built assets (0 secrets detected).                                                         |
| Repository check gate: `npm run check`          | **100% green exit code 0** across all gates.                                                                                                        |

## 2026-09-22 — Live Execution, FTPS Deployment & E2E Test Suite Alignment


| Command / observation                                                         | Actual result                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Remote database migration: `npm run db:migrate:remote`                        | Applied migration `20260922220000_dashboard_aggregation_covering_indexes.sql` to live remote Supabase instance `[ykqugctewsqvevhyqtbi]`. Database up to date (91 migrations applied, 0 pending). |
| Remote preview deployment: `npm run deploy:preview`                           | Uploaded built bundle and prerendered static assets via FTPS (`226 Transfer complete` on all chunks and HTML files). Exit code 0.                                                                |
| E2E test suite (Dashboard): `npx playwright test tests/e2e/dashboard.spec.ts` | **74 passed, 5 skipped (100% green)** in 1.5m, aligning selectors and pagination expectations (6 cards/page) with the streamlined 5-section layout.                                              |
| E2E test suite (Admin): `npx playwright test tests/e2e/admin.spec.ts`         | **8 passed (100% green)** in 10.3s.                                                                                                                                                              |
| E2E test suite (App Shell): `npx playwright test tests/e2e/app-shell.spec.ts`  | **8 passed (100% green)** in 5.6s, verifying navigation rail, mobile drawer focus trap, and admin door isolation.                                                                                |
| E2E test suite (Remaining specs): `npx playwright test tests/e2e/...`         | **42 passed (100% green)** across account, demo, landing, language, legal, pricing, public-build, seo, tour.                                                                                     |
| Full verification gate: `npm run check`                                       | **100% green exit code 0** (lint, format, typecheck, edge functions, 937 Vitest tests across 122 files, 392 DB tests, 270 worker pytest tests, build, 741 files secrets check).                  |

| Command / observation                                  | Actual result                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database test suite: `npm run test:db`                 | **43 test files passed, 392 tests passed (100% green)**, including all 9 test cases in `user_impersonation.test.ts` testing isolation of `my_workspaces`, admin delegation, forbidden error codes for non-admins, and audit events. |
| Web unit tests: `npm test`                             | **122 test files passed, 937 tests passed (100% green)**, including `AdminShell.test.tsx` (4 tests), `impersonation.test.tsx`, `ImpersonationBanner.test.tsx`, `AdminUsersPage.test.tsx`, `SessionControl.test.tsx`.              |
| Python worker test suite: `npm run worker:test`        | **270 tests passed in 4.34s (100% green)**.                                                                                                                                                                                         |
| Python worker linter: `npm run worker:lint`            | All checks passed cleanly (0 errors).                                                                                                                                                                                               |
| Web linter: `npm run lint`                             | ESLint passed cleanly with 0 errors, 0 warnings.                                                                                                                                                                                    |
| Code formatting: `npm run format:check`                | 100% verified with Prettier.                                                                                                                                                                                                        |
| TypeScript typecheck: `npm run typecheck`              | Passed cleanly (`tsc --noEmit`, 0 errors).                                                                                                                                                                                          |
| Edge functions check: `npm run check:functions`        | 7 edge functions passed `deno check`.                                                                                                                                                                                               |
| Production build & prerender: `npm run build`          | Built in 1.24s; 8 prerendered static pages generated cleanly; 0 build errors.                                                                                                                                                       |
| Secrets scan: `npm run check:secrets`                  | Secret-pattern checks passed across 741 source files and built assets (0 secrets detected).                                                                                                                                         |
| Remote database migration: `npm run db:migrate:remote` | Applied migration `20260922170000_user_impersonation_and_workspace_isolation.sql` to live Supabase instance with exit code 0.                                                                                                       |
| Repository check gate: `npm run check`                 | **100% green exit code 0**.                                                                                                                                                                                                         |

## 2026-09-22 — Channel Setup Mutual Exclusivity & Plan-Gated Public Channel Access

| Command / observation                           | Actual result                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database test suite: `npm run test:db`          | **42 test files passed, 384 tests passed (100% green)**, including all tests in `plan_catalogue.test.ts` testing `allow_public_channels` column and `set_plan_public_channels` permissions. |
| Web unit tests: `npm test`                      | **117 test files passed, 917 tests passed (100% green)**, including 51 tests in `WorkspaceCard.test.tsx` verifying permission gating for Option 2.                                          |
| Python worker test suite: `npm run worker:test` | **270 tests passed in 4.37s (100% green)**.                                                                                                                                                 |
| Python worker linter: `npm run worker:lint`     | All checks passed cleanly (0 errors).                                                                                                                                                       |
| Web linter: `npm run lint`                      | ESLint passed cleanly with 0 errors, 0 warnings.                                                                                                                                            |
| Code formatting: `npm run format:check`         | 100% verified with Prettier.                                                                                                                                                                |
| TypeScript typecheck: `npm run typecheck`       | Passed cleanly (`tsc --noEmit`, 0 errors).                                                                                                                                                  |
| Edge functions check: `npm run check:functions` | 7 edge functions passed `deno check`.                                                                                                                                                       |
| Production build & prerender: `npm run build`   | Built in 1.22s; 8 prerendered static pages generated cleanly; 0 build errors.                                                                                                               |
| Secrets scan: `npm run check:secrets`           | Secret-pattern checks passed across 730 source files and built assets (0 secrets detected).                                                                                                 |
| Repository check gate: `npm run check`          | **100% green exit code 0**.                                                                                                                                                                 |

## 2026-09-22 — Cross-Workspace Deduplication & Catalogue Stored Counts

| Command / observation                           | Actual result                                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database test suite: `npm run test:db`          | **42 test files passed, 382 tests passed (100% green)**, including dedicated multi-tenant adoption test in `cross_workspace_deduplication.test.ts`. |
| Web unit tests: `npm test`                      | **117 test files passed, 914 tests passed (100% green)**, verifying `Catalogue.tsx`, `catalogue.ts`, `ops.ts`, `selection.ts`.                      |
| Python worker test suite: `npm run worker:test` | **262 tests passed in 4.34s (100% green)**.                                                                                                         |
| Python worker linter: `npm run worker:lint`     | All checks passed cleanly (0 errors).                                                                                                               |
| Web linter: `npm run lint`                      | ESLint passed cleanly with 0 errors, 0 warnings.                                                                                                    |
| Code formatting: `npm run format:check`         | 100% verified with Prettier.                                                                                                                        |
| TypeScript typecheck: `npm run typecheck`       | Passed cleanly (`tsc --noEmit`, 0 errors).                                                                                                          |
| Edge functions check: `npm run check:functions` | 7 edge functions passed `deno check`.                                                                                                               |
| Production build & prerender: `npm run build`   | Built in 1.24s; 8 prerendered static pages generated cleanly; 0 build errors.                                                                       |
| Secrets scan: `npm run check:secrets`           | Secret-pattern checks passed across 725 source files and built assets (0 secrets detected).                                                         |
| Repository check gate: `npm run check`          | **100% green exit code 0**.                                                                                                                         |

| Command / observation                           | Actual result                                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Python worker test suite: `uv run pytest -v`    | **248 tests passed in 4.39s (100% green)**, including all tests in `test_x_collector.py`, `test_tiktok_collector.py`, and `test_router.py`.   |
| Python worker linter: `uv run ruff check .`     | All checks passed cleanly (0 errors).                                                                                                         |
| Web unit tests: `npm test`                      | **112 test files passed, 887 tests passed (100% green)**, including 41 tests in `WorkspaceCard.test.tsx` and 14 tests in `catalogue.test.ts`. |
| Database test suite: `npm run test:db`          | **40 test files passed, 370 tests passed (100% green)**.                                                                                      |
| Typecheck: `npm run typecheck`                  | Passed cleanly (`tsc --noEmit`, 0 errors).                                                                                                    |
| Edge functions check: `npm run check:functions` | 7 edge functions passed `deno check`.                                                                                                         |
| Production build & prerender: `npm run build`   | Built in 1.19s; 8 prerendered static pages generated cleanly; 0 build errors.                                                                 |
| Secrets scan: `npm run check:secrets`           | Secret-pattern checks passed across 701 source files and built assets (0 secrets detected).                                                   |
| Repository check gate: `npm run check`          | **100% green exit code 0**.                                                                                                                   |

| Command / observation                                                      | Actual result                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database migration `20260920190000_omnichannel_multi_platform_support.sql` | Tested locally with PGlite. Expanded platform domain check, content kinds, connection status view, stored procedures (`register_public_channel`, `dashboard_aggregates`, `dashboard_comments`, `commit_batch`, `worker_commit_catalogue`). |
| Database test suite: `npm run test:db`                                     | **40 test files passed, 370 tests passed (100% green)**, including all tests in `omnichannel_migration.test.ts`.                                                                                                                           |
| Python worker test suite: `uv run pytest -v`                               | **238 tests passed in 4.26s (100% green)**, including `test_router.py` and `test_telegram_collector.py`.                                                                                                                                   |
| Python worker linter: `uv run ruff check .`                                | All checks passed cleanly.                                                                                                                                                                                                                 |
| Web unit tests: `npm test`                                                 | **112 test files passed, 881 tests passed (100% green)**, including WorkspaceCard and FilterBar omnichannel tests.                                                                                                                         |
| Typecheck: `npm run typecheck`                                             | Passed cleanly (`tsc --noEmit`, 0 errors).                                                                                                                                                                                                 |
| Edge functions check: `npm run check:functions`                            | 7 edge functions passed `deno check`.                                                                                                                                                                                                      |
| Production build: `npm run build`                                          | Built in 1.25s; 8 prerendered static pages generated cleanly; 0 build errors.                                                                                                                                                              |
| Secrets scan: `npm run check:secrets`                                      | Secret-pattern checks passed across 697 source files and built assets (0 secrets detected).                                                                                                                                                |
| Repository check: `npm run check`                                          | **100% green exit code 0**.                                                                                                                                                                                                                |

## 2026-09-20 — Decoupled Big-Data Dashboard Architecture & Server-Side Paginated Stream

| Command / observation                                                            | Actual result                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migration `20260920150000_decoupled_dashboard_architecture.sql`                  | Tested locally and deployed remotely to Supabase project `ykqugctewsqvevhyqtbi`. Added `comments_text_trgm_idx` GIN trigram index, `dashboard_aggregates(w uuid, f jsonb)`, and `dashboard_comments(w uuid, f jsonb)`.   |
| Live benchmark: `public.dashboard_aggregates` on AJ360 channel (71,310 comments) | **1.3s** execution time, payload ~300KB (down from 120MB raw comment dump). Returns full sentiment distribution, timeline, topic counts, video aggregates, hourly & weekday activity buckets, and top negative comments. |
| Live benchmark: `public.dashboard_comments` on AJ360 channel (71,310 comments)   | **35ms** execution time, payload ~40KB (50 comments with next cursor, server-side sorting, and full metadata).                                                                                                           |
| Trigram text search benchmark: `public.dashboard_comments(w, '{"q":"شكرا"}')`    | **28ms** execution time using `comments_text_trgm_idx` (GIN Trigram index).                                                                                                                                              |
| Web unit test suite: `npm test`                                                  | **111 test files passed, 874 tests passed (100% green)**.                                                                                                                                                                |
| Production bundle & prerender: `npm run build`                                   | Built in 1.20s; 8 prerendered static pages generated cleanly; 0 build errors.                                                                                                                                            |
| Typecheck: `npm run typecheck`                                                   | Passed cleanly (`tsc --noEmit`, 0 errors).                                                                                                                                                                               |
| SAST Security scan: `semgrep scan --metrics=off --severity ERROR ...`            | Completed with 0 blocking code findings.                                                                                                                                                                                 |

## 2026-09-20 — Sync Experience Optimization, Real-Time Live Polling, Fair Multi-Tenant Scheduling, and Live Deployment

| Command / observation                                            | Actual result                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration `20260920120000_fair_multitenant_claim_scheduling.sql` | Tested locally with PGlite and deployed remotely to Supabase project `ykqugctewsqvevhyqtbi` via Management API. Applied in transaction, registered in `supabase_migrations.schema_migrations`. |
| Git remote push: `git push origin main`                          | Pushed commits `f1626e8` and `fd0b788` to `https://github.com/mlubbad/arabic-audience-sentiment.git`. Branch `main` is clean and up-to-date.                                                   |
| Production preview deployment: `npm run deploy:preview`          | 100% uploaded cleanly to preview host `app.sky-develop.net` over FTP. Cleaned orphaned chunks. Site answers HTTP 200.                                                                          |
| Live health monitoring: `./scripts/monitor.sh`                   | Rest 200 · Gateway 204 · Leases none · Worker seen 0m ago · Predictions fresh · Site 200 OK.                                                                                                   |
| Web unit tests: `npm test`                                       | 111 test files passed, 874 tests passed (100% green).                                                                                                                                          |
| Database test suite: `npm run test:db`                           | 39 test files passed, 365 tests passed (100% green, including `scoped_claim.test.ts` fair interleaving).                                                                                       |
| Worker tests: `npm run worker:test`                              | 229 tests passed in 4.26s (100% green).                                                                                                                                                        |
| Linter & Typecheck: `npm run lint && npm run typecheck`          | Passed cleanly (0 errors).                                                                                                                                                                     |
| Secret check: `npm run check:secrets`                            | Passed on 685 source files and built assets (0 secrets detected).                                                                                                                              |
| Build: `npm run build`                                           | 8 prerendered pages + SPA template generated cleanly.                                                                                                                                          |

| Command / observation                                                                                        | Actual result                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration `20260920000000_ops_snapshot_and_dashboard_optimization.sql`                                       | Applied locally and deployed remotely to Supabase project `ykqugctewsqvevhyqtbi`. Added `workspace_ops_snapshot(w uuid)` and optimized `dashboard_snapshot(w uuid)`. |
| Remote query benchmark: `workspace_ops_snapshot` on AJ360 workspace (`d0c3b9fc-b813-439e-a32b-71dd357f0bb4`) | **386.9 ms** total execution time, payload ~252 KB. Returns `{ sync, plan, video_counts }` with 2,423 videos counted across 28,244 comments.                         |
| Remote query benchmark: `dashboard_snapshot` on AJ360 workspace                                              | Returned full 55.6 MB payload in **10.2s** without timing out (protected by `set statement_timeout = '30s'`).                                                        |
| Contracts test: `npx vitest run packages/contracts/src/ops.test.ts`                                          | 3 passed (100% green)                                                                                                                                                |
| Database test suite: `npm run test:db`                                                                       | 39 test files passed, 364 tests passed (100% green)                                                                                                                  |
| Web unit tests: `npm test`                                                                                   | 111 test files passed, 871 tests passed (100% green)                                                                                                                 |
| Worker tests: `npm run worker:test`                                                                          | 229 tests passed in 4.29s (100% green)                                                                                                                               |
| Linter & Typecheck: `npm run lint && npm run typecheck`                                                      | Passed cleanly (exit 0)                                                                                                                                              |
| Secret check: `npm run check:secrets`                                                                        | Passed on 679 source files (exit 0)                                                                                                                                  |
| Security audit: `npm audit --omit=dev --audit-level=high`                                                    | 0 vulnerabilities found                                                                                                                                              |

| Command / observation                                            | Actual result                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/monitor.sh` (7 probes, 2.4s)                            | All OK: rest 200 · gateway 204 (claims nothing — the probe's job type cannot exist) · leases none · failures none · worker seen 0m ago · newest prediction 0h · site 200                                                                                                                     |
| crontab                                                          | Installed: `*/5 * * * * cd … && ./scripts/monitor.sh >> .worker-logs/monitor.log 2>&1` — edge-triggered alerts (state in `.cache/monitor-state.*`), optional `ALERT_WEBHOOK_URL` in `.env.local`, exit codes 0/1/2                                                                           |
| Migration `20260919140000_reviews_are_looked_up_not_scanned.sql` | Applied and registered: `comment_reviews(workspace_id, comment_id)` and `topic_reviews(workspace_id, comment_id)`. Before: the dashboard's per-comment review lookup seq-scanned both tables — 18,875 scans per page load. `EXPLAIN` with seqscan off confirms Index Scan on the new indexes |
| PostgREST schema cache                                           | Reloaded on its own after the index DDL (no restart needed for indexes; functions needed one earlier today)                                                                                                                                                                                  |

## 2026-09-19 (2) — Lease semantics and scoped claims hardened

The 2026-09-19 incident class is closed at the source: a replayed platform request no longer reads
as a worker fight, and a claim can no longer take work its caller cannot run.

| Command / observation                                                                  | Actual result                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration `20260919120000_a_replayed_claim_is_not_a_fight.sql`                         | Applied and registered. Adds `jobs.heartbeats`, rebuilt `claim_job` (reclaims count only leases that were heartbeated and then lapsed; silent lapses resume free), heartbeat lease floor raised to 5 minutes (was 60s — an early heartbeat used to shorten the lease), and `private.claim_job(w, job_types)` plus `public.svc_worker_claim(text, text[])` |
| Transactional dry-run on live Postgres (BEGIN → DDL → 6 behavioural probes → ROLLBACK) | All probes correct: scoped claim returns only the asked type; silent lapse → `reclaims=0`, no backoff; heartbeated lapse → `reclaims=1`; early heartbeat leaves 300s lease; unscoped claim unchanged                                                                                                                                                      |
| Migration `20260919130000_the_rpc_argument_is_named_for_the_gateway.sql`               | Applied and registered. The scoped RPC's first parameter was named `token_hash` while the gateway sends `credential_hash`; PostgREST resolves RPCs by parameter name, so every scoped claim answered PGRST202. Overload dropped and rebuilt with the gateway's name                                                                                       |
| `pytest` (workers/python)                                                              | 198 passed (scoped-claim body tests added to `test_gateway.py` and `test_backfill.py`)                                                                                                                                                                                                                                                                    |
| `ruff check .`                                                                         | Pass                                                                                                                                                                                                                                                                                                                                                      |
| `tsc --noEmit`                                                                         | Pass                                                                                                                                                                                                                                                                                                                                                      |
| Edge function `worker` redeployed (Management API, `verify_jwt=false`)                 | v16 ACTIVE; a stray duplicate function created by the first deploy attempt was deleted                                                                                                                                                                                                                                                                    |
| Live differential: `POST /worker/claim` `{"types":["collect"]}`                        | **204** — no collect job exists, and the queued analyse job is left untouched (the exact theft this prevents)                                                                                                                                                                                                                                             |
| Live differential: `POST /worker/claim` `{"types":["analyse"]}`                        | 200 with the analyse job; the orphan lease this probe left lapses and resumes without penalty under the new semantics                                                                                                                                                                                                                                     |
| `vitest` / `npm run test:db`                                                           | **Not run in this session** — no pinned Node 22 on this machine. `lease_recovery.test.ts` was rewritten for the new contract (silent lapse never counts; heartbeated lapse counts; heartbeats reset per lease), and `scoped_claim.test.ts` added. Run under `nvm use` before the next deploy                                                              |

PostgREST schema-cache notes, for the next schema change: `NOTIFY pgrst, 'reload schema'` did not
refresh the cache through the Management API path, but functions created there did appear without a
restart after a few minutes — the restart was what made it immediate. A parameter-name mismatch
surfaces as PGRST202, not as a SQL error; check `pg_get_function_identity_arguments` first.

## 2026-09-19 — Arabic normalization wired into inference; live re-analysis under v2

Node not available in this session (pinned Node 22 not installed on this machine); Python work verified
with uv-managed 3.12 (`uv sync --frozen`, plus `--group inference` for the live run).

| Command / observation            | Actual result                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`                   | Pass (exit 0)                                                                                              |
| `node scripts/check-secrets.mjs` | Pass (643 source files + built assets)                                                                     |
| `pytest` (workers/python)        | 196 passed in 0.24s                                                                                        |
| `ruff check .` (workers/python)  | All checks passed                                                                                          |
| `vitest` / `npm run test:db`     | **Not run in this session** — the machine lacks pinned Node 22; run under `nvm use` before the next deploy |

### Code change

- `sentiment/transformer.py`: `LogitsAdapter.predict` now calls `normalize_arabic_text` — the
  normalization helpers (tatweel, tashkeel, elongation) existed and were tested but were never in the
  inference path, exactly the drift `docs/coordination/ACTIVE.md` warned about.
- `sentiment/preprocess.py`: `normalize_arabic_text` now strips tashkeel too (it previously did not,
  despite the helper existing), and `PREPROCESSING_VERSION` bumped to `strip-html-arabic-norm-v2` in
  the same change so stored v1 predictions remain attributable to the pipeline that made them.
- New guard test `test_the_model_is_asked_about_the_normalized_text_not_the_raw_one` in
  `tests/test_transformer.py`; `test_sentiment.py` expectations updated for v2 (tanwīn stripped,
  negation particles and emoji preserved).
- `tests/fixtures/golden_batch.json` regenerated through `test_golden_batch.rebuild()` (never
  hand-edited); new payload hash `6cdd7f81…`. The TS seam test reads the fixture dynamically.

### Live re-analysis (pilot workspace “الجزيرة 360”, channel UCWxc7ue-jGlL5ypOHX_i0Bg)

| Step                                         | Actual result                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase PostgREST                           | Found returning 504 after 60s for every request (worker path dead since 2026-09-18 ~16:00). `POST /v1/projects/…/restart` (200) restored it; claim answered in 2.4s |
| Selection reset (operator SQL)               | 459 comment-bearing videos due, 4,009 empty videos deferred 2h; collect job checkpoint reset, reclaims zeroed                                                       |
| `manual_run --backfill --model camelbert-da` | Comment counts survey: 0 unchanged, 459 to read; job finished **succeeded**                                                                                         |
| Predictions under v2                         | **18,850** succeeded (v1 history preserved at 17,627); 1,223+ comments were new since the first collection; total comments now 18,875                               |
| Label distribution v1 → v2                   | negative 45.6% → 47.4%, neutral 17.9% → 17.9%, positive 36.5% → 34.8% (same model; shift from normalization + new rows)                                             |
| `channels.active_analysis_key`               | Switched to `…@b0df630d…+strip-html-arabic-norm-v2+a272ec5cfcf7` — the dashboard's effective labels now come from v2                                                |
| Effective-label coverage                     | 18,850 of 18,875 comments carry a v2 verdict                                                                                                                        |
| Incidental: analyse job `99cfa273`           | Claimed and finished by the first (mis-aimed) backfill attempt; reset to queued so topics classification still runs                                                 |
| Incidental: Supabase restart                 | Project restarted (~1 min) to clear a wedged PostgREST/pool; data untouched                                                                                         |
| Signed-in dashboard walkthrough              | **Not done** — needs a browser session with a real user token; the `forbidden` response to a no-JWT snapshot call confirms tenant isolation is intact               |

## 2026-09-14 — Private preview deployment and live origin verification

Deployed to private preview hosting (`app.sky-develop.net`, origin `91.204.209.217`) via `npm run deploy:preview`:

| Probe / Request                       | Actual result                                               |
| ------------------------------------- | ----------------------------------------------------------- |
| `GET /` without basic auth            | **401 Unauthorized** (private protection strictly enforced) |
| `GET /` with basic auth               | **200 OK**                                                  |
| `GET /index.html`                     | **200 OK** (803 bytes)                                      |
| `GET /fixtures/dashboard.json`        | **200 OK** (11,283 bytes)                                   |
| `GET /landing/arabic-bold.ttf`        | **200 OK** (229,352 bytes)                                  |
| `GET /robots.txt`                     | **200 OK** (26 bytes)                                       |
| `GET /dashboard` (SPA route fallback) | **200 OK** (serves `index.html`)                            |
| `GET /sync` (SPA route fallback)      | **200 OK** (serves `index.html`)                            |
| `GET /account` (SPA route fallback)   | **200 OK** (serves `index.html`)                            |
| `GET /.htaccess`                      | **403 Forbidden** (direct configuration access prevented)   |
| `GET /assets/report-KE-usfQc.css`     | **200 OK** (19,393 bytes)                                   |
| `GET /assets/Dashboard-MT9GcQVq.js`   | **200 OK** (231,257 bytes)                                  |
| `GET /assets/index-BuQPClQp.js`       | **200 OK** (509,440 bytes)                                  |
| Stale asset cleanup                   | 8 obsolete bundles deleted via FTP DELE (`gone`)            |

## 2026-09-14 — Comment confidence score display and live test alignment

Node 22.14.0, Python 3.12.10. Verified on `main`:

| Command / observation                      | Actual result                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                            | Pass: lint, format, typecheck, Deno check, 225 unit tests, 139 SQL tests, 127 Python tests, Vite build, secret scan |
| `E2E_PORT=5350 npm run test:e2e`           | 68 passed in 59.5s                                                                                                  |
| `E2E_LIVE_PORT=5355 npm run test:e2e:live` | 1 passed in 3.9s; workspace switching and sign-out isolation verified with new navigation destinations              |

## 2026-09-14 — Arabic NLP sentiment engine and text normalization verification

Node 22.14.0, Python 3.12.10. Verified on `main`:

| Command / observation                                      | Actual result                                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pytest tests/test_sentiment.py tests/test_transformer.py` | 27 passed; verified Arabic normalization, tatweel/tashkeel stripping, elongation reduction, 4-class prediction and error handling         |
| `npm run worker:test`                                      | 127 passed in 0.67s across 14 test suites                                                                                                 |
| `npm run worker:lint`                                      | Ruff: All checks passed!                                                                                                                  |
| `npm run check`                                            | Full check passed: lint, Ruff, format, typecheck, Deno check, 225 unit tests, 135 SQL tests, 127 Python tests, Vite build and secret scan |
| `E2E_PORT=5340 npm run test:e2e`                           | 68 passed in 1.0m (Chromium E2E suite covering app shell, dashboard, landing, and mobile UX)                                              |

## 2026-09-14 — Internal UI redesign and Sync identity boundary

All commands used Node 22.14.0 via `PATH=/Users/mlubbad/.nvm/versions/node/v22.14.0/bin:$PATH`.
The browser suites started their own Vite servers on the indicated ports with
`reuseExistingServer: false` and `--strictPort`.

| Command / observation                                                                                                                                                   | Actual result                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_PORT=5334 npm run test:e2e -- tests/e2e/app-shell.spec.ts --reporter=line` before the mobile filter control                                                        | Failed waiting for `إظهار الفلاتر`; after implementation, 1 passed                                                                                                        |
| `npm run check` first attempt                                                                                                                                           | Lint, format, typecheck and Edge Function check passed; 3 server-rendered Dashboard identity unit tests failed because `window` was read during state initialization      |
| `npm test` after guarding browser-only viewport access                                                                                                                  | 150 passed in 19 files                                                                                                                                                    |
| `npm run check` after the fix                                                                                                                                           | Passed: lint, Ruff, format, typecheck, Deno check, 150 unit, 126 SQL, 124 Python tests, Vite build and secret scan                                                        |
| `E2E_PORT=5335 npm run test:e2e -- --reporter=line` first full run                                                                                                      | 47 passed, 2 failed: old mobile navigation test bypassed the new menu, and the disconnected-worker test expected obsolete machine-specific copy                           |
| `E2E_PORT=5335 npm run test:e2e -- tests/e2e/dashboard.spec.ts --grep 'mobile shell\|states plainly' --reporter=line`                                                   | 2 passed after updating those assertions to the intended UX                                                                                                               |
| `E2E_PORT=5335 npm run test:e2e -- --reporter=line` final full run                                                                                                      | 50 passed in 41.6s, including mobile filter disclosure, callback and 404 recovery                                                                                         |
| `E2E_LIVE_PORT=5336 npm run test:e2e:live -- --reporter=line`                                                                                                           | 1 passed; fake local Auth/API responses proved the Sync workspace choice appears before any snapshot and tenant A's comments never paint under tenant B or after sign-out |
| Desktop screenshots at 1280×800; mobile browser pass at 390px                                                                                                           | Account, Sync and Dashboard hierarchy inspected; hero title/description stacking corrected; mobile menu, filter disclosure and horizontal-overflow assertion passed       |
| `npm run check` and `E2E_PORT=5335 npm run test:e2e -- tests/e2e/app-shell.spec.ts --reporter=line` after the mobile spacing adjustment                                 | Full check passed again with the same counts; 2/2 targeted browser tests passed. A 390px Sync screenshot confirmed the reduced empty space in the health card             |
| `npm run format:check`, `npm run build`, and `E2E_PORT=5335 npm run test:e2e -- tests/e2e/app-shell.spec.ts --reporter=line` after styling the no-Auth account fallback | All passed; 2/2 browser tests. The credential-free account state was inspected in a 1280px screenshot                                                                     |

The live-mode browser test intercepts a local fake Supabase origin. It does **not** prove
that the redesigned pages work against the deployed project's Auth, PostgREST, OAuth or
worker. The dashboard and operations sample remain sanitized fixtures for a visitor. No
deployment or real-model validation was performed in this increment.

## 2026-09-14 — Dashboard identity, video choices, and honest introduction

On `0ea0ca0` plus the shared working-tree changes (Claude Code was editing the new report and model path concurrently), Node 22.14.0:

| Command / observation                                                                                                                                               | Actual result                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx vitest run apps/web/src/Dashboard.identity.test.ts --reporter=dot` before the identity fix                                                                     | 2 failed initially: a previous tenant's comment rendered under the next workspace and after sign-out. After adding the pending-workspace case, 3 failed; the new case showed the fixture path while a signed-in workspace list was still loading |
| `npx vitest run apps/web/src/session.test.ts --reporter=dot` before the workspace-loading fix                                                                       | 1 failed: a signed-in user was initially reported as having finished loading before the workspace request began                                                                                                                                  |
| `E2E_PORT=5332 npm run test:e2e -- tests/e2e/dashboard.spec.ts --grep 'actual pending fetch\|video filter offers'` before the copy/video fixes                      | Both failed: the hero reported zero while a request was held, and the selector lacked the unfamiliar video id supplied by the test fixture                                                                                                       |
| `npx vitest run apps/web/src/session.test.ts apps/web/src/Dashboard.identity.test.ts --reporter=dot` after the fix                                                  | 4 passed                                                                                                                                                                                                                                         |
| `E2E_PORT=5332 npm run test:e2e -- tests/e2e/dashboard.spec.ts --grep 'Arabic fixture shell filters\|actual pending fetch\|video filter offers'` after the fix      | 3 passed                                                                                                                                                                                                                                         |
| `npm run check`                                                                                                                                                     | Passed: lint, format, typecheck, Edge Function check, 140 unit tests, 116 SQL tests, 108 worker tests, build, and secret scan                                                                                                                    |
| `E2E_PORT=5332 npm run test:e2e` initial full run                                                                                                                   | 47 passed, 1 failed: review history was reopened before the invalidated snapshot had refreshed                                                                                                                                                   |
| `E2E_PORT=5332 npm run test:e2e -- tests/e2e/dashboard.spec.ts --grep 'history says who reviewed'` after keeping the correction form open until refresh             | 1 passed                                                                                                                                                                                                                                         |
| `E2E_PORT=5332 npm run test:e2e` final full run                                                                                                                     | 48 passed (52.5s)                                                                                                                                                                                                                                |
| `npx vitest run apps/web/src/Dashboard.identity.test.ts apps/web/src/dataSource.test.ts --reporter=dot` after retaining the workspace selector and showing its name | 12 passed; the new selector/name assertion was observed failing before implementation                                                                                                                                                            |
| `npm run test:e2e:live`                                                                                                                                             | 1 passed (3.8s): fake local Auth/PostgREST responses, A then delayed B, then sign-out; A's text was absent during B loading and after sign-out                                                                                                   |

The identity test renders the real Dashboard component with a controlled previous query result, so it asserts the user-visible absence of another tenant's text. The dynamic-video and loading tests run the actual Vite UI against sanitized fixtures. The separate live-mode browser test signs in through a local fake API and delays the second workspace's response; it exercises the actual UI and query lifecycle without external credentials. It is **mocked integration**, not proof against a deployed Supabase project. Model inference against real comments and the corrected private deploy also remain unproven by these checks.

## 2026-09-14 — Landing asset and current-state copy

At `0ea0ca0` plus the landing working-tree changes, with concurrent uncommitted live-dashboard work outside this increment:

| Command / observation                                                                              | Actual result                                                                                     |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `E2E_PORT=5322 npm run test:e2e -- tests/e2e/landing.spec.ts`                                      | 2 passed (5.5s), including working links, FAQ, mobile navigation, accessibility and image loading |
| `npx prettier --check apps/web/src/Landing.tsx apps/web/src/landing.css tests/e2e/landing.spec.ts` | Passed after formatting the landing test                                                          |
| `npx eslint apps/web/src/Landing.tsx tests/e2e/landing.spec.ts`                                    | Passed                                                                                            |
| `npm run build`                                                                                    | Passed, 171 modules transformed, 2.65s                                                            |
| Chromium screenshots at 1440px and 390px                                                           | Full page visually inspected; original bright glass chart sits in the hero without clipping       |
| `shasum -a 256 apps/web/public/landing/audience-growth-original.png`                               | `5f800bc3d9fb7e2004c5de245653021f123f2a4cedbf29f7aee8e6ca5f22cdbe`                                |

Formatting checks initially found wrapping issues in the landing test and then the illustration mask rule; both were corrected before the final passing checks. This increment did not re-run the full repository suite or redeploy the site, because the signed-in dashboard is being edited concurrently. The 65 live comments and tenant boundary were verified by the other development session, as described in the user-supplied handoff; this landing verification did not independently exercise its live OAuth, worker, model or authenticated dashboard path.

## 2026-09-13 — Marketing landing and route integration

Node 22.14.0; load average sampled at 3.13 / 3.30 / 3.25. Code reviewed against `cffb9fa` plus the landing working-tree changes. Concurrent Python/OAuth commits are outside this increment.

| Command / observation                                                                                     | Actual result                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` after final code changes                                                                  | Pass: lint, formatting, typecheck, 107 unit tests, 98 SQL tests, 91 worker tests, build and secret scan                                                                                                       |
| `E2E_PORT=5322 npm run test:e2e` after route integration and lazy loading                                 | 47 passed (45 existing dashboard cases + 2 landing cases), 50.7s                                                                                                                                              |
| `E2E_PORT=5322 npm run test:e2e -- tests/e2e/landing.spec.ts` after final illustrative-chart/copy changes | 2 passed, 5.9s; includes chart/comment filter agreement, FAQ, audience tabs, account and dashboard navigation, reload, mobile menu, keyboard skip link, image loading, and 320/390/768/1440px overflow checks |
| Visual inspection                                                                                         | Chromium screenshots at 1440px desktop and 390px mobile; inspected hero, Arabic hierarchy and full-page section layout                                                                                        |
| Build output                                                                                              | Landing entry JS 272.93 kB (86.85 kB gzip); Dashboard, Account and Supabase emitted as separate deferred chunks                                                                                               |

The first full browser run had one failed landing test: an exact text locator included the decorative FAQ `+` and could not match. It was corrected to target the semantic summary element. The other 46 tests passed on that run; all 47 passed on the rerun. No application failure was hidden by increasing a timeout.

Evidence is local/fixture-backed. No live YouTube, model, account session, or remote deployment was validated by this landing work. `.htaccess` protection was preserved; `noindex` metadata was added. Asset/reference provenance is in `docs/landing.md`.

Run 2026-09-13 on macOS 24.6.0, Node 22.14.0, npm 10.9.2, Python 3.12.10, uv 0.11.11,
load average 2.80.

The machine default is Node 26 / npm 11, which `engine-strict=true` correctly rejects. All
commands were run with Node 22.14.0 first on `PATH`, matching `.nvmrc`.

## Checks

| Command                   | Result                                                      |
| ------------------------- | ----------------------------------------------------------- |
| `npm run lint`            | Pass — ESLint clean; Ruff "All checks passed!"              |
| `npm run format:check`    | Pass                                                        |
| `npm run typecheck`       | Pass — no `tsc` diagnostics                                 |
| `npm run check:functions` | Pass — `deno check` on the three Edge Function entry points |
| `npm test`                | Pass — **83 tests, 10 files**                               |
| `npm run test:db`         | Pass — **103 tests, 11 files**                              |
| `npm run worker:test`     | Pass — **94 tests, 11 files**                               |
| `npm run build`           | Pass                                                        |
| `npm run check:secrets`   | Pass                                                        |
| `npm run test:e2e`        | Pass — **47 tests, Chromium** (45 dashboard, 2 landing)     |

`npm run check` runs everything except `test:e2e` and passed end to end.

## Method: mutation, not just passing

A test that cannot fail is not coverage. Every security or correctness guarantee claimed
below was checked by breaking the code and confirming a test caught it. Each mutation was
reverted and the suite returned to green.

| Mutation                                                    | Tests broken |
| ----------------------------------------------------------- | ------------ |
| Let a quota shortfall through instead of refusing the batch | 1            |
| Accept a reused batch key carrying a different payload      | 1            |
| Allow an OAuth state to be reused                           | 1            |
| Drop the cross-workspace seizure check on channel claim     | 1            |
| Drop the cross-workspace check on a leased job              | 2            |
| Let a revoked worker credential through                     | 2            |
| Let a failed collection report success                      | 1            |
| Put the endpoint into a client error message                | 2            |
| Pass the raw worker credential to the database              | 1            |
| Return the internal error message from the edge handler     | 1            |
| Open the audit trail to any member                          | 1            |
| Drop the import path scoping                                | 1            |
| Remove the lease-duration guard                             | 1            |
| Neutralise the retry backoff                                | 1            |
| Accept a prediction for a comment absent from the batch     | 1            |
| Accept the same comment twice in one batch                  | 1            |
| Flatten the golden fixture back to the pre-split shape      | 3            |
| Hash a prediction over different text than its comment row  | 1            |
| Accept an adapter returning fewer verdicts than rows        | 1            |
| Let a failed analysis finish the run as succeeded           | 1            |
| Commit an empty prediction list, as before the wiring       | 1            |
| Go back to never writing analysis parameters                | 2            |
| Drop parameters from the prediction-to-run join             | 1            |
| Fingerprint an analysis without its settings                | 1            |
| Prune a connection that is still in flight                  | 1            |
| Reuse one nonce for every sealed grant                      | 1            |
| Accept a grant with no refresh token                        | 1            |
| Return Google's error body as the reason                    | 2            |
| Trust the first channel when an account has several         | 1            |
| Overwrite the stored refresh token on renewal               | 1            |
| Retry a revoked grant instead of ending it                  | 1            |
| Treat an expired token as a blocked channel                 | 1            |
| File comments-disabled as an access refusal                 | 1            |
| Send the API key alongside the bearer token                 | 1            |
| Leave the prune job executable by tenants                   | 1            |
| Show a verdict about text the comment no longer has         | 1            |
| Turn unknown engagement into zero on the live read          | 1            |
| Leave the platform parent id unresolved                     | 1            |
| Let a configured project alone flip the data source         | 4            |
| Let the browser suite inherit the machine's .env.local      | 1            |
| Report accuracy as the headline instead of macro F1         | 1            |
| Skip classes the model never predicts                       | 1            |
| Count an unclear gold row as a model error                  | 1            |
| Use the normal approximation for the interval               | 1            |
| Purge the text but leave the author                         | 1            |
| Let a purge take the prediction with it                     | 2            |
| Stop a refresh clearing the purge marker                    | 3            |
| Ignore the retention window and purge everything            | 1            |
| Trust the server's answer without parsing it                | 1            |
| Show the model's answer in the labelling sheet              | 1            |
| Stop neutralising spreadsheet formulas in the sheet         | 1            |
| Drop unanalysable rows without counting them                | 1            |
| Let the booster reuse estimate rows                         | 1            |
| Sample uniformly instead of proportionally by video         | 1            |
| Match the loopback redirect by substring instead of host    | 1            |
| Accept any http redirect URI                                | 2            |
| Send the verifier instead of its challenge                  | 1            |
| Store the OAuth state raw instead of hashed                 | 1            |
| Allow an http redirect URI                                  | 1            |
| Drop the verifier charset and length check                  | 1            |

## What the suites prove

**Contracts (74).** One filter implementation drives views and exports, so they cannot
disagree. Half-open date ranges, unknown dates as their own category, the newest human review
matching the _current_ text winning, stale and failed predictions excluded from the sentiment
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

| Area                                              | Why                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live YouTube collection                           | No API key; no live request has ever been issued                                                                                                                                                                                                           |
| Google OAuth exchange                             | Authorization URL, code exchange, PKCE, `channels.list` and the redirect page are not written. Only the server-side state and ownership logic exists                                                                                                       |
| Deployed Supabase                                 | No project. GoTrue, PostgREST, Storage HTTP and Edge Function deployment are untested                                                                                                                                                                      |
| Real HTTP between the worker and the edge handler | `end_to_end.test.ts` now runs the real handler against the real SQL with a payload the real Python client produced, so the two no longer only meet through stand-ins. What is still untested is an actual network hop and a deployed Edge Function runtime |
| Database behaviour beyond SQL and RLS             | PGlite runs the real SQL and RLS but is not Supabase                                                                                                                                                                                                       |
| Concurrent overspend                              | PGlite is single-connection, so two simultaneous transactions cannot be staged. The row lock is the mechanism; the tests prove no _sequence_ exceeds an allowance                                                                                          |
| Sentiment model quality                           | No model downloaded, no inference run, no benchmark. No accuracy figure is claimed anywhere                                                                                                                                                                |
| Legacy import and the topic-count discrepancies   | Source CSVs and amendment file missing; no reconciliation performed                                                                                                                                                                                        |
| CI                                                | `.github/workflows/ci.yml` exists but has never executed — there is no remote                                                                                                                                                                              |
| Deployment                                        | The **front end only** is deployed, at `app.sky-develop.net`, behind a password and serving fixtures. No Edge Function, no worker, no live data path is deployed                                                                                           |
| Spreadsheet behaviour                             | Formula neutralisation is verified as bytes in the file. No spreadsheet application was opened                                                                                                                                                             |
| Final dashboard styling                           | Original dashboard HTML, ZIP and brand assets not supplied                                                                                                                                                                                                 |

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
right and the _linkage_ was not, so a verdict could be filed under the wrong run. The test
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

| Request                                              | Result                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `GET /rest/v1/comments`, `workspaces`, `memberships` | 401, SQLSTATE 42501                                            |
| `GET /rest/v1/jobs`                                  | 401 — no grant exists at all                                   |
| `GET /rest/v1/connection_status`                     | 401 — the view is security_invoker, so it inherits the refusal |
| `GET /rest/v1/oauth_states`                          | 404 — the `private` schema is not exposed by PostgREST         |
| `POST /rest/v1/rpc/dashboard_snapshot`               | 401, permission denied for function                            |
| `POST /rest/v1/rpc/usage_summary`                    | 401, permission denied for function                            |

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

| Probe                                              | Result                              |
| -------------------------------------------------- | ----------------------------------- |
| Does the bootstrap trigger fire for a second user  | Yes — their own personal workspace  |
| Can B list A's workspaces                          | `[]`                                |
| Can B read A's dashboard by asking for it directly | **403, SQLSTATE 42501 `forbidden`** |

That is the property the whole tenancy model exists for, and it is now proven against a real
PostgREST with two real users rather than inferred from PGlite. It was tested by asking
directly, not by checking that a control was hidden.

**The handler and the SQL have now spoken over a real network hop.** Three Edge Functions are
deployed — `worker`, `oauth-start`, `oauth-callback` — and answered from the live project:

| Request                                    | Result                                               |
| ------------------------------------------ | ---------------------------------------------------- |
| `POST /worker/worker/claim`, no credential | 401 `invalid_worker_credential`                      |
| Same, with a credential never issued       | 401, **the same shape** — nothing distinguishes them |
| `POST /worker/worker/typo`                 | 404 `not_found`, not a malformed-request error       |
| `GET` on a POST-only route                 | 405                                                  |
| `POST /oauth-start` with no session        | 401 `unauthenticated`                                |
| `GET /oauth-callback` with no code         | an Arabic page, 400, no stack trace                  |

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

| Step                                                              | Result                                                                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign up, then read the workspace and client the account was given | One of each                                                                                                                                                      |
| `POST /functions/v1/oauth-start` with that session                | 200, a Google authorization URL                                                                                                                                  |
| Parameters                                                        | `response_type=code`, `code_challenge_method=S256`, `access_type=offline`, `prompt=consent`, the deployed callback as `redirect_uri`, the youtube.readonly scope |
| Is the verifier in the URL                                        | **No** — 43-char state and challenge only                                                                                                                        |
| Fetching that URL from Google                                     | **200, redirected to Google's own sign-in**                                                                                                                      |

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
approximation breaks _near_ the edge — at 19/20 it returns an upper bound of about 1.045 —
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
write that sets both text and marker is _corrected_ rather than refused — refusing would fail
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
demo real channel data?" with _no, synthetic and clearly labelled_; "can I connect my channel
now?" with _not yet_; and "is sentiment analysis always accurate?" with _no_, naming sarcasm,
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
and it held only the _first_ request; the second returned 503 immediately and settled the
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
_verified with curl_ was not _works in a browser_, and only a browser was going to find it. An
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
that had just been fixed. The preflight kept working, because that call site _had_ been
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
new bundle answers 401 (basic auth, as every path does) while the _previous_ bundle
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
before this session's worker came up at 20:19:53Z — walked 30 _recent uploads_ (the old
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
called with a _dead_ lease hung for over two minutes before answering 500
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

Not verified: a `collect` run by the _new_ worker over a due list end to end (the old
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

## 2026-09-16 — topic classification smoke call

`workers/python/scripts/gemini_smoke.py` sent one POST request to `generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` with an Arabic classification prompt, a JSON schema constraint for topic selection, and the configured API key in the `x-goog-api-key` header. Response: **status 403**, reason `API_KEY_SERVICE_BLOCKED`. The error is the API restriction in the Google Cloud console, not a failure of the key or the endpoint; it is the expected outcome for a key whose API access is not yet enabled. The fix is enabling the Generative Language API on the key's restrictions. Live-tested.

## 2026-09-16 — paging, links, the player

`npm run check` exit 0 (unit 331 / 41 files · db 178 / 17 · worker 142 · lint, format,
types, functions, build, secrets 0); `npm run test:e2e` exit 0, 84 tests (82 + 2). Unit:
`pageOf` cuts fifty, clamps past both ends and to NaN, gives an empty list one empty page;
`videoLinks` sends a short to `/shorts/`, everything else to `/watch`, and embeds through
`youtube-nocookie.com` with autoplay. Browser: 120 routed rows → page 1 of 3 with 50 rows and
the newest first; a tick on page 1 still counted on page 2; jump to 3 → 20 rows, next
disabled; "select this page" adds 20, not 120; a search goes back to page 1 of what matches.
Links: `cat-link-video-2` (a short) → `/shorts/fixture0002`, `video-3` → `/watch?v=…`,
`target=_blank`, `rel` carries `noopener`; no iframe until a row is opened; opening shows
the title and an iframe at `youtube-nocookie.com/embed/fixture0003?autoplay=1&rel=0`; Esc
hides it and removes the iframe; the close button too, with the tick untouched. Seen on the
dev server at 1280px (one line per row, link beside the title, the dialog with its 16:9
frame — grey, the fixture ids are not real videos) and 375px (three lines per row, pager,
sticky bar). `layers.test.ts` holds: the backdrop is `color-mix` over a token, no raw
colour. Not verified: a real embed playing (needs a real id — the live AJ360 page after the
next deploy).

## 2026-09-16 — preview deploy of 9b33540

The user ran `npm run build && npm run deploy:preview`: 32 files at 226, including
`static/index-C4A43vPo.js` (554,317 bytes), `static/Sync-Br8MqkKj.js` (20,594) and
`static/index-O6BZyaxP.css` (64,581); the sweep removed the twelve superseded hashed
assets of the previous build. Those three were fetched back over basic auth and are
byte-identical to the local `dist`; the served Sync chunk carries `cat-pager`,
`cat-select-page` and `youtube-nocookie.com/embed`. `/sync?demo=1` on the host renders
the pager ("الصفحة 1 من 1"), the link beside each title, and the same bar. The live AJ360
page with real ids — 90 pages and a real embed — is the user's to open; not seen from here.

## 2026-09-16 — the player centred and smaller, a play badge on the thumbnail

Seen live by the user on AJ360 first: the dialog opened at the inline start and wide. The
app's reset zeroes every margin and a `<dialog>` centres itself with `margin: auto`; the
rule now sets `position: fixed; inset: 0; margin: auto; width: min(88vw, 720px)`. The
thumbnail sits in a wrapper with a play badge (`.cat-play`, a bordered triangle on a
translucent `color-mix` of the ink token) at opacity 0, 1 on hover or focus of the row's
button, 0.85 under `(hover: none)`. Browser test extended: the badge's computed opacity
0 → 1 on hover; the dialog's left and right margins equal within 4px at 1280px and its
width ≤ 720. `npm run check` exit 0 · `npm run test:e2e` exit 0 (84). Seen on the dev server:
badge on hover, dialog centred over the page.

## 2026-09-16 — preview deploy of e82168f, from this session

The user's two runs of `deploy:preview` left the host untouched: the FTP listing still
showed the 22:13 files, and the "new chunk answers 200" check was the `.htaccess` SPA
fallback returning `index.html` — a probe that proves nothing (recorded so it is not
trusted again; a 200 on `/static/<hash>.js` must be followed by a byte comparison). Run
from this session: 32 files at 226, eleven superseded assets swept. Served
`index-wjqPVJpc.js`, `index-wnnYzwdH.css` and `Sync-BpieInGg.js` are byte-identical to the
local `dist`; the Sync chunk carries `cat-play`, the CSS `margin:auto` and
`min(88vw,720px)` on `.cat-preview`. In the in-app browser at 1280px the dialog opens
centred at 720px with YouTube's player loaded ("This video is unavailable" — the fixture's
id is not a real video; the user saw a real one play on AJ360 earlier).

Also read from the live catalogue, for `docs/pricing.md`: 4,456 videos carrying 167,302
reported comments (112,387 videos · 53,775 shorts · 1,140 streams), the heaviest 10,631,
no unknown counts — paged through PostgREST in five ranges of 1,000.

## 2026-09-16 — the worker service

First attempt, plist pointing at the working checkout: `state = spawn scheduled, last
exit code = 126`, log `shell-init: error retrieving current directory: getcwd: cannot
access parent directories: Operation not permitted` and the same on the script — launchd
agents are kept out of `~/Documents`. Moved to a detached worktree under
`~/Library/Application Support/sentiment-worker/checkout` (`git worktree add --detach`).
Second attempt: `ModuleNotFoundError: No module named 'torch'` three runs in a row, thirty
seconds apart — `uv sync --frozen` installs no model runtime by design; the update script
now syncs `--group inference`. Third: `loaded CAMeL-Lab/…@b0df630d23e5`, `worker up, …
tenants=2`, `state = running`, and `worker_seen` advanced on both workspaces within a
minute. Then `launchctl kill KILL` on the running agent: `runs = 2`, a new pid, `worker up`
again 5 s later; the orphaned python child of the killed run logged `worker down (stopped)`
when launchd reaped it. `pgrep` shows one uv and one python afterwards, no orphan. Not
verified: a reboot (RunAtLoad) — the plist says so, the day has not.

## 2026-09-16 — topic classification: the live run, blocked; everything else, fixture-tested

**Live-tested:** nothing beyond the smoke call recorded above under "2026-09-16 — topic
classification smoke call" (`403 API_KEY_SERVICE_BLOCKED` from Google, the key's own API
restriction, not a key or endpoint failure). The three migrations `20260916010000`,
`20260916011000` and `20260916012000` have **not** been applied to the live Supabase
project (no `supabase db push --linked` has been run for them), the `worker` Edge Function
has **not** been redeployed with the `/worker/topics-due` and `/worker/commit-topics`
routes `supabase/functions/_shared/worker-gateway.ts` and `worker/index.ts` now carry, and
no `analyse` job has been claimed or run by any worker against the real project. Per the
controller's ruling for this task, none of those three actions were taken here: the Gemini
key is blocked at the API-restriction level (Task 1), and pushing migrations or deploying
the edge function to the production project is the user's decision, still pending. The
live-run steps the task brief's Step 3 describes (`supabase db push`, `supabase functions
deploy worker`, starting the worker with `--topics gemini`, reading back `jobs`,
`topic_predictions` and the `usage_summary` line, opening the dashboard signed in) were not
attempted.

**Fixture-tested / unit-tested, everything else in this plan:**

- `npm run check`: **red**, stopped at the `format:check` gate (`prettier --check` exit 1)
  on four files this task did not write and may not touch —
  `packages/contracts/src/workerGateway.test.ts`,
  `supabase/functions/_shared/worker-gateway.ts`, `supabase/functions/worker/index.ts`,
  `supabase/tests/dashboard_topics.test.ts` — already unformatted in the committed tree at
  `HEAD` (`1b4ed30`) before this task began; `git status` at the start of this task showed
  nothing pending but the untracked `.screenshots/`. Not this task's to fix: its writable
  files are `docs/decisions.md`, `docs/progress.md`, `docs/verification.md` and
  `docs/coordination/ACTIVE.md` only.
- Every other gate was run individually (the chain that `npm run check` would have run past
  `format:check`, had it passed) and each is green, matching the counts the task brief
  expected: `eslint . && worker:lint` (ruff) — pass; `tsc --noEmit` — pass; `deno check` over
  the edge functions — pass; `vitest run --exclude "supabase/tests/**"` — **343 passed, 42
  files**; `vitest run supabase/tests` — **198 passed, 20 files**; `uv run pytest` (worker) —
  **168 passed**, including `tests/test_topics.py` (7), `tests/test_gemini.py` (13) and
  `tests/test_run_topics.py` (6, the two `blocked`/`no_topic_classifier` and
  `blocked`/`topic_model_not_active` cases among them); `vite build` — succeeds, 32 files
  emitted; `node scripts/check-secrets.mjs` — **passes**, 323 source files plus built assets,
  and finds no `GEMINI_API_KEY` value anywhere tracked (only the variable's name, in
  `.env.example` and `workers/deploy/README.md`, as documentation).
- These counts equal what the individual tasks last reported (`npm test` 343, `npm run
test:db` 198, `npm run worker:test` 168) — nothing drifted between then and this session's
  run, only the `format:check` regression is new and it is upstream of this task's scope.
- `npm run test:e2e -- tests/e2e/dashboard.spec.ts` was not re-run in this task; the count
  last reported by Task 10 was 73.

Nothing else in the topic-classification feature — the taxonomy, the predictions/reviews
tables, the adoption trigger, `worker_topics_due`/`worker_commit_topics`, the Gemini
adapter's schema-constrained enum and its header-only key, the gateway routes, the
contracts (`effectiveTopic`, the filter, `topic_counts`, the CSV columns, the fixture), or
the dashboard (card, filter, chip, correction mode, history, Sync job kind and error
strings, the third budget line) — has been exercised against the live project. All of it is
covered only by the fixture data and the unit/PGlite suites named above.

## 2026-09-16 — topic classification, final fix wave: `npm run check` green at the fix-wave head

Run after the eleven review findings were fixed (the worker seam in `01c97a6`, the SQL,
gateway and seam tests in `f074d01`, the dashboard gate, e2e test and docs in the commit
that carries this entry). `npm run check` exited 0; gate by gate, in the order the script
runs them:

| Gate            | Command                                    | Result                                                                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| lint            | `eslint . && ruff check .`                 | pass, "All checks passed!"                                                                                                                                                                                                                                                                                                           |
| format:check    | `prettier --check …`                       | pass, "All matched files use Prettier code style!" — the four files the previous entry recorded as unformatted were fixed in `cf84011`                                                                                                                                                                                               |
| typecheck       | `tsc --noEmit`                             | pass                                                                                                                                                                                                                                                                                                                                 |
| check:functions | `deno check` over the three edge functions | pass                                                                                                                                                                                                                                                                                                                                 |
| test            | `vitest run --exclude "supabase/tests/**"` | **344 passed, 42 files** (343 before; `workerGateway.test.ts` gained the `max_rows` refusal)                                                                                                                                                                                                                                         |
| test:db         | `vitest run supabase/tests`                | **202 passed, 20 files** (198 before; `worker_topics.test.ts` 13, of which four are new — the quota cap, the `quota_exceeded` block, the no-plan case, and `worker_due_videos` refusing an `analyse` job — plus `topics_stored` assertions in an existing one; `end_to_end.test.ts` 5, the topics seam through the real handler new) |
| worker:test     | `uv run pytest`                            | **175 passed** (168 before; `test_run_topics.py` 9 — one-round stop, 25+5 slices, blocked due list new, the batch-key assertion changed — and `test_gemini.py` 17 — safety settings, bisection, a half failing again, a single item not split new)                                                                                   |
| build           | `vite build`                               | pass, built in 2.49s                                                                                                                                                                                                                                                                                                                 |
| check:secrets   | `node scripts/check-secrets.mjs`           | pass, 323 source files plus built assets                                                                                                                                                                                                                                                                                             |

Outside `npm run check`: `npm run test:e2e -- tests/e2e/dashboard.spec.ts` — **74 passed**
in 1.1m (73 before; the appended not-run test new). The new test failed first against the
unfixed gate — the Topic filter was present with `active_topic_key: ""` — and passed once
`Dashboard.tsx` gated it on the key. Every Important item's test was likewise seen red
before the change: four in `test_run_topics.py`, three in `test_gemini.py`, five in
`worker_topics.test.ts`.

Still not live-tested: nothing in this wave touched the live project. The three migrations
remain unapplied, the edge function undeployed with its topic routes, and the Gemini key
still refused by Google (see the entry above). The quota cap, the `blocked` answer and the
deploy-order guard are PGlite- and unit-tested only.

## 2026-09-16 — the topic layer deployed to the live project, from this session

Order followed as `workers/deploy/README.md` records it: the worker service was already at
`1c9c4eb` (running `topics=none`); then `supabase functions deploy worker` (routes
`/worker/topics-due`, `/worker/commit-topics`); then `supabase db push --linked` applied
`20260916010000`, `20260916011000`, `20260916012000` — `migration list --linked` shows all
three remote; then `npm run build && npm run deploy:preview`. Verified at the origin
(`--resolve app.sky-develop.net:80:91.204.209.217`, not through the CDN):
`index-BTvGX5MB.js` and `Dashboard-tiYHLWNT.js` byte-identical to the local `dist`, the
twelve superseded assets swept, the served index names the new bundle, the old
"غير متاح بعد" string is gone from the shipped chunks.

Read back from the live project: `workspace_topics` holds ten rows in each of the five
workspaces; the first tick after the push enqueued one `analyse` job and the worker finished it
`blocked` / `no_topic_classifier` at 05:57Z — the designed outcome for a worker with no
classifier. No topic has been classified live: the Gemini key is still refused
(`API_KEY_SERVICE_BLOCKED`) and `scripts/worker-service.sh` does not export `GEMINI_API_KEY`.
Live-tested: the deploy, the seeding, the tick, the blocked job. Fixture-tested: everything
else in the feature, as the entries above record.

## 2026-09-16 — a second Gemini key: authenticates, model accepted, credits depleted

The user supplied a second AI Studio auth key (project 272573239614). Live-tested from the
worker checkout with `x-goog-api-key`: `gemini-2.5-flash` → 404 "no longer available to new
users; use gemini-3.6-flash" (so the pin moved, see `docs/decisions.md`); `gemini-3.6-flash`
and `gemini-3.5-flash-lite` → 429 with the message "Your prepayment credits are depleted.
Please go to AI Studio … to manage your project and billing." The adapter reported every item
`failed / gemini_rate_limited`, as designed. So: authentication and the model are right; the
remaining blocker is prepaid credit on the AI Studio project. (An earlier attempt with the key
read off a screenshot failed 401 on every auth style — a misread `I`/`l`; the pasted key was
correct.) The key is in the gitignored `.env.local`; `scripts/worker-service.sh` now exports
`GEMINI_API_KEY` when set. The service was NOT restarted: with credits at zero every analyse
job would end `partial / gemini_rate_limited` on the hour.

## 2026-09-16 — a failed sentiment verdict is retried: PGlite, mutation-checked

`supabase/tests/prediction_retry.test.ts`, four tests against every migration through
`20260916020000` in PGlite. Seen red first, without the new migration on disk: "replaces
the failed verdict with the retry's success" failed with the row still `{status: failed,
label: null}`; "adopts the retried success" failed with `active_analysis_key` null; "never
overwrites a final verdict" failed for the same reason as the first (the success it depends
on had been dropped). After the migration: 4 passed.

Mutations, each applied to the new migration, run, and the file restored byte-identical
from a scratchpad copy (`diff` empty) — never `git checkout`:

| Mutation                                                                             | Test that went red                                                                                 |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Drop `where public.sentiment_predictions.status = 'failed'` from the conflict clause | "never overwrites a final verdict with a later attempt" — the later `failed` overwrote the success |
| Drop the `adopt_first_analysis_on_update` trigger                                    | "adopts the retried success as the channel's first analysis" — key stayed null                     |

Gates at this head: `npm run test:db` **207 passed, 21 files** (202 before); `tsc --noEmit`
exit 0; `eslint` and `prettier --check` clean on the new test.

Not live-tested: the migration is not applied to the linked project. The three topic
migrations ahead of it went live earlier today (the deploy entry above), so it is now the
one migration the live project lacks; it is listed in `docs/coordination/ACTIVE.md`.

## 2026-09-16 — the videos section turns pages: unit, e2e, mutation-checked

`apps/web/src/videoPaging.test.ts`, six tests. Seen red first (module absent), then
6 passed. Mutations applied to `videoPaging.ts`, each run and the file restored from a
scratchpad copy (`diff` empty):

| Mutation                                         | Test that went red                                    |
| ------------------------------------------------ | ----------------------------------------------------- |
| Drop the upper clamp (`Math.max(page, 0)` alone) | "clamps a page index past the end to the last page"   |
| `Math.max(0, …)` for the page count              | "is one empty page for an empty list, not zero pages" |
| `from: start + 1` unconditionally                | the empty-list test — `from` read 1 of nothing        |

`tests/e2e/dashboard.spec.ts`, two blocks appended. The first rewrites the fixture route
into 30 videos of 6 comments (180 total), asserts 25 cards and "الصفحة 1 من 2 — عرض 1–25
من 30 فيديو", turns to page two (5 cards, next disabled), proves the two pages are
disjoint (30 distinct test ids), that the totals do not move, that a sentiment filter
applied from page two lands on **page one** of a list that still has two pages, and that
the pager disappears when one video is left. The second asserts the untouched fixture
shows no pager. Mutation: removing `setVideoPage(0)` from `applyFilters` turned the first
red with "الصفحة 2 من 2 — عرض 26–30" where page 1 was expected — the clamp alone would
not have caught it, which is why the test filters to a list that keeps both pages.

Gates at this head: `npm run check` exit 0 (unit 350 passed / 43 files, PGlite 207 / 21,
worker 175, build clean, secret scan clean); `npm run test:e2e` **90 passed** (88 before)
at load average 5.3. Screenshot of page two taken with a throwaway Playwright script
against `web-dev-5176` with the same 30-video route rewrite; not committed.

Not live-tested: the built front end has not been redeployed with this change.

## 2026-09-16 — preview deploy of 348895c (the videos pager)

`npm run build` (Dashboard chunk `Dashboard-DjCNa2EG.js`, entry `index-DFEGkI-B.js`),
then `npm run deploy:preview`: 28 files uploaded, every transfer answered 226, and the
twelve hashed assets of the previous build removed by the sweep. Fetched back over
basic auth and compared with the local `dist` byte for byte: `index.html`, both entry
chunks, the CSS, `Dashboard-DjCNa2EG.js`, `report-gTalQbOi.css` and
`fixtures/dashboard.json` — all identical. The served Dashboard chunk contains
`video-page-state` and the served entry contains "تصفح الفيديوهات", so what
`app.sky-develop.net` serves is the pager build.

Not verified from here: the signed-in dashboard for workspace `d0c3b9fc-…` in a browser
(no session in this environment). The pager appears only for a workspace whose filtered
list exceeds 25 videos; the user's screenshot shows such a workspace.

Seen live, 2026-09-16: the user opened the signed-in dashboard for workspace
`d0c3b9fc-…` on `app.sky-develop.net` and reported the videos pager showing. That closes
the "not verified from here" line above for the pager itself; the figures on the page
are the workspace's own and were not compared from this side.

## 2026-09-16 — the night the pilot's units ran out, and what it proved

At 21:31Z the user selected videos on the live page until the estimate met the remainder:
**789 selections, 5,002 reported comments** over them against a 5,000-unit plan with 412
used — the "fit newest" shortcut doing its job. The service collected through the night:
**771** selections carry a `last_collected_at` after that hour, `comments` holds 4,999 rows
for the workspace and `usage_events` 4,999 `comment_analysis` events — one unit short of the
plan, i.e. the estimate (YouTube's counts) and the metered truth agreed to within three
comments over 771 videos. The hard stop is honest.

What was not honest was the worker's answer to the refusal. Once `commit_batch` said
`quota_exceeded` (429), `_backfill` let the `ControlPlaneError` escape, `serve` logged
"control plane refused: quota_exceeded" and moved on, the lease lapsed five minutes later,
the job was reclaimed and refused again: `lease_thrashing:20` on `7d981e11`, then a fresh
collect `79fc8161` reclaimed twelve times by morning, and thirteen `worker up` lines in the
service log (each idle exit, then restart, then the same refusal). Fixed in `93f27be`: a
non-retryable refusal ends the job `blocked` with the server's own code and its checkpoint
kept — `test_a_plan_refusal_ends_the_job_blocked_rather_than_dropping_the_lease` was red
(the error escaped) and is green; a 503 still escapes and is asserted to. The service was
updated to it. `_analyse` (the topics session's) has the same shape and was not touched
here.

Also today, pushed by the user: the three topic migrations (`db push --dry-run` now says
"Remote database is up to date"), the `worker` Edge Function at version 11
(`/worker/topics-due` answers 400 to a malformed body, not 404), and `GEMINI_API_KEY` in
`.env.local`; after `worker-service-update.sh` the log reads `topics=gemini` and `topic
classifier: gemini-3.6-flash`. The first `analyse` job before that update finished
`blocked: no_topic_classifier` (the worker had no key yet), the backoff held it an hour,
and the next one is running as this is written. Web deploy of `93f27be` from this session:
32 files at 226, served `index-DFEGkI-B.js` byte-identical to the local build.

## 2026-09-16 — `20260916020000` is on the live project

`npx supabase migration list --linked` from this checkout, after `supabase login`, lists
`20260916020000` with a remote timestamp, the last of 47 with no local-only row; three
consecutive `npx supabase db push --linked` runs by the user answered "Remote database is up
to date". It was applied by the user's earlier push that `b3cb15e` records as "the three topic
migrations" — the primary checkout had fast-forwarded to `be45415` before that push, so the
CLI took all four. Not read back: the live `commit_batch` body and the
`adopt_first_analysis_on_update` trigger — `supabase db dump --linked` needs Docker, which was
not running. The claim that the live function carries the `where ... status = 'failed'` clause
rests on the migration table and on `db push` applying a file and recording it in one
transaction, not on inspection. No retry has yet exercised it against real data.

## 2026-09-16 — the first topic classification of a real channel

`analyse` job `a58307f0` on AJ360, claimed 06:51:51Z by the service on the new pair with
`topics=gemini` (`gemini-3.6-flash`), finished `succeeded` at 08:01:54Z — seventy minutes,
one lease re-claim after a transient `network_failure` at 07:23Z (retryable, escaped by
design, the job resumed where the server said it was). `coverage_summary {topics_stored:
4839}`; `topic_predictions` holds 4,839 rows for the workspace, every one `succeeded`, and
`usage_events` 4,839 `topic_classification` units — one per verdict, of the pilot's 5,000.
The 160 stored comments without a verdict are the ones the run did not reach or the
classifier did not answer; the next `analyse` (the tick, after the backoff) takes them.

The channel's audience, by the first verdicts (share of 4,839): discussion 26.9% ·
religious 22.3% · criticism 18.4% · praise 14.7% · question 6.2% · humour 4.5% · other 3.4%
· personal 2.0% · request 1.5% · promotion 0.1%. Median confidence 0.92. No human has read
a verdict yet; this is what the model said, not what is true.

Collect `79fc8161` is still `running` with 12 reclaims and a lapsed lease: the worker ran
the analyse job first, and the next claim will reach it with `93f27be`'s handler and end
it `blocked: quota_exceeded`.

## 2026-09-16 — the 160 are the channel's own voice; the service runs the cheaper request

Correction to the entry above: the 160 stored comments without a verdict were not missed —
they are the 160 comments whose `author_channel_id` is the channel's own, which the due list
excludes on purpose (the channel talking to its audience is not the audience). Audience
comments 4,839, verdicts 4,839, units charged 4,839: coverage is exact, and the next tick
will find nothing due. `active_topic_key` adopted `topics:v1+gemini-3.6-flash+p1`.

At 11:03:53 local the service was moved to `28b6b50` (`worker-service-update.sh`), which
carries `52120bd`: 100 comments per Gemini request and `thinkingBudget: 0`. It came up
`topics=gemini`; the change is measured (docs/decisions.md) and takes effect on the next
analyse job. Live-tested: the restart line and the checkout's `CHUNK = 100` /
`thinkingConfig` lines, read from the service's own checkout.

## 2026-09-16 — the stuck collect ends the way it should

`79fc8161`, twelve reclaims by morning under the old handler, was claimed a thirteenth
time by the service running `93f27be` after the analyse job released the worker, and
finished `blocked: quota_exceeded` at its first refused batch — the checkpoint kept, no
further reclaim, no thrash. The tick afterwards answers `collect: 0`: the hour's backoff
after a blocked job holds, and the pilot's units stay spent until 2026-12-01 or a plan
change.

## 2026-09-16 — plans v2 and the Paddle sandbox reach the live project

Applied by the user's "طبّق", from this checkout, `npx supabase db push --linked` after a
dry run listed exactly six files: `20260917020000_usage_grants`, `20260917030000_platform_admin`,
`20260917040000_plan_catalogue`, `20260917050000_billing_events`, `20260917051000_billing_rpc_surface`,
`20260917052000_yearly_prices_follow_the_spec`. `20260917010000_plans_v2` was already on the
remote (pushed by another session before the yearly figure was checked), which is why the
correction is its own file and the applied file was restored to what the remote holds.

Read back over REST with the service key: `plans` carries the eight rows; `plan_catalogue()`
as **anon** returns six (`free, creator, creator_plus, agency, media, enterprise`) with yearly
cents `12000/28800/94800/238800`; `addon_catalogue()` returns `pack_10k` at 500 cents;
`billing_apply_pack` as anon answers `42501 permission denied`.

Seeded over `supabase db query` (not a migration — data, not schema): one row in
`private.platform_admins` (engmlubbad@gmail.com); the owner's personal workspace
`d0c3b9fc…` on `owner` for a hundred years, `provider='admin'`; his second workspace
`bf3f7333…` on the same plan with `billing_workspace_id` = the personal one; one
`plan_set` audit row. The three probe workspaces stay on `pilot`.

Paddle sandbox: the API key answered `GET /products` → 200 with an empty catalogue.
`node --env-file=.env.local scripts/paddle-sync-prices.mjs` created 4 products and 7
prices (`pro_01m2n5f7…`, `pri_01m2n5f7…` … `pri_01m2n5f8qdb48jc797fcwk4f92` for the
pack) and wrote their ids into `plans.provider_prices` / `addon_prices.provider_prices`;
the second run reported `0 created, 4 updated (0 products, 0 prices created)` — nothing
duplicated.

Edge functions: `supabase secrets set` from `supabase/functions/.env` added `PADDLE_API_KEY`
and `PADDLE_ENV=sandbox`; `functions deploy paddle-webhook --no-verify-jwt` and
`functions deploy billing-portal` both finished. Probed: webhook `GET` → 405, `POST` without a
signature → 500 `not_configured` (the webhook secret is not set yet — Paddle's notification
destination needs the deployed URL first); portal `POST` without a bearer → 401.

Preview: `npm run build` with `VITE_PADDLE_ENV=sandbox` (no client token yet) and
`npm run deploy:preview`. In the browser at `/pricing` behind basic auth: both segments
render from the live catalogue; the yearly switch shows `$79`/`$199` with «تُدفع $948 /
$2,388 سنويًا»; `media` and `enterprise` read «تواصل معنا», `enterprise` prices «حسب
الاتفاق»; the anchor badge sits on `agency`. Screenshots in `.screenshots/` (untracked).

Not yet verified live: a checkout (needs `VITE_PADDLE_CLIENT_TOKEN` and the domain approved
in Paddle), a webhook delivery (needs `PADDLE_WEBHOOK_SECRET`), the portal session, the
account page's plan panel and the admin page as the signed-in owner (his session, not ours).

## 2026-09-16 — the sandbox walk: webhook, pack, cancel, stale, past_due, sweep, portal

Secrets on the project after the user created the notification destination:
`PADDLE_API_KEY`, `PADDLE_ENV=sandbox`, `PADDLE_WEBHOOK_SECRET`. The web bundle carries
`VITE_PADDLE_CLIENT_TOKEN` (public by design) and `VITE_PADDLE_ENV=sandbox`.

Against the deployed `paddle-webhook`, each body signed with the real secret
(`HMAC-SHA256(secret, ts:body)`, `Paddle-Signature: ts=…;h1=…`) for the probe workspace
`18e093a5…` (owner `connect-probe-1789332349@`):

| sent                                                     | answered                    | live row afterwards                                                           |
| -------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `subscription.activated`, price `creator:month`          | `{"outcome":"applied"}` 200 | `pilot → creator`, `provider=paddle`, `sub_walk_001`, `ctm_walk_001`, `month` |
| the same event again                                     | `duplicate` 200             | unchanged                                                                     |
| the same signature, body with `active→paused`            | `bad_signature` 401         | unchanged                                                                     |
| `transaction.completed`, price `pack_10k:pack`           | `applied` 200               | `usage_grants`: 10,000 `comment_analysis`, `txn_walk_002`                     |
| `transaction.completed`, a subscription price            | `ignored` 200               | unchanged                                                                     |
| `subscription.updated`, `scheduled_change.action=cancel` | `applied` 200               | `cancel_at_period_end=true`                                                   |
| `subscription.updated` dated 2026-09-15 (older)          | `stale` 200                 | unchanged                                                                     |
| `subscription.past_due`                                  | `applied` 200               | `status=past_due`                                                             |

Audit rows in order: `plan_paddle_activated`, `pack_paddle comment_analysis:10000`,
`plan_paddle_updated`, `plan_paddle_past_due`. Then, over `supabase db query`, the row's
`period_end` set to eight days ago and `select private.billing_sweep()` → the row reads
`free / active / provider null / open-ended`, last audit `plan_dropped`.

`billing-portal`, called with a session minted for the probe owner (admin
`generate_link` + `verify`) after a sandbox customer `ctm_01m2n7c7…` was created over the
API and written to `provider_customer_ref`: own workspace → 200 with a
`sandbox-customer-portal.paddle.com/cpl_…` URL; the owner's workspace `d0c3b9fc…` → 403
`forbidden`.

The account page, signed in as the probe in the preview browser: plan panel reads «مجاني»,
analysis `0 من 10,100` — the free plan's 100 plus the pack's 10,000 — with «ترقية الخطة»
and «إضافة 10,000 تعليق». Pressing the pack button ran the app's own path: Paddle.js
initialised in **sandbox**, the overlay iframe came from `sandbox-buy.paddle.com`, and
Paddle's overlay then showed its generic "Something went wrong" with no request logged by
the page. Paddle's checkout refuses like this when the account's **Checkout settings**
(default payment link / website approval for `app.sky-develop.net`) are not set — a
dashboard step, not code. Left open; see progress.md.

Two things the walk showed for the rail card and the panel: the card prints the plan key
(`خطة free`) rather than the title, and an open-ended free plan reads «تتجدد في 2126-09-16».
Both go with the `pilot` rename the user asked for.

## 2026-09-16 — a real sandbox payment, end to end

After the user set Paddle's checkout settings (default payment link, website approval),
the account page's «إضافة 10,000 تعليق» opened Paddle's overlay in sandbox for the probe
user: "Analysis pack — 10,000 comments, $5.00 inc. VAT" with PayPal offered beside the
card form. Cards are the user's to type, not ours; he then paid from **his own** account
on the pricing page instead — `txn_01m2n8077f6c9164dn3pym8b86`, Creator monthly, $12.00
(Paddle's invoice: $10.00 + 20% tax withheld $2.00, Paddle fee $1.10, net $8.90).

Paddle delivered `subscription.created` (`evt_01m2n8197g3spyc2b2yn8bpwzc`) and
`subscription.activated` (`evt_01m2n8197g6t2bkb657fsdejq0`) to the deployed webhook, both
`applied`, `custom_data.workspace_id` = his personal workspace `d0c3b9fc…`. The root row
**and** its client «قناة يوتيوب» (`bf3f7333…`, `billing_workspace_id` = root) moved together
to `creator / paddle / sub_01m2n8191adpkmm5cgq3ps8fj8 / ctm_01m2n8075nekv5qfzw4tm74n7e`
— the root propagation, live, unprompted.

Because that replaced his `owner` plan (correctly: a paid subscription is the truth), the
subscription was cancelled over the sandbox API (`effective_from: immediately`);
Paddle's `subscription.canceled` arrived within seconds and both rows read `cancelled`.
Then `public.set_workspace_plan('d0c3b9fc…','owner',1200,'owner restore after sandbox
test')` ran as his user id over `db query` — the same RPC the admin page calls — and both
rows read `owner / admin / active` again, the client still bound to the root.

Two things the invoice shows for the pricing decisions:

1. **Both lines were tax-inclusive.** The pack read "$5.00 inc. VAT" (4.17 + 0.83), and
   the subscription's $12.00 was $10.00 plus $2.00 _withheld_ — Paddle treated the table's
   $12 as the price including tax and took the tax out of it, so the seller received $10
   before Paddle's fee, not $12. (An earlier reading of this invoice as "$10 exclusive plus
   $2 on top" was wrong: the price in the table is $12, and $12 is what was charged.) The
   decision recorded on 2026-09-16 is "price excludes tax, tax on top", and the sandbox's
   first sync had created every price with Paddle's default tax mode (the account setting,
   which is inclusive). The fix is in code, not the dashboard: `scripts/paddle-sync-lib.mjs`
   creates every price with `tax_mode: "external"` and PATCHes a found price that lacks it
   (commit `758edca`, tests in `paddle-sync-lib.test.ts`). The sync against the sandbox is
   re-run by the controller after that commit, so the seven existing prices take the mode;
   the fix session itself made no Paddle call.
2. Paddle withheld 20% tax for a customer it placed in Turkey, and its fee was 5% + $0.50
   ($1.10 on $12) — the rate the consultation assumed.

## 2026-09-16 — the fix wave reaches the live project

`npx supabase db push --linked` applied `20260917060000_cancel_drops_to_free.sql` alone
(dry run listed only it). The owner's row read `owner / admin / active` afterwards.
`scripts/paddle-sync-prices.mjs` then reported `0 created, 11 updated (… 7 tax modes
fixed)` and, on the next run, `0 tax modes fixed`; `GET /prices/pri_01m2n5f8qdb48jc797fcwk4f92`
answers `tax_mode: external`, amount 500 — the pack and the six subscription prices now
sell at the listed price with tax on top. The preview was rebuilt and redeployed with the
pricing page's "manage" rule for a Paddle subscriber.

## 2026-09-16 — the pilot plan is the Founding Partner, named in the reader's language

`20260917070000_pilot_is_founding_partner.sql` pushed alone (`db push --linked`): the
`pilot` row's titles are «شريك مؤسِّس» / "Founding Partner"; `admin_plan_catalogue()`
returns every plan for an admin and `forbidden` for anyone else (PGlite-tested). On the
preview, signed in as the pilot-plan probe `connect-probe-1789332387@`: the rail card reads
«مساحة العمل الشخصية | شريك مؤسِّس | تحليل التعليقات: يتبقى 25,000 من 25,000» and the
plan panel «شريك مؤسِّس · تتجدد في 2026-12-13»; after the language switch, "Founding
Partner · Renews on 2026-12-13" and "Comment analysis: 25,000 of 25,000 left". No surface
prints a plan key any more (`planTitle` is gone from both locales); the admin select
offers titles from `admin_plan_catalogue()`. An open-ended plan (a period ending more than
fifty years out) reads «بلا تاريخ انتهاء» — unit-tested; the probe's period is a real
ninety days, so its date is the true one.

## 2026-09-16 — the legal pages

Unit (`apps/web/src/legal/legal.test.ts`, `LegalPage.test.ts`): the Arabic and English
documents have the same section ids, paragraph and bullet counts and the same links in the
same order; every link is https; both privacy policies link policies.google.com/privacy,
youtube.com/t/terms and myaccount.google.com/permissions; both name `youtube.readonly`,
`youtube.force-ssl` and thirty days; no document contains a personal name or mailbox; a
server render of each document carries its title, `<time dateTime>`, one `<section id>` per
contents entry and an anchor with `rel="noopener noreferrer"` for each inline link; the
three footers mount `<LegalLinks`; `main.tsx` serves each `LEGAL_PATHS` entry. `npm test`
430 passed, `test:db` 291, `worker:test` 177, build green, secrets scan green. Prettier:
this branch's files pass; the untracked `supabase/tests/worker_video_counts.test.ts`
(not this work's) fails `format:check`.

Browser (`tests/e2e/legal.spec.ts`; the whole suite 96 passed in 1.4m before the page
count settled at two, then legal + landing + pricing 10 passed): the landing footer's
«سياسة الخصوصية» opens `/privacy-policy` with the right `<h1>` and document title; the
Google and YouTube anchors carry the required hrefs; the contents link scrolls `#retention`
into view; `/terms` opens from the footer, carries the Paddle buyer-terms anchor and links
back to the privacy policy; the language switch turns the document English with
`lang="en"` and `dir="ltr"`. Seen on the dev server at 800, 1280 and 375 wide: the title
block, contents grid and sections in Arabic and English, the legal row in the landing and
app-shell footers.

## 2026-09-16 — the public face is open, probed from outside

`npm run deploy:preview` after a fresh build: 40 files `226`, `.htaccess` 4,386 bytes on
the host. Probed **without credentials** through Cloudflare: `/`, `/pricing`,
`/privacy-policy`, `/terms`, `/static/index-Ca5U9bEO.js`, `/static/LegalPage-Bz25wQ9k.js`,
`/fonts/readex.css`, `/landing/audience-growth-original.png` and `/robots.txt` each `200`;
`/dashboard`, `/account`, `/sync`, `/admin`, `/fixtures/dashboard.json` and `/index.html`
each `401` with the Basic challenge; `/.htaccess` `403`. So the SPA rewrite carries the
public mark through `REDIRECT_public` as the file says it does, and a protected route
rewritten to the same `index.html` is still refused. `htaccess.test.ts` 8 passed against
the shipped file. The host still sends `X-Robots-Tag: noindex, nofollow` on every answer:
open to a reviewer who has the link, not to a search engine.

## 2026-09-16 — the live check reads only what moved, on the real channel

`20260917080000_live_check_by_comment_count.sql` pushed alone; `functions deploy worker`;
`scripts/worker-service-update.sh` moved the launchd service to `88a918b` (log: "worker up,
model=camelbert-da, tenants=2, topics=gemini").

The owner's channel `b7de589f…` holds 789 selections, all read yesterday on the 24-hour
interval. One hundred of the exhausted ones were set due by hand (`next_check_at = now()`),
because none carried `last_seen_comment_count` yet:

| pass                                | worker log                                 | what it cost                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| first                               | `comment counts: 0 unchanged, 100 to read` | 2 `videos.list` units + the reads — every selection was unseen, so every one was read; afterwards 100 rows carry `last_seen_comment_count`                                  |
| second (the same 100 set due again) | `comment counts: 100 unchanged, 0 to read` | **2 `videos.list` units, no `commentThreads` call**; 100 rows read `last_outcome = 'unchanged'`, `next_check_at` moved a `live_interval` ahead; the collect job `succeeded` |

The pass before this change would have paged `commentThreads` for all 100 (≥ 100 units).
The dashboard's catalogue shows a deferred video as up to date («لم يتغير منذ آخر قراءة»),
not as a partial read (`88a918b`). Not yet exercised live: a count that moved on the second
pass (the channel had no new comment in the seventeen minutes between passes), and a
`videos.list` refusal falling back to reading everything — both fixture-tested.

## 2026-09-16 — a workspace can be renamed, its channel disconnected, and itself handed over

`20260917090000_rename_and_retire_a_workspace.sql` pushed alone; preview redeployed. On the
preview as the pilot-plan probe `connect-probe-1789332387@` (English locale): the card shows
"Rename", "Connect a YouTube channel" and "Retire workspace". Rename through the form →
"The name is changed." and the card reads «مساحة الاختبار». Retire on the only workspace →
the question ("Your access to this workspace ends, its channel is disconnected, and
everything collected in it passes to the service operator — nothing is deleted…"), then
"Your last workspace cannot be retired; create another first." A second workspace «عميل
للتسليم» created, then retired: it left the probe's list; in the database it reads
`created_by` = the platform owner, members = the platform owner as `workspace_owner` only,
plan `owner` under the owner's root `d0c3b9fc…`, `retired_from` = the probe,
`retired_at` set, last audit `workspace_retired`. Rows untouched.

The disconnect door was rendered (card unit test, 9/9) and its RPC `oauth_disconnect`
predates this change; not pressed live — the only connected channel is the owner's own,
and disconnecting it would stop the pilot's reads. `docs/youtube-quota-extension.md` §4's
first item is closed.

## 2026-09-16 — Task 17 (ui-foundation plan), `AdminPage.tsx`'s plan picker on `ui/Select`

TDD: `apps/web/src/AdminPage.test.tsx` written first; confirmed it fails for the right
reason by temporarily removing the new `adminPlanPicker` key from `ar.ts` and re-running —
`vitest` still passed (the test's own `PlanPicker` reads `ar.adminPlanPicker`/`undefined` on
both sides of its assertion, so a runtime pass is not itself proof), but `npx tsc --noEmit`
correctly failed with `TS2339: Property 'adminPlanPicker' does not exist` against `ar.ts`'s
literal type and `TS2353` against `en.ts`'s `Strings` shape — the real failure mode Step 1
closes. Restored the key; `npm test -- apps/web/src/AdminPage.test.tsx
apps/web/src/ui/Select.test.tsx` then passed, 4/4.

`npm run check` (`lint`, `format:check`, `typecheck`, `check:functions`, unit/db tests,
worker tests, `build`, `check:secrets`) exited 0: 70 web test files / 484 tests, 31 db test
files / 297 tests, 195 worker tests, build succeeded, secrets check passed on 445 source
files. One `format:check` failure surfaced on first run (`AdminPage.tsx`/`AdminPage.test.tsx`
needed `prettier --write`); re-run was clean.

`git status` after the code commit (`f94cd90`, five files: `AdminPage.tsx`,
`AdminPage.test.tsx`, `strings/ar.ts`, `strings/en.ts`, `tests/e2e/app-shell.spec.ts`,
staged and committed by explicit pathspec) showed `apps/web/public/.htaccess` and
`apps/web/src/htaccess.test.ts` modified and `docs/quota-application/**` dirty — none of it
touched by this task; those are another writer's uncommitted work already on disk, left
alone. The pack-kind `<select>` in `AdminPage.tsx`'s `WorkspaceRow`, two lines below the
plan picker, is still a native `<select>`; `WorkspaceRow`'s `plan`/`setChosenPlan`/`options`/
`pending`/`keys` are unchanged. Not verified live (no seeded platform-admin e2e session
exists in this checkout yet): the appended `app-shell.spec.ts` block only confirms `/admin`
still renders its signed-out forbidden state with the new `ui/Select` import present.

## 2026-09-16 — the YouTube API quota extension request is submitted

The user filled and submitted the YouTube API Services quota-and-audit form (Project #1)
with the answers prepared in this session: organization "self", country Türkiye, category
Analytics and Business Intelligence, API client "Audience Sentiment" at
`https://app.sky-develop.net`, privacy/terms URLs live and password-free, five read-only
endpoints checked (`channels.list`, `playlistItems.list`, `videos.list`,
`commentThreads.list`, `comments.list`), requested quota 50,000 units/day with the
justification text from `docs/youtube-quota-extension.md` §2. Attachments: the architecture
and user-flow diagrams, the supporting-materials PDF, and `evidence-project-1.pdf` (the
in-app screens plus the two Google-hosted ones the owner captured — the account chooser and
`myaccount.google.com/connections` showing `SentimentAnalysis` under linked apps).

One finding from the owner's own capture, worth acting on separately: the OAuth consent
screen shows the raw Supabase auth domain (`ykqugctewsqvevhyqtbi.supabase.co`) as the
requesting party, not "Audience Sentiment" — the OAuth consent screen's app name in Google
Cloud Console was never set. Cosmetic for this submission (the form's own answers name the
client correctly); worth fixing before a real user reads that screen.

Outcome: pending Google's review. The stated turnaround is weeks, with possible follow-up
questions; `docs/youtube-quota-extension.md` §2's answers cover what those are likely to ask.

## 2026-09-16 — the password removed, probed from outside

`apps/web/src/htaccess.test.ts`: 5 passed — the cache-status-guard tests unchanged, the
old "keeps the password" assertion replaced with one that the shipped file names no
`AuthType`, `AuthUserFile`, `Require`, `SetEnvIf` or `.htpasswd` reference anywhere,
comments included. `npm test` 481 passed, lint/typecheck/format:check/build/secrets green.

Deployed via `npm run deploy:preview`: 40 files `226`, `.htaccess` 2,420 bytes, 20 stale
hashed chunks swept. Probed **without credentials**: `/`, `/pricing`, `/privacy-policy`,
`/terms`, `/dashboard`, `/account`, `/sync`, `/admin`, `/connected`,
`/fixtures/dashboard.json`, `/fixtures/catalogue.json`, `/index.html` and `/robots.txt`
each `200`, no `WWW-Authenticate` header on any of them; `/.htaccess` still `403` —
Apache refuses to serve the file itself, unrelated to Basic Auth, unchanged from before.
The whole app is now reachable by anyone with the URL.

## 2026-09-16 — Task 5 (app-shell plan): full check and the whole browser suite, both clean

`npm run check` exited 0: lint (`eslint . && worker:lint`) clean, `format:check` clean,
`typecheck` (`tsc --noEmit`) clean, `check:functions` clean, unit tests 72 files / 492 tests
passed (including the new `SessionControl.test.tsx` and `RailState.test.tsx`), db tests
(`vitest run supabase/tests`) 31 files / 297 tests passed, worker tests (`pytest`) 195 passed,
`vite build` succeeded (297 modules transformed, largest chunk `index-Beba_wQP.js` at 699.68 kB
raw / 210.51 kB gzip — the existing chunk-size warning, unrelated to this plan), and
`check:secrets` passed on 455 source files plus built assets.

`npm run test:e2e > /tmp/e2e.log 2>&1; echo "exit=$?"` — port 4173 confirmed free before the
run — exited 0: 98/98 passed in 1.4m, 6 workers, no retries, nothing flaked. `tests/e2e/
app-shell.spec.ts` ran whole, 8/8: the two tests this plan appended (`the mobile menu takes
focus when it opens and gives it back on Escape`, plus the earlier `the operations page…`
Task 17 block) both green alongside the six that predate this plan. No re-run needed — the
single run held clean the first time, so the `docs/coordination/ACTIVE.md` contention
allowance did not come up.

`git status --short` after both runs showed only `docs/oauth-verification.md` modified
(the other concurrent session's uncommitted edit, left untouched per this task's brief) and
the untracked `.screenshots/` directory (unrelated to this plan); nothing from this plan's
four commits (`0bb18b6`, `d97e009`, `b87abef`, `3ea6d17`) was left uncommitted.

## 2026-09-17 — the quota form's submission confirmed on the second attempt

The 2026-09-16 entry above recorded the form as submitted; it was not. In that browser
session the Submit button showed a spinner for over five minutes while the network log held
only the seven `upload-ceres` attachment uploads and no form POST — the page's client-side
submit never fired, most likely because hidden Project #4 upload slots had been filled by
mistake and then cleared. The page was reloaded (01:00 local) and refilled from scratch with
the same answers and the same seven attachments, touching no hidden field.

The owner's first Submit click on the refilled form did not register (button stayed enabled,
no spinner, no request); a second click did. Evidence of the send: `POST
support.google.com/apis/cufinsert` → 200, followed by `/apis/cufz` → 204, and the page
replaced the form with "Your email has been sent — Thank you for submitting the YouTube API
Services Form." No case number is shown on the page; Google's acknowledgement and any
follow-up questions arrive by email to engmlubbad@gmail.com, and there is no self-serve
status page for this form.

Acknowledgement received at 00:18 local: subject "YouTube API Services: Thank you for your
submission", from "YouTube API Quota" `youtube-disputes+0fgjaqtphf4qo1n@google.com` — the
`+` suffix is the case token; follow-ups belong on that thread. Body: "We will follow up
with a response once the application has been reviewed." Status: pending Google's review.

## 2026-09-17 — on-page SEO: `/en`, prerender, metadata, copy — checks and the whole browser suite

Node 22.14.0, on `main` at the commit that carries this entry. Another session was working
in the same checkout on the workspace-deletion migration; its uncommitted
`supabase/tests/workspace_lifecycle.test.ts` fails `format:check`, so `npm run check` was
run as its parts, with the format check scoped to the files this work touched.

| Command / observation                                                                                                                                                                       | Actual result                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint` (eslint + ruff)                                                                                                                                                              | clean                                                                                                                                                                                                                                                                                                                  |
| `prettier --check 'apps/web/src/**/*.{ts,tsx,css}' 'apps/web/scripts/*.mjs' 'tests/e2e/*.ts' '*.json'`                                                                                      | all matched files formatted                                                                                                                                                                                                                                                                                            |
| `npm run typecheck`                                                                                                                                                                         | 0 errors                                                                                                                                                                                                                                                                                                               |
| `npm run check:functions`                                                                                                                                                                   | clean                                                                                                                                                                                                                                                                                                                  |
| `npm test`                                                                                                                                                                                  | 75 files, 512 passed (before `prerender.test.ts`: +5, all passing)                                                                                                                                                                                                                                                     |
| `npm run test:db`                                                                                                                                                                           | 31 files, 302 passed                                                                                                                                                                                                                                                                                                   |
| `npm run worker:test`                                                                                                                                                                       | 195 passed                                                                                                                                                                                                                                                                                                             |
| `npm run build`                                                                                                                                                                             | `prerender: catalogue read at build time, 6 plans` · `8 pages, sitemap, robots.txt (noindex)`; every per-page check passed                                                                                                                                                                                             |
| `VITE_SITE_PUBLIC=true npm run build`                                                                                                                                                       | `robots.txt (public)`: `Allow: /`, product routes disallowed, `Sitemap:` line; `dist/.htaccess` carries no `X-Robots-Tag`; `index.html` and `en/pricing/index.html` say `index, follow`; `app.html` still says `noindex, nofollow`. Rebuilt without the flag afterwards: `Disallow: /`, header present, meta `noindex` |
| `npm run check:secrets`                                                                                                                                                                     | passed (479 source files, plus built assets)                                                                                                                                                                                                                                                                           |
| `E2E_PORT=5399 npx playwright test`                                                                                                                                                         | **103 passed** (1.4 m), including the new `seo.spec.ts` (5) and the updated landing, pricing and language specs                                                                                                                                                                                                        |
| Hydration, development React bundle (`NODE_ENV=development vite build --mode development --minify false`, prerender, Chromium via Playwright over a static server that mirrors `.htaccess`) | `/`, `/en`, `/pricing`, `/en/pricing`, `/privacy-policy`, `/en/privacy-policy`, `/terms`, `/en/terms`, `/dashboard`, `/account`: **0 errors each**. Before the fixes: React #418 on every page (missing `ToastHost` sibling), then on the six lazy pages (missing `Suspense` boundary)                                 |
| Production bundle in the browser pane, `/en/pricing` after hydration                                                                                                                        | one `<title>`, one description, one canonical, three alternates, one JSON-LD; four offers (`Free 0.00`, `Creator 12.00`, `Creator Plus 29.00`, `Agency 99.00`); switch `href="/pricing"`, brand `href="/en"`, legal links `/en/…`; `localStorage.audience.locale = "en"`                                               |
| Production bundle, `/` → click the switch                                                                                                                                                   | URL `/en`, `lang="en"`, canonical `…/en`, one `<title>`, English H1                                                                                                                                                                                                                                                    |
| `dist/index.html` head                                                                                                                                                                      | title, description, robots, canonical, `hreflang` ar/en/x-default (lower-case attribute), OG and Twitter tags, `<link rel="preload" as="image">` for the WebP hero (React's own); JSON-LD in the body with `Organization`, `WebSite`, `SoftwareApplication`, `WebPage`, `FAQPage` (8 questions)                        |
| Hero image                                                                                                                                                                                  | `audience-growth-original.webp` 29,194 bytes (PNG: 1,191,081), 1536×1024; share image `og-audience-sentiment.jpg` 71,179 bytes, 1200×630                                                                                                                                                                               |

Not verified here: the deployed host (no deploy was made in this work — the owner decides
deploys), Cloudflare's `robots.txt` override, and Core Web Vitals on the CDN.

## 2026-09-17 — the SEO build deployed to the preview, probed from outside

`npm run build` then `npm run deploy:preview` at `50b0f99` (HEAD `50f78c1`, the same
front end). Transfer log: every file `226`, including the new `app.html`, `sitemap.xml`,
`en/index.html`, `en/pricing/index.html`, `pricing/index.html`, the two legal pairs, the
WebP hero and the share image; twenty stale hashed assets removed (`gone`).

| Probe (`curl`, no session)                                                  | Actual result                                                                                                                                                  |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/en`, `/pricing`, `/en/pricing`, `/terms`, `/en/privacy-policy`       | `200`; `<html lang>` matches the address; each carries its own `<title>`, an `<h1>`, `noindex, nofollow` and its canonical                                     |
| `/pricing/` (trailing slash)                                                | `200`, same document, canonical `…/pricing` — no `301` from mod_dir                                                                                            |
| `/dashboard`, `/account`                                                    | `200`, 921 bytes: `app.html`, empty root, `noindex`                                                                                                            |
| `/robots.txt`                                                               | `200`, **26 bytes — our file**, not the 1836-byte Cloudflare one `deployment.md` recorded; worth re-checking on the day the flag flips                         |
| `/sitemap.xml`                                                              | `200`, 2954 bytes                                                                                                                                              |
| `/en/pricing` headers                                                       | `x-robots-tag: noindex, nofollow`, `cache-control: no-cache`, `cf-cache-status: DYNAMIC`                                                                       |
| `/landing/audience-growth-original.webp`                                    | `200`, `image/webp`, 29,194 bytes                                                                                                                              |
| `/landing/og-audience-sentiment.jpg`                                        | `200`, `image/jpeg`, 71,179 bytes                                                                                                                              |
| Chromium via Playwright against the live host, `pageerror` + console errors | `/`, `/en`, `/pricing`, `/en/pricing`, `/terms`, `/en/privacy-policy`, `/dashboard`: **0 errors each** — the production bundle hydrates every prerendered page |

## 2026-09-17 — indexing turned on and deployed, at the owner's instruction

`VITE_SITE_URL` and `VITE_SITE_PUBLIC=true` added to `apps/web/.env.local`; `npm run build`
(`robots.txt (public)`, `dist/.htaccess` without `X-Robots-Tag`, `index.html` → `index, follow`,
`app.html` → `noindex, nofollow`); `npm run deploy:preview`.

| Probe (`curl`, from outside)                    | Actual result                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`, `/en`, `/pricing`, `/en/pricing`, `/terms` | no `x-robots-tag` header; `<meta name="robots" content="index, follow">`                                                                                                                                                                                                                                     |
| `/dashboard`                                    | `noindex, nofollow` (app.html)                                                                                                                                                                                                                                                                               |
| `/sitemap.xml`                                  | the new file, `cache-control: no-cache`, `cf-cache-status: DYNAMIC`                                                                                                                                                                                                                                          |
| `/robots.txt`                                   | **stale**: the closed 26-byte copy, `cf-cache-status: HIT`, `cache-control: max-age=14400`; a `HEAD` got a `MISS` with the new 188-byte length, a `GET` still the old body. Cloudflare's zone rule overrides the origin's cache headers for `.txt` and the edge holds the old copy; no purge credential here |
| Fix shipped                                     | `.htaccess` `no-cache` rule now covers `.txt` and `.xml` as well as `.html` and `.json` (`htaccess.test.ts` still green); redeployed. Prevents the next such hold, does not clear this one                                                                                                                   |

The owner purged the Cloudflare cache; fetched again from outside: `/robots.txt` is the
188-byte open file (`Allow: /`, the five product routes and `/fixtures/` disallowed,
`Sitemap: https://app.sky-develop.net/sitemap.xml`), `cf-cache-status: MISS`. All three
indexing signals now agree on the live host. Left to the owner: submit the sitemap in Search
Console.

## 2026-09-17 — Search Console and the Rich Results Test

The owner submitted `https://app.sky-develop.net/sitemap.xml` in Search Console (property
`sky-develop.net`): "Sitemap processed successfully", last read 9/17/26, 8 discovered pages.

Google's Rich Results Test, run from the browser pane against the live pages:

| Page                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`                          | crawled 00:53:57; **Software Apps: 1 valid item** («مشاعر الجمهور»); two optional fields flagged: `aggregateRating` (no ratings exist — not written) and `offers` (the landing carries no catalogue; the pricing page does). `FAQPage` is not listed: since 2023 Google shows FAQ rich results only for government and health sites, so the tool does not report it — the data is still valid JSON-LD and read by the page's own FAQ |
| `/pricing`, first run        | Software Apps valid; 5 non-critical: `aggregateRating`, and **"Invalid object type for field priceSpecification"** on each of the four offers                                                                                                                                                                                                                                                                                        |
| Fix                          | `offersFrom` no longer writes a `UnitPriceSpecification`; each offer carries `name`, `price`, `priceCurrency`, `availability`, `url`. `seo.test.ts` asserts none is written. Built and deployed                                                                                                                                                                                                                                      |
| `/en/pricing`, after the fix | crawled 00:57:36; Software Apps valid; **1 non-critical** (`aggregateRating`, optional)                                                                                                                                                                                                                                                                                                                                              |

## 2026-09-17 — Core Web Vitals on the live host, and the fix wave they asked for

PageSpeed Insights' keyless API answered `429` (daily quota, shared project), so Lighthouse
12 was run locally (`npx lighthouse@12`, Chrome 141, `--headless=new`, default simulated
throttling; `--preset=desktop` for the desktop rows) against the deployed pages.

| Page, form                     | Before                                                               | After                                                                                       |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/` mobile                     | perf 57 · LCP 4.2 s · FCP 3.9 s · **CLS 0.279** · SI 7.1 s · a11y 96 | perf **86** · LCP 4.1 s · FCP 1.8 s · CLS 0 · SI 1.9 s · a11y 100                           |
| `/en` mobile                   | perf 67 · LCP 5.3 s · FCP 4.6 s · CLS 0 · SI 5.3 s                   | perf 84 · LCP 3.8 s · FCP 2.5 s · CLS 0 · SI 3.2 s                                          |
| `/pricing` mobile              | perf 72 · LCP 4.6 s · FCP 3.9 s · SI 5.3 s                           | perf 77 · LCP 4.7 s · FCP 3.2 s · SI 3.3 s (measured before the low-priority bundle change) |
| `/`, `/en`, `/pricing` desktop | perf 98 / 96 / 98 · LCP 0.9–1.1 s · CLS ≤ 0.04                       | not re-run                                                                                  |
| SEO / best practices           | 100 / 79 on every page                                               | 100 / 79                                                                                    |

What Lighthouse named, and what was changed for each:

| Finding                                                                                                      | Change                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cdn.paddle.com/paddle/v2/paddle.js` render-blocking, est. 926 ms                                            | `defer` on the script in `index.html`; checkout reads `window.Paddle` at click time                                                                                                                                                                 |
| Layout shift on `section.lp-hero`, CLS 0.279 — the H1 swapping into the display bold after first paint       | `arabic-regular.woff2` / `arabic-bold.woff2` (67,828 / 69,436 bytes; TTF kept as fallback) listed first in `landing.css`; the prerender preloads both on Arabic pages and `readex-latin-700/400` on English ones; checked per page by the prerender |
| Bundle (218 kB) fetched at High priority on a page whose words are already in the HTML                       | `fetchpriority="low"` on the module script of prerendered pages only (`app.html` untouched)                                                                                                                                                         |
| `color-contrast` on `.lp-hero-word` (1.14:1, decorative, `aria-hidden`)                                      | the word is drawn by `::after { content: attr(data-word) }` — no text node                                                                                                                                                                          |
| `label-content-name-mismatch` on the language switch (`aria-label` in one language over a word in the other) | `aria-label` removed; the visible word is the name; `switchLabel` deleted from both string files                                                                                                                                                    |

Left as measured: LCP ≈ 4 s on simulated slow 4G is the H1's swap into the 69 kB display
bold (render delay 3.2–3.6 s of it); options recorded in `docs/seo.md` §6. Best practices
79: Paddle's third-party cookie, no source maps, the matching DevTools issue.

Checks after the wave: typecheck 0 errors; web unit tests 66 files / 408 passed; the whole
browser suite **103 passed** (1.3 m); build with every prerender check green; deployed, and the
WOFF2 files answer `200 font/woff2` from the host.

## 2026-09-17 — the metrics-matched fallback faces, measured and deployed

At the owner's instruction. Three fallback families in `apps/web/src/landing.css`
(`Audience Arabic Fallback Naskh` / `Geeza` / `Noto Sans`), each a `local()` face with
`size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`, listed after
`"Audience Arabic"` in the landing's stack.

| Step                                                                                                | Actual result                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shaped width of the hero + lead + section headings, HarfBuzz (`uharfbuzz`), Plex over each fallback | Geeza Pro 105.12 % / bold 95.25 %; Noto Naskh Arabic 104.47 % / bold 107.31 %; Noto Sans Arabic 92.89 % / bold 90.83 % (SF Arabic 99.12 %, not usable by `local()` — hidden system face)           |
| `local("Geeza Pro")`                                                                                | matched nothing in Chromium; the full name ("Geeza Pro Regular") and PostScript name ("GeezaPro") both match — every rule now lists both                                                           |
| Chrome canvas, adjusted Geeza against Plex, same passages                                           | regular 0.978 / 0.989, bold 1.013 / 1.034 → size-adjust corrected to 103.39 % / 97.48 %; after: 0.994, 1.004, 0.990, 1.010                                                                         |
| `swap-check.mjs`: 390 px, web font blocked vs loaded                                                | H1 `[221, 309]` both · lead `[552, 115]` both · CTA `[696, 92]` both · "why" heading `[1461, 109]` both · FAQ title 5606 vs 5581 (one wrap, far below the fold) · document 7311 vs 7286 px         |
| Lighthouse 12 mobile, live host, two runs each                                                      | `/`: perf 95 / 80 · LCP 2.7 / 3.9 s · FCP 1.7 / 2.9 s · CLS 0 · SI 1.7 / 4.7 s; `/pricing`: perf 79 / 79 · LCP 4.5 / 4.6 s · CLS 0. The LCP render delay (2.3–4.1 s) is still the H1's swap render |
| `tests/e2e` landing, seo, pricing                                                                   | 12 passed; web unit tests 410 passed; build and deploy green                                                                                                                                       |

Not measured: the Noto faces in Chrome on Android — no such device or font here; their
ratios are HarfBuzz's, uncorrected.

## 2026-09-17 — `font-display: optional`, tried at the owner's instruction, measured, and not kept

Deployed with `optional` on the two Arabic faces, then measured; then put back to `swap`
and deployed again. What decided it:

| Measurement                                                                                                                                                          | swap                                                                   | optional                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| Lighthouse 12 mobile, live host (simulated)                                                                                                                          | perf 73–95 · sim LCP 2.8–4.5 s · CLS 0                                 | perf 74–79 · sim LCP 4.0–4.4 s · CLS 0              |
| The same traces, **observed** FCP / LCP                                                                                                                              | 697 / 697 ms and 2249 / 2249 ms (two runs — the host varies that much) | 2398 / 2398 and 2329 / 2329 ms                      |
| A/B under control (`.cache/scratch/paint-ab.mjs`: both builds served locally, CDP slow-4G 1.6 Mbps / 150 ms, 4× CPU, cache disabled, 390 px phone, 4 cold runs each) | FCP = LCP 2372–2408 ms · CLS 0 · H1 in the web face                    | FCP = LCP 2360–2428 ms · CLS 0 · H1 in the web face |

The two are indistinguishable. In every trace the H1 is the LCP element and paints at
first paint (observed FCP = observed LCP); the later LCP Lighthouse prints is Lantern's
estimate of a page whose fonts sit in its critical path, not a second paint. `optional`
therefore had nothing to shorten, and on a visit where the preload lost the race it would
keep the page in the fallback face for good. `swap` is deployed.

The variance to know about: the live host answers the same build with an observed first
paint of 0.7 s on one run and 2.2 s on the next. Field data (CrUX) is what settles that,
and needs traffic.

2026-09-17 20:02 local, same thread: "Thank you for working with us on the YouTube
Compliance Review. We are already in the process of reviewing your request and as of this
writing, we have seen the information provided to us: Project Key, Quota Request,
Attachment." Any request for more information will come on this thread; they ask to be
told if engmlubbad@gmail.com is not the preferred contact. No action required. Status:
under review.

## 2026-09-18 — OAuth verification: one scope instead of two, second video scripted

Google's Third-Party Data Safety Team rejected the demo video (thread of 2026-09-14 /
2026-09-17, details in `docs/oauth-verification.md` §5): it did not show why
`youtube.readonly` and `youtube.force-ssl` were both necessary or why a narrower scope
could not be used. `readonly` is a subset of `force-ssl`, so `oauth-start` now requests
`force-ssl` alone; the privacy policy (ar/en) says "exactly one permission" and names why.
`legal.test.ts` asserts `youtube.readonly` is gone from the policy; the oauth fixtures
follow. `npm test` 734 passed (103 files), `tsc --noEmit` clean, prettier clean on the
touched code. The 14 September objection (pages behind sign-in) was already moot: `/`,
`/privacy-policy`, `/terms` probed `200` without credentials on 2026-09-17.

Not done here, owner-side: deploy `oauth-start`; remove `youtube.readonly` in Google Auth
Platform → Data Access and paste the §5b justification; record the §5c video (its centre
is the live `403 insufficientPermissions` under readonly, then the same call under
force-ssl); send the §5d reply on the thread. `apps/web/src/account/*`, `app.css`,
`setup-path.css` were dirty from another session and were left unstaged.

## 2026-09-18 — oauth-start deployed with the single scope, version 13

`npm run check:functions` clean (six functions), then `npx supabase functions deploy
oauth-start` by the owner ("Docker is not running" warning only — the bundle is built
remotely). `functions list` afterwards: `oauth-start` version 12 → **13**, `ACTIVE`,
`verify_jwt` false as before (the function checks the caller's Supabase session itself).
From here on the consent screen lists one scope, `youtube.force-ssl`; the demo video can be
recorded.

## 2026-09-18 — pushed and deployed: the live privacy policy names one scope

`git push origin main` (`af5526b..bf0c3a7`, includes the other session's account-page
commits and the `oauth-callback` log line), `npm run build`, `npm run deploy:preview`.
Probed after: `/en/privacy-policy` contains "exactly one permission" and zero occurrences
of `youtube.readonly`; `/privacy-policy` contains "صلاحية واحدة لا أكثر"; `/`, `/en`,
`/account`, `/terms` all `200`. Trigger: the owner's first demo take (8:00, reviewed
frame-by-frame from 80 stills) showed the live policy still saying "exactly two
permissions" at 0:26 — the code had changed on 2026-09-18 but the host had not.

## 2026-09-18 — the demo video, edited rather than re-recorded

The owner's 8:00 take was reviewed from 80 stills and a Groq Whisper transcript (key now in
`~/.config/watch/.env`, 0600). Narration confirmed: "the single Google scope we use" at
0:35, "the consent screen shows one permission" at 3:40 — nothing spoken about two scopes.
Defects: the live policy still read "exactly two permissions" (fixed by the deploy above);
the force-ssl "success" call had hit a video with comments disabled (403 commentsDisabled);
25 s of `invalid_state` after a browser back; 50 s of an empty workspace; Disconnect never
clicked; recorder toolbar and Dock in frame. The owner supplied three inserts: a policy
clip recorded before the deploy (unusable, still "two"), a 96 s clip with the 200 response
under force-ssl and a real Disconnect, and a second policy clip after the deploy.

Cut with ffmpeg (`scratchpad/video/edit.py`, ten segments, audio and video ranges chosen
separately at silence boundaries, held frames where the narration outlasts the footage,
`crop=1112:676:40:0` to drop the Dock and toolbar, loudnorm): 6:44, 20.8 MB, delivered as
`~/Downloads/audience-sentiment-oauth-demo-v2.mp4`. Verified from 101 stills at 4 s: the
consent popup with the single scope now precedes "Channel connected"; no error screen, no
old policy text, no Playground flash inside the catalogue section. Reply text in
`docs/oauth-verification.md` §5d-bis; awaiting the unlisted link to send it.

## 2026-09-18 — the OAuth-verification reply is sent

The owner pasted the new unlisted video link into Google Auth Platform → Data Access (single
scope, §5b justification) and sent the §5d-bis reply on the "[Action Needed] OAuth
Verification Request Acknowledgement" thread (~02:30 local). Status: waiting for the
Third-Party Data Safety Team; further questions arrive on that thread. `main` CI is green
again (`9867c0d`) after formatting `tests/e2e/account.spec.ts`.

## 2026-09-18 — the account redesign verified: `npm run check` stage by stage, the demo pages probed

`docs/superpowers/plans/2026-09-17-account-redesign.md`, tasks 1–8, BASE `2f128d3`, commits
`dc7b513`…`b95f7a2`. `npm run check` (`PATH` with Node 22.14.0 pinned) failed on its first two
foreground runs, both times at `test:db`, both times on the same single test:
`supabase/tests/usage_grants.test.ts > usage grants > reserve_usage spends the plan first, then
the grant, then stops`, a `Test timed out in 30000ms` — a file untouched by this phase's diff
(`git diff 2f128d3..HEAD --stat -- supabase/` shows only oauth files) and unrelated to any
account-page code. `uptime` read a load average of 25–100 across both runs on this 16-core
machine, and `ps aux` showed an external LLVM build (`clang++` compiling `llvm-project` under
`/private/tmp/s-KybF7nyE/llvm-20260918-*`) consuming most of it — the same host-load pattern
`docs/ONBOARDING.md` already documents as a trap. Isolated with `npx vitest run
supabase/tests/usage_grants.test.ts --testTimeout=120000`: 13/13 passed in 70s, confirming the
test is correct and the failure is a timing artefact of the host, not a regression. `test:db`
was rerun a third time at the default timeout and failed the same single test the same way
(load still 25–30 on 16 cores), so the chained `npm run check` command could not be made to
exit 0 without either the external build finishing or editing test/script code, both out of
scope for a records-only task. Ran the remaining stages of `npm run check` individually instead
to reach a complete, honest tally:

- `npm run lint` — clean (eslint + worker `ruff check`).
- `npm run format:check` — clean.
- `npm run typecheck` (`tsc --noEmit`) — clean.
- `npm run check:functions` (`deno check`, six functions) — clean.
- `npm test` (`vitest run --exclude "supabase/tests/**"`) — 105 files / 786 tests, green; the
  `apps/web`-only subset (`npx vitest run apps/web`) is 94 files / 669 tests, green, matching
  task 7's baseline exactly (task 8 added no test code).
- `npm run test:db` (`vitest run supabase/tests`) — 32 files / 310 tests; 309 passed, 1 timed
  out (`usage_grants.test.ts`, see above) on three separate runs, all under the same external
  build's load; not caused by this phase, not fixed here.
- `npm run worker:test` (`uv run pytest`) — 195 passed.
- `npm run build` — 8 prerendered pages (`/`, `/en`, `/pricing`, `/en/pricing`,
  `/privacy-policy`, `/en/privacy-policy`, `/terms`, `/en/terms`), sitemap and robots.txt
  written, no build errors.
- `npm run check:secrets` — 622 source files plus built assets, clean.

**e2e, not rerun here** (`npm run check` does not run Playwright — confirmed by reading
`package.json`'s `check` script, which chains lint/format/typecheck/check:functions/test/
test:db/worker:test/build/check:secrets and nothing under `test:e2e*`). The counts carried
forward from task 6's and task 7's own foreground runs: `tests/e2e/account.spec.ts` 9/9 on its
own; full `npm run test:e2e` 123 tests (114 carried + 9 new) at task 6's close; task 7's two
foreground reruns of the full suite landed 116–117/123 under the same external-LLVM-build host
load documented above, always the same six tests (the first, heaviest-route test Playwright
dispatches to each of six spec files, cold-compiling that route's modules), each re-passing
alone under `--workers=1`; 123/123 was reached before that load began. `npm run test:e2e:build`
is 6/6, unaffected either time.

**The demo pages, probed.** `/account?demo=1` and `/account` (no demo) were exercised across
tasks 5–7's own dev-server probes (ports 5175/5176, killed after each) and again in task 6's
Playwright suite: three workspace cards, three `role=progressbar` plan meters, rename,
disconnect, retire down to one card then refused, create a fourth workspace, the
connect/top-up `demoExternalNote`, and the no-demo fallback to `account-unavailable` — all
against the real `/account` component tree, not a stand-in. This task did not repeat those
probes; it is a records-only task and made no code change to verify against.

**Screenshots.** `.superpowers/sdd/2026-09-17-account-redesign/shots/` (git-ignored, on disk)
holds `account-1280.png`/`account-390.png` (signed-out entry), `demo-1280.png`/`demo-390.png`
(`/account?demo=1`), `entry-1280.png`/`entry-390.png`, and task 7's post-`rp-*`-removal set
(`after-dashboard.png`, `after-sync.png`, `after-admin.png`, `after-account-demo.png`,
`after-account.png`) — the last two confirmed byte-identical / same-size against task 5's
pre-removal captures, i.e. deleting the CSS changed nothing any of these four pages render.
The top-level `.screenshots/` (untracked, dated 2026-09-14/15, unrelated to this phase) was not
touched.

**Host-load caveat, stated once for both suites above:** every failure recorded in this entry —
the one `test:db` timeout and task 7's 116–117/123 e2e runs — occurred while an external LLVM
build held this machine's load average at 25–281 across a 16-core machine, and every one
resolved (passed in isolation, or was reproduced with a generous timeout) once load-driven
timing was accounted for. None touched account-redesign code; none is treated here as a defect
in this phase's work.

## 2026-09-18 — the owner's video selection was refused by the browser alone; the worker's two tenants

**Reproduced before the fix**, on the contract with a small script under
`node --experimental-strip-types`: `selectionEstimate(rows, {new}, -1)` →
`{ remainingAfter: -3, exceeds: true }`; `fitNewest(rows, Math.max(0, -1 - 1))` → `[]`. The
same shape as the two screenshots («المحدد: 789 فيديو · حتى 1 تعليقًا · الاختيار يتجاوز…»,
then 793 and 10). Read, not run: `private.analysis_remaining` as last rebuilt in
`20260917060000` returns `2147483647` for a null `analysis_units`, so the refusal never
reached the server; the owner's plan row in `20260917010000` has null for all three units.

**Red, then green.** `packages/contracts/src/selection.test.ts`: 2 failed / 8 passed before the
contract change — the -1 case answered `exceeds: true, remainingAfter: -42`, and the first
case's `toEqual` lacked the new `unlimited` field — 10/10 after. `apps/web/src/ops/Catalogue.test.tsx`:
the new case red on «المحدد: 2 فيديو · حتى 3 تعليقًا · يتبقى بعدها 0» where «بلا حدود» was
expected, green once `SelectionBar` and `Catalogue` changed; 14/14. `tests/e2e/dashboard.spec.ts`
"a plan with no ceiling never exceeds, and the save is offered": red on the same sentence
before the component change, green after (2.9 s). The `fitNewest(rows, Infinity)` case passed
as written — a characterisation of arithmetic the component now relies on, not a red.

**`npm run check`**, chained, exit 0, on a tree that by then also carried the other session's
tour commits through `847c369`: lint, format:check, typecheck, `check:functions`; unit 110
files / 858 tests; db 32 files / 310 tests, no timeout this time; worker 195; build 8
prerendered pages; secrets 637 source files plus built assets.

**Whole dashboard browser spec** (`tests/e2e/dashboard.spec.ts`, 79 tests): 78 passed, 1 failed
on the first run — "the catalogue is paged by fifty, and the selection is not", `cat-page` not
found after «التالية», while the other session was saving `tour/*` files into the same working
tree the dev server was serving. Rerun alone on a free port (`E2E_PORT=5198`): passed in 3.1 s.
Run against the deploy worktree's source (`46ec419` + `699bbba`, `E2E_PORT=5199`) together with
the new case: 2/2. The failure did not reproduce and is attributed to a mid-run reload; not a
regression of this change.

**The deploy: built, verified against the host, not uploaded.** `curl` of `PREVIEW_URL/`
found the host serving `static/index-BmIMt0s_.js` with no `tour:v1` marker in it. A detached
worktree at `46ec419` (node*modules linked in, `@sentiment/*` re-pointed at the worktree's
own packages, `.env.local` copied) built to exactly `index-BmIMt0s*.js`— so the host is at`46ec419`. `699bbba`cherry-picked onto it built to`index-CxI1oaAs.js`, and its `Sync-\*`chunk
carries the new`unlimited`branch.`scripts/deploy-preview.sh` from that worktree was refused
by the Claude Code auto-mode guard ("Production Deploy") and was not retried; the worktree is
left in place under the session's scratch directory for the operator to run the script from,
or to grant the permission. Until then the host still refuses the owner's selections.

**Not verified:** the owner ticking a video and saving on the live host after the deploy — needs
the owner's own session and the upload above.

**The second problem — «الجمع متوقّف الآن» for a `creator_plus` tenant — diagnosed from the
code and the service log, not fixed.**

- `public.worker_seen` is written per workspace by `claim_job`, and `sync_state.worker.connected`
  reads it: a workspace is "connected" only if a worker asked _that workspace_ for work in the
  last three minutes (`20260914200000`). A worker asks on behalf of one credential, and a
  credential is bound to one workspace (`private.worker_credentials.workspace_id`, not null).
- The service (`scripts/worker-service.sh`) holds exactly two: `WORKER_CREDENTIAL` and
  `WORKER_CREDENTIAL_WS2` (`tenants=2` in the log). A workspace created by a signup has no
  credential, so nothing ever asks for its jobs, its discover job stays `queued`, and the page
  says so honestly. This is structural: every new customer needs the operator to mint a
  credential (`svc_register_worker_credential`), add it to the service's `.env.local`, extend
  the service script (it knows only `_WS2`) and restart — or the model changes to a
  platform-wide credential.
- Separately, `service.log` shows `control plane refused: invalid_worker_credential` and
  `tick refused: invalid_worker_credential` once per round since 2026-09-17 01:23:36 local
  (3,658 refusals by 11:50 on 09-18), after a healthy `comment counts` pass at 01:15. Exactly
  one refusal per round with two tenants means one credential is dead and the other still
  polls and reads counts (`748 unchanged` at 11:46). Both credential values are byte-identical
  between the repo's `.env.local` and the service's copy, so the change was on the server. The
  timeline fits the delete door: `delete_workspace` (`20260917100000`, commits 00:24–01:38 that
  night) deletes `private.worker_credentials` of the workspace it removes, and a test
  workspace deleted then would have taken its credential with it. Confirmation needs one read
  of `private.worker_credentials` on the live project; `npx supabase db query --linked` for it
  was refused by the auto-mode guard ("Production Reads") and left to the operator.
- The worker's Python is unchanged since its checkout (`88a918b`; no commits under `workers/`
  since), so a restart with a corrected credential list needs no code update.

## 2026-09-18 — the onboarding tour: the browser suite, the full e2e, the build, and `npm run check`

`docs/superpowers/plans/2026-09-18-onboarding-tour.md`, task 4, on top of tasks 1–3's
`6649c60`…`51b5b2e`. New file `tests/e2e/tour.spec.ts` (four tests, `storageState` reset to
empty and `reducedMotion: "reduce"` per task 3's own note); no tour or page code needed a fix
— all four tests passed the first time they were run against the existing implementation.

**`npx playwright test tests/e2e/tour.spec.ts` alone: 4/4 passed** (19.9s) — the full walk
(welcome → seven steps across `/dashboard`, `/account`, `/sync` and back → finish → replay),
the auto-started welcome dismissed as "dismissed" and staying closed on reload, the 390×844
phone layout (`rail-menu` lit, card ≤ 358px wide, `scrollWidth` ≤ 390), and Escape on step 3
ending the tour as "seen" with no card left open.

**Full `npm run test:e2e`, three foreground runs.** First run: 120 passed, 8 failed — every
failure the first, heaviest test dispatched to its spec file (`account.spec.ts`,
`admin.spec.ts`, `app-shell.spec.ts`, two in `dashboard.spec.ts`, two in `demo.spec.ts`,
`landing.spec.ts`), none of them `tour.spec.ts`, none of them touching tour code. `uptime` at
the time read a load average of 18–32 on this 16-core machine — the same
cold-compile-under-host-load pattern the account-redesign entry above already documents (there
it was an external LLVM build; here nothing was identified beyond the load figure itself, but
the signature — always the dispatch-first test of a file, never a repeat, never a tour test —
matches). All eight were rerun and passed: six of them (`account`, `admin`, `app-shell`, both
`dashboard` ones) in one `--workers=1` pass across their five files before it was stopped
partway through (all five files' first tests had already passed by then); the other two
(`demo.spec.ts`, `landing.spec.ts`) in a second, separate run, 7/7. A third, clean full run
with load back down to 7–20 reached **128 passed, 0 failed, in 2.5 minutes** — the number this
entry stands on. 128 = 124 carried from the account-redesign close (`docs/verification.md`'s
2026-09-18 entry above cites 123 at that point; the one more is `699bbba`'s
`tests/e2e/dashboard.spec.ts` test — the owner's plan with no ceiling, «بلا حدود» in the
selection bar — from the other session's owner-plan fix) + 4 new in `tour.spec.ts`.

**`npm run test:e2e:build`: 6/6 passed** (12.5s), unchanged from before this task.

**`npm run check`, one clean foreground run, no isolation needed:**

- `npm run lint` — clean (eslint + worker `ruff check`).
- `npm run format:check` — clean, `tests/e2e/tour.spec.ts` included in the glob (no scoped
  prettier run was needed; the file was already Prettier-formatted as written).
- `npm run typecheck` (`tsc --noEmit`) — clean.
- `npm run check:functions` (`deno check`, six functions) — clean.
- `npm test` (`vitest run --exclude "supabase/tests/**"`) — **110 files / 860 tests**, green.
- `npm run test:db` (`vitest run supabase/tests`) — **33 files / 316 tests**, green (no
  timeout this run).
- `npm run worker:test` (`uv run pytest`) — **195 passed**.
- `npm run build` — **8 prerendered pages** (`/`, `/en`, `/pricing`, `/en/pricing`,
  `/privacy-policy`, `/en/privacy-policy`, `/terms`, `/en/terms`), no build errors.
- `npm run check:secrets` — **642 source files plus built assets**, clean.

**The lazy chunk, measured off a real build** (task 2's own figure was against a placeholder
`Tour.tsx` standing in for the chunk before task 3 built the actual veil/card/welcome):
`dist/static/Tour-*.js` 4.59 kB (gzip 2.01) + `Tour-*.css` 1.09 kB (gzip 0.56); the eager
`index-*.js` sits at 776.90 kB (gzip 235.42), consistent with task 2's measured
provider+entry+storage delta (+4.43 kB / +1.42 gzip) over the pre-tour baseline — the welcome,
card and veil never rode the main bundle.

**Not touched, not needed for this task:** `supabase/**` (a different session is mid-work
there — `488bcd2`…`900b83d`, a platform-worker-credential redesign, unrelated to the tour);
`.screenshots/`; `docs/oauth-*`; `apps/web/src/legal/*`.

## 2026-09-18 — the platform worker credential: red then green per task, three mutations, the check; the owner-plan fix live

**The suite** `supabase/tests/platform_worker.test.ts` runs on PGlite with pgcrypto installed
in an `extensions` schema, as Supabase installs it, so `svc_register_platform_worker_credential`
hashes for real rather than the suite inserting digests by hand. Per task, watched red first:

- Task 1 (the column and the doors): red in `beforeAll` — `function
public.svc_register_platform_worker_credential(unknown, unknown) does not exist`; once the
  migration existed, `schema "extensions" does not exist` — the suite's own gap, closed by
  loading `@electric-sql/pglite/contrib/pgcrypto`; 2/2 green.
- Task 2 (the claim and the sighting): 4 red on `invalid_worker_credential` — the fourth an
  artefact: a failing assertion had left `set role authenticated` on the suite's one connection,
  now reset in a `finally`; after the two rewrites the sighting case was still red on six
  workspaces where three were expected, because the migrations seed workspaces of their own —
  the assertion now says _every_ workspace; 6/6 green.
- Task 3 (the guard, the grants, the tick): 3 red — `null value in column "workspace_id" of
relation "videos"` (the guard's null reaching a catalogue commit), `forbidden`
  (`worker_mark_revoked`), `no_active_plan` (the tick pricing a null workspace); after the
  rewrites 2 red — `Invalid input for bytea type` (the driver takes bytes; the test now passes a
  `::bytea` literal) and the scoped tick answering `{discover, collect, analyse}`:
  `schedule_due_work` had gained a third counter in `20260916011000` that the spec had missed,
  so the platform tick now sums all three; 9/9 green. The spec and plan were corrected
  (`12e8658`).
- Task 4 (the retire guard): red on `keep_at_least_one`; 10/10 green, and
  `worker_catalogue.test.ts`'s own empty-keep refusal still green — its database holds no
  platform credential.

**Mutations**, the migration backed up to the scratch directory and restored by copy (`cmp`
identical afterwards), each followed by a 10/10 rerun: (M1) the claim predicate without
`w is null or` → 3 failed — the claim case and the two that need a claimed job; (M2) the
platform poll leaving no sighting → 2 failed — the sighting and the connected read; (M3)
`worker_job` answering the credential's workspace instead of the job's → 1 failed — the
end-to-end case, at the catalogue commit. Reverting the guard's comparison alone raises
nothing (`null <> uuid` is null), which is why the suite commits a catalogue rather than only
heartbeating; the spec records this.

**Neighbouring suites** after each task — `worker_gateway`, `worker_catalogue`,
`worker_video_counts`, `worker_topics`, `oauth`, `lease_recovery`, `end_to_end`,
`workspace_lifecycle` — 93 tests, green and unchanged: scoped credentials behave as before.

**`npm run check`**, chained, exit 0: lint, format:check, typecheck, `check:functions`; unit
110 files / 860 tests; db 33 files / 320 tests (the new file's 10 included); worker 195; build 8
prerendered pages; secrets 642 source files plus built assets.

**Not verified:** a live claim by a platform credential, a live platform tick, and «متصل» on the
`creator_plus` tenant's page — all need the rollout (migration push, registration, the service's
env and restart), which is the operator's hand and is listed in `docs/progress.md`.

**The owner-plan fix is live.** The morning's entry left `scripts/deploy-preview.sh` refused by
the auto-mode guard. The operator ran it from the worktree (`46ec419` + `699bbba`). The first
run failed inside `check-secrets.mjs` with `EISDIR`: the worktree's `apps/web/node_modules` was
a symlink, which `git ls-files --others` lists as an untracked file (a directory pattern never
matches a symlink) and the scanner then tried to read; the link removed, the second run put
every file up with `226` and swept 22 stale assets. Fetched afterwards: the host serves
`static/index-CxI1oaAs.js`, `static/Sync-B7Lhs7Qv.js` carries the `unlimited` branch, and the
old entry address answers the shell's HTML (`text/html`, `cf-cache-status: BYPASS`), not the old
bundle. The worktree is removed. Still not verified: the owner ticking and saving on the live
host — their own session.

## 2026-09-18 — the platform worker credential rolled out: what the log and the doors answered

- `supabase db push --linked`: «Applying migration 20260918130000_a_platform_worker_credential.sql… Finished».
- `svc_register_platform_worker_credential` over `supabase db query --linked`: first call with the
  literal placeholder refused `weak_credential` (the 32-character floor, working as designed);
  second call with the 64-hex secret answered id `7abfe195-b3d4-4fe6-9527-7d4f4b022bf2`.
- Service log after `scripts/worker-service-update.sh` on the corrected env: `worker up,
model=camelbert-da, tenants=1, topics=gemini` at 12:59:53 local; `invalid_worker_credential`
  count since then: 0 (it was ~1/minute since 2026-09-17 01:23).
- `svc_retire_worker_credentials('d0c3b9fc-b813-439e-a32b-71dd357f0bb4', '{}')` → `1`: the
  empty keep accepted live because an active platform credential exists — the guard rebuilt in
  section 8 of the migration, seen on the real project.
- The mishap in between (placeholder written into `.env.local`, service restarted on it,
  `syntax error near unexpected token 'newline'` in launchd's loop, `last exit code = 2`) and
  its repair are in `docs/progress.md`'s entry of the same date.

**Not verified here:** a claim of the `creator_plus` tenant's discover job and «متصل» on its
operations page — the read-only query is with the operator; the runner writes no log line for
a successful claim or discover, only `comment counts` lines during a collect.

## 2026-09-19 — admin observability RPCs, phase one

- `tsc --noEmit` clean (whole repo, includes the four new pages and the extended contracts).
- `eslint` clean on `apps/web/src/admin/**`, `packages/contracts/src/admin.ts`,
  `supabase/tests/admin_observability.test.ts`, `main.tsx`, `strings/**`.
- The PGlite suite could not run under vitest in this shell (no npm; rollup's darwin-arm64 native
  module cannot load into the available Node build). Instead: a standalone script running the same
  migrations on PGlite with the same fixture and the same assertions — **30/30 pass**: the gate
  refuses all four RPCs to a non-admin and answers the admin; `admin_users` returns one row per
  user with workspace/owner counts (owner 2/2 counting the bootstrap personal workspace, admin 1/1);
  `admin_channels` carries the counts and the failed run's verdict and error code; `admin_ops`
  reports 4 workspaces (three bootstrap-personal, one named), the failed-runs list with its error
  code, `worker_fresh` true, the queue length; `admin_audit` attaches actor email and workspace
  name and refuses limits 0 and 501; and after all reads, `audit_events` still holds exactly one
  row, counted as the superuser (as `authenticated` the table's RLS hides the trail from a reader
  who is not a member — the RPC is the admin's only window, by design).
- **Not run here:** the vitest suite itself (`npm run test:db`) and the Playwright suite — both
  blocked by the toolchain above; the vitest file `supabase/tests/admin_observability.test.ts`
  mirrors the standalone script and is the one the repo gate runs. The browser pages were not
  exercised live against the hosted project either — no session here.

**Addendum, same day — the security and technical review:**

- Secrets scan (`scripts/check-secrets.mjs`) passed over 661 source files.
- No `dangerouslySetInnerHTML`/`innerHTML` anywhere in the new admin code; errors surface as
  codes only, rows render through React's escaping.
- All four RPCs: `security definer` + `set search_path=''` + fully qualified names, the
  `is_platform_admin()` raise at the head, `revoke all` then `grant execute to authenticated` —
  four for four, matching the house pattern. No dynamic SQL; the one parameter (`p_limit`) is an
  int range-checked at both ends. PII (emails) flows only through the gated RPCs and from
  `auth.users` columns alone — no raw_user_meta_data, no tokens.
- Performance: three indexes added to `20260919160000` before it applies anywhere —
  `sync_runs_channel_started` (the per-channel lateral was a full sync_runs scan per channel;
  `sync_runs_recent` leads with workspace_id and cannot serve it), `sync_runs_failed_recent`
  (partial, the failed-runs list and phase two's health tick), `comments_first_seen` (the weekly
  count was a full scan of a grow-only table; phase two's scheduled signals ask the same).
  Verified created in the bootstrap; the standalone 30/30 run re-passed on top of them.
- Known, deliberate: admin reads write no audit rows (phase four's writes will, each with its
  own guard); the reads are platform-wide by design, which is what the page is for.

## 2026-09-19 — the TypeSafe topic classifier: what was actually run

- Unit: `pytest tests/test_typesafe.py` under the project venv, 13/13, plus the
  existing `tests/test_gemini.py` and `tests/test_topics.py` (24) green on the same
  tree — 37 passed in one run against the current dirty worktree.
- Live, through the adapter (not a mock): `TypeSafeTopicClassifier(key, httpx.Client())`
  against the real `api.typesafe.ai/v1/systemone` with the default taxonomy and 7 items
  (including the "آمين"-with-parent reply and a purged text). Verdicts correct on all
  classifiable items, the purged text returned `skipped` and its bytes were confirmed
  absent from the request state, total wall time under one second.
- Head-to-head, same batch of 12 comments to both providers: Gemini `gemini-3.6-flash`
  with the exact production request shape from `topics/gemini.py` (temperature 0,
  thinkingBudget 0, responseSchema enum, BLOCK_NONE safety settings) vs TypeSafe
  `jev-latest` — 11/12 same topic; the disagreement is a genuinely ambiguous comment
  (criticism vs discussion) where TypeSafe's distribution said 0.68/0.30 and Gemini's
  self-reported confidence said 0.95. Router variant: one request with 15 parallel
  `noul` questions over 14 comments classified 5 as no-topic skips and preserved the
  project's reply-context semantics (0.77 interpretable → passed, matching what the
  Gemini prompt does today).
- Honest limits: 12 comments is a demonstration, not a benchmark; thresholds (0.5
  routing, escalation confidence) are uncalibrated until run over a real channel's
  comments. Token counts are not comparable across the two providers' tokenizers;
  cost depends on each provider's pricing. The loop.py wiring is pending, see the
  progress entry of the same date.

## 2026-09-19 — the live push and what the operator should click through

- `supabase db push --linked` (CLI v2.117.0, downloaded release binary): applied
  `20260919160000_admin_observability` + `20260919170000_worker_renews_its_token`; "Finished".
- REST probe with the service-role key: `admin_users`, `admin_channels`, `admin_ops`,
  `admin_audit(p_limit:0)` → HTTP 403 `42501 forbidden` × 4. Existence + gate, both live. (A
  signed-in-as-admin probe was deliberately not attempted — minting an admin `sub` token would
  forge the identity the row-based gate exists to honour.)
- Host `app.sky-develop.net` HTTP 200; serving the previous bundle still.

**Operator checklist, once `npm run build && npm run deploy:preview` ships the new bundle —
sign in as the platform admin and walk:**

1. `/admin` — the tab strip appears under the head (demo mode keeps it hidden, as designed).
2. `/admin/users` — one row per signed-up user; the owner's counts include their personal
   workspace (bootstrap trigger); the PII note under the table.
3. `/admin/channels` — AJ360's real counts, its last run verdict; a channel whose last run
   failed shows the error code under its name.
4. `/admin/ops` — the seven cards; `worker_fresh` says «العامل يعمل» while the worker service
   polls; the failed-runs table lists the last two weeks, «قناة محذوفة» if a handle is gone.
5. `/admin/audit` — the trail with actor emails; the 100/300/500 rungs re-query.
6. Signed out, or signed in as a non-admin: every one of the five screens says one sentence and
   shows no table (`admin-forbidden`), and the rail's «الإدارة» link is absent.

## 2026-09-19 — token-renewal lane: check gates and the worker v17 deploy

- **Live project, via Management API:** `20260919170000_worker_renews_its_token`
  is present in `supabase_migrations.schema_migrations` (queried, not assumed
  from `db push` output — no push was needed).
- **Deployed `worker` v17** (`supabase functions deploy worker
--project-ref ykqugctewsqvevhyqtbi --no-verify-jwt`, run from a clean
  worktree at `b3c3b95` so only committed code shipped). Function API reads
  back `version 17, verify_jwt false, status ACTIVE`.
- **Live probe:** `POST /functions/v1/worker/claim` with a bogus credential →
  `HTTP 401 {"code":"invalid_worker_credential"}` — the request reaches the
  gateway's own auth layer (Supabase JWT verification is off, as before) and
  the function executes. The renewal route itself is covered by its five
  handler tests, now actually executed (`87ff30a`).
- **Gates at `b3c3b95`:** lint ✓ · format:check ✓ · typecheck ✓ ·
  check:functions ✓ · unit 110 files / 863 tests ✓ · python worker 218 ✓ ·
  build ✓ · check:secrets ✓ (671 files + built assets). **Not green:
  `npm run test:db` = 334 passed / 5 failed** — `scoped_claim.test.ts` (3,
  incl. the `jobs_one_outstanding_collect` constraint violation) and
  `end_to_end.test.ts` (2). Those files are the Bionic session's 2026-09-19
  work, recorded there as never executed; not this lane's to rewrite.
- Not verified here: no live claim was taken (that would consume a real job),
  so the renewal route was not exercised against the deployed function with a
  real credential; the first long collection run will.

2026-09-19, the channel-lookup lane (public-data channel addition): every gate run
locally, all green.

- **Gates:** lint ✓ · format:check ✓ · typecheck ✓ · check:functions (deno) ✓ ·
  unit 110 files / 867 tests ✓ · **test:db 37 files / 353 tests ✓** · python
  worker 227 tests ✓ (incl. the new `test_public_channel.py`) · build ✓ (8
  prerendered pages) · check:secrets ✓ (672 files + built assets).
- **New coverage:** `channel_query.test.ts` (the link/handle/id/search parser),
  `public_channel.test.ts` (register: metadata filed, public status only,
  re-add idempotent, non-member/viewer/other-client refusals, blank-null,
  overlong refused, discovery reachable without a plan gap), gateway handler
  public-id presence/absence, worker public discover/collect/blocked paths and
  key-only catalogue by id.
- **Repaired on first execution** (the Bionic lane's 2026-09-19 files, recorded
  there as never run; fixture fixes only, no product SQL): `scoped_claim.test.ts`
  — jobs bled across tests into `jobs_one_outstanding_collect`, and the ordering
  test raced on same-microsecond `not_before` (now strictly ordered, and the
  order is asserted across two claims, since one claim hands out one job);
  `end_to_end.test.ts` — the pinned claim key list predated
  `access_token_expires_at` (token-renewal lane) and `external_channel_id` (this
  lane), and the topics-due failure was its cascade (the commit under test never
  ran); `worker_video_counts.test.ts` — due-list order asserted over random
  video uuids, now seeded ordered.
- **Not verified (blocked on credentials/deploy):** no live Data API call was
  made — `YOUTUBE_API_KEY` is not set in this environment, so the lookup
  function and the worker's public path are fixture-tested only; the migration
  is not applied to the live project; the `channel-lookup` function is not
  deployed (`supabase secrets set YOUTUBE_API_KEY`, then `supabase functions
deploy channel-lookup`, then `db push` — operator steps, in that order); and
  the door was not walked in a browser signed in, because the browser suite
  runs signed out. The e2e gap is the account page's standing one, not new.

2026-09-19, live rollout of the public-channel path: `20260919180000` applied
and read back via the Management API migration table; `channel-lookup` v1 and
`worker` v18 ACTIVE (channel-lookup verify_jwt=true: no/bad JWT → 401 /
UNAUTHORIZED_INVALID_JWT, probed live; worker verify_jwt=false as before);
`ALLOWED_ORIGINS` present, `YOUTUBE_API_KEY` absent in the secrets list. The
lookup function has not answered a real lookup yet — that needs the operator's
API key — so `YOUTUBE_API_KEY`-dependent behaviour remains fixture-tested only.
The worker service itself was left untouched: the update script run from this
second account (`muhammed`) produced an EX_CONFIG crash loop against the
hard-coded `mlubbad` paths and was uninstalled here; the script now templates
the home paths, so rerunning it from the service's own account applies main
cleanly.

## 2026-09-19 — live verification: platform OAuth reader and public channel discovery

- **Live Channel Lookup Verification**:
  - Probed Edge Function `channel-lookup` via POST with JWT membership:
    - Handle `@alaa_jaber_official`: correctly parsed handle, fetched channel from YouTube Data API v3 via platform reader grant (`channel_lookup_reader_grant`), returning title "علاء جابر | Alaa Jaber", channel ID `UC-7b_c5pT2t1p7y9p_b69sw`, thumbnail, and video count (194).
    - Query "علاء جابر": executed search query against YouTube Data API v3, returning 5 matching channel candidates with Arabic titles.
- **Live Channel Registration & Video Discovery**:
  - Registered channel `ebb2cff8-58eb-4228-ab9c-3daa2e66d123` into workspace `d0c3b9fc-34bf-4ec6-8fef-93c4a22ad31e` with status `public_unverified`.
  - Triggered catalogue discovery job `request_discovery`: claimed by worker via gateway, authenticated using platform reader access token, discovered and stored 194 videos into `videos` table.
- **Automated Test Gates**:
  - `npm test`: 110 test files passed, 865 tests passed.
  - `npm run test:db`: 38 test files passed, 361 tests passed (including `public_channel.test.ts` and `platform_reader.test.ts`).
  - Python worker pytest: 229 passed in 4.24s.
  - TypeScript typecheck: `tsc --noEmit` clean.
  - Edge function checks: `npx deno check supabase/functions/*/index.ts` clean.
  - Production web build: `npm run build` completed, 8 prerendered pages.
  - Secret scan: `node scripts/check-secrets.mjs` passed with zero secrets.
  - Preview deploy: `npm run deploy:preview` uploaded assets cleanly to preview host.

## 2026-09-19 — live verification: CORS preflight with x-client-info

- **Root Cause Verified**:
  Simulating browser preflight request with curl:
  `curl -i -X OPTIONS "https://ykqugctewsqvevhyqtbi.supabase.co/functions/v1/channel-lookup" -H "Origin: https://app.sky-develop.net" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type,apikey,x-client-info"`
  Failed to include `x-client-info` in `access-control-allow-headers`, causing browser preflight refusal.
- **Fixed & Verified**:
  After updating `_shared/cors.ts` and redeploying `channel-lookup`, live curl preflight test returned:
  `HTTP/2 204`
  `access-control-allow-origin: https://app.sky-develop.net`
  `access-control-allow-headers: authorization,content-type,apikey,x-client-info`
  `access-control-allow-methods: POST, OPTIONS`
- **Unit test**:
  `npx vitest run supabase/tests/cors.test.ts` passed (4/4 tests).
- **Full verification check**:
  `npm run check` passed completely green across all gates (lint, format, typecheck, check:functions, test, test:db, worker:test, build, check:secrets).
- **Preview deployed**:
  `npm run deploy:preview` uploaded cleanly (HTTP 226 / gone, exit code 0).

## 2026-09-20 — verification: Continuous Deployment with GitHub Actions, FTPS, and Remote Migrations

- **Workflow Syntax Validation**:
  - Python YAML safe_load check: `.github/workflows/deploy.yml` parsed valid with keys `['name', True, 'permissions', 'concurrency', 'jobs']`.
- **Security & SHA Pinning Audit**:
  - Actions pinned to commit SHAs: `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683` (v4.2.2), `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` (v4.4.0).
  - Security gates: Semgrep SAST completed without new blocking findings; `check-secrets.mjs` confirmed zero committed secrets in source and built bundles.
- **Local Remote Migration Validation (`npm run db:migrate:remote`)**:
  - Executed against live Supabase project `ykqugctewsqvevhyqtbi`:
    `Connecting to Supabase project [ykqugctewsqvevhyqtbi]...`
    `Database is up to date (78 migrations applied, 0 pending).`
  - Exit code 0, 0 pending.
- **Full Gate Verification (`npm run check`)**:
  - ESLint + Ruff: clean.
  - Prettier formatting: clean.
  - TypeScript typecheck: clean (0 errors).
  - Edge Functions: Deno check clean.
  - Web unit tests: 111 test files, 874 passed.
  - DB tests (PGlite): 39 test files, 365 passed.
  - Worker tests (pytest): 229 passed in 4.27s.
  - Production build: Vite + prerender 8 pages clean.
  - Secret scan: 688 source files + built assets clean.
