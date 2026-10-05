# WO-4c (Gemini): honest KPIs, full export, syncHealth, admin services, small UI bugs

Mirror of GitHub issue #46. **The issue is the source of truth**; this copy exists for agents
whose token can't read issues. If they differ, ask.

> **Scope change (owner decision, 2026-10-04):** tasks **1 (KPIs)** and **2 (export)** moved to
> Codex as **WO-14 (#76)**. Gemini keeps tasks **3, 4 and 5**.
> - Drop from your branch the migration `20261003080000_honest_dashboard_aggregates.sql`, its
>   test, the `buildExport` changes, the KPI mapping in `Dashboard.tsx` and the aggregates schema
>   change in `fixture.ts`.
> - After WO-14 merges, merge `origin/main` into your branch (no rebase, no force-push).
> - Open the PR as `WO-4c: syncHealth truth, admin services, small UI bugs` (`Closes #46`).
>   Details: the comment on #46 dated 2026-10-04.
>
> **Second scope change (owner decision, 2026-10-05):** Claude takes over tasks **3, 4 and 5**
> and implements them directly; Gemini has no open task in this work order. The draft branch
> `gemini/wo-4c-honest-numbers` (`99ee202`) is superseded and is not merged.

- **Branch:** `gemini/wo-4c-honest-numbers`, created from the **latest** `origin/main`
  (`a807eab` or newer, not `0423b62`).
- **PR title:** `WO-4c: honest numbers, full export, status truth` (body starts `Closes #46`
  and fills the PR template: evidence, mutation proof, scope)
- **Migration timestamp range:** `20261003000000`–`20261003115959`. WO-9 (#60) holds the
  afternoon half of the same day.
- **No deploy, no remote migration, never push to `main`.**

## Read this first
- The line numbers below come from the audit of `main` @ `f47fe97`. Since then WO-4b (#53),
  WO-7, WO-8, #57 and #58 have merged. **Re-locate every line on current `main`** before you
  change it. If an item is already fixed there, say so in the PR with the evidence, and
  don't redo it.
- Product rule: **unknown is `null`/"—", never 0, never a capped count.**
- Agent conduct (`AGENTS.md`): don't read credentials or keychains (`git credential fill`,
  `security …`), and don't read other agents' or tools' session histories. If you lack
  something (for example issue access), stop and ask the owner.

## Tasks
1. **KPIs.**
   - `dashboard/Dashboard.tsx` hard-codes `replies: 0, unknown_dates: 0` and derives
     `unique_authors` from `agg.people`. The SQL `people_agg` has `LIMIT 10`.
   - Add `replies`, `unknown_dates` and `unique_authors` (`count(distinct …)`, no LIMIT) to
     `dashboard_aggregates_impl` in **one new migration** in the range above. Keep
     `search_path=''`, fully qualified names and the existing grants. Add a DB test.
   - Until the values are present, the client renders "—". They are rendered in
     `Summary.tsx` and `Hero.tsx`.
2. **Export.**
   - Live CSV export goes through `dashboard_snapshot` (`LIMIT 1500`) via `readLive` in
     `data.ts`.
   - Rebuild it to page through `dashboard_comments` using the screen's filters
     (`filtersToRpc`), with a sensible upper bound. If the bound is hit, **both the UI and the
     CSV** say so.
   - The exported row count equals the on-screen filtered total. Test this with a live-path
     fixture of more than 1,500 comments.
3. **syncHealth.**
   - A quota block turns `healthy` after UTC midnight with no new run, and skips staleness.
     The date comparison also fails across month and year boundaries.
   - Required behavior: stay `quota_paused` until a **later** run succeeds. Past the reset
     time with no run, show `stale`/`queued`. Staleness always applies.
   - Replace the test that asserts the old behavior with "blocked 10 days ago, no run since →
     not healthy". Add a Dec 31 → Jan 1 case.
4. **Admin services.**
   - `admin/adminRead.ts` returns demo data on RPC error, and builds the live report on top of
     the demo one, so unreported services read "healthy".
   - In live mode, show an error state instead. Add `not_monitored` to
     `packages/contracts/src/servicesHealth.ts` and use it for unreported services.
   - `planCatalogue.ts`: no fixture fallback for admins in live mode.
   - `EditPlanLimitsDialog.tsx`: `parseInt(...) || 0` in seven places. A blank field means no
     change or a validation error, never 0.
5. **Small UI bugs.**
   - (a) Net sentiment shows "0٪" when nothing is analysed (`Summary.tsx`, `Voice.tsx`). Show
     "—", and use the server's `kpis.net_sentiment`.
   - (b) `Videos.tsx` uses `like_count ?? 0`. Null means unknown.
   - (c) `CommentsTable.tsx` renders "(5 5 replies)".
   - (d) `AdminServicesPage.tsx` reads `localStorage` without a try/catch.
   - (e) Add a locale-aware percent formatter and use it in Summary, Voice, Videos, Comments
     and CommentsTable. Update `Summary.test.tsx` accordingly.

## Owned paths
- `apps/web/src/dashboard/**`
- `apps/web/src/admin/**`
- `apps/web/src/syncHealth.ts` and its test
- `apps/web/src/planCatalogue.ts`
- `apps/web/src/data.ts` (export path only)
- `packages/contracts/src/servicesHealth.ts`
- one new migration in the range above, plus a new `supabase/tests/*` file
- new string keys, **append only**

**Do not touch:** `connect.ts`, `connectResult.ts`, `Connected.tsx`, `apps/web/src/ops/**`,
`apps/web/src/failure.ts` (WO-9), `queryRetry.ts`, or `supabase/functions/**`.

## Acceptance criteria
- [ ] No live path renders `replies`/`unknown_dates`/`unique_authors` as a hard-coded 0 or a
  capped count.
- [ ] Export row count equals the on-screen count with a fixture of more than 1,500 rows. A hit
  bound is stated in the UI and the file.
- [ ] syncHealth is not healthy for "quota block 10 days ago, no run since", and month and year
  boundaries are correct.
- [ ] Admin services with a failing RPC render an error, not demo data. Unreported services
  render `not_monitored`.
- [ ] Every new test fails on the old code. Say how you proved it.
- [ ] `npm run check` and `npm run test:e2e` pass. Paste the summary lines.
