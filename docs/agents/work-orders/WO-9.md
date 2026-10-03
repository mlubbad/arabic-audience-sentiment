# WO-9 (Codex): ops snapshot reads precomputed per-video counts, and failures show their SQLSTATE

Mirror of GitHub issue #60. **The issue is the source of truth**; this copy exists for agents
whose token can't read issues. If they differ, ask.

- **Branch:** `codex/wo-9-ops-snapshot-counters`
- **PR title:** `WO-9: precomputed ops counts and diagnosable read failures` (body starts
  `Closes #60` and fills the PR template: evidence, mutation proof, scope)
- **No deploy and no remote migration.** CI applies the migration after the owner merges.
- Line numbers are from `main` at `a807eab`.

## Why
On production, the **التشغيل** (Sync) page and the rail's "الجمع" card both fail with
`read:live_unavailable` for the AJ360 workspace. They succeed after two manual retries, which
is the signature of a statement timeout on a cold cache. Both read
`public.workspace_ops_snapshot(w)`, which calls `private.workspace_ops_snapshot_impl`. Its
latest definition is in
`supabase/migrations/20260922020000_adopt_full_channel_on_registration_and_backfill.sql`.

On every page view its `stats` CTE scans **every comment** in the workspace (~195k comments
across ~4k videos for AJ360) and left-joins `sentiment_predictions`. That is the shape we fixed
for the dashboard on 2026-09-24. Until WO-4b (#53) the client retried `57014` twice, which hid
the problem; WO-4b correctly removed that retry.

## Part A: precomputed per-video counts (SQL)
1. Add a new migration that creates `private.video_comment_stats(workspace_id, video_id, total,
   analysed)`, keyed by `(workspace_id, video_id)`. Its FK to `public.videos` must cascade on
   delete. Not reachable by `anon` or `authenticated`.
2. Keep it **exact** with statement-level triggers that use transition tables:
   - on `public.comments`: after insert and after delete;
   - on `public.sentiment_predictions`: after insert, after update of `status`, and after
     delete.

   Each trigger collects the distinct `(workspace_id, video_id)` pairs the statement touched and
   **recomputes those videos only** from the base tables, as an upsert. No per-row `+1/-1`
   arithmetic. Bulk paths (`private.adopt_channel_content`, `remove_channel`,
   `delete_workspace`) must stay correct and set-based.
3. `analysed` is the number of **distinct comments** on the video with at least one
   `status = 'succeeded'` prediction. Check the current join-count for double counting. If it
   double counts, prove it with a test and fix it (`analysed <= total` always).
4. In the same migration, backfill every existing video in one set-based statement, without
   `COMMIT` or `CONCURRENTLY`.
5. Redefine `private.workspace_ops_snapshot_impl` to read `video_counts` and `catalogue_summary`
   from `videos` left-joined to the stats table. It must not reference `public.comments` or
   `public.sentiment_predictions`. Keep the authorization check, the output shape
   (`OpsSnapshotSchema`) and every other field unchanged.

## Part B: a read failure names its SQLSTATE
`failureCode` (`apps/web/src/failure.ts:41`) drops the PostgREST code that `DashboardRpcError`
already carries (`apps/web/src/data.ts:250-270`).

- When `code` matches `^[0-9A-Z]{5}$` or `^PGRST[0-9]{3}$`, append it:
  `read:live_unavailable:57014`.
- Never append anything else.

## Owned paths
- the new migration file
- `supabase/tests/ops_snapshot.test.ts`, or a new `supabase/tests/ops_snapshot_stats.test.ts`
- `apps/web/src/failure.ts` and its test

**Do not touch:** `apps/web/src/data.ts`, `queryRetry.ts`, `ops/**`, `RailState.tsx`, older
migrations, `supabase/functions/**`, or `.github/**`.

## Acceptance criteria
- [ ] **Parity (DB test).** After each of these, the snapshot equals a brute-force count:
  - inserting comments across 2+ videos;
  - inserting a succeeded prediction;
  - updating a prediction's status from `pending` to `succeeded`, and from `succeeded` to
    `failed`;
  - deleting comments;
  - channel adoption (`adopt_channel_content` / `register_public_channel`);
  - removing a channel;
  - deleting a workspace.
- [ ] **Isolation.** B's stats never appear in A's snapshot. `authenticated` can't read the
  stats table.
- [ ] **No full scan.** `pg_get_functiondef` of the impl contains neither `public.comments` nor
  `public.sentiment_predictions`. Show that it fails against the current definition.
- [ ] **Bulk is not per-row.** The triggers are `FOR EACH STATEMENT` with transition tables,
  asserted from `pg_trigger`.
- [ ] **Backfill.** Parity holds after the migration's backfill runs over pre-seeded data.
- [ ] **Part B unit tests:**
  - `57014` and `PGRST301` are appended;
  - `"57014; drop"`, an absent code and a non-string code all give plain
    `read:live_unavailable`;
  - the existing failure tests still pass.
- [ ] **Mutation proof:** removing the delete trigger, or using `+1` arithmetic, fails the
  parity test.
- [ ] `npm run check` and `npm run test:db` pass. Paste the summary lines.
- [ ] No deploy, no remote migration, never push to `main`.

## Notes
- If `private.usage_summary_impl` also does a full-table read that would time out at this
  scale, report it in the PR. Don't fix it in this WO.
