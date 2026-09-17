# Account Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/account` on `ui/` under `pages.css`, add `/account?demo=1` on a fixture + reducer with a browser suite, and retire every `rp-*` class rule in the tree.

**Architecture:** New folder `apps/web/src/account/` (Account, AuthEntry, Unavailable, WorkspaceCard, ConfirmDialog, PlanPanel, CreateWorkspace, accountDemo, account.css). `BudgetMeter` moves to `ui/`. `SetupPath` stays where it is, restyled. The old files and the verbatim `account.css` are deleted; the guard loses its allow-list.

**Tech Stack:** React 19, Radix via `ui/`, react-query, Vitest/jsdom + `@testing-library/react`, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-account-redesign-design.md`

## Global Constraints

- **Test ids / attributes are a contract:** `account-trust`, `account-plan-panel`, `plan-failed`, `plan-notice`, `plan-${event_type}`, `rename-form-*`, `rename-*`, `channel-*`, `sync-*`, `connect-*`, `connect-continue-*`, `relink-*`, `disconnect-*`, `disconnect-confirm-*`, `retire-*`, `retire-confirm-*`, `SetupPath`'s `testId`, `data-provider="<id>"`, `id="why-<id>"`, `data-action` on plan doors, the strings `Account.entry.test.ts` / `Account.setup.test.ts` assert («مرحبًا بعودتك», «أنشئ حسابًا», `>إنشاء حساب جديد<` absent…). `disconnect-confirm-*` / `retire-confirm-*` move into a dialog; everything else lands on the equivalent element.
- **Behaviour frozen:** the auth calls (`signInWithPassword` / `signUp` via the `submitter` value), One Tap mount, the four table reads, `create_workspace`, `rename_workspace`, `oauth_disconnect`, `retire_workspace` (+ `last_workspace` mapping), `beginConnect`, `openPortal` / `openCheckout`, `planPanelWords`, `setupProgress`, `useWorkspaceSelection` — same calls, same payloads, same messages.
- **Copy frozen** except the two new keys `accountDemoLead`, `demoExternalNote` (exact texts in the spec); `dashDemoTag` reused.
- **Tokens only; no hex; no non-zero `letter-spacing`; no `rp-*` class anywhere after Task 7**; no `<progress>`; z-index on the documented scale.
- **The other session's files** (`docs/verification.md`, `.screenshots/`) untouched; stage by exact path; never `npm run format` (scoped `prettier --write` on files you created is fine); NEVER push, never stash. Commit messages are sentences ending with a blank line + `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. e2e in the FOREGROUND with a 10-minute timeout; Playwright owns 5173, 5174 is not yours, use 5175 for probes/screenshots and kill it after. Screenshots go to `.superpowers/sdd/2026-09-17-account-redesign/shots/`, nowhere else.

---

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/src/ui/BudgetMeter.tsx` (+test) (moved from `ops/`) | the meter both `/sync` and `/account` render |
| `apps/web/src/SetupPath.tsx` + `setup-path.css` | the three steps, restyled on tokens |
| `apps/web/src/account/accountDemo.ts` (+test) | `loadAccountDemo`, `reduceAccountDemo`, ids |
| `apps/web/public/fixtures/account.json` | 3 workspaces, 2 clients, 2 channels, 2 jobs, 2 usage entries |
| `apps/web/src/account/PlanPanel.tsx` (+test) | plan card |
| `apps/web/src/account/WorkspaceCard.tsx` (+test), `ConfirmDialog.tsx` | one workspace + the two confirmations |
| `apps/web/src/account/AuthEntry.tsx`, `Unavailable.tsx`, `CreateWorkspace.tsx` | the signed-out screen, the unavailable card, the create form |
| `apps/web/src/account/Account.tsx` | composition + data + demo |
| `apps/web/src/account/account.css` | the page's rules on tokens |
| `tests/e2e/account.spec.ts` | the demo suite |
| deleted: `apps/web/src/Account.tsx`, `WorkspaceCard.tsx`, `PlanPanel.tsx`, `account.css` (verbatim), `.app-shell .rp-*` blocks in `app.css` |

---

### Task 1: `ui/BudgetMeter`, `SetupPath` restyle, fixture + reducer

- [ ] `git mv apps/web/src/ops/BudgetMeter.tsx apps/web/src/ui/BudgetMeter.tsx` (+ `BudgetMeter.test.tsx`); update `ops/PlanBudgets.tsx`'s import; move the `.db-meter*` rules from `ops/ops.css` into `ui/ui.css` (rename to `.ui-meter*` and update the component — a `ui/` component wears `ui-*`). `/sync` e2e subset `-g "budget|meter|colour"` green.
- [ ] `SetupPath.tsx`: classes `setup-path`, `setup-step`, `setup-step-state` (drop `account-steps`); `apps/web/src/setup-path.css` on tokens: an `ol` with numbered markers, `data-status` on each `li` (`done` → success tone, `current` → indigo, `todo` → muted — read `SetupStep["status"]` for the real names); imported by `SetupPath.tsx` itself. The dashboard still renders it (`dashboard/Dashboard.tsx`) — check it there at 1280 (`/dashboard` with no workspace state is hard to reach; a unit render is enough).
- [ ] `apps/web/public/fixtures/account.json` per the spec (ids `…a1/a2/a3`; client ids `…c1/c2`; channel ids `…ch1/ch2` with `external_channel_id` like `UCxxxx`, `handle` `@salem.yjarrib` / `@reem.kitchen`, `title`s; jobs `created_at` recent; `usage` for a1 = creator_plus / paddle / active / budgets `comment_analysis 7400/40000`, `topic_classification 900/4000`, `backfill 0/120000`… — read `packages/contracts/src/usage.ts` `BudgetSchema` for the exact budget shape and the `event_type` names the worker uses; `plan` row from `fixtureCatalogue`; a2 = free / provider null / budgets from the free row).
- [ ] `apps/web/src/account/accountDemo.ts`: `ACCOUNT_DEMO_FIXTURE`, `type AccountDemo`, `AccountDemoAction` (`rename | retire | disconnect | connect | create`), `loadAccountDemo(signal?)` (fetch + parse: `UsageSummarySchema` per usage, the four row shapes with zod), `reduceAccountDemo(state, action): AccountDemo` (pure; `next` id = `…a${n+1}`); refusals as `{ message, code }` (`invalid_name` 22023, `last_workspace` 55000). TDD: `accountDemo.test.ts` first — fixture parses; every action; both refusals; input not mutated.
- [ ] Strings `accountDemoLead`, `demoExternalNote` in `ar.ts` + `en.ts` (exact spec texts). Verify unit + typecheck + lint + format:check. Commit: "The meter moves to ui/, the setup path wears tokens, and the account demo has its fixture and reducer".

### Task 2: `account/PlanPanel.tsx`

**Interface:** `PlanPanel({ session, workspaces, loading, demo?: { usage: UsageSummary | null; place: Place } })` — live path calls `usePlanUsage` exactly as today; demo path takes its data from the prop and never calls `usePlanUsage` (split into `LivePlanPanel` / `PlanPanelView({ place, usage, status, onPress })` so the view is testable without react-query). `onPress(action)` in demo sets the feedback line to `S.demoExternalNote` for `manage` / `topup`.
- [ ] Failing `PlanPanel.test.tsx` (testing-library): renders a `BudgetMeter` per budget with `role=progressbar`, `plan-${event_type}` ids, doors per `planPanelWords` with `data-action`, `plan-notice`, `plan-failed`; demo press → `demoExternalNote`.
- [ ] Implement per spec on `Card`/`Button`/`BudgetMeter`; `account.css` gets `.db-plan*` rules. Delete `apps/web/src/PlanPanel.tsx` after re-pointing `Account.tsx`'s import (temporary — Task 5 replaces Account). `planPanelWords.ts` untouched. Commit: "The plan card on ui/: the same meter as the operations page, the doors as buttons".

### Task 3: `account/WorkspaceCard.tsx` + `ConfirmDialog.tsx`

- [ ] Failing `WorkspaceCard.test.tsx`: rename door opens the form with the name prefilled and `onRename("save", "new")` on submit; connect → consent step with `connect-continue-*` → `onConnect("continue")`; disconnect → dialog with `disconnect-confirm-*` → `onDisconnect("confirm")`; retire → dialog `retire-confirm-*` → `onRetire("confirm")`; `channel-*` shows the handle in `<bdi>` or `S.noChannel`; `relink-*` only when `channel.status === "needs_relink"` (read `setupProgress`/the old card for the exact rule); `sync-*` link.
- [ ] `ConfirmDialog({ open, kind: "disconnect" | "retire", workspaceName, pending, onConfirm, onClose, confirmTestId })` on `ui/Dialog` (`closeTestId={`${kind}-cancel-${id}`}`), title/body from the same `S.*` the inline blocks used, confirm `Button` (retire in danger tone) `data-testid={confirmTestId}`. Same props as the old card (keep the `step` callbacks so `Account.tsx`'s handlers move verbatim). `li` = `Card`. Delete `apps/web/src/WorkspaceCard.tsx` after re-pointing the import. Commit: "A workspace card on ui/: rename inline, connect with its consent step, disconnect and retire behind a dialog".

### Task 4: `AuthEntry.tsx`, `Unavailable.tsx`, `CreateWorkspace.tsx`

- [ ] Cut the signed-out JSX (`Account.tsx` ~315–444) into `AuthEntry({ joining, setJoining, email, setEmail, password, setPassword, busy, feedback, onSubmit, S })` — or, cleaner, own its email/password/joining state and take `onAuth(action, { email, password })`; keep `Account.entry.test.ts` and `Account.setup.test.ts` green by moving their imports (they render `Account` — so keep the markup contract: `data-provider`, `id="why-*"`, the strings). One Tap: `useGoogleOneTap` mounts inside `AuthEntry`. Providers as `Button variant="outline"` (check `ui/Button.tsx`'s variants; add `outline` if missing — tokens only). `Unavailable` = `Card className="db-empty db-empty--page"` with the two strings + the dashboard `Button asChild` link. `CreateWorkspace({ name, setName, pending, feedback, onSubmit })` on `Card` + `Input` + `Button`.
- [ ] Wire them into the OLD `Account.tsx` (still at `apps/web/src/Account.tsx`) so the page keeps working; unit + typecheck + `app-shell.spec.ts` (signed-out assertions) green. Commit: "The way in, the unavailable card and the create form on ui/".

### Task 5: `account/Account.tsx` — composition, data, demo; cut-over

- [ ] `git mv apps/web/src/Account.tsx apps/web/src/account/Account.tsx`; `main.tsx` route import → `./account/Account`; `Account.entry.test.ts` / `Account.setup.test.ts` imports → `./account/Account`. Root `db-page` + `db-hero` (Badge eyebrow; demo tag/lead per spec); `feedback("page")`; the `!supabase` branch → `Unavailable` **unless `wantsDemo`** (demo works in fixture mode — that is its point); signed-out → `AuthEntry`; signed-in → `db-provenance` line, `PlanPanel`, workspaces `db-section`, `<ul role="list">` of `WorkspaceCard`, `CreateWorkspace`. Demo: `useAccountDemo()` (`useQuery(["account","demo"])` → `useState`), every handler routes to `reduceAccountDemo` + `setState`, refusals mapped to `S.retireLast` / `S.renameFailed`, connect "continue" → `say(scope, S.demoExternalNote)`; `PlanPanel` gets `demo={{ usage: state.usage[first.id] ?? null, place: { kind: "ready", id: first.id, name: first.name } }}` (read `Place` in `workspace.ts` for the exact shape). Live path: the handlers move verbatim.
- [ ] Import `../pages.css` + `./account.css`; delete the verbatim `apps/web/src/account.css` (`git rm`); `grep -rn "rp-" apps/web/src/account apps/web/src/SetupPath.tsx` → nothing. Screenshots: `/account` (signed-out) and `/account?demo=1` at 1280 and 390 → `shots/`; look at them. Unit + typecheck + lint + format:check + `app-shell.spec.ts` green. Commit: "The account page is the new page: composed under the shared rhythm, with a demo that needs no session".

### Task 6: `tests/e2e/account.spec.ts`

- [ ] The suite per the spec's Tests section (each test its own `page.goto("/account?demo=1")`; a row-scoped locator helper; the dialog via `getByRole("dialog")`; no `waitForTimeout`). Run it, then the FULL `npm run test:e2e` (expect 114 + new) and `npm run test:e2e:build`. Commit: "The account demo has a browser suite".

### Task 7: the last `rp-*` rules

- [ ] Delete every `.app-shell .rp-*` block from `app.css` (lines ~200–360: `.rp-page .rp-hero*`, `.rp-eyebrow`, `.rp-pills`, `.rp-pill`, `.rp-hero-split`, `.rp-nav`, `.rp-provenance*`, `.rp-section*`, `.rp-card`, `.rp-metric`, `form.rp-card.rp-filters*`, `.rp-missing`…) and the `.notice` / `.account-feedback` / `.app-state*` / `.link-button*` rules IF no `.tsx` still wears them (grep each; `WorkspaceGate.test.ts` asserts `class="app-state"` on the gate — that one stays). `noReportCss.test.ts`: remove the allow-list; assert no `.tsx` under `apps/web/src` has a `className` containing `rp-` (ids/anchors excluded as today), and neither `apps/web/src/report.css` nor a verbatim `apps/web/src/account.css` exists. `layers.test.ts`: `account.css` → `account/account.css` in the "no raw colour" list. `brandMark.test.ts` list updated if it names `account.css`. Visual check `/dashboard`, `/sync`, `/account` at 1280 after the deletion (nothing should change — they wear `db-*`). Commit: "The last rp-* rules go: every page wears the design system, and the guard has no exceptions".

### Task 8: Records + `npm run check`

- [ ] `npm run check` green; append `docs/progress.md`, `docs/decisions.md` (demo modes as the browser-test strategy for gated pages; `ConfirmDialog` over inline confirms; `BudgetMeter` in `ui/`), `docs/coordination/ACTIVE.md` (phase 5 closed; phase 6 pending); `docs/verification.md` only if clean. Commit: "docs: the account page recorded".

## Self-review
Spec coverage: structure (T1–T5), page sections (T2–T5), demo (T1, T5), tests (each, T6), rp-* end (T7), records (T8). Interfaces: `reduceAccountDemo` (T1) consumed by T5; `PlanPanel` demo prop (T2) consumed by T5; `WorkspaceCard` step callbacks (T3) unchanged so T5's handlers move verbatim; `BudgetMeter` path (T1) consumed by T2 and `ops/PlanBudgets`.
