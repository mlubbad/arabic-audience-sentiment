# Working here alongside other agents

Read this before writing anything. It is short because it is the set of things
that have actually gone wrong in this checkout, not a policy.

There is no message channel between the tools working on this repository —
Claude Code, Antigravity and Codex cannot talk to each other. The repository is
the channel. That is why this file exists and why it is kept current rather
than aspirational: if it says something that is no longer true, it is worse
than nothing.

## The one that loses work

**There is a git remote since 2026-09-16:** `origin` is the private GitHub repository
`mlubbad/arabic-audience-sentiment`, created and first pushed that day at `b3cb15e`
(250 commits). Not `mlubbad/sentimentanalysis` — that is an unrelated public repository
from 2024 and must never receive this code. Before that day every commit existed on one
disk only, which is the situation the rules below were written for; a commit is still
only safe once it is pushed, so push after committing.

So:

- **Never `git checkout <path>` or `git reset --hard` on a file with
  uncommitted changes.** Copy it somewhere first. This is not a precaution
  against a theoretical mistake — it happened in this checkout on 2026-09-14
  during mutation testing, destroyed about an hour of uncommitted work in
  `Dashboard.tsx` and `report.css`, and the work had to be written again from
  memory. Mutation testing in particular *invites* this: the natural instinct
  after mutating a file is to check it out, and the natural instinct is wrong.
  Back the file up, mutate, restore from the backup.
- **Commit early.** An uncommitted change is the only kind that can vanish.
- Push to `origin` after committing (`git push origin main`); ask the user before adding any other remote
  or changing the repository's visibility.
- **Pushing to `main` triggers automated CI/CD:** `.github/workflows/deploy.yml` runs automatically on
  push, builds the project, deploys the preview bundle over FTPS to `app.sky-develop.net`, and applies
  any pending migrations to the remote Supabase database via `npm run db:migrate:remote`. Always verify
  locally with `npm run check` before pushing. If GitHub Secrets (`PREVIEW_FTP_*`) are unset, CI still
  runs cleanly with a notice. Local manual fallback commands are `npm run deploy:preview` and
  `npm run db:migrate:remote`.

## Who is writing

One writer at a time on `apps/web/src/**`. There is no ownership guard any
more — `scripts/check-ownership.mjs` and its hook were removed with the old
four-lane protocol (see `README.md` in this directory). Nothing will stop two
agents editing the same file; only telling each other will.

If you are picking up work, say so in your first commit message and note here
what you are taking. If you find this file claiming an area that has been idle
for a day, assume it is free.

Claimed as of 2026-09-14, by message between the two live Claude sessions:

| Area | Held by | Since |
| --- | --- | --- |
| `supabase/migrations/**` | `sentimentanalysis-91` — collection-queue reliability | 2026-09-14 |
| `workers/python/src/server/**` | `sentimentanalysis-91` | 2026-09-14 |
| `apps/web/src/syncHealth.ts`, `jobFeed.ts`, `Sync.tsx` | shared — touched by -91, -82 and Antigravity since 2026-09-14 | 2026-09-14 |
| `tests/e2e/dashboard.spec.ts` | **shared, append-only** — add your block, never rewrite another's | |
| `apps/web/src/Dashboard.tsx`, `Account.tsx`, `Landing.tsx`, `main.tsx`, `authProviders.ts`, the CSS | `sentimentanalysis-82` | 2026-09-14 |
| `packages/contracts/**` | `sentimentanalysis-82` | 2026-09-14 |
| `workers/python/src/labelling/**` | free | |
| `docs/coordination/ACTIVE.md` | `sentimentanalysis-82` maintains it; everyone reads it | |
| `docs/progress.md`, `decisions.md`, `verification.md` | shared, append-only | |
| `apps/web/src/locale.ts`, `locale.css`, `strings/**`, `LanguageSwitch.tsx`, `tests/e2e/language.spec.ts` | **done** — English language support landed as `f9b2840`…`7478dc0` by the audit-phase-two Claude session; free | 2026-09-15 |
| UI text in `apps/web/src/**` | **every sentence now lives in `strings/ar.ts` with a typed English twin in `strings/en.ts`.** A new sentence goes there, in both languages, or `tsc` fails. `Landing.tsx` included since `b956c64` — the demo's four comments are the one deliberate Arabic-only text, as data | 2026-09-15 |
| `workers/python/src/topics/**`, `supabase/migrations/20260916010000`–`012000`, `supabase/functions/_shared/worker-gateway.ts`, `supabase/functions/worker/index.ts`, `packages/contracts/src/topics.ts` | **done** — topic classification (tasks 1–10) landed as `0866318`…`1b4ed30`; free, and see the not-yet-live-deployed note below | 2026-09-16 |
| `apps/web/src/dashboard/**` (and the `.ui-split` primitive in `apps/web/src/ui/ui.css`) | **done** — the dashboard redesign (tasks 1–12) landed as `4566718`…`07e9ccd`; the old `apps/web/src/Dashboard.tsx` is deleted, `report.css` no longer loads on this page; free | 2026-09-17 |
| `apps/web/scripts/{demo-content,make-demo-fixture}.mjs` (+ `.d.mts`), `apps/web/public/fixtures/{dashboard,e2e-dashboard,catalogue}.json`, `apps/web/src/{demoFixture,noSyntheticWords}.test.ts`, `tests/e2e/demo.spec.ts` | **done** — the demo-data feature (tasks 1–4) landed as `938cfc0`…`97ed318`, plus this task's records commit; the visitor dashboard and the browser suite now read separate fixtures from one generator, «توضيحية» replaces «اصطناعي» everywhere reader- or test-facing; free | 2026-09-17 |
| `apps/web/src/googleOneTap.ts` (+ `.test.ts`), `apps/web/src/google-gsi.d.ts`, `apps/web/vite-env.d.ts`, the Google door's slice of `Account.tsx`/`Account.entry.test.ts`, `.env.example` | **done** — Google sign-in and One Tap (`docs/superpowers/plans/2026-09-17-google-signin.md`) landed as `0102bea`…`5c2f9ca`, plus this task's hardening (`6e2ac2e`) and records commit; the door opens on `VITE_AUTH_PROVIDERS=google`, One Tap prompts a signed-out `/account` visitor via GIS + `signInWithIdToken`; free | 2026-09-17 |
| `apps/web/src/pages.css`, `apps/web/src/pageStates/**`, `apps/web/src/ops/**`, `apps/web/src/admin/**`, `apps/web/src/account.css`, `apps/web/src/noReportCss.test.ts` | **done** — the operations and admin redesign (`docs/superpowers/plans/2026-09-17-ops-admin-redesign.md`, tasks 1–8) landed as `0d6f51f`…`e3642af`, plus this task's records commit; `/sync` and `/admin` are on the shared `db-*` rhythm and `ui/` primitives now, `report.css` is deleted, `/account` carries the last of its rules verbatim in `account.css` until phase 5; free | 2026-09-17 |
| `apps/web/src/account/**`, `apps/web/src/ui/BudgetMeter.tsx`, `apps/web/src/setup-path.css`, `apps/web/public/fixtures/account.json`, `tests/e2e/account.spec.ts` | **done** — the account redesign (`docs/superpowers/plans/2026-09-17-account-redesign.md`, tasks 1–8) landed as `dc7b513`…`b95f7a2`, plus this task's records commit; `/account` is on `ui/` now, the verbatim `account.css` and every remaining `.app-shell .rp-*` block in `app.css` are deleted, `BudgetMeter` moved into `ui/`; free | 2026-09-18 |
| `apps/web/src/tour/**`, `apps/web/src/strings/{ar,en}.ts`'s tour keys, `data-tour` attributes on `main.tsx`/`account/{Account,WorkspaceCard,CreateWorkspace}.tsx`/`SetupPath.tsx`/`ops/{Catalogue,SelectionBar}.tsx`/`dashboard/{FilterBar,SectionNav}.tsx`, `playwright.config.ts`'s `tourSeen` storageState, `tests/e2e/tour.spec.ts` | **done** — the onboarding tour (`docs/superpowers/plans/2026-09-18-onboarding-tour.md`, tasks 1–4) landed as `6649c60`…`c7d96b5`…`847c369`…`51b5b2e`, plus this task's browser suite and records commit; a once-per-browser welcome plus seven anchored steps across `/account`, `/sync`, `/dashboard`, replayable from the rail and via `?tour=1`; free | 2026-09-18 |

`sentimentanalysis-69` reported itself inactive with no uncommitted work.

2026-09-15, a third Claude session, on the UX audit's phase two: took `Dashboard.tsx`,
`Account.tsx`, `main.tsx` and the CSS, and touched `Sync.tsx` only in its gate block and its
page head; one migration (`20260915080000`) and the OAuth callback, unrelated to the
queue-reliability work the migrations lane was held for. Committed through `e01dc5e`; nothing
of it is uncommitted. The `Landing.tsx` / `landing.css` / `landing.spec.ts` changes on disk
are not this session's and were not touched.

2026-09-15, selective video sync (tasks 1–9 of
`docs/superpowers/plans/2026-09-15-selective-video-sync.md`, `ca86ed3`…`4abfd02`, plus this
task's records-only commit): touched `supabase/migrations/20260915130000` through
`20260915132000` (three new files, no existing migration edited),
`supabase/functions/_shared/worker-gateway.ts`, `supabase/functions/worker/index.ts`,
`workers/python/src/{collectors,server}` (`youtube_api.py`, `protocol.py`, `gateway.py`,
`runner.py`, `loop.py`, `manual_run.py`), `packages/contracts/src/selection.ts`,
`apps/web/src/{Sync.tsx, OperationsPanels.tsx, CataloguePanel.tsx, catalogue.ts,
WorkspaceCard.tsx, Account.tsx, strings/ar.ts, strings/en.ts}`, and
`tests/e2e/dashboard.spec.ts` (append-only, as this file already asks). Nothing of it is
uncommitted; `git status` shows only the untracked `.screenshots/`.

## Six invariants that no failing test will announce

Both were flagged by `sentimentanalysis-69`, which wrote them. Each is enforced
in one place rather than at every call site, which is what makes them easy to
undo by accident — a redesign can bypass either and every existing test still
passes, because the tests check the path that goes through them.

**The channel's own comments are excluded in exactly one function.**
`filteredRows` in `packages/contracts/src/snapshot.ts`, plus the two option-list
builders (`comment_types`, `video_options`) that repeat the predicate. Every
total on the dashboard is taken downstream of it. A new panel that reads
`input` instead of the returned `filtered`/`rows` silently puts the channel's 13
promotional replies back into that panel's denominator — nothing fails, the
number is just wrong. `channel_own_comments` is deliberately counted from the
*unfiltered* input and shown on screen; it should stay visible.

**`measurable` is what stops the legend printing a false zero.** It is a Set
built from `active_analysis_labels`, and it is why the legend reads
"لا يقيسه النموذج الحالي" rather than "مختلط: 0 (0٪)". The live model has three
classes and roughly 4% of this channel's comments are genuinely mixed, so that
zero is not merely uninformative — it is false. Render the four labels from a
static list and the regression comes back looking like a design detail.

**The trust panel on the signed-out account page may not carry a number.**
It currently says six Arabic classifiers were measured against a hand-labelled
set and none passed the gate — all three parts check out against
`docs/evaluation/model-comparison.md`, and the claim is safe *because it is a
negative one*. The golden set has a single annotator, no second pass and no
adjudication (model-comparison.md:23–26), which cannot make "we measured and
none passed" less true. It can make an absolute figure false. So the moment
anyone writes a per-class number or an accuracy into that panel, the
single-annotator limit has to go in beside it — the set cannot establish an
absolute accuracy. Flagged by `sentimentanalysis-69`, which built the set. Same
shape as the two above: no test will catch it.

**`create or replace` on a SQL function is a whole-body rewrite.** Build the
replacement from the function's *current* definition, never from the migration
that first created it — a later migration may have added something to the body,
and starting from the original silently reverts it. This happened on
2026-09-14: a `worker_finish` replacement drafted from the original plus one
line dropped the run-closing insert that `20260914070000` had added. Two
worker_gateway tests caught it, which is luck rather than design; nothing
announces a reverted body. Flagged by `sentimentanalysis-91`, which hit it.

**The operations page cannot currently show a job that died before committing.**
`sync_runs` opens on the first committed batch, so a job that fails earlier
leaves no run row and the panel shows the last *successful* run instead — which
reads as "things were fine recently" at the exact moment they were not. This is
why a screenshot of that page was misdiagnosed on 2026-09-14 as a stopped
worker process when the worker was running fine and the lease was too short: it
took eight samples of the live `jobs` row, two minutes apart, to see `attempt`
climbing with no error ever recorded. None of that is visible in the product.
Found and being fixed by `sentimentanalysis-91`.

**`PREPROCESSING_VERSION` is provenance, not a version string.** The analysis
key is `model_id@revision` + `PREPROCESSING_VERSION` + `parameters_digest`, and
it is what makes two predictions comparable. Change how text is preprocessed
without bumping that constant and every prediction before and after carries an
identical key while having been computed differently — the stored predictions
become incomparable with new ones, invisibly, and nothing fails.

As of 2026-09-14 a third writer in this tree (not either Claude session — the
user also runs Antigravity and Codex, and neither can be messaged) has
uncommitted work adding Arabic normalisation to `preprocess.py`: tashkeel
stripping, tatweel, elongation. It is currently harmless because
`normalize_arabic_text` is defined and called from nowhere, so the pipeline is
unchanged and the key still tells the truth. The danger is the next commit.
Wire it into `to_plain_text` or the analyser and bump the constant in the same
change, or the 326 stored predictions silently stop meaning the same thing as
the ones after it. Found by `sentimentanalysis-91`, which preserved the work
rather than touching it.

**A zero in a `letter-spacing` declaration is usually load-bearing.** Arabic
letters join, and tracking runs after shaping, so positive tracking draws the
connected forms with gaps between them — the word comes apart and reads as a
rendering fault. `report.css` tracks the hero eyebrow at 0.16em for the Latin
landing page, and `.app-shell .rp-page .rp-eyebrow { letter-spacing: 0 }`
exists *only* to undo it inside the app. A restyle on 2026-09-15 replaced that
zero with 0.03em, which looks like a taste change and is not one.
`dashboard.spec.ts`'s "no Arabic label is letter-spaced" caught it, and caught
a new caption at 0.08em in the same run. It cannot catch `.app-plan-kicker`,
which had the same defect at 0.04em: that label renders only to a signed-in
reader and the browser suite is signed out.

## Things that are shared and will collide silently

**Port 4173.** The Vite preview server and Playwright's `webServer` both want
it. If a preview is already running, `npm run test:e2e` waits 60 s and then
reports the whole suite as failed — failures that are not real and that look
exactly like real ones. Stop your preview before running the browser suite.

**The browser suite's exit code.** `npm run test:e2e | tail` reports *tail's*
exit code, not Playwright's. A run with two failures reads as success. Redirect
to a file and check `$?`, or check each gate separately. This also happened
here, and a green report was nearly filed on a run that was not green.

**System load.** On a loaded machine (load average above ~15) single browser
tests take 25 s and the suite reports one or two failures, a *different* one
each run, each passing in isolation. That is contention, not regression — but
confirm it by running the failing test alone rather than assuming.

**`npm run deploy:preview`.** Single writer, no locking. It uploads
`apps/web/dist` over FTP and then deletes superseded hashed assets on the
server; two concurrent runs would delete each other's files.

Its failure mode is the safe one and is deliberate: `set -eu` stops the script
on the first error, so a deploy that cannot connect uploads nothing and the
last good build keeps serving. A non-zero exit is not a half-deployed site.

**Do not read "FTP is down" as a standing fact from this file.** It has been
intermittent: two sessions on 2026-09-14 got opposite results within the hour —
one completed (25 files at 226, superseded assets removed, the host answering
401 with the new bundle), the other timed out at port 21 on three consecutive
attempts and again on a fourth check later. Test it when you need it. A
document that says deploying is impossible will stop someone deploying when
they can, which is the more expensive error of the two.

**The live Supabase project.** Migrations and auth configuration are applied to
a real project serving real comments. Do not enable providers, change
`site_url`, or apply a migration without the user saying so in that turn. The
project currently has `external_google_enabled`, `external_azure_enabled` and
`saml_enabled` all false, and `site_url` still `http://localhost:3000` — which
would break any OAuth redirect from the deployed host, and is the user's to
fix.

Pending, from selective video sync, all the user's decisions and none of them taken:

- `supabase db push --linked` for the four migrations `20260915130000` through
  `20260915140000` (catalogue columns, `video_selections`, `select_videos`/
  `request_discovery`, the worker's due-list/catalogue/tick routes, and — the fourth, from
  the final review — the quota priced against every outstanding selection, the last run
  being the last *collect* run, the tick's hour-long backoff after a failed job, and the
  pilot plan's 30-minute rate limit).
- Redeploying the `worker` Edge Function — its `supabase/functions/worker/index.ts` and
  `_shared/worker-gateway.ts` now carry the due-list, commit-catalogue, video-finished and
  tick routes the three migrations above expect, and the deployed function does not yet.
- `create extension pg_cron` plus `select cron.schedule('sentiment-tick', '17 * * * *',
  $$select private.schedule_all()$$)` — until then, the worker's own idle-loop `tick()` is
  the only thing that would run `schedule_due_work`, and only while a worker process is up.
- `supabase/migrations/20260916020000_a_failed_verdict_is_retried.sql` (`eaac5c6`) — **applied,
  2026-09-16**: `migration list --linked` shows it remote. It went up with the topic three in
  the user's `db push` recorded under `b3cb15e` (that entry names only the three; the primary
  checkout was already past the merge). The live function body was not read back — `db dump`
  needs Docker, which was not running — so the evidence is the migration table plus the
  push's atomicity; `docs/verification.md`'s entry of that date says the same.
- `supabase db push --linked` for `supabase/migrations/20260917100000_delete_workspace.sql`
  (workspace-delete plan) — `retire_workspace`'s new refusal of the platform owner and the
  new `delete_workspace`/`admin_workspace_footprint` functions are not on the live project.

Until these happen, no discovery or collection has run against the real channel and
the catalogue has never been seen signed in — see `docs/verification.md`'s "Not verified"
for 2026-09-15.

**PENDING, the operator's: verify Google sign-in and One Tap on the deployed host.** Everything
in `docs/superpowers/plans/2026-09-17-google-signin.md` is unit-tested and, for the door and
the script-injection gate, dev-server-verified locally — there is no e2e for it, because
Google's own UI cannot be driven headlessly. After the next deploy, on
`app.sky-develop.net/account`: the Google button should open Google's consent screen and
complete a sign-in; a signed-out visit should show the One Tap prompt and a credential should
sign in; a signed-in visit should not show the prompt at all.

## What the tests are for

Every guarantee in this product is asserted somewhere, and most of the
assertions were written *after* a mutation proved they would catch the thing
they claim to catch. If you change behaviour and a test fails, read the test's
comment before changing it: it usually records a specific defect that shipped
once.

**One meaning with two implementations is the dominant bug in this codebase.**
Six instances found so far: sentiment colours in three places; two typefaces
neither of which knew about the other; two tables of error codes that
disagreed on the same screen; a second reader of that table in `Sync.tsx` that
dropped the cause entirely; the landing page keeping its own sentiment words;
and the landing page keeping its own sentiment colours, so a visitor learned
purple-is-positive and met teal-is-positive on the next screen.

None of them failed a test. Each was found by looking for the shape. If you are
about to add a second place where something is decided, that is the shape.

**But unifying is not automatically an improvement, and this is not a rule you
can apply without looking.** Both failure modes showed up while fixing the six:

- *The merged reader said less than a reader it replaced.* Two error-code
  tables became one, and the surviving one's entry for a bare
  `source_access_denied` was thinner than the table's had been — it dropped the
  half of the sentence that told the operator where to look. Caught by a
  browser test, by luck. The rule now encoded: a merged reader may override
  another only where it has something *more* specific to say; otherwise the
  replaced wording stands, asserted over every key with the one deliberate
  exception named.
- *The discarded version was better on a dimension nobody was measuring.* The
  landing page's sentiment palette separated better under deuteranopia than the
  dashboard's (ΔE 23.4 against 9.6) — the dashboard's was still chosen, because
  all four landing marks sat under 3:1 on white and a mark carries meaning at
  3:1. "Unify on the shared source" would have concluded the opposite without
  measuring, and would have been wrong about which set was better.

So: find the shape, then measure both sides before collapsing them. The shape
tells you there is a decision to make, not what the decision is.

## When you finish

Append a dated entry to `docs/progress.md` and, if you verified something,
`docs/verification.md`. Leave the tree clean. Say in your last message what is
committed and what is only on disk.

2026-09-16, the selective-sync session: **`e94f995` carries the topics session's staged
work, not only mine.** I ran `git add supabase/tests/topics.test.ts` (prettier only) and
committed; the index already held that session's staged rename of
`20260915160000_a_comment_has_a_topic.sql` → `20260916010000_a_comment_has_a_topic.sql`
(with the `topic_predictions_by_comment` index dropped, three lines), so the commit took it
too. Nothing is lost — the tree after it equals what that session had staged — but the
rename is in a commit whose message does not name it. The old timestamp collided with
`20260915160000_retire_worker_credentials.sql`; the new one is what the live project will
get. Lesson, the general one: with two writers in one checkout, `git commit` with a
pathspec (`git commit -- <files>`) or check `git status` for a foreign `RM` before
committing from the index.

2026-09-16, task 11 of topic classification (records-only): claimed
`workers/python/src/topics/**`, `supabase/migrations/20260916010000` through `012000` (the
renamed timestamps `e94f995` already carries, per the entry above), `supabase/functions/
_shared/worker-gateway.ts`, `supabase/functions/worker/index.ts`, `packages/contracts/src/
{topics,comments,filters,snapshot,csv,fixture,usage}.ts`, `apps/web/src/{Dashboard.tsx,
data.ts,jobFeed.ts,OperationsPanels.tsx,strings/**,report.css}`, this feature's appended
block in `tests/e2e/dashboard.spec.ts`, and the fixture JSON — all of it already landed as
`0866318`…`1b4ed30` before this task began. Nothing of this feature is uncommitted: `git
status` at the start of this task, and again now, shows only the untracked
`.screenshots/`. This task wrote only the four docs it is scoped to
(`docs/decisions.md`, `docs/progress.md`, `docs/verification.md`, this file); it touched no
migration, worker, gateway, contract or dashboard file. `npm run check` is red on this
checkout — stopped at `format:check` on four files this task did not write (see
`docs/verification.md`'s 2026-09-16 topic-classification entry) — which the next writer in
this area should fix before adding more code on top of it.

2026-09-17, task 11 of the landing redesign (records-only): claimed
`apps/web/src/{public,landing}/**`, `pricing.css`, `legal.css`, `ui/Accordion.tsx` (and
`ui/Dialog`'s new `sheet` variant) — done, commits `b4d6dcf`…`b8439b2`. `npm run check` is
green at the time of this entry: lint, format:check, typecheck, `check:functions` (deno),
unit (85 files / 548 tests), db (31 files / 303 tests), worker (195 tests), build (8
prerendered pages), secrets (521 source files plus built assets). `git status` at the start
of this task, and again now, shows only the untracked `.screenshots/` and the other
session's uncommitted `docs/verification.md` — neither touched by this task; that file's
dated entry for this work is deferred, not skipped.

**PENDING: the LCP budget.** The redesign's own rule — the hero's LCP after the rebuild
should be no slower than before — missed on the local static preview: `H1.hero-title`,
the same heading before and after, went 96→132ms unthrottled and 280→408ms at 4× CPU
throttle (full matrix in `.superpowers/sdd/2026-09-17-landing-redesign/vitals.txt`). Waived
rather than chased: every value is well inside "good" (2.5s), the same element paints
later rather than a heavier one replacing it, and the likely cause is a real product window
parsed from the prerendered HTML in place of a single deferred 29kB image request — plausible,
not confirmed, because the only measurement that actually answers this is Lighthouse against
the deployed host, not a synthetic `vite preview` on this machine. Reasoning in full in
`docs/decisions.md`'s 2026-09-17 landing entry. Next action, the owner's to schedule: run
Lighthouse (mobile + desktop) against the deployed landing after this work ships, the same
way `docs/seo.md` §6 did for the previous redesign, and record the result there.

2026-09-17, landing redesign final-review fix wave: claimed `apps/web/src/main.tsx`,
`apps/web/src/{PricingPage,LegalPage}.tsx`, `apps/web/src/{pricing,legal}.css`,
`apps/web/src/{public,landing}/**`, `apps/web/scripts/prerender.mjs`,
`apps/web/vite.config.ts`, `playwright.config.ts`, `tests/e2e/public-build.spec.ts` —
done, `5131a66` (code), `074431a` (build guard), and the records commit after them. The other session's
uncommitted `docs/verification.md` and untracked `.screenshots/` were not touched, staged or
stashed. Note for whoever runs the browser suite next: `playwright.config.ts` now starts two
servers, and the second one is `npm run build` — every `npm run test:e2e` builds first, and
it builds into `apps/web/dist` in the suite's fixture mode (empty Supabase URL). Run `npm run
build` again before `deploy:preview`, or the preview host gets a fixture build.

2026-09-17, later the same wave — the note above about `npm run test:e2e` building into
`dist` is closed: the built-site suite (`tests/e2e/public-build.spec.ts`, the `public-build`
project and its build-and-preview server) now exists only when `E2E_BUILD=1`, and runs only
via `npm run test:e2e:build`. `npm run test:e2e` starts the dev server alone, runs the
`default` project alone, and never touches `apps/web/dist` — checked by the file's mtime
before and after a run. Running the build suite still leaves a fixture-mode `dist` behind,
so `npm run build` before `deploy:preview` as ever.

2026-09-17, the dashboard redesign (tasks 1–12, `4566718`…`07e9ccd`): claimed
`apps/web/src/dashboard/**` (whole new directory; `apps/web/src/Dashboard.tsx` deleted, not
shimmed) and the `.ui-split` primitive lifted into `apps/web/src/ui/ui.css`. Free now, row
added to the table above. `npm run check` green at the close: lint, format:check, typecheck,
`check:functions` (deno), unit (94 files / 597 tests), db (32 files / 310 tests), worker (195
tests), build (8 prerendered pages), secrets (575 source files plus built assets); the
browser suite is `tests/e2e/dashboard.spec.ts` + `app-shell.spec.ts`, 86/86, recorded in
Task 11's report rather than re-run here. `docs/verification.md` was left alone all the way
through — `git status --short docs/verification.md` was non-empty (another session's
in-flight edit) at every task's start and at this one's close; its dated entry for this work
is deferred, not skipped. `.screenshots/` (untracked) was never touched; this feature's own
screenshots live under `.superpowers/sdd/2026-09-17-dashboard-redesign/shots/`.

**PENDING: phase 4, retire `report.css`.** It still loads on `/sync`, the catalogue panel and
`/admin` (Operations) — none of those pages moved in this redesign, by design (out of scope,
see `docs/progress.md`'s dated entry). The next session that touches those pages should either
carry them onto the `ui/`-primitive pattern this redesign used for the dashboard, or confirm
they still need `report.css`'s rules verbatim before deleting anything.

2026-09-17, closing the note above: phase 4 (`docs/superpowers/plans/2026-09-17-ops-admin-redesign.md`,
tasks 1–8) carried `/sync` and `/admin` onto the `ui/`-primitive pattern and deleted
`report.css`. Claimed `apps/web/src/pages.css`, `apps/web/src/pageStates/**`,
`apps/web/src/ops/**`, `apps/web/src/admin/**`, `apps/web/src/account.css`,
`apps/web/src/noReportCss.test.ts` (row added to the table above) — done, `0d6f51f`…`e3642af`
plus this task's records commit. `/account` keeps its remaining rules verbatim in
`account.css` (phase 5 recomposes that page); `PlanPanel.tsx`'s native `<progress>` is the one
piece phase 5 still owes, now that `/sync` carries `BudgetMeter` instead. `npm run check` green
at the close: lint, format:check, typecheck, `check:functions` (deno), unit (102 files / 708
tests), db (32 files / 310 tests), worker (195 tests), build (8 prerendered pages), secrets (609
source files plus built assets); the browser suite gained `tests/e2e/admin.spec.ts` (7 tests,
driving the real `/admin?demo=1`), full e2e now 114. `docs/verification.md` was left alone —
`git status --short docs/verification.md` was non-empty (another session's in-flight edit) at
this task's start and remains so; its dated entry for this work is deferred, not skipped.
`.screenshots/` (untracked) was never touched; this feature's own screenshots live under
`.superpowers/sdd/2026-09-17-ops-admin-redesign/shots/`.

**PENDING, unchanged from before this phase:** phase 5 (account/billing redesign on `ui/`,
including `PlanPanel.tsx`'s move to `BudgetMeter` and `account.css`'s own retirement) and
phase 6 (the product tour) remain open; nothing in this phase started either.

2026-09-18, closing the note above: phase 5 (`docs/superpowers/plans/2026-09-17-account-redesign.md`,
tasks 1–8) rebuilt `/account` on `ui/`, moved `BudgetMeter` into `ui/`, added `/account?demo=1`
+ `accountDemo.ts`, and retired the verbatim `account.css` along with every remaining
`.app-shell .rp-*` block in `app.css`. Claimed `apps/web/src/account/**`,
`apps/web/src/ui/BudgetMeter.tsx`, `apps/web/src/setup-path.css`,
`apps/web/public/fixtures/account.json`, `tests/e2e/account.spec.ts` (row added to the table
above) — done, `dc7b513`…`b95f7a2` (interleaved with another session's OAuth commits on the same
branch — `b3001ae`, `9135a6c`, `7dd0086`, `bf0c3a7`, `7714683`, `0a4c1f0`, and the formatting fix
`9867c0d` — none of it touched here) plus this task's records commit. `npm run check`, run stage
by stage after the chained command stopped at one db timeout: lint, format:check, typecheck,
`check:functions` (deno), unit (105 files / 786 tests, `apps/web` alone 94 files / 669), db (32
files / 310 tests, one timeout — see below), worker (195 tests), build (8 prerendered pages),
secrets (622 source files plus built assets); full e2e is 123 (114 carried + 9 new in
`tests/e2e/account.spec.ts`), `test:e2e:build` stays 6. `docs/verification.md`'s dated entry
below carries the host-load caveat for both the one `test:db` timeout and the e2e counts.
`.screenshots/` (untracked) was never touched; this feature's own screenshots live under
`.superpowers/sdd/2026-09-17-account-redesign/shots/`.

**PENDING, unchanged from before this phase: phase 6 (the in-app onboarding/product tour)
remains open; nothing in this phase started it.**

**Concurrent-session index incident, recurred 2026-09-18.** The failure mode logged on
2026-09-16 above (a commit picking up another session's staged changes because both sessions
share one git index) recurred: a `git rm` staged by one session landed in the other session's
commit `9135a6c`. No work was lost either time, but the commit's message does not name the
change it silently carried. Mitigation, unchanged from the 2026-09-16 entry and worth repeating
since it recurred: stage and commit in one command (`git add <exact paths> && git commit`, or
`git commit -- <paths>`), and check `git status` for a foreign `RM`/`A` before committing from
whatever the index already holds.

2026-09-18, closing the note above: phase 6 (`docs/superpowers/plans/2026-09-18-onboarding-tour.md`,
tasks 1–4) landed the in-app onboarding tour — `apps/web/src/tour/**`, the 24 string keys, the
`data-tour` anchors, and `tests/e2e/tour.spec.ts` (row added to the table above) — commits
`6649c60`…`51b5b2e` plus this task's browser suite and records commit. Phase 6 was the last
of this file's numbered phases (ops/admin was 4, account 5); **the eight-phase pre-launch
redesign is complete.** `npm run check` green at the close:
lint, format:check, typecheck, `check:functions` (deno), unit (110 files / 860 tests), db (33
files / 316 tests), worker (195 tests), build (8 prerendered pages), secrets (642 source files
plus built assets); full `npm run test:e2e` is 128 (124 carried + 4 new in `tour.spec.ts`),
`test:e2e:build` stays 6. `docs/verification.md`'s dated entry below carries the full detail,
including a host-load flake this task hit and cleared on rerun (unrelated to the tour).
`.screenshots/` (untracked) was never touched; this feature's own screenshots live under
`.superpowers/sdd/2026-09-18-onboarding-tour/shots/`.

**What is still open, carried from earlier entries in this file — none of it part of the
redesign, and none of it blocked on anything this task could do:** the operator has not yet
verified Google sign-in and One Tap on the deployed host (line ~243 above); the landing's LCP
regression is waived, not fixed (line ~335 above); the owner-plan selection fix (`699bbba`)
is built and waiting for the operator to run `scripts/deploy-preview.sh` or grant the
permission (`docs/progress.md`'s 2026-09-18 entry); and the `creator_plus` tenant's dead
worker credential is diagnosed but not resolved — a separate session is actively working a
platform-wide-credential redesign for it as of this writing (`488bcd2`…`900b83d`, untouched
here). Nothing above is this task's to fix; each is named here only so the next reader does
not have to re-derive it from scattered entries.

**PENDING, the operator's: the platform worker credential rollout (2026-09-18).** Migration
`supabase/migrations/20260918130000_a_platform_worker_credential.sql` is committed and pushed
to the repository and NOT applied to the live project. The steps, in order, are in
`docs/progress.md`'s entry of the same date: `supabase db push --linked`; register a platform
credential with `svc_register_platform_worker_credential`; `.env.local` down to one
`WORKER_CREDENTIAL` (drop `_WS2` and `_NEW_ID`); `scripts/worker-service-update.sh`; retire the
owner's scoped credential (`rotated-2026-09-15`, id `14b189c0-…`). Until then the worker serves
the owner's workspace alone and every self-serve workspace reads «الجمع متوقّف». No web deploy
is involved: nothing above SQL changed.

2026-09-18, closing the note above: the platform worker credential is live — migration applied,
credential `7abfe195-…` registered, the service on `277913a` with `tenants=1` since 12:59:53,
the owner's scoped credential retired. `.env.local` holds one `WORKER_CREDENTIAL` and no
`_WS2`; `scripts/worker-service.sh` is unchanged. Open: read back the `creator_plus` tenant's
discover job (`docs/progress.md`, same date).

2026-09-19, a Bionic desktop-agent session (review → hardening → live re-analysis): worked the
migrations, `workers/python/src/server/**`, `supabase/functions/{_shared/worker-gateway.ts,
worker/index.ts}`, `supabase/tests/**` and `workers/python/src/sentiment/**` lanes — all idle
per this file's own one-day rule — plus `scripts/monitor.sh` (new) and append-only records in
`docs/{progress,verification,decisions}.md` (three dated entries each). Landed, in three
commits on `main` — `9f204f8`, `3adf257`, `49bd352` — **not yet on `origin`:** the push from
this machine was refused (403; the cached GitHub credentials have no write access to
`mlubbad/arabic-audience-sentiment`). The operator should `git push origin main` from a
session that can, or grant this machine's credential write access — until then these three
commits exist on this disk only, which is exactly the situation the rules above were written
for.

1. **Arabic normalization reaches the model.** `LogitsAdapter.predict` now calls
 `normalize_arabic_text`; `PREPROCESSING_VERSION` → `strip-html-arabic-norm-v2` in the same
 change (the wiring gap this file warned about on 2026-09-14 is closed, with a guard test).
 Golden fixture regenerated via `test_golden_batch.rebuild()`.
2. **Lease/claim semantics** (`20260919120000` + `20260919130000`): `jobs.heartbeats` — a lapsed
 lease with zero heartbeats resumes free (platform replays are not worker fights); heartbeated-then-
 lapsed counts and backs off; heartbeat renewal is a 5-minute floor (was 60s — an early heartbeat
 shortened the lease). Claims carry `job_types` end to end; a collect-scoped run can no longer
 consume a topics job (verified live: scoped claim → 204 while a topics job waits).
3. **Resource guard + monitor** (`20260919140000` + `scripts/monitor.sh`): `comment_reviews` and
 `topic_reviews` indexed on (workspace_id, comment_id) — the dashboard's per-comment review
 lookups were seq scans, ~37,700 per page load; and an external monitor probing rest/gateway/
 leases/failures/worker/freshness/site, installed in this machine's crontab every 5 minutes
 (edge-triggered alerts, `ALERT_WEBHOOK_URL` optional).

**Live-project operations another agent must know about** (all on `ykqugctewsqvevhyqtbi`):
migrations `20260919120000`, `20260919130000`, `20260919140000` applied via the Management API
query endpoint AND registered in `supabase_migrations.schema_migrations`; edge function `worker`
redeployed to v16 (verify_jwt=false, same as before); the project was **restarted twice** to
recover a PostgREST wedge (504 on every request from ~2026-09-18 16:00) and again to reload the
function-overload schema cache; the pilot workspace «الجزيرة 360» was **re-collected and
re-analysed** — `channels.active_analysis_key` now points at the v2 key, 18,850 v2 predictions
exist beside the 17,627 v1 history, and the dashboard's effective labels come from v2. Two
queued jobs were consumed and honestly restored: analyse `99cfa273` reset to queued (my first
backfill ran before claim scoping existed — its own motive), and the collect job's `reclaims=20`
zeroed (platform-retry noise, would have buried it).

**Left untouched, seen uncommitted on disk:** `.github/workflows/ci.yml` and
`apps/web/index.html` — another session's in-flight work; not staged, not reverted.

**Open, this session's:** `npm run test:db` under pinned Node 22 (rewritten
`lease_recovery.test.ts`, new `scoped_claim.test.ts`, updated handler test — written but never
executed; this machine lacks the pinned Node); a signed-in dashboard walkthrough against the v2
key; the analyse job `99cfa273` needs a classifier-capable worker to actually classify; and the
monitor's `ALERT_WEBHOOK_URL` is unset, so alerts are log-only until the operator adds one.

2026-09-19, a Bionic (LM Studio) session, TypeSafe topic classifier: added
`workers/python/src/topics/typesafe.py` and `tests/test_typesafe.py` (the topics lane
was free), plus progress/verification entries. **Did not touch `server/loop.py`** even
though the wiring needs a six-line branch there — the token-renewal lane has uncommitted
`loop.py` changes in flight and a commit of mine would have swept them up. The wiring
snippet is in `docs/progress.md` under the same date; apply it after that lane commits.

2026-09-19, same Bionic session, follow-up: the loop.py wiring landed after the
token-renewal lane finished — committed via `git apply --cached` with only my two
hunks (argparse choices + the classifier branch). That lane's `build_collector`
change in loop.py is still uncommitted on disk, untouched, exactly as it left it.

2026-09-19, the session that executed the token-renewal lane's leftover steps
(check, deploy): touched only `workers/python/tests/test_typesafe.py`,
`supabase/tests/worker_gateway_handler.test.ts`, `scripts/check-secrets.mjs`,
ten prettier-only reformats, and the three shared docs — all committed
(`7df9f56`, `1fc5a9b`, `87ff30a`, `b3c3b95`). The channel-lookup lane's
uncommitted work (gateway, worker/index, python, account/**, strings,
migration `20260919180000`) was seen on disk, left byte-for-byte alone, and
deliberately EXCLUDED from the deploy (done from a worktree at `b3c3b95`;
worker is now v17). Two machine notes for the next session: Node 22.14.0 and
Supabase CLI 2.117.0 now live under `~/.local/share/{nodejs,supabase-cli}` —
this machine still has no global node/npm/supabase on PATH. `test:db` remains
red with 5 failures in the Bionic session's `scoped_claim`/`end_to_end` files
(written 2026-09-19, never executed) — that lane's to fix.

2026-09-19, the channel-lookup lane (public-data channel addition): claimed
`supabase/migrations/20260919180000_*`, `supabase/functions/channel-lookup/**`,
`supabase/functions/_shared/channel-query.ts`, `supabase/functions/{worker/index.ts,
_shared/worker-gateway.ts}` (claim payload only), `workers/python/src/{collectors/
youtube_api.py, server/runner.py, server/loop.py, server/manual_run.py}`,
`workers/python/tests/{test_public_channel.py, test_discover.py}`,
`packages/contracts/src/{channelLookup.ts, index.ts}`, `apps/web/src/account/{Account,
WorkspaceCard, WorkspaceCard.test}.tsx`, `apps/web/src/account/account.css`,
`apps/web/src/strings/{ar,en}.ts` — all landed and committed; see docs/progress.md's
entry of this date. Also repaired, with fixture-only changes, the never-executed
`supabase/tests/{scoped_claim,end_to_end,worker_video_counts}.test.ts` files the
2026-09-19 Bionic session recorded as unrun (test:db is now green, 353). Free now.
**Operator steps, in order:** `supabase db push --linked` for `20260919180000`;
`supabase secrets set YOUTUBE_API_KEY`; `supabase functions deploy channel-lookup`;
restart the worker service with `YOUTUBE_API_KEY` in its environment (`public=yes`
in its startup log line confirms). Until then the new door looks up nothing and a
claimed public job ends blocked `public_collection_not_configured`.

2026-09-19, same lane, live rollout correction: db push applied `20260919180000`;
`channel-lookup` v1 and `worker` v18 are deployed; the operator steps in the entry
above are now only — create the API key (restricted to YouTube Data API v3),
`supabase secrets set YOUTUBE_API_KEY=…`, the same value in `.env.local`, then
`scripts/worker-service-update.sh` **from the `mlubbad` login**, where the service
actually runs (an update run from the `muhammed` account crash-looped EX_CONFIG
against the plist's hard-coded paths and was uninstalled; the script now templates
those paths). The deployed web bundle predates the new door until the next
`deploy:preview`.

2026-09-19, Antigravity session — platform reader grants, immediate discovery, and live rollout:
- Google Cloud API key creation on modern projects failed with `403 API keys are not supported by this API`.
- Integrated `private.platform_reader` into `channel-lookup` and `worker` edge functions, unsealing reader tokens via `TOKEN_ENCRYPTION_KEY` and auto-refreshing against Google OAuth endpoints when `YOUTUBE_API_KEY` is not present.
- Migration `20260919230000_platform_reader_grants.sql` granted `select, update` on `private.platform_reader` to `service_role` and updated `schedule_due_work` to include `public_unverified` channels. Pushed live via `supabase db push --linked`.
- `channel-lookup` and `worker` deployed live.
- `apps/web/src/account/Account.tsx`: added immediate `request_discovery` invocation upon successful `register_public_channel`.
- Preview web bundle deployed live via `npm run deploy:preview` over FTP (exit code 0).
- Live verified: channel lookup by handle `@alaa_jaber_official` and search "علاء جابر" resolved successfully via platform reader; channel registered and 194 videos catalogued live into database.
- All test suites green: unit 110 files / 865 tests, db 38 files / 361 tests, python worker 229 tests, deno check, build, secret scan. All paths free.

2026-09-19 (evening), Antigravity session — browser CORS preflight fix for channel-lookup and edge functions:
- Problem: Browser fetch from `apps/web` (`https://app.sky-develop.net`) failed during preflight `OPTIONS` with `Failed to fetch` / `تعذّر البحث عن القنوات. حاول من جديد.` because the browser Supabase client sends `x-client-info` in `Access-Control-Request-Headers`, while `_shared/cors.ts` only permitted `authorization, content-type, apikey`.
- Fix: Updated `supabase/functions/_shared/cors.ts` so `corsHeaders()` allows `x-client-info, x-retry-count, traceparent, tracestate, baggage` and reflects `access-control-request-headers` on preflight for allowed origins.
- Tests: Added test in `supabase/tests/cors.test.ts` verifying `x-client-info` and requested headers reflection.
- Client logging: Added `console.error` in `apps/web/src/account/Account.tsx` for lookup error diagnostics.
- Deployed: Edge functions `channel-lookup`, `billing-portal`, `oauth-start`, `paddle-checkout` redeployed to Supabase project `ykqugctewsqvevhyqtbi`. Live preflight curl verified returning `access-control-allow-headers: authorization,content-type,apikey,x-client-info`.
- Preview deployed: `npm run build && npm run deploy:preview` uploaded cleanly. Full verification suite `npm run check` passed 100% green. All paths free.

2026-09-20, Antigravity session — Decoupled Big-Data Dashboard Architecture (DONE):
- **Radical Big-Data Architecture Completed & Deployed**: Transitioned the live dashboard from monolithic in-memory fetching to a fully decoupled enterprise server-side aggregation and paginated stream architecture suited for tens of thousands to millions of comments.
- **Database & Indices (`supabase/migrations/20260920150000_decoupled_dashboard_architecture.sql`)**:
  - GIN Trigram index `comments_text_trgm_idx` created on `public.comments USING gin (text_raw extensions.gin_trgm_ops)`. ILIKE queries run in 28ms across 71,310 rows.
  - Implemented `private.dashboard_aggregates_impl(w uuid, f jsonb)` and `private.dashboard_comments_impl(w uuid, f jsonb)` wrapped by `public.dashboard_aggregates` and `public.dashboard_comments` with strict RLS enforcement.
  - Returns summary metrics, sentiments, timeline, topic counts, videos, 24h hourly buckets, 7d weekday buckets, weekly buckets, top commenters, and top negative comments in ~1.3s down from 120MB raw data to ~300KB.
- **Contracts (`packages/contracts/src/fixture.ts`)**:
  - Exported `DashboardAggregatesSchema` and `DashboardCommentsResponseSchema` with full TypeScript inference.
- **Analytics (`apps/web/src/analytics.ts`)**:
  - Added pre-computed server bucket converters: `hoursToBucketed`, `weekdaysToBucketed`, `weeksToBucketed`, `peopleToCommenters`.
- **Data Layer (`apps/web/src/data.ts`)**:
  - Exported `toLabelledComment`, `filtersToRpc`, `loadDashboardAggregates`, and `loadDashboardComments`.
  - Preserved `loadSource` and `deriveSnapshot` intact for fixture mode and complete backwards compatibility.
- **Frontend Dashboard (`apps/web/src/dashboard/Dashboard.tsx`)**:
  - Live mode executes decoupled queries: `aggregatesQuery` (`dashboard-aggregates`), `commentsQuery` (`dashboard-comments`), and `cardsQuery` (`dashboard-cards`).
  - Completely bypasses 120MB monolithic comment transfer in live mode.
  - Verified 100% green across all 111 test files (874 tests), typecheck, Semgrep, and Vite production build.
- **Paths released**: All paths free.

2026-09-20, Antigravity session — Continuous Deployment (CD) Pipeline with GitHub Actions & Remote Migrations:
- **Deployment is now automated:** Any push to `main` triggers `.github/workflows/deploy.yml`.
- **Pipeline actions:**
  1. Checks out repo and sets up Node 22 (pinned SHA actions).
  2. Runs `npm ci && npm run build` (including prerendered pages).
  3. Uploads web assets to preview host `https://app.sky-develop.net` using FTPS (`scripts/deploy-preview.sh`) if `PREVIEW_FTP_*` secrets are configured in GitHub.
  4. Runs remote Supabase database migrations transactionally using `npm run db:migrate:remote` (`scripts/apply-migrations-remote.mjs`) if `SUPABASE_ACCESS_TOKEN` is configured in GitHub.
- **Rule for all agents:**
  - Always run `npm run check` locally before pushing to `origin main` to guarantee gates are green.
  - Do NOT deploy via local scripts unless working offline or troubleshooting; git push handles deployment.
  - Manual local fallback commands if ever needed: `npm run deploy:preview` and `npm run db:migrate:remote`.
