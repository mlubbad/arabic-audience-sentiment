# Operations + Admin Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/sync` (catalogue + operations) and `/admin` on `ui/`, add `/admin?demo=1` with a fixture and a browser suite for it, share the signed-in pages' rhythm through one `pages.css`, move the account page's live rules out, and delete `report.css`.

**Architecture:** New folders `apps/web/src/ops/` and `apps/web/src/admin/`; the shared page rules (`dashboard/dashboard.css`) become `apps/web/src/pages.css`; page states move to `apps/web/src/pageStates/`. Each task cuts one region onto `ui/` keeping every `data-testid`; the last tasks switch the routes, delete the old files and `report.css`, and record.

**Tech Stack:** React 19, Radix via `ui/` (Tabs, Select, Checkbox, Dialog, Table, Badge, Button, Input, Card, Toast, Skeleton), react-query, Vitest/jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-ops-admin-redesign-design.md`

## Global Constraints

- **Test ids are a contract:** every `data-testid` in `CataloguePanel.tsx` (27 patterns: `catalogue, cat-search, cat-kind-*, cat-sort, cat-select-page, cat-clear, cat-fit, cat-refresh, cat-discovering, cat-empty, cat-row-*, cat-check-*, cat-open-*, cat-play-*, cat-link-*, cat-state-*, cat-pager, cat-prev, cat-page, cat-next, cat-jump, cat-preview, cat-preview-close, cat-preview-frame, cat-estimate (+data-exceeds), cat-save, cat-feedback`), `OperationsPanels.tsx` (`sync-panel, sync-state (+data-severity), sync-error, sync-queued, sync-worker, sync-no-channel, sync-last-run, plan-panel, plan-none, budget-* (+ <small data-state>), jobs-failed, attempts, cancel-*, retry-*, job-action`), `Sync.tsx` (`sync-signed-out`), `AdminPage.tsx` (`admin-forbidden`, `admin-workspaces`) lands on the equivalent element. The `/sync` e2e tests in `tests/e2e/dashboard.spec.ts` (~16) are the oracle; they change only where a native control became a `ui/` one (mapping table in Task 7).
- **No arithmetic/RPC changes:** `selectionEstimate`, `budgetState`, `storedPerVideo`, `pageOf`, the `select_videos`/`set_workspace_plan`/`grant_pack`/`delete_workspace`/`admin_workspaces` calls and their payloads move verbatim.
- **Copy frozen** except: reuse `S.dashDemoTag` («مثال توضيحي») for the ops eyebrow; two new admin-demo keys (Task 5).
- **Tokens only; no hex; no non-zero `letter-spacing`; no `rp-*` class on new markup** (ids/test ids may keep `rp-` only where the e2e reads them — none do on these pages).
- **The other session's files** (`docs/verification.md`, `.screenshots/`) untouched; stage by exact path; never `npm run format`; NEVER push, never stash. Docs append-only. Commit messages are sentences ending `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. e2e in the FOREGROUND with a 10-minute timeout; Playwright uses 5173 (a controller dev server sits on 5174 — leave it; use 5175 for your probes).

---

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/src/pages.css` (renamed from `dashboard/dashboard.css`) | rhythm shared by dashboard, ops, admin (`db-*` classes unchanged) |
| `apps/web/src/pageStates/PageStates.tsx` + `page-states.css` (+test) (moved from `dashboard/`) | `Loading`, `Updating`, `LoadError`, `EmptyState`, `ChartEmpty` |
| `apps/web/src/ops/Sync.tsx` | composition + state + queries + `?demo=1` (moved logic) |
| `apps/web/src/ops/Catalogue.tsx` + `catalogue.css` (+test) | filters, rows, pager |
| `apps/web/src/ops/CataloguePreview.tsx` (+test) | ui/Dialog with the YouTube iframe |
| `apps/web/src/ops/SelectionBar.tsx` | sticky bottom bar: estimate + save |
| `apps/web/src/ops/SyncHealth.tsx`, `PlanBudgets.tsx`, `BudgetMeter.tsx` (+test), `Attempts.tsx`, `ops.css` | the operations panels |
| `apps/web/src/admin/AdminPage.tsx`, `WorkspaceRow.tsx` (+test), `adminDemo.ts` (+test), `admin.css` | the admin page and its demo mode |
| `apps/web/public/fixtures/admin.json` | six demo workspaces |
| `apps/web/src/account.css` | Account's rules moved verbatim from `report.css` |
| `tests/e2e/admin.spec.ts` | the admin demo suite |
| deleted: `Sync.tsx`, `CataloguePanel.tsx`, `OperationsPanels.tsx`, `AdminPage.tsx`, `report.css` |

---

### Task 1: `pages.css`, `pageStates/`, and the ops folder scaffold

- [ ] `git mv apps/web/src/dashboard/dashboard.css apps/web/src/pages.css`; update the one importer (`dashboard/Dashboard.tsx`) and any test that reads the file by path (`grep -rn "dashboard.css" apps/web`). `git mv apps/web/src/dashboard/PageStates.tsx apps/web/src/pageStates/PageStates.tsx` (+ `page-states.css`, `PageStates.test.tsx`); fix their relative imports and every dashboard importer (`grep -rn "PageStates" apps/web/src/dashboard`). `dashboard/noReportCss.test.ts` keeps passing (adjust its file list if it enumerated `dashboard.css`).
- [ ] `git mv apps/web/src/Sync.tsx apps/web/src/ops/Sync.tsx`, `CataloguePanel.tsx` → `ops/CataloguePanel.tsx`, `OperationsPanels.tsx` → `ops/OperationsPanels.tsx`; fix relative imports (`./x` → `../x`); shim `apps/web/src/Sync.tsx` = `export { Sync } from "./ops/Sync";` (main.tsx keeps importing `./Sync` until Task 7). Keep `import "../report.css"` in `ops/Sync.tsx` for now.
- [ ] Verify: `npx vitest run apps/web` , `npm run typecheck`, `npm run lint`; e2e `npm run test:e2e -- tests/e2e/dashboard.spec.ts > /tmp/e2e-t1.log 2>&1; echo exit=$?` → all green (nothing visible changed). Commit: "The signed-in pages share one stylesheet and one set of page states; the operations files move into ops/ whole".

### Task 2: `BudgetMeter`, `SyncHealth`, `PlanBudgets`, `Attempts` (+ `ops.css`)

**Interfaces:** `BudgetMeter({ used, allowance, state, label, sentence, testId })` → `<div className="db-meter" data-testid={testId}>` with `<div role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={allowance} aria-label={label}><i style={{ width: pct% }} data-state={state} /></div>`, the sentence, and `<small data-state={state}>` kept exactly where `OperationsPanels` rendered it (the e2e reads `budget-*` → `small[data-state]`). `SyncHealth({ ...the props OperationsPanels takes for the health card, S })`, `PlanBudgets({ plan, S })`, `Attempts({ entries, acting, act, S })` — read `ops/OperationsPanels.tsx`'s props block and split it three ways; `ops/Sync.tsx` renders the three in the same order.
- [ ] Failing `BudgetMeter.test.tsx`: `used=74, allowance=100` → fill width `74%`, `data-state="warn"` (or whatever `budgetState` returns — import it from `@sentiment/contracts` and assert the same value); `allowance=0` → width `0%` and no NaN; progressbar `aria-valuenow=74`.
- [ ] Implement the three panels on `Card`/`Badge`/`Button` (`ghost sm` for cancel/retry; keep `disabled={acting === e.id}` and `data-testid="job-action"`), `ops.css` for the meter (`.db-meter-bar { height: 10px; border-radius: 999px; background: var(--bg-muted); overflow: hidden } .db-meter-bar > i { display:block; height:100%; background: var(--ml-indigo) } [data-state="warn"] > i { background: var(--color-warning) } [data-state="over"] > i, [data-state="blocked"] > i { background: var(--color-danger) }` — use the exact state names `budgetState` emits: read `packages/contracts` for them). Severity Badge tone map for `sync-state`: `ok→success`, `warn→warning`, `bad/blocked→danger`, else `neutral` (read the severities the old markup used).
- [ ] Delete the three panels from `ops/OperationsPanels.tsx` (the file may become empty → delete it and its import). Verify unit + typecheck + the `/sync` e2e subset: `npm run test:e2e -- tests/e2e/dashboard.spec.ts -g "sync|budget|plan|attempt|worker|queue" > /tmp/e2e-t2.log 2>&1; echo exit=$?` (grep the test titles first to pick the right `-g`). Commit: "The operations panels on cards: a token-coloured budget meter, a severity badge for sync health, and the attempt log as rows".

### Task 3: `Catalogue`, `CataloguePreview`, `SelectionBar`

- [ ] Failing tests: `CataloguePreview.test.tsx` (open → `role=dialog` with `data-testid="cat-preview"`, `h3` = the title, iframe `data-testid="cat-preview-frame"` `src` contains `youtube-nocookie.com/embed/<id>`, Escape → `onClose`, close button `cat-preview-close`); `Catalogue.test.tsx` (kind tabs filter rows; `cat-select-page` ticks the page; `cat-clear`; the estimate sentence and `data-exceeds`; `cat-save` disabled when clean / when exceeding).
- [ ] Cut `ops/CataloguePanel.tsx` into `Catalogue.tsx` (filters + rows + pager), `CataloguePreview.tsx` (`ui/Dialog`: `DialogContent data-testid="cat-preview" className="db-preview" closeLabel={…the current close label string…}` with `<DialogClose data-testid="cat-preview-close">`; `.db-preview { width: min(720px, calc(100vw - 32px)) }` — the e2e asserts width ≤ 720 and horizontal centring), `SelectionBar.tsx` (`Card` `position: sticky; bottom: 0; z-index: 4` on the level-2 glass tokens, the estimate line `data-testid="cat-estimate" data-exceeds`, the note, `Button` `cat-save`, `cat-feedback`). Controls: `Input` (`cat-search`), `Tabs` (`TabsTrigger data-testid={`cat-kind-${k}`}`, no panels → `aria-controls={undefined}`), `Select` (`cat-sort`; the `Labelled` helper from `dashboard/Labelled.tsx` — move it to `apps/web/src/ui/Labelled.tsx` now and update the dashboard import), `Checkbox` (`cat-check-*`; read `ui/Checkbox.tsx`'s API — Radix checkbox is a `button role="checkbox"`; the e2e uses `.check()`/`toBeChecked()` which Playwright supports on `role=checkbox`), `Badge` for kind and state (`cat-state-*` on the badge). All state and the `select_videos` save stay as they were (in `Catalogue.tsx` or lifted to `Sync.tsx` — pick one and say).
- [ ] `catalogue.css` on tokens; ≤760px the filter row wraps and the row cards stack. Verify unit + typecheck + `/sync` e2e subset `-g "catalogue|paged|preview|quota|disabled|phone"`. Commit: "The catalogue on ui/: tabs for kind, a real checkbox per video, the YouTube preview in a dialog, and the selection bar as a pinned card".

### Task 4: `ops/Sync.tsx` composition and the ops cut-over

- [ ] `ops/Sync.tsx`: drop `import "../report.css"`, import `../pages.css` + `./ops.css`; root `<div className="db-page">`; the head as `Hero`-like markup (`.db-hero`, eyebrow `Badge` `S.opsEyebrow · S.dashDemoTag` in demo — the «معاينة تجريبية» word goes), `data-testid="sync-signed-out"` state on `EmptyState`. `main.tsx` imports `./ops/Sync`; delete the shim `apps/web/src/Sync.tsx` and, if empty, `ops/OperationsPanels.tsx`/`ops/CataloguePanel.tsx`. `grep -rn "rp-" apps/web/src/ops` → nothing. e2e selector updates in `tests/e2e/dashboard.spec.ts` for `/sync` only: `cat-sort` `.selectOption(...)` → `pick(page, …)` (the helper exists), the preview `dialog` locator (`getByTestId("cat-preview")` still works), kind buttons (`getByTestId("cat-kind-short").click()` still works on a tab), any `locator("select")`/`dialog[open]`/`progress` reads → their new equivalents (list them). Run the FULL `dashboard.spec.ts` + `app-shell.spec.ts` → 86/86. Screenshots `ops-1280.png`, `ops-390.png` into `.superpowers/sdd/2026-09-17-ops-admin-redesign/shots/`. Commit: "The operations page is the new page: composed under the shared rhythm, report.css no longer loads on it".

### Task 5: `adminDemo.ts` + `admin.json` + strings

- [ ] `apps/web/public/fixtures/admin.json`: six `AdminWorkspace` rows (schema `packages/contracts/src/admin.ts`: `id` uuid, `name`, `created_by` uuid, `plan_key|null`, `status|null`, `period_end|null`, `provider|null`):
  1. «مساحة العمل الشخصية» — plan `owner`, status `active`, provider `admin`, period_end 2126-09-16 (the owner's root; id `00000000-0000-4000-8000-000000000001`, created_by `00000000-0000-4000-8000-0000000000aa`)
  2. «قناة ريم للطبخ» — `founding_partner`, `active`, `admin`, 2027-03-01
  3. «وكالة نبض الإعلامية» — `growth`, `active`, `paddle`, 2026-10-01
  4. «استوديو المدى» — `growth`, `past_due`, `paddle`, 2026-09-20
  5. «عميل للتسليم 1» — `free`, `active`, `admin`, 2026-10-01 (created_by a different uuid: a retired-to-owner client)
  6. «مساحة بلا خطة» — all four null
  (Plan keys: read `apps/web/src/planCatalogue.ts`/the catalogue fixture for the real keys and use those.)
- [ ] `apps/web/src/admin/adminDemo.ts`: `loadAdminDemo(signal)` fetches the JSON; `reduce(rows, action)` for `{type:"set_plan", w, plan_key, months, note, override}` (refuses `paddle_subscription_active` when provider=paddle and status ∈ active/past_due and !override; else sets plan/status active/period_end += months), `{type:"grant_pack", w, kind, units, note}` (no-op on rows; returns ok), `{type:"delete", w}` (refuses `billing_root` for row 1, `last_workspace` when only one row created_by the owner would remain, `paddle_subscription_active` for rows 3/4; else removes). Errors thrown as `{ code }` objects shaped like PostgREST errors so `adminErrorMessage` maps them (read `adminWords.ts`). Unit test each refusal and the happy paths; `demo:fixture`-style pinning is NOT needed (hand-authored JSON is fine — it is six rows).
- [ ] Strings (both languages): `adminDemoLead` («هذه نسخة توضيحية من صفحة الإدارة: التغييرات تبقى في هذه الجلسة فقط.» / "An illustrative copy of the admin page: changes stay in this session."), `adminDemoTag` reuses `S.dashDemoTag` — so ONE new key. Commit: "An admin demo: six illustrative workspaces and a reducer that refuses exactly what the server refuses".

### Task 6: `admin/AdminPage.tsx` + `WorkspaceRow.tsx` on ui/, with demo mode

- [ ] `git mv apps/web/src/AdminPage.tsx apps/web/src/admin/AdminPage.tsx` (+ shim at the old path until Task 7? No — `main.tsx`'s lazy import is the only consumer; switch it in this task and delete nothing else). Split `WorkspaceRow` into `admin/WorkspaceRow.tsx`. Demo: `const demo = new URLSearchParams(location.search).has("demo")`; when demo, the page bypasses `useIsPlatformAdmin`'s gate and the session requirement, reads rows from `loadAdminDemo` into local state, and every action goes through `reduce` (then `setRows`) instead of the RPC; feedback via the same `role="status"` lines + `toast()`; the eyebrow `Badge` `S.dashDemoTag` and `S.adminDemoLead`. `DeleteWorkspaceDialog` gets an `onConfirm?: () => Promise<void>` prop (defaulting to the RPC) so demo mode can pass the reducer — keep its tests green and add one for the injected path. Table on `ui/Table` (≤760 stacked `Card`s with `<dl>`); pack kind on `Select` (`aria-label` = the current label), units/months/note on `Input`, override on `Checkbox`; each row gets `data-testid={`admin-row-${w.id}`}` and the two forms `data-testid="admin-plan-form"` / `"admin-pack-form"` (new ids for the new suite). Unit tests: `WorkspaceRow.test.tsx` with a fake `act` — plan change payload, pack validation (units/note required), refusal sentence rendering.
- [ ] `admin.css` on tokens; `grep -rn "rp-\|report.css" apps/web/src/admin` → nothing. Verify unit + typecheck + `app-shell.spec.ts` (the forbidden path still passes — demo is only with `?demo=1`). Commit: "The admin page on ui/ with a demo mode: the same rows, the same refusals, no server".

### Task 7: `tests/e2e/admin.spec.ts` + `account.css` + delete `report.css`

- [ ] `admin.spec.ts` (default project): `/admin?demo=1` → `admin-workspaces` has 6 rows (or 6 cards at 390); change row 2's plan via `pick()` + apply → the row's plan cell updates and the status line says done; grant a pack on row 5 → done sentence; open delete on row 3 → dialog, type the name → refusal sentence `S.adminPaddleActive`-family (read the exact mapped sentence from `adminWords.ts`); delete row 6 → the row disappears; at 390px no horizontal overflow. Plus the forbidden path without `?demo=1` stays as `app-shell.spec.ts` has it.
- [ ] `account.css`: copy verbatim from `report.css` every rule the account page uses — grep `Account.tsx`, `WorkspaceCard.tsx`, `PlanPanel.tsx`, `SetupPath.tsx` for `className` values and take each matching `report.css` block (the `.rp-page`/`.rp-hero`/`.rp-eyebrow`/`.rp-section`/`.rp-card`/`form.rp-card*`/`.auth-*`/`.account-trust*`/`.budgets*`/`.history*`/`.plan-actions`/`.empty-actions` groups and their media queries) — `Account.tsx` imports `./account.css` instead of `./report.css`. Then `git rm apps/web/src/report.css`; `grep -rn "report.css" apps/web/src tests` → only comments; widen `dashboard/noReportCss.test.ts` to scan all of `apps/web/src` for `report.css` imports and `className="rp-` outside `Account.tsx`/`WorkspaceCard.tsx`/`PlanPanel.tsx`/`SetupPath.tsx` (which keep `rp-*` until phase 5 — say so in the test's comment). Before/after screenshots of `/account` signed-out at 1280 (`account-before.png` from a `git stash`? NO — take "before" from the live dev server BEFORE editing, then "after"); compare visually.
- [ ] Run the FULL e2e: `npm run test:e2e > /tmp/e2e-all.log 2>&1; echo exit=$?` → all green incl. the new admin suite; `npm run test:e2e:build` → green. Commit: "report.css ends: the account page carries its own rules, the admin demo has a browser suite, and the guard covers every page".

### Task 8: Records + `npm run check`

- [ ] `npm run check` green (tallies). Append `docs/progress.md` (what moved, the demo mode, the suite, the deletion — list the dead rule groups that went with `report.css`), `docs/decisions.md` (admin demo reducer mirrors the server's refusals; `pages.css` shared; `BudgetMeter` to be adopted by phase 5; `account.css` verbatim until phase 5), `docs/coordination/ACTIVE.md` (rows; the phase-4 pending item closed). `docs/verification.md` only if clean. Commit: "docs: the operations and admin pages recorded".

## Self-review
Coverage: spec structure (T1, T4, T6), catalogue (T3), operations (T2), admin + demo (T5, T6, T7), words (T4), report.css end (T7), tests (each + T7), records (T8). Types: `BudgetMeter` props (T2) reused nowhere else this plan; `reduce` action shapes (T5) consumed by T6/T7; `Labelled` moves to `ui/` (T3) — dashboard import updated in the same task.
