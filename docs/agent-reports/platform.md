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
