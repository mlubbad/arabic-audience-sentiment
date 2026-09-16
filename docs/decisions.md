# Implementation decisions

2026-09-14 — Internal UX follows one scoped application shell, using the landing's existing
mark and visual tokens. The analytical report's data and label rules are unchanged; a CSS
layer corrects the old global `header` layout and aligns account, operations and recovery
pages without introducing a second UI framework. The report's many filters remain visible
on desktop and are initially closed on narrow screens behind a button with `aria-expanded`;
the form remains in the DOM so opening it preserves its state and keyboard access. The
Sync route resolves session and workspace before a live read, and remounts per identity and
workspace. A fixture cannot stand in for a signed-in user's missing or failed workspace
list, because that would make a tenant-specific operations page appear populated by another
source. An account's empty-workspace message waits for its workspace request to complete.
Worker-disconnected copy describes its effect on freshness rather than assuming it runs on
a developer machine, which is no longer a generally valid deployment claim.

2026-09-14 — Dashboard data is scoped to the current authenticated user and workspace in both the component lifetime and React Query key. A source switch remounts the report so local filters, review dialogs, and pending correction context cannot outlive the identity they describe. Placeholder data may survive a filter change within one identity but never cross a user, mode, or workspace boundary. A signed-in account with a workspace list still loading or failed gets an explicit state, not a fixture fallback. The workspace selector remains available after the first choice and the report names the chosen workspace rather than exposing its UUID. Video filter options derive from the source workspace independent of the active filter selection; available video titles are displayed without inventing titles for unknown ids.

2026-09-14 — Replace the supplied marketing-reference hero with an original generated illustration before treating the landing as a product asset. The reference archive informs composition only; it does not establish redistribution rights. Use the project's documented indigo token for landing actions. Marketing copy distinguishes the fixture example on the landing from the pilot channel's collected real comments and does not imply that live model analysis or authenticated dashboard reading has been validated.

2026-09-13 — Arabic marketing landing: the user's supplied screenshot/archive is a visual reference. `/` now serves the landing and the dashboard moves to `/dashboard`, with existing browser tests retaining their dashboard coverage at that route. Scoped landing styles protect the application shell; on-demand dashboard/account imports reduce the marketing entry bundle. Product copy discloses illustrative data and incomplete live setup; no customer endorsements, measured accuracy, paid plan, or lead collection is invented. Reference/font provenance and private-preview limitations are in `docs/landing.md`.

2026-09-12 — The supplied handoff plus the latest M0–M2 request are the approved design and scope. Work runs inline on `codex/m0-foundations` in the supplied empty workspace.

- Use npm workspaces and the resolved React/Vite/Chart.js/Tailwind/TanStack Query/Router/Zod stack. Node 22.14.0 supports the pinned Vite 6 release. Python 3.12.10 and uv lock the lightweight worker foundation. PyTorch/model downloads wait for the real inference milestone; no invented revision or unused heavyweight dependency is installed.
- Fixture mode is an explicit local data source, with synthetic identities and no customer records. Live Auth is a separate configurable flow; fixture data never implies a live backend.
- All dashboard sections derive from one filtered snapshot and a named active analysis key. Dates use UTC half-open intervals; unknown dates are separately counted. Current-text human reviews override current active predictions.
- SQLite is a private local collection spool, not the SaaS job queue. PostgreSQL is the shared job queue with atomic leases. Both fence stale workers and commit rows/checkpoint together.
- Database tests run the migration in embedded PostgreSQL (PGlite) with minimal test-only Auth/Storage tables. This provides SQL/RLS evidence without Docker, but cannot validate GoTrue, PostgREST, Storage HTTP, or deployed Supabase behavior. Full Supabase integration remains a separate gate.
- Security-sensitive state is written through role-checked SQL RPCs; tenants cannot directly alter memberships, channel verification status, job leases or quotas. Private storage paths begin with workspace UUID.
- Only a neutral Arabic RTL shell is built until the actual visual assets arrive. No final brand choices, public publication, paid resources, production migrations, or live data collection are part of setup.

References checked: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Vite requirements](https://vite.dev/guide/), [Supabase changelog](https://supabase.com/changelog). Changelog reviewed 2026-09-12; this foundation does not modify Realtime, pin extension versions, or use the deprecated Management logs endpoint.

2026-09-12 (continuation) — decisions made while closing the M0–M2 gaps.

- Every Auth user is bootstrapped with a personal workspace by a definer trigger on
  `auth.users`, so no signed-in user can exist without a tenant. Channel claiming goes through
  `register_channel`, which checks role and client tenancy, validates the `UC` + 22-character
  id format, and always creates channels as `public_unverified`. A tenant never sets
  `connected` itself; that status is reserved for a completed OAuth flow in M5.
- `channels` stays unique per workspace rather than globally, so two tenants may register the
  same public channel id before OAuth. This is deliberate: pre-OAuth collection of public data
  must not depend on ownership, and ownership is proven at M5 from the channel identity
  returned by an authorized connection. A global unique constraint would let the first tenant
  to type a URL block the real owner.
- A `ModelCard` registry records model id, pinned revision, declared label mapping,
  preprocessing version and any measured results. It refuses a moving ref such as `main`, and
  refuses malformed or duplicated mappings, because label order must never be inferred from a
  config. No card is constructed for a real candidate yet: that would require inventing a SHA.
  A three-class model reports `supports_mixed == False` so the UI can say Mixed detection is
  unsupported rather than display a 0% that reads as a measurement.
- A `DeterministicTestAnalyzer` labels by an explicit marker character so pipeline behaviour is
  testable without weights. It is named `deterministic-test-analyzer`, documented as not a
  model, and returns `unsupported` rather than guessing Neutral for unmarked text.
- The browser error-state test gates its route handler on a flag rather than a request index.
  React StrictMode issues two fetches on the initial mount — confirmed by probing the running
  page, not assumed — so an index-based handler let the second request succeed and silently
  tested nothing.

2026-09-13 — metering and plan limits.

- Plans live in an operator-managed `plans` table with no tenant grant, so a workspace cannot
  raise its own limits. A subscription carries the plan key and a UTC period; the period is
  declared in UTC and does not move when a workspace changes its display timezone.
- `usage_events` is keyed by `(workspace_id, event_key)`, which is what makes a retry, a
  reimport, or a likes-only refresh free. One unique comment costs one unit in a workspace
  once, not once per period, so the key is checked across all periods rather than within one.
- `historical_backfill` draws on its own allowance. An exhausted analysis quota must not block
  a backfill, and a backfill must not silently consume the monthly analysis budget.
- `reserve_usage` locks the subscription row before reading the remaining allowance. That lock
  is the mechanism that stops two concurrent callers both seeing the same headroom and both
  spending it. Reservation is deliberately partial: it grants what the allowance still holds
  and returns the covered keys, leaving the caller to decide whether a partial grant is usable.
- `commit_checkpoint` is all-or-nothing by contrast. Rows, checkpoint and meter move in one
  transaction, and a batch that cannot be paid for in full is refused rather than committed
  half-metered. A replayed batch key returns before metering, so it is never charged twice.
- A reservation is released only while it is still `reserved`. A confirmed charge is history
  and `release_usage` will not remove it, so a failure late in a batch cannot un-bill work
  that already succeeded.
- The subscription table rejects `provider = 'mock'`, so a mock billing mode cannot be attached
  to a real plan row outside a test harness.
- Metering is service-only. No `authenticated` grant exists on `reserve_usage`, `confirm_usage`
  or `release_usage`, so a tenant cannot meter itself or forge a reservation.

2026-09-13 — surfacing plan usage.

- `usage_summary` is readable by every member including a viewer: it is a read, not a control,
  and someone watching a dashboard should be able to see why a sync stopped. It returns null
  when no subscription exists, and the UI states that no plan has been activated rather than
  implying the allowance ran out. Those are different situations and must not look alike.
- `reserve_usage` and `usage_summary` both count a period's spend through one `used_units`
  helper, so the number that blocks a batch and the number shown on screen cannot drift apart.
- The 70% and 85% alert thresholds the specification defines for the storage budget are applied
  to plan usage as well, so a limit becomes visible while there is still room to act instead of
  only when a batch is refused. A zero allowance reads as exhausted rather than dividing by zero.
- `BudgetSchema` refuses a summary whose `remaining` does not follow from `used` and `allowance`.
  A miscounting server should fail loudly rather than render a confident but wrong progress bar.
- The fixture carries a plan block so the panel is exercisable without a server. It is synthetic
  like the rest of the fixture and does not describe any real workspace's consumption.


2026-09-13 — Parallel development uses three sibling Git worktrees: Codex/Python,
Claude/platform, and a single integration lane. The original checkout is preserved during
Claude's transition. Shared TypeScript contracts, Node dependency changes and central
milestone records have one owner (integrator). Lane reports avoid concurrent edits to shared
progress documents. Ownership guards run before commits in the new worktrees. See
`docs/coordination/README.md` and `tasks.md`. No changes to application architecture or paid
service authorization follow from this setup.

2026-09-13 (M3 and M5 server work) — decisions taken while implementing, with reasons.

- **The billable unit is the comment, not its text.** `usageEventKey` is
  `analysis:{platform}:{external_comment_id}` with no content hash, so a retry, a reimport, a
  likes refresh and a re-analysis after an edit are all free. Including the hash would bill a
  customer for edits they did not ask for. This was recorded as an open pricing question and
  is now decided; it is reversible by changing one function and adding a migration.
- **Replay is keyed on the batch key plus a payload fingerprint.** The earlier
  `commit_checkpoint` compared only the checkpoint, so a reused key carrying different rows
  would have been accepted as an update. It is now a conflict. The Python client hashes the
  payload canonically, because a digest that varied with dictionary order would make a
  legitimate replay look like a conflicting payload and turn a retry into a failure.
- **A prediction for a comment not in its batch fails the whole batch**, rather than being
  stored, because it is analysis of something the server cannot show. A successful prediction
  must carry its class scores, since the specification requires keeping all class
  probabilities.
- **Nothing that crosses a trust boundary accepts a workspace.** The OAuth callback, the
  worker gateway, the batch payload and the edge handler all derive the tenant from something
  the caller cannot choose — stored state, or a credential. This is deliberately structural
  rather than a validation step: there is no field to forge, so the check cannot be forgotten
  later.
- **A worker holds a scoped credential, never the service role**, and that credential names
  exactly one workspace. Claim, heartbeat, commit and finish take no workspace argument.
- **The connected claim on a channel is globally exclusive**, enforced by a partial unique
  index. A second workspace keeps its `public_unverified` row, because collecting public data
  needs no authorisation, but can never become the authorised holder. A channel already being
  collected publicly is upgraded in place so pilot data gathered before the creator authorised
  carries over instead of being orphaned.
- **An idempotent replay is answered before the rate limit is consulted.** Returning the same
  job for the same key is not a new request, and refusing it would punish a correctly
  retrying client.
- **`sync.ts` is application schema, not worker protocol.** It is a read projection over sync
  runs and the job queue, so changing it cannot break the worker. `jobs.ts` and the barrel
  stay coordinated because a unilateral change there would.
- **Aggregates belong in the shared snapshot, not the app.** `comment_types` and the
  per-video figures were computed in the browser, which only worked because fixture mode
  reads every row; a live paginated read could not have offered the same control, and the two
  modes would have diverged. The per-video figures accumulate in the pass that already walks
  the rows, which is what a `GROUP BY` does, so there was never a scaling reason to defer it.
- **Unknown is never zero.** An unparsed like count stays null and its comment is excluded
  from the engagement ranking rather than sorted last; an export writes it empty. Sorting
  unknown as zero would present an unmeasured row as measured-and-lowest.
- **Errors crossing a boundary carry a code and no message.** A driver or transport error can
  quote a connection string, and a credential with it.
- **The audit trail answers to owners only** and is append-only in the database, with short
  bounded fields so a comment body cannot be parked in it.
- **A contract describes the wire, or it describes nothing.** `CommitBatchSchema` was one flat
  object while the client posts an envelope wrapping a payload, and the seam test reshaped the
  payload before parsing — so the test's adapter was the only thing making the two agree, and
  the handler could not have validated against the schema even in principle. The schema is now
  `CommitBatchSchema` (envelope) over `BatchPayloadSchema` (content), and the golden fixture is
  the request body captured from the real client rather than one assembled by the side reading
  it. A fixture built by the consumer proves the consumer agrees with itself.
- **A rule that meters must be enforced where the metering happens.** The prediction/comment
  rule lived only in Zod, which the worker is free not to run and the handler never reached.
  The consequence was not a dropped row but a charge for one. Validation may live in as many
  layers as are useful, but the layer that spends the customer's allowance has to be one of
  them.
- **A malformed batch is refused whole, never filtered.** Silently discarding the rows that do
  not fit is what turned a worker defect into a customer charge. A batch whose predictions do
  not describe its own comments is a bug in the sender, and the sender should be told.
- **An analysis failure keeps the rows and downgrades the claim.** Collected comments are real
  work and are committed; what the run may no longer say is that it finished. An exhausted
  source that was not fully labelled is `partial`, never `succeeded`. Discarding the rows
  would lose collection and the checkpoint with it; reporting success would claim a coverage
  the data does not have.
- **An adapter returning the wrong number of verdicts is refused, not zipped.** A short list
  silently leaves later rows unanalysed while the run reports success, and a long one names
  comments that do not exist.
- **A comment's content hash is computed in one place.** Predictions join to comments on it, so
  a prediction hashed over different text is stored and then never becomes the effective label
  — a comment that is analysed but shows no verdict, with nothing failing anywhere.
- **Settings are part of what identifies an analysis.** Section 9 makes the fingerprint model,
  revision, preprocessing *and* settings. They are stored on the run and folded into
  `analysis_key`, because a prediction is unique on that key: without them, re-analysing a
  comment under different settings collides with the earlier verdict and the new one is
  dropped. An adapter with no settings declares `{}`, which is a statement rather than an
  absence.
- **Spent OAuth states are pruned; states in flight never are.** Retention was never load
  bearing for security — consume requires a row that is unconsumed and unexpired — so the
  window exists for operational diagnosis and is short. The operation is committed without a
  schedule, because a schedule needs a deployed project and inventing one here would be a
  configuration nobody runs.
- **Going live takes a configured project and an explicit request.** A configured Supabase
  project enables Auth and workspace management; on its own it must never turn fixture rows
  into live data, or a correction against a fixture id would be addressed to a real server and
  reported as saved. The read and the write branch on the same data mode, so they cannot
  disagree about which one they are in.
- **The live read returns the whole workspace, and says so.** That is the same whole-set read
  the fixture does, which is what lets one `snapshot()` compute identical aggregates in both
  modes. It is right for pilot-scale data and needs server-side filtering before a workspace
  holds substantially more. It is deliberately not capped: a silent subset would report
  partial data as if it were the whole set.
- **`snapshot()` makes no claim about provenance.** It aggregates rows and cannot know where
  they came from. Returning `mode: "sanitized_fixture"` was a claim made by the one function
  with no access to the answer, and it stayed true only because no live read existed.
- **The state is stored hashed; the verifier is stored raw.** They are different kinds of
  secret. The state travels back through the browser, so a readable copy in the database would
  be enough to forge a callback. The verifier never leaves the server and the exchange requires
  it, so storing it is what the protocol asks for. Both live in a table with no tenant grants,
  single use, ten minutes, and pruned.
- **The state is recorded before the redirect is issued.** A callback for a state that was
  never written is refused, so the write must not be able to fail after the user has already
  been sent to Google.
- **A verifier is validated where it is created, not where it is used.** By the exchange it has
  already been used, and a weak one cannot be un-sent.
- **The brand's own tokens, a deliberate subset of them.** Colours, spacing, shadows and the
  type scale come from the project's brand book by way of `dashboard.sky-develop.net`. What is
  chosen here is the subset: a dashboard needs surfaces, text and a sentiment palette, not the
  display scale or the mesh gradients that belong to a marketing page.
- **Sentiment colour is separate from the accent.** Indigo is chrome; green, rose, grey and
  amber plot the four labels. Sharing them would make a figure read as "brand" and a button
  read as "positive". Every figure still carries a text label — colour is never the only
  carrier, and the browser suite asserts it.
- **Fonts are self-hosted.** Readex Pro carries Arabic and Latin in one design, which is why
  an Arabic-first interface needs it: a fallback stack that changes family mid-sentence makes a
  mixed line ragged. Served from our own origin rather than Google, because a render-blocking
  third-party stylesheet delayed first paint enough to break a browser test, it hands a
  visitor's IP to a third party on every load, and it is one more thing that can be
  unreachable. Only the Arabic and Latin subsets are shipped, at four weights.

2026-09-15 — سلّم الخطط مثبَّت في `docs/pricing.md`: خمس درجات (`free` قمع لمرة واحدة على فيديو
عام، `starter` 9$/5,000، `pro` 29$/25,000، `business` 99$/100,000، `enterprise` بعرض سعر)
بوحدة التعليق المحلَّل الموجودة، والموجز المولَّد بوحدة مستقلة تُحسب بالتقرير. مبنيّ على تجربة
BeyondComments وتسعير Comment Finder وAwario وBrand24 وغياب الأسعار المعلنة عند Lucidya وCrowd
Analyzer. الدفع الفعلي يبقى مؤجَّلًا؛ الصفوف تُفعَّل يدويًا. `pilot` لا تُمسّ.

2026-09-15 — Selective video sync (`docs/superpowers/specs/2026-09-15-selective-video-sync-design.md`,
tasks 1–9, `ca86ed3`…`4abfd02`).

- **Selection is a table (`video_selections`), and jobs stay per-channel.** A `collect` job
  carries no video list; the server hands the worker its due list at claim time from
  `private.due_videos`. This keeps the pre-existing "one outstanding collection per channel"
  invariant (`jobs_one_outstanding_collect`) and its UI wording true without a second
  mechanism, lets a video selected mid-run be picked up by the next run rather than needing a
  second job or a silent wait, and means the tenant cannot forge which videos a job touches —
  the list is computed server-side from rows RLS already scopes, not read from client input.
  Rejected: storing the video list on the job (two places deciding what to collect) and one
  job per video (N attempt-log rows per selection, N× worse once live re-checks run
  continuously) — both already rejected once, in `runner.py`, before this work.
- **The scheduler lives in Postgres.** `private.schedule_all()` is the function `pg_cron`
  would call hourly; `private.worker_tick` (wired into `svc_worker_tick`) is the
  extension-free fallback the worker loop calls on every idle tick, so live re-checks and
  fresh-catalogue discovery work on the live project today, without `pg_cron` enabled, and
  without a second scheduling mechanism to keep in sync once it is.
- **`historical_backfill` remains unmetered by this work.** The budget line already existed
  in the plan schema; nothing in this feature reserves it, and nothing here changes that —
  recorded as out of scope in the spec and left that way.
- **The catalogue lives on the operations page (`/sync?ws=…`), not a new route.** It is the
  page's first section, above the health/plan/attempts panels (which moved unchanged into
  `OperationsPanels.tsx` so the split carries no behaviour change), because the operations
  page already carries the plan meter the estimate reads and is where the removed
  "request sync" button lived. No new rail destination was added.
- **The free-tier/public-video funnel is not part of this work.** `plans.free` and the
  `public_unverified` channel state predate this feature and are unchanged by it; selective
  sync applies uniformly to a workspace's one connected channel regardless of plan.

2026-09-16 — Topic classification (`docs/superpowers/specs/2026-09-15-topic-classification-design.md`,
plan `docs/superpowers/plans/2026-09-15-topic-classification.md`, tasks 1–10,
`0866318`…`1b4ed30`).

- **Gemini (`gemini-3.6-flash`, prompt `p1`) is the topic layer.** One primary topic per
  comment, drawn from a per-workspace taxonomy of ten seeded defaults (question, religious
  remark, praise, criticism, request, discussion, personal story, humour, promotion, other —
  `private.seed_default_topics`). The model is pinned by id and prompt version in
  `TopicClassifier.model_id`/`prompt_version`, and a worker whose `model_id`/`prompt_version`
  is not the workspace's own `active_topic_key`'s pair is told `active: false` by
  `worker_topics_due` and finishes the job `blocked` with `topic_model_not_active` rather
  than spending a Gemini call on a verdict that can never become effective — the same
  reasoning `active_analysis_labels` already applies to sentiment.
- **What is sent to Google, and what is withheld.** `worker_topics_due` hands the worker the
  comment's text, its parent's text (or an explicit note that the parent is unavailable, for
  a reply whose parent was purged), and the workspace's taxonomy (key and description; the
  display names never leave the database) —
  never the author, any id, or the workspace. `gemini.py` puts the key only in the
  `x-goog-api-key` header, never in a URL, and constrains the response to the taxonomy's own
  keys via a JSON schema enum so the model cannot name a topic nobody chose; a response
  outside that enum is recorded `failed`/`gemini_bad_response`, not guessed and not folded
  into `other`.
- **Dedicated tables (`topic_predictions`, `topic_reviews`), not `comment_annotations`.**
  Topic and sentiment are independent dimensions with independent lifecycles (a taxonomy can
  be re-versioned; sentiment's label set cannot) and independent metering
  (`topic_classification` is its own kind, `plans.topic_units`, pilot `5000`); folding both
  into one polymorphic table would make a taxonomy version bump touch sentiment rows and vice
  versa. `submit_topic_review` is append-only like `submit_comment_review` and mirrors its
  shape (originates `human`, records who and when) but writes no `audit_events` row, because
  `submit_comment_review` does not either — consistency with the existing behaviour over
  inventing a new one.
- **An `analyse` job, not a sweep.** Topic classification reuses the same `jobs`/lease/retry
  machinery as `collect` and sentiment, dispatched in `run_job` by `type='analyse'`, rather
  than a background sweep with its own scheduling. One job type, one retry story, one place
  the operations page already knows how to show.
- **A missing classifier finishes the job `blocked`, not "skipped."** The design's own
  language called this case "skipped," but the job status vocabulary the schema already
  enforces has no such state — `blocked` with `error_code = 'no_topic_classifier'` is the
  closest existing status that is honest about the outcome (the job did not fail, and it did
  not succeed; it could not run), and extending the vocabulary for one case was rejected as
  the smaller but wrong-shaped fix.
- **A retry may overwrite only a `failed` verdict.** `worker_commit_topics` upserts on
  conflict only when the stored row's status is `failed`; a `succeeded` row is immutable
  once written, matching how `topic_classification` is metered once ever per comment
  regardless of how many times it is later reclassified. The same on-conflict-do-nothing
  defect that lets a sentiment retry silently drop its update exists in the sentiment
  `commit_batch` — noted here as a known follow-up, not fixed in this feature.
- **A reply whose parent was purged is still classified.** `worker_topics_due` sends the
  item with `parent_text: null` and the prompt says explicitly that the parent is
  unavailable, rather than skipping the reply or sending an empty string that could read as
  "no parent" versus "empty parent."
- **Taxonomy-editing UI is deferred.** `set_workspace_topics` exists and is tested at the RPC
  layer; no screen calls it yet. The ten seeded defaults are the only taxonomy any workspace
  has today, which is sufficient for the pilot and does not block the classification path
  landing first.
- **Existing Arabic strings win over new ones where a browser test already pins the wording.**
  The row button that opens topic correction reads "تعديل الموضوع" and the chip's human-review
  marker reads "تصحيح بشري" — the same verb and noun `dashboard.spec.ts` already asserts for
  the sentiment correction flow — rather than a topic-specific phrase that would read as a
  second vocabulary for the same action on the same row.

2026-09-16, later — **the pinned topic model is `gemini-3.6-flash`, not `gemini-2.5-flash`.**
The first working key answered a 2.5 request with 404 "no longer available to new users; use
gemini-3.6-flash". The pin lives in one place (`workers/python/src/topics/gemini.py`); the
classification key changes with it (`topics:v1+gemini-3.6-flash+p1`), which is what the key is
for. Nothing was classified under 2.5 anywhere, so nothing is orphaned.

## 2026-09-16 — a failed sentiment verdict is retried

- **A sentiment retry may overwrite only a `failed` verdict — the same rule as topics.**
  `commit_batch`'s prediction insert now conflicts with `do update ... where
  public.sentiment_predictions.status = 'failed'` rather than `do nothing`. A `succeeded`,
  `skipped` or `unsupported` row is final and a later attempt never touches it, matching
  how `comment_analysis` is metered once ever per comment. This closes the follow-up the
  topic-classification entry above left open. The update also takes the retry's
  `analysis_run_id` and resets `predicted_at`, so the stored row points at the run that
  actually produced the verdict it now carries.
- **Adoption on update is a second trigger, not a rewrite of the first.**
  `adopt_first_analysis_on_update` (`after update ... referencing new table ... for each
  statement`) calls the existing `private.adopt_first_analysis()` unchanged; the function
  already filters on `status = 'succeeded'` and `active_analysis_key is null`, so a
  failed-to-failed update adopts nothing and an already-adopted channel is never swapped.
  Mirrors `adopt_first_topic_classification_on_update` in `20260916011000`.
- **Rebuilt from `20260914070000`, not `20260913220000`.** The task named the latter as the
  current definition; `grep 'create or replace function private.commit_batch'` shows the
  former is later and adds the `sync_runs` block. Starting from `20260913220000` would have
  silently reverted that — the exact failure `docs/coordination/ACTIVE.md` records for
  `worker_finish` on 2026-09-14. The new migration's body is the current one plus one
  clause, verified by `diff`.
- **The `failed` row's `analysis_runs` row is still written as `succeeded`.** Pre-existing
  and unchanged here: a run row's status describes the run, and the worker reports a run
  that produced verdicts, some failed. Narrowing this migration to the conflict clause keeps
  the diff reviewable; if run status should reflect per-verdict failure that is its own
  decision.

2026-09-16, later — **Gemini requests carry 100 comments and no chain of thought; the
prompt version stays `p1`.** Measured on the live key against `gemini-3.6-flash` with the
real prompt: 25 comments per request cost 2,305 tokens (891 prompt, 964 "thoughts", 450
output — 92 a comment); with `thinkingBudget: 0` and 100 comments per request, 5,398 tokens
for 100 (54 a comment), the same verdicts, valid JSON every time. For a 5,000-comment
workspace that is 50 requests and ~270k tokens instead of 200 and ~460k. The version is not
bumped: the instructions and the taxonomy the model reads are the same text, and bumping it
would mark 5,000 fresh verdicts stale and spend the tokens again. A change to the prompt
text itself is a new version. Decided with the user.

## 2026-09-16 — سلّم الخطط v2 والدفع عبر Paddle

Six open questions from `docs/pricing-v2-draft.md` §6, answered in
`docs/pricing-consultation-2026-09-16.md` §7 and carried into
`supabase/migrations/20260917010000_plans_v2.sql`:

1. **Individual prices are 12$/29$**, not the 9$/29$ the old `pricing.md` had. At a ~10%
   payment burden and a flat 0.30$ fee, 9$ nets to about 8$; 12$ leaves margin that survives
   Gemini with thinking on (64% vs 52%), and no subscription competitor sits at 9$
   (Comment Finder's 9.9$ is a one-time credit, not a subscription; vidIQ starts at 19$).
2. **`media` is published, not self-serve.** Its row exists (`self_serve = false`) so it
   anchors `agency` as the middle choice on the pricing page, but its button reads "contact
   us" until change-detection lands in the live check — a `media` subscriber's two-hour,
   thirty-channel check alone would burn ~72% of the project's daily YouTube quota today.
3. **One add-on pack in v1: +10,000 comments for 5$**, one size, no ladder of packs. A hard
   stop with no way out loses the subscriber at the moment of highest intent (an agency
   hitting its ceiling mid-month); the pack is cheap to build because it spends the same
   `analysis_units` `reserve_usage` already reserves, not a parallel credit system.
4. **USD only, no approximate SAR/AED display.** An approximate conversion creates disputes
   the moment a card statement disagrees with the displayed number, and real SAR pricing
   (mada) only makes sense once Tap/Moyasar are in place with a Gulf entity.
5. **Upgrade Supabase to Small before the first paying subscriber, not after.** Micro
   already "runs low on resources" against one pilot channel; the cheapest place to measure
   `commit_batch` under load is now, between analysis jobs, not the week billing goes live.
6. **Paddle first**, reversing the same day's earlier "Stripe first" call — see the tax
   reasoning below.

**Root billing, not per-workspace billing.** A client workspace carries no allowance of its
own; its `subscriptions` row points at `billing_workspace_id`, and every meter
(`private.billing_root`, `reserve_usage`, `used_units`, `analysis_remaining`,
`topic_units_remaining`, the channel-limit count in `register_channel_impl`) reads through
that root. The alternative — a fresh allowance per workspace — would let one `agency`
subscriber multiply their 150,000-comment plan by five just by opening five client
workspaces; one allowance per paying subscriber, shared across every workspace that
subscriber bills through, is the only shape that matches "one plan per customer."

**Owner has no ceiling, encoded three ways on purpose, not one.** `plans.analysis_units`
(and the other limit columns) are `null` for the `owner` row — Postgres's own "no value,"
guarded by a check that only an `internal` plan may spell it that way. The zod contract in
`packages/contracts/src/plans.ts` and `usage.ts` cannot carry `null` through a `.min()`
schema cleanly, so it reports `-1` for "no ceiling" instead. The SQL gates that do arithmetic
against the allowance — `analysis_remaining`, `topic_units_remaining` — cannot subtract from
`null` either, so they return `2147483647` (`int4` max) there, which keeps `remaining - used`
and `used >= allowance` comparisons meaningful without a `null`-check at every call site.
Three representations for one fact, each chosen for what that layer can express cleanly.

**`past_due` carries a 7-day grace, enforced in Part C.** The column and status value exist
today (`subscriptions.status` accepts `past_due`, and every plan-limit read in
20260917020000 still counts a `past_due` subscription as active), but the sweep that drops a
subscription to `free` after seven unpaid days is not built — Paddle is not wired yet, so
nothing can go `past_due` for real. Recorded now so Part C builds the sweep to this number
rather than picking one when the webhook lands.

**Tax reasoning (`docs/pricing-consultation-2026-09-16.md` §5.3, §7.2):** the operating
entity sells through a UK-registered Stripe account while the seller of record is resident
in Türkiye, and sells B2C into Saudi Arabia, the UAE and the EU — three jurisdictions that
each require VAT registration from the first sale to a non-resident seller, with no
threshold. Stripe direct would mean registering with ZATCA, the UAE FTA and the EU's non-
union OSS before the first dollar; Paddle, as merchant of record, becomes the seller of
record instead and absorbs those registrations at a fee (~5% + 0.50$) that is not higher
than Stripe UK's own effective rate on a Gulf card settling in dollars (~5.25% + 0.20£, once
the currency-conversion surcharge is counted).

## 2026-09-16 — the final review of plans v2 / Paddle: what was decided in the fix wave

Nine findings from the whole-branch review; the code is in `20260917060000_cancel_drops_to_free.sql`,
`pricing.ts` / `PricingPage.tsx` / `AdminPage.tsx`, and `scripts/paddle-sync-lib.mjs`.

**A cancelled or paused subscription is the free plan, not a row that says so.** `apply_billing_event`
had stored Paddle's `canceled` / `paused` as `status`, and every gate then refused the row — `reserve_usage`
with `plan_inactive`, `analysis_remaining` with `no_active_plan` — while the sweep looked only at
`past_due`: the customer who cancelled could not spend even the free hundred. The spec is «النزول إلى
free بلا حذف» (`docs/pricing.md`), so the webhook now writes what the sweep writes: `free / active`, no
provider, an open-ended period, on the root and every client row, audited `plan_paddle_canceled` /
`plan_paddle_paused` with target `free`. A later `activated` re-applies the plan. Neither status persists
on a row any more; the column still admits them so an old row is not a migration error.

**The seven-day grace is code, not Paddle's period.** `private.subscription_open(s)` is the one answer to
"may this subscription spend": active inside its period, or past-due for seven days past `period_end`.
`reserve_usage`, `analysis_remaining` and `topic_units_remaining` ask it; before, the meter refused at
`period_end` while the selection gate never looked at the period, so a past-due tenant passed selection
and met `plan_inactive` in the worker. The number is the one recorded on 2026-09-16 and the one
`billing_sweep` enforces from the other side.

**`plan_limit` refuses rather than answering null.** Null now means a live plan's own "no ceiling"
(owner), so a root with no active or past-due subscription must not read as unlimited channels and
workspaces: it raises `no_active_plan`. A workspace with no subscription row at all is refused the same
way — unentitled means unentitled, and `reserve_usage` already said so.

**The workspace limit counts client workspaces.** The card says "workspaces (clients): 5" and the
individual ladder says one workspace; the count in `create_workspace_impl` had included the home, so
`agency` got four clients. The home is not a client (`owned - 1 >= allowed`), and the column is the
number of clients: the individual rows go to 0 and the `>= 1` check to `>= 0`. `pilot` keeps its default
of 1 until it is renamed away.

**A second Paddle subscription for a live root is `conflict`.** `custom_data.workspace_id` is minted by
the browser at checkout; the webhook trusts it. The cheap guard now: an event whose `provider_ref` is not
the one the root is live on (`provider = 'paddle'`, active or past-due) is recorded with outcome
`conflict` and moves nothing; the webhook answers 200 on any decided outcome so Paddle stops retrying.
**Pre-live requirement:** the checkout transaction is minted on the server (an edge function that reads
the caller's session, checks ownership of the workspace, and creates the Paddle transaction with
`custom_data` it wrote itself), so the workspace in a webhook is never a value a browser chose. Until
then, live keys are not set.

**Ruling 17 — Paddle.js has no SRI.** `https://cdn.paddle.com/paddle/v2/paddle.js` (in `index.html`) is
an unversioned URL by Paddle's design — their docs mandate it and they ship fixes under it — so a
subresource-integrity hash cannot be pinned without breaking on their next release. Accepted as-is: it is
the same exposure every Paddle merchant carries, and no secret reaches the page (the client token is
public by design).

**Prices exclude tax: `tax_mode: "external"` on every synced price.** The first real sandbox invoice
showed both lines treated as tax-inclusive — the $12 was $10 plus $2 withheld. The sync creates every
price with `tax_mode: "external"` and PATCHes a found price that lacks it (counted under "updated");
the controller re-runs the sync so the seven existing sandbox prices take the mode. The decision itself
("price before tax, tax on top") is unchanged.

**`set_workspace_plan` keeps a Paddle link.** Over a root Paddle is billing it refuses with
`paddle_subscription_active` unless called with `override = true`; with it, the plan and period change
but `provider`, `provider_ref` and `provider_customer_ref` stay, so the portal and the next webhook still
find the subscription Paddle keeps charging, and the note lands in the audit row (`plan:note`) rather
than over the `provider_ref`. The admin page has the checkbox and the sentence. The four-argument
signature is dropped: with a default on the fifth, PostgREST would see two candidates for a four-field
call.

**A workspace already on Paddle changes plan in Paddle's portal.** The pricing page had offered a second
checkout for every other paid card; a second checkout is a second subscription. When `usage_summary`
says `provider = 'paddle'`, every paid self-serve card that is not the current one opens the portal
(`openPortal`, the plan panel's "manage"), with the same two refusals.
