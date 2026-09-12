# Arabic Audience Sentiment — development workspace

Arabic-first, multi-tenant YouTube sentiment MVP. Read [AGENTS.md](AGENTS.md) and
[docs/Codex-Build-Handoff.md](docs/Codex-Build-Handoff.md) before changing anything.

**Status: M0 complete; the unblocked parts of M1 and M2 are implemented and fixture-tested.**
Nothing here has been validated against live YouTube, Google OAuth, a deployed Supabase
project, a real sentiment model, or any deployment. See
[docs/progress.md](docs/progress.md) for what is blocked and why, and
[docs/verification.md](docs/verification.md) for the commands actually run and their results.

## Requirements

| Tool | Pinned version | Source of the pin |
| --- | --- | --- |
| Node | 22.14.0 | [.nvmrc](.nvmrc), `engines` in [package.json](package.json) |
| npm | 10.x | `engines` in package.json; `engine-strict=true` in [.npmrc](.npmrc) |
| Python | 3.12.x | [workers/python/.python-version](workers/python/.python-version) |
| uv | 0.11.x | CI pin in [.github/workflows/ci.yml](.github/workflows/ci.yml) |

`engine-strict=true` means a newer Node or npm on `PATH` will refuse to install. Use
`nvm use` (or an equivalent) first. Docker is **not** required: database tests run against
embedded PostgreSQL.

## Setup

```bash
npm run setup
```

Installs Node dependencies from `package-lock.json`, Python dependencies from
`workers/python/uv.lock`, and the Chromium build used by browser tests. Setup performs no
collection, applies no migration, deploys nothing, and creates no paid resource.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `127.0.0.1:5173` |
| `npm run build` | Production build of `apps/web` |
| `npm run lint` | ESLint over the workspace, then Ruff over the worker |
| `npm run typecheck` | `tsc --noEmit` across app, contracts, functions and tests |
| `npm test` | Vitest unit tests (contracts, snapshot, authorization) |
| `npm run test:db` | Migration + RLS tests in embedded PostgreSQL (PGlite) |
| `npm run test:e2e` | Playwright browser tests against the fixture shell |
| `npm run worker:test` | pytest for the Python worker |
| `npm run worker:lint` | Ruff for the Python worker |
| `npm run check:secrets` | Secret-pattern and frontend-boundary scan, including built assets |
| `npm run check` | Everything above except `test:e2e` |

Collection smoke test, against sanitized fixtures only:

```bash
npm run worker:collect -- --source fixture --workspace demo --video abcdefghijk --output .cache/spool
```

`--source youtube-api` reads `YOUTUBE_API_KEY` from the environment and performs real network
calls. It has never been run against live YouTube in this workspace.

## Layout

| Path | Contents |
| --- | --- |
| `apps/web` | React + Vite Arabic RTL shell |
| `packages/contracts` | Shared Zod schemas and the reference snapshot function |
| `supabase/migrations` | SQL schema, RLS policies, role-checked RPCs |
| `supabase/functions` | Server-side authorization helper (not a deployed Edge Function) |
| `supabase/tests` | Direct-SQL tenant-isolation tests |
| `workers/python` | Collector adapters, durable spool, sentiment interfaces |
| `docs` | Specification, decisions, progress, verification, input inventory |

## Rules that outrank convenience

- Never put a service-role key, OAuth token, or encryption key in a `VITE_*` variable.
- Keep real datasets out of Git. Only clearly sanitized fixtures are committed.
- A collection failure is `partial`, `failed`, or `blocked` — never a successful empty result.
- Mixed is a first-class label. Skipped, failed, and stale predictions never become Neutral
  and never enter the sentiment denominator.
