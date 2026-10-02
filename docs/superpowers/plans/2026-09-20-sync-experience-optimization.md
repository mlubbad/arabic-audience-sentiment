# Sync Experience Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the sync and operations experience from a static, contradictory, and opaque state into a responsive, accurate, and self-updating feedback loop that eliminates user confusion and avoids background task starvation.

**Architecture:** 
1. Frontend adaptive polling in `Sync.tsx` that automatically re-queries while jobs are queued or running, stopping when idle.
2. Distinct UI status representation for `discover` vs `collect` in `jobFeed.ts` and contextual queued awareness in `syncHealth.ts`.
3. Fair multi-tenant job scheduling in Postgres `claim_job` migration to prevent a large channel from starving other workspaces.

**Tech Stack:** React 19, TypeScript, Vitest, Supabase Postgres RPC migrations.

**Spec:** Derived from user critique and pre-mortem analysis on 2026-09-20.

## Global Constraints
- Preserve tenant isolation and RLS on all operations.
- Migrations are immutable once applied: add a new timestamped migration.
- All vitest suites and linting must stay green.
- Respect YouTube Data API quota constraints: no multi-worker quota burning.

---

### Task 1: Differentiate Catalogue Discovery in Job Feed & Strings

**Files:**
- Modify: `apps/web/src/strings/ar.ts`
- Modify: `apps/web/src/strings/en.ts`
- Modify: `apps/web/src/jobFeed.ts:156-175`
- Test: `apps/web/src/jobFeed.test.ts`

**Interfaces:**
- Consumes: `JobRow.type === "discover"`
- Produces: `JobEntry` with distinct catalogue headline and tailored detail message.

- [ ] **Step 1: Write the failing test in `apps/web/src/jobFeed.test.ts`**
  Add a test asserting that a `discover` job with status `succeeded` produces headline containing `jobKindCatalogue` and detail containing catalogue-specific confirmation rather than comment-related wording.
- [ ] **Step 2: Run test to confirm failure**
  Run `npm test -- apps/web/src/jobFeed.test.ts`.
- [ ] **Step 3: Update strings in `ar.ts` and `en.ts`**
  Add `jobKindCatalogue` ("فهرسة القناة" / "Catalogue"), `jobCatalogueSucceededDetail` ("تم استكشاف فيديوهات القناة وتحديث القائمة بنجاح." / "Channel videos catalogued and list updated successfully.").
- [ ] **Step 4: Update `jobFeed.ts`**
  Support `job.type === "discover"` so its headline and success detail reflect catalogue discovery.
- [ ] **Step 5: Run tests to confirm passing**
  Run `npm test -- apps/web/src/jobFeed.test.ts`.

---

### Task 2: Contextual Sync Health when Jobs are Queued

**Files:**
- Modify: `apps/web/src/strings/ar.ts`
- Modify: `apps/web/src/strings/en.ts`
- Modify: `apps/web/src/syncHealth.ts:40-70`
- Test: `apps/web/src/syncHealth.test.ts`

**Interfaces:**
- Consumes: `SyncState.queued_jobs > 0`, `SyncState.worker.connected === true`
- Produces: `Health` reflecting that new work is queued/scheduled with a live worker rather than surfacing old blocked errors as a current critical failure.

- [ ] **Step 1: Write failing test in `apps/web/src/syncHealth.test.ts`**
  Assert that when `queued > 0` and `worker.connected === true`, even if the previous run was `blocked`, the state is classified as active waiting/queued (`severity: "warning"`, `key: "queued"`) rather than a fatal blocker with no remedy.
- [ ] **Step 2: Run test to confirm failure**
  Run `npm test -- apps/web/src/syncHealth.test.ts`.
- [ ] **Step 3: Update `HealthKey` and strings**
  Add `queued: "توجد مهام في الانتظار؛ بانتظار دورها في المعالجة"` in `syncMessages`.
- [ ] **Step 4: Update `syncHealth.ts` logic**
  If `queued > 0` and `worker.connected`, return `key: "queued"` with severity `"warning"` and preserve `errorCode` as historical context if present.
- [ ] **Step 5: Run tests to confirm passing**
  Run `npm test -- apps/web/src/syncHealth.test.ts`.

---

### Task 3: Adaptive Live Polling in `Sync.tsx`

**Files:**
- Modify: `apps/web/src/ops/Sync.tsx`

**Interfaces:**
- Consumes: `health.queued > 0` or any job in `jobs` having `status === 'running'` or `status === 'queued'`
- Produces: Automatic tick interval (e.g. 4000ms) that re-fetches snapshot and jobs while active, and cleanly tears down when quiet.

- [ ] **Step 1: Implement adaptive polling effect in `Sync.tsx`**
  Inspect if any job is `queued` or `running` or `health.queued > 0`. If so, start a 4-second interval that increments `tick` and calls `snapshot.refetch()`.
- [ ] **Step 2: Clean up interval on unmount or when all jobs complete**
- [ ] **Step 3: Run full web tests and linter**
  Run `npm test` and `npm run typecheck`.

---

### Task 4: Fair Multi-Tenant Scheduling Migration in Postgres

**Files:**
- Create: `supabase/migrations/20260920120000_fair_multitenant_claim_scheduling.sql`
- Test: `supabase/tests/scoped_claim.test.ts`

**Interfaces:**
- Consumes: `private.claim_job(w, job_types)`
- Produces: Interleaved scheduling across workspaces so that a heavy backfill in one workspace does not starve others.

- [ ] **Step 1: Write the migration**
  Update `claim_job` ordering to prioritize interactive / discover jobs, and interleave workspaces fairly using round-robin / last-claimed timestamps.
- [ ] **Step 2: Run verification against Supabase**
