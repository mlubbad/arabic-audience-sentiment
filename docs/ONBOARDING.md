# Onboarding

For whoever picks this up next — a new agent lane, a new contributor, or the same
people after a long gap. It is an entry point, not a summary: everything here is
either a pointer, a trap that has already cost someone time, or a rule you cannot
infer by reading the code.

The counts below are from the latest full run; `docs/verification.md` is the
authoritative record of what was run when.

Read `AGENTS.md` first. It is short and it is binding.

---

## 1. What this is

An Arabic-first, multi-tenant YouTube audience-sentiment SaaS. One channel owner
connects their channel, comments are collected and classified, and a dashboard
shows sentiment with filters, corrections and export. The specification is
`docs/SpecTech-YouTube-Sentiment-MVP.md`; `docs/Codex-Build-Handoff.md` carries it
plus the build context.

The path a comment takes, and the only one that matters:

```
Python collector          workers/python/src/collectors/
   emits RawComment, an outcome, and a checkpoint
        |
Python control client     workers/python/src/server/{gateway,runner}.py
   claim -> heartbeat -> commit_batch -> finish
        |
Edge handler              supabase/functions/_shared/worker-gateway.ts
   hashes the bearer, routes, calls worker_* RPCs
        |
Database                  supabase/migrations/
   private.commit_batch writes comments + predictions in one transaction
        |
Shared contract           packages/contracts/src/snapshot.ts
   snapshot() and exportRows() share one filteredRows
        |
Dashboard                 apps/web/src/
```

The dashboard is **fixture-backed today**. `apps/web/src/data.ts` decides the mode
in one place and there is no live comment read path; configuring Supabase enables
Auth and workspace management, it does not turn fixture rows into live data. That
is deliberate — read the comment at the top of `data.ts` before changing it.

---

## 2. Get it running

**The one thing that will stop you.** Node is pinned to 22.14.0 and `.npmrc` sets
`engine-strict=true`. This machine's default Node is newer, so every npm command
fails until the pinned toolchain is on `PATH`. It is not broken; it is the guard
working.

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
```

Put that in every shell you open for this repo. `nvm use` works too if your shell
loads nvm.

Then:

```bash
npm run setup
```

That runs `npm ci`, `uv sync` for the Python worker, and installs Playwright's
Chromium. `uv` must be installed separately.

### The command set

| Command | Covers | Latest run |
| --- | --- | --- |
| `npm run check` | lint, format, typecheck, unit, SQL, worker, build, secret scan | green |
| `npm test` | contracts + web unit (10 files) | 83 passed |
| `npm run test:db` | real SQL + real RLS in PGlite | 73 passed |
| `npm run worker:test` | Python worker via uv/pytest | 74 passed |
| `npm run test:e2e` | Playwright against a dev server it starts itself | 45 passed |

`npm run check` does **not** include `test:e2e`. Run that separately; it starts its own dev
server and refuses to adopt one that is already listening — see the port trap below.

`npm run test:db` needs no Docker. It runs the real migrations and the real RLS
policies inside PGlite, an embedded Postgres. What that buys and what it does not
is in `docs/verification.md`; the short version is that it is real SQL and real
RLS but it is not GoTrue, PostgREST, Storage HTTP, or a deployed project.

---

## 3. Traps that have already cost time

Every row here is something that actually happened in this repo, not a
hypothetical.

| Trap | What you see | What is true |
| --- | --- | --- |
| `npm run dev -- --port X` | The flag is silently ignored and Vite serves 5173 | The root `dev` script is itself an `npm run`, so npm eats the flag. `playwright.config.ts` goes one layer down on purpose: `npm run dev -w @sentiment/web -- --port X --strictPort` |
| A dev server already listening on the port | The suite passes, or fails, against the wrong build | `reuseExistingServer: false` and `--strictPort` exist for this. Stop your own stray `vite`, or set `E2E_PORT` to a free port |
| `getByLabel("...")` in a test | Matches more elements than you expect | It is a substring match. A `<label>` wrapping a `<select>` also takes its accessible name from **all option text**, so `{ exact: true }` can match nothing. Every select carries an explicit `aria-label` for this reason — that was a real a11y defect, not a test workaround |
| e2e failing differently on each run | Looks like a flaky regression | Check the host load average. At 17.25 this suite took 12m27s for 32s of work and failed a different test each run. Diagnose contention before diagnosing code |
| `git checkout -- <file>` to undo an experiment | Reports a pathspec error and does nothing | It fails on an **untracked** file. A deliberately introduced mutation nearly shipped this way. Re-read the file after restoring it; do not trust the restore |
| Writing a BOM or a newline into source via a heredoc | ESLint catches a literal `U+FEFF`, or `\n` renders as text on the page | Use `﻿` and real newlines. One escaped-newline bug reached the screen because the test only asserted the wrapping `<span>` — assert the sentence |
| Expecting PGlite to prove concurrency | A passing test that cannot fail | PGlite is single-connection. Two simultaneous transactions cannot be staged. The row lock is the mechanism; the tests prove no *sequence* exceeds an allowance |

---

## 4. Rules you cannot infer from the code

These are invariants. Breaking one is a defect even if every test still passes.

**Nothing crossing a trust boundary accepts a workspace.** The tenant is derived
from stored state or from a credential — `oauth_consume_state` returns the
binding and takes no workspace; the worker gateway derives the workspace from the
hashed bearer. There is no field to forge. This has been applied four times and
must be applied a fifth time the same way.

**Unknown is never zero.** A missing like count is `null`, not `0`. Negative
comments split into `negative_ranked` and `negative_unranked` precisely so an
unknown engagement figure never silently sorts as the least engaged.

**Failure never becomes success.** A collection that fails is `partial` or
`failed`. An empty result is not a successful empty dataset. A generator that
ends without exhausting the source finishes `partial`.

**A malformed batch is refused whole, never filtered.** Quietly dropping the rows
that do not fit is how a worker defect became a customer charge: predictions for
comments absent from the batch were metered, then discarded by the join. If the
sender built it wrong, tell the sender.

**A rule that meters must be enforced where the metering happens.** Validation
can live in as many layers as are useful, but the layer that spends the
customer's allowance has to be one of them.

**Commit is progress, not completion.** `commit_batch` records a checkpoint; it
does not set a terminal status. `worker_finish` does. Migration
`20260913180000` exists because they once disagreed.

**Migrations are immutable once applied.** Add a new timestamped file. Do not
extend the baseline — several branches depend on it.

**A test that cannot fail is not coverage.** The standard of proof here is
mutation: break the implementation deliberately and confirm the test goes red.
`docs/verification.md` carries a 14-row mutation table. Follow it for new work.

**Distinguish mocked, fixture-tested and live-tested.** Never write that
something works live. Nothing in this repo has been validated live —
`docs/verification.md` §"Not verified" is the authoritative list and it must stay
accurate.

**Boundaries are where the defects are.** The three defects the cross-language
seam test found all had passing unit tests on both sides: Python's `1.0` against
JS's `1`, the handler matching `error.code` where Postgres puts a SQLSTATE, and
the commit/finish status disagreement. Three more came out of an audit. Test the
seam, not the stand-in.

---

## 5. Where things live

```
packages/contracts/src/    Zod schemas + the shared snapshot. The barrel
                           (index.ts) and jobs.ts are coordinated — see §7
  snapshot.ts              filteredRows, used by both snapshot() and exportRows()
  jobs.ts                  CommitBatchSchema, usageEventKey — the worker contract
apps/web/src/              React 19 + Vite + Chart.js dashboard (Arabic, RTL)
  data.ts                  the single place that decides fixture vs live; live
                           needs a configured project AND VITE_DASHBOARD_SOURCE=live
supabase/migrations/       13 files, applied in filename order, never edited
supabase/functions/        _shared/worker-gateway.ts and oauth-start.ts — pure
                           handlers with injected dependencies, testable with no
                           deployed project
supabase/tests/            6 PGlite suites; end_to_end.test.ts is the seam test
workers/python/src/        collectors/ (sources), sentiment/ (adapters, no model),
                           server/ (control plane, analysis wiring),
                           labelling/ (evaluation-set sampler and sheets)
workers/python/tests/fixtures/golden_batch.json
                           produced by the real Python client, consumed by the TS
                           seam test. Regenerate it, do not hand-edit it
scripts/                   check-secrets.mjs, and the Playwright isolation test
```

---

## 6. What to read, in order

1. `AGENTS.md` — the binding constraints. Short.
2. `docs/coordination/README.md` — the lane protocol, ownership table, handoff.
3. `docs/progress.md` — milestone state M0–M6, and §"Exact missing input per
   blocked task", which names the specific artifact each blocked item needs.
4. `docs/verification.md` — what is proven, how, and what is explicitly not.
   Read §"Not verified" before you describe this system to anyone.
5. `docs/decisions.md` — why things are the way they are. Add to it before you
   add infrastructure.
6. `docs/agent-reports/<lane>.md` — per-lane state. Yours is the one you write.

---

## 7. Before you commit

One writer, one branch: `main`, in this checkout. There are no worktrees and no ownership
guard; both belonged to a multi-agent protocol that closed on 2026-09-13, recorded in
`docs/coordination/README.md`.

What still holds, and is not enforced by anything:

- **Migrations are immutable once applied.** Add a new timestamped file. Never edit one
  that has shipped — the test suite replays all of them in filename order.
- **`packages/contracts/src/jobs.ts` is the worker-facing surface.** A change there is a
  change to what the Python client and the database both agree a batch is, so it travels
  with its fixture and its SQL. `sync.ts` next to it is application schema and is free to
  change; the split is deliberate.
- **Run `npm run check` before committing**, and `npm run test:e2e` when you touched the
  dashboard. Nothing runs them for you.
- **Say what you actually ran.** `docs/verification.md` is the record, and its value is
  entirely in it being true.

## 8. What is not real

No model has been downloaded and no accuracy figure is claimed anywhere — do not
produce one. No YouTube or Google credential is configured for collection.

What *is* real, as of 2026-09-13: a Supabase development project holds the schema;
the built front end is deployed at `app.sky-develop.net` behind a password, serving
fixtures; and Auth works, verified by a real signup. What is still not real: any
live comment data, any deployed worker or Edge Function, and the whole YouTube path.
`docs/verification.md` is the authoritative split — read it before describing this
system to anyone.

Blocked items are blocked by a **named operation and a named missing input**, not
by a whole milestone: `channels.list(mine=true)` plus the OAuth code exchange
needs Google client credentials and a registered redirect URI; an HTTP round trip
to a deployed Edge Function needs a Supabase project; the legacy import needs the
original CSV and the amendment file; any accuracy figure needs the notebooks and
the ~600 human-labelled comments. The full table is in `docs/progress.md`.

When you hit one, say which operation and which input. Do not mark a milestone
blocked because part of it is.

Standing constraints, from the user and from `AGENTS.md`: keep publication
private; do not enable paid services or real billing without explicit approval;
never put tokens or server keys in `VITE_*`; keep real raw datasets out of
tracked source.
