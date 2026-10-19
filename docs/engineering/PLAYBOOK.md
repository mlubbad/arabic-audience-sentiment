# Engineering playbook

Binding for every agent and contributor. Owned by Claude (architect/QA); changes come through a
PR the owner merges. Where this file and `AGENTS.md` disagree, `AGENTS.md` wins and this file
gets fixed.

## 1. Roles
| Role | Who | Responsible for | Never does |
| --- | --- | --- | --- |
| Owner | Mohammed | Product decisions, money, accounts, merging (which deploys the app, migrations and edge functions, ADR 0004), credential rotation | — |
| PM / architect / QA / DevOps / data lead | Claude | Roadmap; ADRs; work orders; reviews with independent verification; quality gates; CI/CD design; evaluation design; status board (#7); `docs/progress.md`, `docs/verification.md`, `docs/decisions.md` | Merge, touch production, spend money, contact anyone outside the repo |
| Precision engineer | Codex | Small, high-stakes, fully specified work orders (security SQL, CI, auth, tricky fixes) | Broad exploration, large refactors, reading the long docs |
| Volume engineer | Gemini | Refactors, test suites, UI, worker restructuring, investigations written up on the issue | Production credentials, merging |

### Budget-aware sizing
- **Codex (limited tokens)**
  - Work orders arrive pre-digested: exact files and line ranges, target design, test list.
  - At most ~300 changed lines (excluding tests) and ~8 files per PR.
  - Read only what the work order lists, plus `AGENTS.md` and `docs/agents/CONTEXT.md`.
  - Run targeted tests while working, and `npm run check` once before review. CI runs e2e.
- **Gemini**
  - PRs up to ~600 changed lines (excluding tests and generated files). Split bigger work into sequential PRs.
  - "Investigate and report" tasks are answered as a comment on the issue, not as code.

## 2. The work loop
1. **Work order.** Claude opens a GitHub issue from the work-order template (§3) and mirrors it to
   `docs/agents/work-orders/WO-N.md` for agents whose tokens can't read issues.
2. **Workspace.** Each agent works in **its own git worktree**
   (`git worktree add ../aas-<agent>-wo-N -b <agent>/wo-N-slug origin/main`). Never work in, or
   leave uncommitted changes in, a checkout another agent uses.
3. **Draft PR early.** Title `WO-N: …`; the body follows the PR template and starts `Closes #N`.
   A draft runs no CI (billed minutes, 2026-10-10): `npm run check` locally until ready.
4. **Ready.** Every acceptance box is ticked with evidence. Handoff: comment
   `Ready for review: PR #N` on the issue. If your token can't comment, tell the owner, who relays it.
5. **Review.** Claude runs the §6 checklist and posts a verdict on the PR: **Approve** or
   **Changes requested** (numbered). Fix on the same branch and reply to each number.
   **Small fixes by Claude** (owner grant, 2026-10-06): when a review finding needs about 20
   changed lines or fewer, inside the work order's owned paths, Claude may push the fix to the
   agent's branch itself, as its own commit (never a rewrite of the agent's history), name the
   commit in the review, and re-run §6 on the new head. Anything larger goes back to the agent.
6. **Merge.** Owner only, in dependency order. Claude then updates the docs and the board.
7. **Learn.** A mistake seen twice becomes a lint rule, a CI check or a line in this playbook.

**WIP limit:** per agent, at most 1 PR in progress and 1 in review. No PR stacked on an unmerged branch.

## 3. Definition of Ready (Claude's obligation for every work order)
- The problem, with evidence (file:line, command output, or a review finding).
- **Owned paths** (the only paths the agent may change), and a migration timestamp range if any SQL.
- The design is decided, or an ADR is linked.
- Tasks, testable acceptance criteria, and out-of-scope.
- For Codex: the exact file list to read, and the locations of current definitions.

## 4. Definition of Done (every PR)
- [ ] CI green on the PR: `verify`, Security (Secret scan, Semgrep SAST, Dependency audit), CodeQL.
- [ ] Every acceptance criterion is met and verified by Claude on the branch.
- [ ] Each new test fails on the old code, and the PR says how that was shown.
- [ ] Diff limited to the owned paths; no drive-by refactors.
- [ ] No new lint or type suppression without a one-line reason next to it.
- [ ] No secrets, no machine-specific paths (`/Users/…`, `~/.gemini/…`), no network calls in tests.
- [ ] Any new user-facing text exists in both `strings/ar.ts` and `strings/en.ts`; RTL is intact.
- [ ] Real command output is pasted. "100% green" only if CI shows it.

## 5. Code standards

### 5.1 Everywhere
- Invariants in `docs/agents/CONTEXT.md` §5 are non-negotiable.
- Errors are never swallowed. Error codes are stable enums; raw exception text goes to logs
  only, with credentials stripped from URLs.
- Names say what things are. Comments say *why*, not *what*.
- Prefer the simplest thing that works. No new dependency or infrastructure without an ADR.

### 5.2 TypeScript / React
- Pages compose, hooks fetch and hold state, components render.
- New files are ≤ 400 lines; existing oversized files only shrink.
- Server access goes through typed API modules (`apps/web/src/api/*`, being introduced) with a
  query-key factory. No new inline `client.rpc` in components.
- React Query for server state; `useReducer` for complex local state. No hand-rolled
  fetch + `useEffect` + reload counters.
- No `any`. No inline `style={{}}`; use CSS with the design tokens. No
  `locale === "ar" ? … : …` in components; all text comes from `strings/`.
- Unknown numbers render as "—" with a reason, never 0.

### 5.3 Python worker
- Type hints everywhere. `mypy --strict` on new and refactored modules (once G-4 lands).
- Collectors implement `collectors/protocol.py` exactly. Callers never probe signatures or
  catch `TypeError` to find out.
- Configuration comes from one typed settings object (being introduced); no scattered `os.environ`.
- No blind `except Exception` without `# noqa: BLE001 — <reason>`.
- Outcomes are explicit: `exhausted` only when the source positively says there's no more data.
- Tests mock every network call.

### 5.4 SQL
- One concern per migration file; new files only; inside your timestamp range.
- `SECURITY DEFINER` functions need `set search_path = ''`, fully qualified names, and
  `revoke … from public, anon` plus explicit grants.
- Every public RPC needs a PGlite test that calls it directly as a user of *another* workspace.
- Usage arithmetic in `bigint`; "unlimited" is `NULL`, never a magic number.
- No `coalesce(x, 0)` on a value that can be unknown.
- New `public` tables need RLS enabled with tenant-scoped policies in the same migration.

### 5.5 Target patterns (move toward these; don't big-bang)
| Problem | Pattern |
| --- | --- |
| Provider fallback duplicated across collectors | Strategy + chain (`ProviderChain`) returning a typed outcome |
| Scattered env reads, builders with many keyword arguments | Typed `WorkerSettings` + `CollectorFactory` |
| Untyped RPC strings in components | API module (repository) + generated DB types + query-key factory |
| Fixture vs live dashboard engines | Adapter: fixture source implements the live interface |
| Page components with dozens of `useState`s | Reducer + custom hooks; dialogs own their state |
| Wire shape copied in Zod, Python and SQL | One schema (Zod → JSON Schema), validated at each boundary |
| SQL `public` wrapper → `private` implementation | Keep. It's the right pattern |

## 6. Review checklist (what Claude checks on every PR)
1. **Scope:** only owned paths; nothing unrelated.
2. **Independent verification:** check out the branch; run `npm run check` and the relevant
   suites; for UI, run the app and look at the changed screens in Arabic and English, desktop and
   phone width.
3. **Acceptance:** each criterion seen to hold, not just claimed.
4. **Mutation spot-check:** revert the fix for at least one new test and see it go red.
5. **Adversarial read:** tenant isolation, unknown vs zero, failure vs success, idempotency,
   error paths, RTL.
6. **Security pass** on anything touching auth, grants, secrets or CI.
7. **Design:** moves toward §5.5, not away from it. Readable without the PR description.
8. **Verdict** on the PR and the board updated.

## 7. Handoff and communication
- The GitHub issue is the record for a work order. The PR is the record for its code.
- Questions go on the issue, phrased so the owner or Claude can answer in one line.
- Blocked? Say what you need and from whom, then stop. Don't work around a block by widening
  scope.
- Never paste secrets, tokens or personal data into issues, PRs or logs.
