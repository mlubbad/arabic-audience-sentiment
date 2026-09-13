# Platform lane report

Owner: Claude Code. Branch: `codex/agent-b-platform`.
Worktree: `/Users/mlubbad/Documents/Codex/SentimentAnalysis-worktrees/platform`.

## Transition acknowledgement (2026-09-13)

Moved. I am working only in this worktree from now on and will not edit the original
checkout or any other lane's files.

Baseline check: the original checkout `/Users/mlubbad/Documents/Codex/SentimentAnalysis`
was clean at `5e9094f` with nothing uncommitted. `git merge-base --is-ancestor 5e9094f
codex/agent-b-platform` succeeds, so every commit I made is already contained in this
lane's baseline `59b9205`.

**There are no newer original-checkout commits to preserve, and nothing was discarded,
reset or stashed.** The five product commits are `f3384d0`, `42b1e28`, `6f961fa`,
`8dabee0`, `5e9094f`.

## P1 — fixture and live modes kept separate (done)

Commit: see below. Base: `59b9205`.

The defect was real and mine. `loadSnapshot` always read the fixture, while `submitReview`
branched on `if (supabase)`. With `VITE_SUPABASE_URL` set, the dashboard showed fixture
rows while a correction called `submit_comment_review` with `c: "fixture-1"` — a fixture id
and a fixture workspace addressed at a real server. `reviewsArePersisted` was derived from
Auth configuration, so the "session only" notice disappeared and the UI claimed persistence
for a write that could not succeed. The read path and the write path disagreed about which
mode they were in.

Fix: one explicit `dataMode`, decided in a single place and currently `sanitized_fixture`
because there is no live comment read path. `reviewsArePersisted` is derived from the data
mode, not from Auth. The Auth-keyed server branch is removed rather than left half-wired; a
live write path cannot be correct before a live read path exists, and both should land
together so the two cannot drift apart again. The dashboard now states on screen that
signing in does not change the data source.

Changed paths (all in lane):
- `apps/web/src/data.ts`
- `apps/web/src/data.test.ts` (new)
- `apps/web/src/Dashboard.tsx`

Commands and results, run in this worktree:
- `npm run typecheck` — pass
- `npx eslint apps/web supabase tests` — pass
- `npm test` — 31 passed, 5 files (4 new in `apps/web/src/data.test.ts`)
- `npm run test:db` — 18 passed
- `npm run test:e2e` — 15 passed, 11.3s. Port 5173 was verified free before starting and
  released after; load average was 3.22.
- `node scripts/check-ownership.mjs platform` — pass, 3 changed paths

The new tests mock `./supabase` as **configured** and assert the RPC is never called, the
correction stays in the session view, a stale content hash is still refused without falling
back to a server, and `dataMode` is `sanitized_fixture` even with Auth present. Test 1 was
confirmed to fail against the old code with the real defect (`c: "fixture-1"` sent to the
RPC) before the fix.

Mocked vs live: everything here is fixture-backed. No live Supabase, Auth, YouTube, OAuth,
model or deployment behaviour is exercised or claimed.

## Requested shared changes (integrator-owned)

1. **Contracts bottleneck, measured.** 3 of the last 5 feature commits modified
   `packages/contracts/src/index.ts` (438 lines). If every schema change round-trips through
   the integrator, the platform lane stalls most of the time. Proposal: split into domain
   modules behind a thin barrel (`filters.ts`, `comments.ts`, `snapshot.ts`, `csv.ts`,
   `usage.ts`, `jobs.ts`); keep the barrel and any cross-lane schema integrator-owned, and
   let each lane own its domain module. Preserves one-writer-per-interface, removes the stall.

2. **Playwright can report a false pass across lanes.** `playwright.config.ts` sets
   `reuseExistingServer: !process.env.CI` on fixed `127.0.0.1:5173`. A dev server left
   running in another worktree is silently adopted, so a lane can exercise another lane's
   code and still report green. Port etiquette does not fix this. Request: per-lane port via
   env, or `reuseExistingServer: false`. Root config is integrator-owned.

3. **Load contention manufactures phantom failures.** Measured on this laptop on 2026-09-12:
   at load average 17.25, `npm run check` took 12m27s for 31.8s of user CPU (4% cpu) and the
   browser suite failed a *different* test on each of two runs at 0% cpu; the same commit
   passed 12/12 in 11.6s at 111% cpu once load fell to 9.7. Request: lane reports record load
   average beside browser results, and a browser failure under high load is recorded as
   unproven and re-run before it is believed. Already noted in `docs/verification.md`.

4. **Stub collision risk.** `docs/agent-reports/platform.md` was committed by integration and
   is also written by this lane. This commit rewrites it wholesale, which will conflict if
   integration edits it too. Suggest integration treats lane reports as lane-owned from here
   and does not edit them.

## Next

P2 depends on I1. I will draft the worker↔server batch contract proposal for I1 next and
record it here, then continue independent in-lane work while the integrator publishes it.
I will not create a competing copy of a shared contract.

## I1 proposal — worker → server batch contract (for the integrator to publish)

This is a proposal, not an implementation. I have not added any of it to
`packages/contracts`. P2 will consume whatever the integrator publishes.

### Shape

One call commits a batch. The server owns identity; the worker never sends a server UUID.

```
CommitBatchRequest {
  job_id:        uuid           // from claim
  lease_token:   uuid           // fencing; never logged
  batch_key:     string(1..200) // idempotency key for this batch
  payload_hash:  sha256 hex     // fingerprint of comments+predictions+checkpoint
  checkpoint:    object         // opaque to the server, stored verbatim
  outcome:       "partial" | "exhausted" | "blocked" | "failed"
  comments:      RawComment[]   // <= 500
  predictions:   Prediction[]   // may be empty; keyed to comments by external id
}
```

`RawComment` mirrors what the collector already produces and must keep:
`external_comment_id`, `external_parent_id`, `is_reply`, `parent_source`,
`author_channel_id`, `text_raw`, `content_hash`, `published_time_raw`, `published_at`,
`timestamp_precision`, `likes_raw`, `likes_value`, `source`, `field_provenance`.

`Prediction` carries `external_comment_id`, `content_hash`, `analysis_key`, `status`,
`label`, `class_scores`, `model_id`, `revision`, `preprocessing_version`. `status` and
`label` stay coupled: only `succeeded` has a label. Mixed is a first-class label.

### Rules I would like frozen

1. **Identity.** The worker addresses rows by `(platform, external_comment_id)`. The server
   resolves or inserts and returns nothing row-shaped, so the two sides cannot drift.
2. **Lease scope.** The allowed workspace is derived server-side from the worker credential
   and the job, never read from the payload. A payload workspace field would be a
   privilege-escalation vector, so there should not be one.
3. **Replay.** `batch_key` plus `payload_hash` together. Same key and same hash is a no-op
   returning success; same key and different hash is `batch_conflict`. Today
   `commit_checkpoint` compares only the checkpoint, which would accept a different payload
   under a reused key — that is the gap P2 must close.
4. **Metering.** The server derives usage keys; the worker does not send them. Charging is
   inside the same transaction as rows and checkpoint, which already works.
5. **Failure is not success.** `outcome` never collapses to succeeded. A batch that cannot
   be paid for in full is refused whole, as `commit_checkpoint` already does.
6. **Errors.** `lease_lost` (409, retryable after re-claim), `batch_conflict` (409, not
   retryable), `quota_exceeded` (429, not retryable without a plan change), `invalid_batch`
   (400), `forbidden` (403). Shapes should reuse the existing `ErrorSchema` with
   `request_id` and `retryable`; no stack traces.

### Open questions the integrator should decide, not me

1. **What is the billable unit key?** The spec says one unit for the first successful
   analysis of a *unique comment*, and that re-analysis from a model upgrade is internal and
   unbilled. It does not say whether re-analysing a comment whose **text changed** is new
   billable work. `analysis:{platform}:{external_comment_id}` never double charges but bills
   edited text as free; adding `content_hash` to the key bills every edit. I lean to the
   comment-only key, since it cannot surprise a customer, but this is a pricing decision.
2. **Does a prediction for a comment not in this batch commit or fail?** I lean to failing
   the batch, so the worker cannot analyse rows it never delivered.
3. **Is `class_scores` required for `succeeded`?** Storing all class probabilities is
   specified; making it required blocks any future adapter that cannot produce them.

### Dependency note

P2 is blocked on this being published. P3 partially depends on it where payloads are shared.
I will not speculate a Python-side client, and I will not implement a competing schema.
Independent in-lane work continues meanwhile: the remaining dashboard filters that
`FiltersSchema` already supports (comment type, reply mode, review status, video kind),
which need no new shared contract.

## Patch request for the integrator (2026-09-13)

Read-only review of the integration worktree after Codex stopped at its usage limit.
Nothing is committed there: `codex/coordination-integration` is still at `59b9205`, with
`scripts/check-ownership.test.mjs` modified and `scripts/playwright-isolation.test.mjs`
untracked. `npm run check` is green at HEAD; only the working tree is red. Both new tests
are correct and both implementations are missing.

I did not edit any of these files. Every command below was run in the platform worktree
against a copy of the same setup, so the patch is verified rather than proposed.

### Patch 1 — `scripts/check-ownership.mjs`: make the contracts rule real

`violations()` still allows only `apps/web/`, `supabase/`, `tests/e2e/`, so the agreed rule
is not in force and the platform lane is still blocked from `packages/contracts`. Confirmed
by running `node --test scripts/check-ownership.test.mjs` in the integration worktree:
**3 pass, 1 fail**, the failure being the new contracts test.

Minimal change that turns it green — add one prefix to the allow list:

```js
    return !["apps/web/", "supabase/", "tests/e2e/", "packages/contracts/src/"].some(
      (prefix) => file.startsWith(prefix),
    );
```

`packages/contracts/package.json` and `packages/contracts/protocols/**` are then denied
automatically, because neither lives under `src/`. No explicit deny entry is required for
the test as written.

Recommended hardening, and an open question. The allow list lets the platform lane change
anything under `src/`. If a worker-facing TypeScript type ever lands there, one lane could
change a cross-language contract unilaterally, which is the thing the split exists to
prevent. Either keep worker-facing schema out of `src/` entirely, or add a defensive deny:

```js
    if (file.startsWith("packages/contracts/src/protocols/")) return true;
```

Please decide where the TypeScript side of the I1 worker batch contract will live. I have
not created it anywhere.

### Patch 2 — `playwright.config.ts`: fail closed, and avoid a trap

`E2E_PORT` is currently read by nothing: `grep -rn E2E_PORT` finds only the test that sets
it. Replace the config body with:

```ts
// Each lane drives its own dev server. Never adopt one that is already listening:
// a server left running by another worktree serves that lane's code, and the suite
// would pass against the wrong build.
const port = Number(process.env.E2E_PORT ?? 5173);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: origin, viewport: { width: 1280, height: 800 } },
  webServer: {
    // Single npm layer on purpose, and --strictPort so an occupied port exits
    // rather than silently moving to another one.
    command: `npm run dev -w @sentiment/web -- --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: false,
  },
  reporter: "list",
});
```

**The trap, measured.** The natural form `npm run dev -- --port ${port}` does not work.
The root `dev` script is itself `npm run dev -w @sentiment/web`, so npm consumes `--port`
as its own flag instead of forwarding it to Vite. I ran it: the server came up on **5173**
while 5199 stayed closed. A patch written that way looks correct, changes nothing, and
leaves the false-pass risk in place while appearing fixed. The single-layer form
`npm run dev -w @sentiment/web -- --port 5199 --strictPort` served **5199** and left 5173
closed.

**Fail-closed confirmed.** With a foreign socket holding the port, that command exits `1`
and prints `Error: Port 5197 is already in use`. Codex's assertion
`/already used|already in use|EADDRINUSE/` matches that output, so its test should pass
against this patch unchanged.

Note that `apps/web/vite.config.ts` pins `port: 5173, strictPort: true` and is
platform-owned. The CLI override makes this patch integrator-only; editing the Vite config
instead would have crossed lanes for no reason.

### Patch 3 — give the isolation test its own script

`scripts/playwright-isolation.test.mjs` is wired to nothing. `test:coordination` runs only
`check-ownership.test.mjs`, so the isolation test would never run.

```json
"test:isolation": "node --test scripts/playwright-isolation.test.mjs"
```

Please do **not** add it to `test:coordination`, and therefore not to `npm run check`. It
spawns a full browser run, so it would put a browser suite inside the unit-test step and
contend with the separate `npm run test:e2e` CI step. A separate CI step after `test:e2e`,
or on demand, is the right home.

### Patch 4 — raise the isolation test timeout

`{ timeout: 60000 }` will flake exactly when it matters. Measured on this laptop on
2026-09-12: at load average 17.25, `npm run check` took 12m27s for 31.8s of user CPU. A
60-second budget for spawning a dev server plus a browser fails whenever the machine is
busy, which is precisely when two agents are working. Suggest `{ timeout: 600000 }` with a
comment pointing at that measurement.

### Patch 5 — a fresh clone silently loses the guard

`core.hooksPath` is set to `.githooks` in both worktrees and the hook is executable, so it
is active here. But it is local git config: it is not committed and `npm run setup` does not
set it, so a fresh clone or a CI runner gets no pre-commit ownership guard. Suggest
appending to `setup`:

```
&& git config core.hooksPath .githooks
```

### What I verified, and what I did not

Ran: `node --test scripts/check-ownership.test.mjs` in the integration worktree (read-only,
pure Node, no ports); the two port-forwarding forms; and the occupied-port fail-closed case.

Did not run `scripts/playwright-isolation.test.mjs` itself — it spawns a browser suite and
would leave artifacts in another agent's worktree. Its behaviour is inferred from the three
measurements above rather than observed end to end. Worth one real run once Patch 2 lands.

No stray dev servers were left behind; port 5173 was released after each check.

## Remaining dashboard filters (done, 2026-09-13)

`FiltersSchema` already supported these and `snapshot()` already implemented them; only the
controls were missing. Now exposed: video kind, participation (comment vs reply), comment
type, review status, and known/unknown publication date. Every panel still derives from the
one snapshot, so aggregates, the comment table and the CSV export all move together — the
export test asserts a replies-only filter produces a two-row file.

Two decisions worth recording.

**Comment types are derived from the data, not hard-coded.** The options come from the
distinct `comment_type` values present in the workspace, computed over every row rather than
the current page so a type that is filtered out can still be selected. The specification is
explicit that one channel's vocabulary must not be generalised to other customers, so a
fixed list would have been wrong. This is currently computed in `apps/web/src/data.ts`
because the fixture is read whole. **Shared-contract request:** when the live dashboard read
lands, `snapshot()` needs a `comment_types` aggregate, otherwise the live path cannot offer
the same control and the two modes diverge — the exact failure P1 fixed.

**A date range and "no known date" cannot contradict.** Selecting undated rows disables the
range inputs and the range is not sent, rather than silently returning an empty screen.

### Accessibility defect found and fixed

A `<label>` wrapping a `<select>` takes its accessible name from all descendant text, which
includes every `<option>`. A screen reader announced the video filter as
"الفيديو كل الفيديوهات فيديو اصطناعي ١ فيديو اصطناعي ٢" — the entire option list as the
field name. Found because `getByLabel("الفيديو", { exact: true })` matched nothing. Every
select in the dashboard now carries an explicit `aria-label`, so each control has a real
name. This was a pre-existing defect, not one introduced here.

Related: adding the label "نوع الفيديو" silently broke four passing tests, because
Playwright's `getByLabel` is a substring match and "نوع الفيديو" contains "الفيديو". Those
selectors are now exact.

### Fixture change

`fixture-5` and `fixture-6` became `short`, and two rows gained a `comment_type`. No row was
added or removed: the total stays 6 and the per-video counts stay 4 and 2, so no existing
assertion changed. Without this the two new filters had no distinguishable data to act on.

### Commands and results, run in this worktree

- `npm run check` — pass (lint, format, typecheck, coordination, 31 unit, 18 SQL, 23 worker,
  build, secret scan)
- `npm run test:e2e` — 22 passed in 16.9s, load average 1.79. Run on port 5199 via
  `npm run dev -w @sentiment/web -- --port 5199 --strictPort`; port 5173 was never occupied
  by this lane and no server was left running.
- `node scripts/check-ownership.mjs platform` — pass

Seven new browser tests were confirmed failing against the missing controls before the
controls were written.

## Review history per comment (done, 2026-09-13)

Each comment's verdicts are now listed in the correction panel, newest first, with what each
one is doing now. `reviewHistory()` uses the same precedence rule as `effectiveLabel` — the
newest human verdict whose hash matches the current text wins — so the panel and the number
in the table can never disagree.

Four states, because "not counted" has four different meanings and collapsing them would be
the dishonesty this is meant to remove:

| State | Meaning |
| --- | --- |
| `in_force` | This is the verdict the dashboard is using |
| `superseded_by_review` | A later human verdict replaced it; it is kept, not overwritten |
| `superseded_by_edit` | Made against text that was edited afterwards; needs re-auditing |
| `legacy_unverified` | An imported legacy amendment, never human-reviewed truth |

`effectiveLabel` silently discards the last three. A reviewer previously had no way to see
that their correction had stopped counting, which matters most for `superseded_by_edit`:
the comment reverts to the model label with nothing on screen explaining why.

A unit test covers the case worth being careful about — a newer *stale* verdict must not
hide an older applicable one, and must not be promoted itself.

### Blocked: "who" and "why"

The task called for who, when and why. **When** and **whether it still applies** are done.
**Who** and **why** are not, and I did not fake them: `ReviewSchema` carries only
`label`, `content_hash`, `created_at`, `origin`. The SQL table already stores `reviewer_id`
and `reason`, so the data exists — the shared contract does not expose it, and
`packages/contracts` is still integrator-owned on my branch because Patch 1 has not landed.
I verified this rather than assuming: `violations('platform', ['packages/contracts/src/index.ts'])`
is still non-empty.

**Shared-contract request:** add `reviewer_id: string` and `reason: string` to
`ReviewSchema`. Note `ReviewSchema` is not `.strict()`, so Zod strips unknown keys — the
fields cannot be carried through the fixture as a workaround, which is why this is a real
block rather than a preference. Once it lands I will show the reviewer and the stated reason
against each entry; the panel already has the row for them.

### Fixture change

`fixture-3` gained a `legacy_unverified` amendment and `fixture-6` a human verdict against
pre-edit text. Neither is counted by `effectiveLabel`, so every existing count is unchanged:
total 6, analysed 4, reviewed 0 before any correction. Confirmed by the 22 pre-existing
browser tests passing untouched. Without them the two most important states had no data.

### Commands and results

- `npm run check` — pass (36 unit across 6 files, 18 SQL, 23 worker, build, secret scan)
- `npm run test:e2e` — 26 passed in 18.0s, load average 1.99, on port 5199
- `node scripts/check-ownership.mjs platform` — pass

Four new browser tests and five new unit tests were confirmed failing before the code existed.

## Video comparison (done, 2026-09-13)

Per-video figures are computed by running the shared `snapshot()` once per video with that
video pinned, rather than writing a second aggregation. Filter semantics are then identical
**by construction** instead of by a second implementation happening to agree with the first.
No shared-contract change was needed: `snapshot()` already accepts `video_ids`.

Two correctness points.

**Each video uses its own denominator.** The test proves it rather than asserting numbers
that happen to coincide: it corrects one comment on video-2 so the whole set reads 5 analysed
with 2 positive (40%) while video-2 alone reads 1 of 1 (100%). Sharing the global denominator
would have shown 40% for both.

**A video with nothing analysed says so.** video-2 renders "لا توجد تعليقات محللة ضمن
الفلاتر" rather than 0% positive, which would read as a measurement that was never made —
the same rule as a three-class model not reporting 0% Mixed.

The panel also declares its scope: these are comment-derived figures under the current
filters, explicitly not lifetime video metrics, which the specification requires to carry
their own observation window. Comparison is capped at the ten busiest videos and says when
it has truncated, since a channel can have hundreds.

### Two defects found and fixed on the way

**Literal escape characters were rendering on screen.** The undated-comments line displayed
`\n تعليقات بلا تاريخ: 1 \n`. An earlier edit of mine had written escaped newlines into the
JSX as text. The existing test passed because it asserted only the `<span>` holding the
number, not the sentence around it. Found by looking at the page, not by a failing test. The
test now asserts the rendered sentence, which would have caught it.

**Every video other than `video-1` was labelled "فيديو اصطناعي ٢".** The old code was an
inline ternary with no third branch, so a third video would have been silently mislabelled as
the second. Replaced with a lookup that falls back to the identifier rather than guessing.

### A selector fragility the new table exposed

Adding a second table broke eleven passing tests that used a bare `locator("tbody tr")`.
Three more kept passing only because the comparison table happens not to contain comment
text. All nineteen are now scoped to `[data-testid="comments-table"]`; none of them depend on
there being exactly one table any more.

### Commands and results

- `npm run check` — pass (36 unit across 6 files, 18 SQL, 23 worker, build, secret scan)
- `npm run test:e2e` — 29 passed in 17.1s, on port 5199
- `node scripts/check-ownership.mjs platform` — pass

Three new browser tests were confirmed failing before the section existed.

### Shared-contract requests arising

`snapshot()` returns only `{id, total}` per video and there is no video title anywhere in the
contract, so the comparison labels by identifier through a fixture-local lookup. For the live
read path this needs either a per-video aggregate on `dashboard_snapshot` or a `videos`
projection carrying title and kind — one snapshot call per video will not scale to a channel
with 194 of them. Recorded here rather than worked around.

## Sync health panel (done, 2026-09-13)

The panel classifies rather than summarises, because the specification is explicit that a
worker on a closed laptop does not give round-the-clock updates and that a collection which
stopped early is partial or failed but never a successful empty dataset. "Succeeded" alone is
therefore not enough to call a channel current.

| State | Severity | Why it is separate |
| --- | --- | --- |
| `stalled` | critical | Queued work with no worker. Checked **first**, so a healthy previous run cannot hide that nothing is progressing |
| `never_run_no_worker` / `never_run` | critical / warning | Nothing has run; whether anyone could is a different problem |
| `failed` / `blocked` | critical | Shown with the error code, not a generic failure |
| `partial` | warning | Stopped before the end; never rendered as completion |
| `incomplete_coverage` | warning | The source stopped returning rows, which is not proof everything was retrieved. Outranks recency |
| `stale` | warning | Completed, but more than 24h ago |
| `running` / `healthy` | ok | In progress with no outcome guessed, or complete and recent |
| `no_data` | unknown | Absent or malformed input reads as unknown, never as healthy |

The worker line states *why* a developer machine is not a scheduler rather than implying it.

In fixture mode the panel shows "no sync has run and no worker is connected". That is not a
placeholder: it is the true state, and it is what the acceptance criteria ask to be visible.

### Defensive parsing

`readSyncState()` validates the block and returns null on anything unexpected, so a
malformed payload reads as `unknown` rather than falling through to healthy. A browser test
feeds it `{worker: "yes please", queued_jobs: "many"}` and asserts both the unknown state and
that the rest of the dashboard still works — sync health is not load-bearing.

### Contract note

The shared contract has no `sync_runs` schema and `FixtureSchema` is not strict, so it
silently strips a `sync` key. The block is therefore read from the raw payload alongside
`FixtureSchema.parse`, and validated by a local presentation model in
`apps/web/src/syncHealth.ts`. I could not add `zod` to `apps/web` for this because the
package manifest is outside my lane; the validation is hand-rolled instead of pulling in an
undeclared dependency.

**Shared-contract request:** canonicalise this shape as `SyncRunSchema` plus a `sync` field on
`FixtureSchema`. The local type in `syncHealth.ts` is the proposed shape; the classification
logic is presentation and should stay in the app.

### Commands and results

- `npm run check` — pass (45 unit across 7 files, 18 SQL, 23 worker, build, secret scan)
- `npm run test:e2e` — 33 passed in 19.3s, on port 5199
- `node scripts/check-ownership.mjs platform` — pass

Nine unit tests and four browser tests were confirmed failing before the code existed. One
unit expectation was wrong on the first run — a 49.5-hour gap rounds to 50, not 49 — and the
test was rewritten to use an exact 48-hour gap rather than depending on rounding.
