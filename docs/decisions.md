# Implementation decisions

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
