# Implementation decisions

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
