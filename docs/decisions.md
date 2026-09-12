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

