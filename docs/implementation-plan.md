# M0–M2 foundation implementation plan

Goal: a reproducible monorepo with a tested fixture dashboard, durable worker primitives, and tenant-isolated database foundation.
Spec: AGENTS.md and docs/Codex-Build-Handoff.md; latest user request limits this increment to M0 and unblocked M1/M2.

- [x] Scaffold manifests, environment contract, scripts, CI and documentation; install exact dependencies and generate both lockfiles.
- [x] Write failing schema/snapshot tests covering scope, filters, Mixed, stale labels, missing dates and pagination; implement shared Zod contracts and one snapshot function.
- [x] Write failing durability tests; implement collector/sentiment protocols, API pagination adapter and transactional local spool with lease fencing and bounded retries.
- [x] Write failing direct SQL authorization tests; generate initial migration with Supabase CLI and implement membership/ownership, composite foreign keys, private storage and controlled job RPCs.
- [x] Build the Arabic RTL shell with fixture loading/retry/empty states and configurable Auth. Test requests, filtering and responsive browser behavior.
- [x] Run clean Node/Python installations, lint, typecheck, unit, worker, SQL, browser and build checks; inspect outputs and update actual evidence and per-task blockers.

All six steps are complete for this increment; see docs/progress.md for per-task status and
docs/verification.md for the commands actually run. Remaining M1/M2 work is blocked on named
missing inputs, listed at the end of docs/progress.md.
