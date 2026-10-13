# Owner console review (2026-10-13)

The owner asked (2026-10-13) for a root review of the platform-owner console: all six sections
(الرئيسية، مساحات العمل، الحسابات، القنوات، المقارنة، النظام), covering design, user experience, operations,
and the code on both sides. This report ranks what was found. Each finding cites its evidence. The
appendices hold the full working notes:

- [`map.md`](2026-10-13-owner-console/map.md): every page, the RPC it reads or writes, the
  migration that last defines it, its checks, background jobs and tests.
- [`security.md`](2026-10-13-owner-console/security.md): permissions, data exposure,
  impersonation, the `admin-users` Edge Function, audit coverage.
- [`correctness.md`](2026-10-13-owner-console/correctness.md): how each number is defined,
  behaviour at production size, background jobs, error paths, and the comparison-refresh design.
- [`ux.md`](2026-10-13-owner-console/ux.md): walkthrough of the 12 pages at 1440 px and 390 px.

## Method

- **Code:** read against `supabase/schema/current.sql` (latest definitions) and the migrations.
  Security and correctness ran as two independent reviews; the most severe claims were re-checked
  by hand (marked ✔ below).
- **Production evidence:** the owner's read-only SQL editor queries (`cron.job`,
  `cron.job_run_details`, the compare tables, `pg_stat_statements`, `pg_stat_activity`,
  `explain (analyze, buffers)`).
- **Local Postgres 16.13:** every migration applied, a workspace sized like the largest production
  channel (4,583 videos, 155,822 comments with predictions) and 12 smaller synthetic workspaces in
  varied states.
- **UX:** the real web app run against a mocked Supabase whose answers came from the real admin
  functions on that local database, screenshotted at desktop and phone width. This is a
  professional heuristic review, not a test with users.
- **No production data was read.** Production numbers above are the owner's own query results.

## Findings, most severe first

| # | Severity | Area | Finding | Evidence | Fix (batch) |
|---|---|---|---|---|---|
| 1 | Critical | Comparison | ✔ The recount has never completed, so every row is "pending". `channel-compare-drain` is cancelled at exactly 2:00 on every run; 0 workspaces counted, 115 waiting. The function's own `statement_timeout = '300s'` cannot extend the caller's 2-minute limit (proven locally). A cancel rolls back the whole run, and the oldest-first queue puts the same workspace first again. | `cron.job_run_details` (owner); `20261021000000:157-186` | Bounded per-unit recount with back-off; timeout set in the job command (A) |
| 2 | High | Comparison, Home | Uncounted and stale rows look like real data: 0 analysed with "small sample", a freshness line that shows only the newest row, a "this week" that drains to zero, and digest movers that say "no change". No page shows background-job failures. | `AdminComparePage.tsx:97-101,217-225`; `20261022000000:39-58` | Per-row state; oldest freshness; `admin_background_jobs()` on System (A) |
| 3 | High (unverified) | Home, Channels counts | The nightly `reconcile_all_video_comment_stats()` loops every workspace in one statement under the same 2-minute cron limit; likely failing the same way. | `20261004010000:162`; `current.sql:3771-3807` | Check `cron.job_run_details`; same per-unit pattern (A) |
| 4 | High (unverified) | Worker | `touch_worker_seen` upserts a `worker_seen` row per workspace inside commit and heartbeat transactions; two workers with one credential can wait on each other (the class fixed for `worker_credentials` in #128). | `current.sql:4889-4905,5029,5353` | Touch at most once a minute with `skip locked` (B) |
| 5 | Medium | Accounts / `admin-users` | ✔ An admin can create a sign-in link for, or change the email of, **another admin**; only suspension is guarded. The link is returned to the caller. | `_shared/admin-users.ts:138-155` | Refuse `recovery_link`, `change_email`, `confirm_email` on another admin (C) |
| 6 | Medium | Workspaces | Deleting a workspace deletes its audit rows, including impersonation and plan changes made by the owner. | `current.sql:7068` | Null the workspace on those rows instead of deleting (C) |
| 7 | Medium | Plans | ✔ The public-channels toggle reports success when the save fails, and flips the toggle anyway; the limits dialog shows the raw `live_unavailable`. | `AdminPlansPage.tsx:72-76`; `EditPlanLimitsDialog.tsx:117-119` | Show the real error; tests (D) |
| 8 | Medium | Plans, audit | Plan-wide changes write no audit row: `set_plan_public_channels`, `update_plan_limits`, `promote_platform_reader`. | `current.sql:7615-7634, 8016-8138, 7385-7405` | Audit with `target_type 'plan'` (C) |
| 9 | Medium | Definitions | "Analysed comments" means three things: Home and Channels count the channel's own comments and any analysis version; Comparison and the customer dashboard do not. "Failed" is counted four ways. | `current.sql:4019-4031` vs `3933-3971`; correctness §5, §9 | One definition per label, or distinct labels (E) |
| 10 | Medium | Workspaces | Deleting the largest workspace likely fails: `admin_workspace_footprint` and `delete_workspace` run under the 8 s limit and recount stats per video; the dialog shows a raw `57014`. | `current.sql:6849-6866, 7010+` | Capped footprint, function timeouts, batched delete (E) |
| 11 | Medium | Ops | `admin_ops` has no timeout and counts a week of collected comments by `first_seen_at`; after an import that read passes 8 s. The label suggests comments posted this week. | `current.sql:6242-6257` | Timeout, maintained daily count, relabel (E) |
| 12 | Medium | Workspaces (UX) | Every row carries the full edit form and a red "permanent delete" button: 27 workspaces make a 7,471 px page. No search, no owner column; many rows share the name "مساحة العمل الشخصية". | `ux.md`; screenshot `desktop-02` | List + detail panel like Accounts; search; delete inside the detail only (F) |
| 13 | Medium | Channels (UX) | On a phone only the channel name shows; state, counts and last success are cut off. | `ux.md`; screenshot `phone-05` | Stacked card layout under 640 px (F) |
| 14 | Medium | Shell (UX) | Inside the console the side rail is the customer rail ("مساحة العمل الشخصية", "لا خطة مفعّلة", the tour). | `ux.md` | Console rail, or hide the workspace block on `/admin` (F) |
| 15 | Low | Demo mode | `?demo` reaches live admin reads and writes on Plans, Channels, Compare, Audit, Ops and System; Plans shows no demo label. The database still refuses non-admins. | `AdminPlansPage.tsx:41`; `AdminShell.tsx:39-46` | Fixtures only in demo (D) |
| 16 | Low | Exports | CSV formula guard misses leading tab or carriage return, and corrupts negative numbers (`-12` becomes `'-12`). | `channelsConsole.ts:159` | Strings only, `[=+\-@\t\r]` (D) |
| 17 | Low | Copy | Raw codes on screen: plan keys (`t`, `pro`), status `active`, five untranslated audit actions; a free plan ends "2126-10-13"; untitled channels show the raw id; the System badge is green at 0 healthy; bulk collect is green when 0 were queued. | `ux.md`; correctness §10; map "problems found" | Labels and states (D) |
| 18 | Low | Grants, limits | `promote_platform_reader` is executable by PUBLIC (internally refused); `admin_audit(null)` skips the 1–500 limit; `grant_pack` can audit a grant that did not happen (cross-workspace note collision). | security §4, §5, §9 | Revoke; null check; scope the key (C) |
| 19 | Low | Notes | Admin notes on a plan or pack are readable by the workspace's own members. | security §10 | Keep notes private or label them (C) |
| 20 | Low | Indexes | `audit_events` has no index for the console's reads (by time, by actor, by target). Fine at today's volume. | correctness §11 | Three indexes (E) |
| 21 | Low | Import (UX) | 23 px of horizontal overflow on a phone. | harness | (F) |

Not a defect, kept for the record: times are UTC throughout and labelled so. The owner reads
Doha time; a later choice.

## What was checked and found sound

- Every public admin RPC is `SECURITY DEFINER` with `search_path = ''`, checks
  `is_platform_admin()` before any read or write, and is executable only by `authenticated`; no
  admin RPC returns tokens, credential hashes or OAuth grants.
- `admin-users` checks the caller's own token before any service-role call; origins are
  allow-listed; nothing sensitive is logged.
- Every other console write leaves an audit row; the append-only guard on `audit_events` exists.
- All 462 admin string keys exist in both `ar.ts` and `en.ts`.
- The read paths for Comparison (once counted), the overview, channel states, accounts, services
  and the palette are indexed lookups or small tables at production size.

## Still to confirm in production (read-only, owner)

1. Comparison: the size of the workspace at the head of the queue and the production plan for its
   recount (two queries sent on 2026-10-13). Locally the same recount takes 0.47 s.
2. Finding 3: `select status, return_message, start_time from cron.job_run_details where command
   like '%reconcile_all%' order by start_time desc limit 5;`
3. Finding 4: whether worker requests wait on `worker_seen` (`pg_stat_activity` with
   `wait_event_type = 'Lock'` while both workers run).

## Proposed fix batches (one PR each, owner decides the order)

- **A. Background jobs that finish and say so** (1, 2, 3): per-unit recount with back-off and
  a timeout set in the job command; per-row states on Comparison; an `admin_background_jobs()` card
  on System. First, because the page is empty in production.
- **B. Worker heartbeat lock** (4), if production confirms it.
- **C. Permissions and audit** (5, 6, 8, 18, 19).
- **D. Honest errors and labels** (7, 15, 16, 17).
- **E. Definitions and scale** (9, 10, 11, 20).
- **F. Layout** (12, 13, 14, 21): Workspaces as list + detail, phone layouts, the console rail.

Each batch carries its tests, a mutation check and a `docs/verification.md` entry, as usual.
