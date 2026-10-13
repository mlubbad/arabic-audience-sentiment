I found 14 problems; the comparison refresh is the most severe. It is badly designed, and its pages hide the failure from the owner. Three more issues are likely to break in production but are **unverified**: the nightly recount behind the Home and Channels comment counts, a lock pile-up on the worker heartbeat, and deleting the largest workspace.

How I checked: by reading `supabase/schema/current.sql`, the migrations and the admin pages. No files were changed and no network service was contacted, and I ran no tests. "Unverified" marks what I could not confirm without production access.

## Findings, most severe first

**1. CRITICAL: the comparison refresh can never finish, and finished work is thrown away.** In `20261021000000_admin_channels_compare.sql:157-186`, `drain_channel_compare(15)` recounts up to 15 workspaces in one cron statement, which is one transaction.
- A statement timeout (code 57014) cancels the whole transaction. Postgres does not let `exception when others` (`:180`) catch a cancel, so every workspace already recounted in that run is rolled back. That explains "0 ever refreshed", even if the first few workspaces finished.
- The time check `exit when clock_timestamp() - started > interval '2 minutes'` (`:176`) only runs between workspaces, and it equals the cron limit. Any run that adds up to more than 2 minutes is killed and rolled back.
- The queue is oldest-first (`order by min(d.marked_at)`, `:173`). The rolled-back workspace keeps its mark, so it is first again every run and blocks the other 114.
- `set statement_timeout = '300s'` (`:162`) has no effect under cron. Failures that can be caught only produce a `raise warning` (`:181`), which the cron log does not keep.
- The mark table has no unique key (`:47-52`, `:207`). While nothing drains, it grows by a row for every prediction write.
- The text still says counts update "within minutes" (`ar.ts:792`, `:812`).
- **Fix:** the design at the end.

**2. HIGH: the Comparison page and morning summary show never-counted and stale numbers as if they were real.**
- A row that was never counted shows `0` analysed and the "small sample" badge (`AdminComparePage.tsx:217-225`). The only hint is the count text (`:182`). The CSV exports those zeros with no freshness column.
- The freshness line shows the newest `refreshed_at` of any row (`:97-101`, `:242-243`), so one fresh workspace hides every stale one.
- A stale workspace's "this week" is fixed in old cells, so as days pass it shrinks to zero (window `day > today - 7`, `current.sql:5924-5929`). The page shows that as a real drop and a weekly "change".
- The morning summary's movers come from the same empty cells (`20261022000000_admin_daily_digest.sql:39-58`). They show "no change with enough sample yet" (`adminDigestNoMovers`), which looks the same as "comparison broken".
- No page reads `cron.job_run_details`. The Services page doesn't watch scheduled jobs, so a job failing every 10 minutes for days is invisible.
- **Fix:** give each row its own state (not counted / behind since X / failed: reason) instead of "small sample" for uncounted rows. Have the freshness line show the oldest count time and how many rows are behind. Add an `admin_background_jobs()` read for the System and Comparison pages. Store the comparison's freshness in the summary snapshot.

**3. HIGH (unverified): the nightly recount of comment counts probably fails the same way.** The `reconcile-video-comment-stats` cron job (`20261004010000…:162`) runs `reconcile_all_video_comment_stats()` (`current.sql:3771-3807`). That loops every workspace in one statement: a full count of each video's comments plus an existence check per comment for a prediction. It runs under the same 2-minute cron limit. At about 14 s to read 155k comments, the whole platform likely goes over, rolls back, and lets Home, Channels, search and summary counts drift with no warning.
- **Check:** `select status, return_message, start_time from cron.job_run_details where command like '%reconcile_all%' order by start_time desc limit 5`.
- **Fix:** one workspace per transaction, or the same one-unit-per-run pattern as the design below, and report failures on the Services page.

**4. HIGH (unverified): the worker heartbeat locks every workspace's row.** With the platform credential, `touch_worker_seen` (`current.sql:4889-4905`) upserts a `worker_seen` row for every workspace. It runs at the start of `worker_commit_batch` (`:5029`) and `worker_heartbeat` (`:5353`), so all of those row locks are held until the batch commits. A second worker process (the Mac and Oracle workers both use it, per `20261023…`) waits behind it until the 8 s limit. That is the same failure `20261023000000` fixed for `worker_credentials`, still present here.
- **Fix:** touch at most once a minute using `for update skip locked`, as in `worker_workspace`, or keep one heartbeat row per credential.
- **Check:** `pg_locks` / `pg_stat_activity` wait events on `worker_seen`.

**5. MEDIUM-HIGH: "تعليقات محللة" (analysed comments) means three different things.**
- Home, the Channels side panel (`AdminChannelsPage.tsx:367-370`), the search palette and the morning summary read `private.video_comment_stats`. There, `total` includes the channel's own comments, and `analysed` is any successful prediction under any analysis or text version, with human reviews ignored (`current.sql:4019-4031`). Each workspace copy of a channel is counted separately (`:6095-6096`).
- The Comparison page and the customer dashboard drop the channel's own comments, use the active analysis with the matching text version, and let a human review win (`current.sql:3933-3971` vs `2384-2402`).
- The same channel can show different analysed numbers on Channels and Comparison under the same label.
- Two smaller differences from the dashboard:
  - The dashboard joins predictions on `comment_id` only (`:2384`), so a comment with predictions for two text versions may be counted twice. Unverified that old versions are kept.
  - The dashboard uses the first channel's analysis key and channel id for the whole workspace (`:2251`, `:2290`), so multi-channel workspaces can differ.
- **Fix:** label the stats-table numbers differently ("collected, including the channel's own"), or add matching own-excluded and active-analysis columns to the stats table.

**6. MEDIUM: the largest workspace probably can't be deleted.** `admin_workspace_footprint` (`current.sql:6849-6866`) counts all comments, predictions and reviews with no function timeout, so the 8 s limit applies. At ~14 s for 155k comments it likely fails, and the confirm button then stays disabled (the dialog's own test covers that path). `delete_workspace` (`:7010+`) deletes predictions and then comments, and the stats triggers recount all 4,583 videos twice, also within 8 s. The dialog shows the raw `adminFailed("57014")`.
- **Fix:** capped counts or the stats table for the footprint; set `statement_timeout` on both public functions; delete the large child tables in batches before the final call.

**7. MEDIUM: the Ops page's "comments this week" can time out and doesn't mean what it says.** `admin_ops` has no timeout (8 s). `comments_7d` counts by `first_seen_at`, i.e. when collected (`current.sql:6242-6244`). After a big import that is ~155k rows, which is over 8 s on these disks, so the Ops page errors. The label "تعليقات هذا الأسبوع" suggests comments posted this week, and the count includes the channel's own comments and every copy.
- **Fix:** `alter function public.admin_ops set statement_timeout='30s'`, keep a daily count maintained by the existing comment-insert trigger, and relabel.

**8. MEDIUM: the stats triggers recount a whole video on every write.** `refresh_video_comment_stats` (`current.sql:3988-4044`) recounts every comment of each touched video, with a prediction check per comment, on each insert of comments or predictions. A video with tens of thousands of comments is re-read on every worker batch, the same class as the earlier worker timeouts. Size per video is unverified.
- **Fix:** add or subtract counts per statement instead of recounting.

**9. MEDIUM: "failed" is counted four different ways.**
- Home "failing": the latest run of any kind failed (`current.sql:1241`).
- Morning summary: `status='failed'` in the last 24 h (`20261022…:81-82`).
- Ops "مزامنات فاشلة": failed or partial, 7 days (`current.sql:6254-6257`).
- Services: failed, blocked or partial (`:6452-6456`).
- **Fix:** one definition, with "partial" shown separately.

**10. MEDIUM: error paths in the UI.**
- *Known:* the Plans toggle shows success on failure and also flips the toggle locally (`AdminPlansPage.tsx:72-76`). The limits dialog shows the raw `live_unavailable` (`EditPlanLimitsDialog.tsx:117-119`).
- *New:* "Log in as" ignores the `error` from `my_workspaces` (`impersonation.tsx:107-120`). On failure it opens `/dashboard` with no workspace, which the code's own comment says can fall back to the owner's workspace while the banner says you are acting as the user. Unverified in practice.
- *New:* the System card always shows a green "N سليمة" badge, even at 0 healthy, and never shows the "not monitored" count (`AdminSystemPage.tsx:43-50`).
- *New:* bulk collect shows a green success note when 0 were queued and everything was skipped (`AdminChannelsPage.tsx:536,588`).
- *New:* the morning summary gives no warning when the latest snapshot is more than about 26 h old. "Collected" then covers an unknown number of days (`dailyDigest.ts:54-55`).

**11. LOW: audit reads have no matching index.** `audit_events` has only `(workspace_id, created_at desc)` (`current.sql:446`). The audit page, Home activity (`:6127`) and account history (`:6800-6803`, which also filters by `actor_id`/`target_id` with an OR) each scan and sort the whole table. Fine today, since only owner actions write rows.
- **Fix:** indexes on `(created_at desc)`, `(actor_id, created_at desc)`, `(target_type, target_id)`.

**12. LOW (depends on tenant credentials existing): the worker tile can stay green while the main worker is down.** It reads `max(last_seen_at)` over all workspaces (`current.sql:6098`), so any tenant worker keeps it "fresh".

**13. LOW: the comparison misses some changes until the nightly sweep.** It is not marked when comments are added or deleted, when reviews are deleted, or when a channel's active analysis or workspace topic changes. Those wait for the 02:47 sweep, which is broken too (finding 1).

**14. LOW: times are UTC throughout.** Labelled "UTC" and consistent with the dashboard. No mismatch, but the owner reads Doha time.

The other pages are fine at production size: the Comparison read itself (a few hundred cell rows per channel), the overview, the channel states, accounts, the services read and the palette all use indexed lookups or small tables.

## Proposed comparison refresh design (short spec)

**Goal:** progress is saved per unit, a slow unit can't block others, the time limit is real, and failures are visible. The recommended version (B) needs no `COMMIT` in any migration.

**Tables (new, created empty, no `CONCURRENTLY` needed):**
- `channel_compare_marks(workspace_id, video_id, marked_at)`: append-only, no unique key, so writers never wait. Statement-level triggers on prediction and review inserts/updates and on comment inserts/deletes write `select distinct workspace_id, video_id`, joining comments on the existing unique `(workspace_id, id)` index. Triggers on a change of the active analysis or topic mark all of that channel's or workspace's videos.
- `channel_compare_video_dirty(workspace_id, video_id) pk, channel_id, marked_at`: written only by the job.
- `channel_compare_video_cells(workspace_id, channel_id, video_id, day, topic_key, counts…)`.
- The existing `channel_compare_cells` stays as the per-channel rollup, so the page's read is unchanged.
- `channel_compare_units(workspace_id, channel_id) pk`: `dirty_since, refreshed_at, attempts, next_attempt_at, last_error, last_error_at`.

**`private.channel_compare_step()`: one bounded unit per transaction.**
1. Move pending marks into `video_dirty` and lower `units.dirty_since` where needed.
2. If this job's previous run in `cron.job_run_details` failed, take the unit that would be picked first now. It is the one that died, because the rollback restored the queue. Record the failure on it (`attempts+1`, `last_error = return_message`), back it off (10 min × 2^attempts, at most 24 h), and return.
3. Pick the unit not in back-off, ordered by `attempts, dirty_since`. A slow unit is parked, so it can't block the rest.
4. Take its dirty videos up to about 25k comments in total (sized from `video_comment_stats.total`; at least one video). Recount just those videos:
   - read the channel's analysis key into a variable first, so the planner uses the unique prediction index;
   - read comments through the `comments_topic_scan` index, which covers every column needed.
5. Clear the dirty rows that were marked before the recount, rebuild that channel's rollup, and set `attempts=0`. Set `refreshed_at` once no dirty videos remain.
6. Catch ordinary errors in an inner exception block, store them on the unit with back-off, and return normally so the record is saved.

**Schedule:** `cron.schedule('channel-compare-step', '30 seconds', 'select private.channel_compare_step()')`. The 30-second form needs pg_cron 1.5 or later; otherwise run every minute. A killed run loses only one unit, and the next run records the failure.

**Making a time limit actually apply:** settings on the function itself never apply under cron, and PostgREST's handling of them doesn't apply either. The bounded unit keeps each run far below 2 minutes. To set an explicit limit, put it in the job command: `set statement_timeout='100s'; select private.channel_compare_step()`. On Postgres 13 and later each statement in a multi-statement string gets its own timer, armed from the current setting.
- **Unverified:** that this holds in pg_cron's background-worker mode. Probe with a `pg_sleep` job, and check `show cron.use_background_workers` and the `rolconfig` of the cron role to see where the 2-minute limit comes from.

**Showing failures to the owner:**
- Add fields to each row of `admin_channels_compare`: `dirty_since, last_error, last_error_at, attempts, next_attempt_at`. Update the zod contract.
- Add a new `admin_background_jobs()` that reads `cron.job` plus the latest `cron.job_run_details` (it needs its own `statement_timeout` set on the public function).
- On the page, show each row's state and the oldest count time, and drop the "within minutes" promise whenever the job's last run failed.

**Alternative A, a procedure that commits between units (not recommended):** `call private.drain_p()` with `COMMIT` between units and a 90 s budget. Obstacles:
- `validateMigrationSql` uses `/(?:^|[;\r\n])\s*commit\s*;/i` (`scripts/apply-migrations-remote.mjs:39`), which rejects `commit;` even inside a function body. It would need a reviewed runner change that skips dollar-quoted bodies, not wording that slips past the check.
- Postgres forbids transaction control in a `SECURITY DEFINER` procedure or one with a `SET` clause. That conflicts with the repo's `security definer` / `search_path=''` convention.
- The timeout keeps running across the procedure's internal commits, because one `CALL` is one statement. The budget must still stay under 2 minutes.
- Whether pg_cron runs a `CALL` that commits: I believe it works in its default connection mode, where a top-level `CALL` may commit. **I am not certain** about background-worker mode; a probe job would settle it.

**Stopgap until then (unverified):** reschedule as `set statement_timeout='9min'; select private.drain_channel_compare(1)` with smallest-workspace-first ordering. That limits each run to one workspace, so one finished workspace commits per run.