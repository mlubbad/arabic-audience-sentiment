# Working here alongside other agents

Read this before writing anything. It is short because it is the set of things
that have actually gone wrong in this checkout, not a policy.

There is no message channel between the tools working on this repository —
Claude Code, Antigravity and Codex cannot talk to each other. The repository is
the channel. That is why this file exists and why it is kept current rather
than aspirational: if it says something that is no longer true, it is worse
than nothing.

## The one that loses work

**There is no git remote.** `git remote -v` is empty. Every commit exists on one
disk, in one checkout, with no copy anywhere. As of writing that is 11 commits
made today.

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
- Ask the user before adding a remote or pushing. It is the right fix and it is
  their decision, not ours.

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

Until these happen, no discovery or collection has run against the real channel and
the catalogue has never been seen signed in — see `docs/verification.md`'s "Not verified"
for 2026-09-15.

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
