# The operations and admin pages on the design system, and the end of report.css (design)

2026-09-17. Phase 4 of the pre-launch UI roadmap (phases 0–3: foundation, shell, landing,
dashboard). Approved in conversation with option 2: rebuild `/sync` and `/admin` on `ui/`,
and give `/admin` a demo mode with a fixture so the browser suite can finally cover it.

## What exists

- `/sync` (`Sync.tsx` 317 lines) composes `CataloguePanel.tsx` (590) above
  `OperationsPanels.tsx` (245). Zero `ui/` primitives; 16 hand-written buttons, one native
  `<select>`, a native `<dialog>` for the YouTube preview, `<progress>` budget meters. A
  `?demo=1` mode serves the fixture so ~16 Playwright tests (in `dashboard.spec.ts`) cover
  it through 27 `cat-*` and the `sync-*`/`plan-*`/`budget-*` test ids.
- `/admin` (`AdminPage.tsx` 417) is half migrated: the plan picker is `ui/Select` and the
  delete door is `ui/Dialog`; the table, the pack-kind `<select>`, the buttons and the
  per-row feedback lines are hand-written on `app.css`/`report.css`. No browser test reaches
  its signed-in table — there is no admin fixture.
- `report.css` (1,316 lines) still loads on `/sync`, `/admin` and `/account`; more than
  half of it is dead since the dashboard left it. What is live: the page shell (`.rp-page`,
  `.rp-hero`, `.rp-section`, `.rp-card`), tab-style buttons, the budget/history rules, the
  account page's auth card / trust block / `form.rp-card`.
- The eyebrow still says «التشغيل · معاينة تجريبية».

## Approach

**Structure.** `apps/web/src/ops/`: `Sync.tsx` (composition, state, the `dashboard-source`
query, the job/channel reads, `?demo=1` — unchanged logic), `Catalogue.tsx` + `catalogue.css`,
`CataloguePreview.tsx` (ui/Dialog), `SelectionBar.tsx`, `SyncHealth.tsx`, `PlanBudgets.tsx`,
`BudgetMeter.tsx` (reusable; phase 5's `PlanPanel` adopts it), `Attempts.tsx`, `ops.css`.
`apps/web/src/admin/`: `AdminPage.tsx`, `WorkspaceRow.tsx`, `adminDemo.ts`, `admin.css`.
Old `Sync.tsx`, `CataloguePanel.tsx`, `OperationsPanels.tsx`, `AdminPage.tsx` are deleted at
cut-over; `main.tsx`'s lazy imports move. Page-level shared rules (`.db-page`, `.db-section`,
`.db-grid`, `.db-pager`, `.db-lead/.db-note`) come from `dashboard/dashboard.css` — it becomes
`apps/web/src/pages.css` (renamed, imported by the dashboard, ops and admin) so the three
signed-in pages share one rhythm; class names stay `db-*` (no churn in the dashboard's tests).

**Catalogue.** Filter row on the same sticky pattern as the dashboard's bar but NOT sticky
(the list is the page): search `Input` (`cat-search`), kind as `ui/Tabs` (`cat-kind-*` on the
triggers, counts in the labels as today), sort `ui/Select` (`cat-sort`), then the three page
actions as `Button variant="secondary" size="sm"` (`cat-select-page`, `cat-clear`, `cat-fit`)
and refresh (`cat-refresh`); the "list as of" caption `.db-note`. Rows: `Card` with `ui/Checkbox`
(`cat-check-*`), title, kind `Badge`, date, count, collection state `Badge` (`cat-state-*`,
tone by state), the YouTube link (`cat-link-*`) and preview `Button variant="ghost" size="sm"`
(`cat-play-*`/`cat-open-*` as today). Empty/discovering states via the dashboard's
`PageStates` (`EmptyState`, `Loading`) — moved to `apps/web/src/pageStates/` so both pages
import them. Pager `.db-pager` (`cat-pager/prev/page/next/jump`). Preview: `CataloguePreview`
on `ui/Dialog` (`cat-preview`, `cat-preview-close`, `cat-preview-frame` on the iframe; same
`youtube-nocookie` embed; Escape/overlay close; focus returns to the play button).
Selection bar: `position: sticky; bottom: 0` level-2 glass `Card` with the estimate sentence
(`cat-estimate`, `data-exceeds` kept; a `danger` Badge when it exceeds), the standing-selection
note, and `Button` «احفظ الاختيار» (`cat-save`, disabled rule unchanged) + `cat-feedback`.

**Operations.** `SyncHealth`: `Card` with a severity `Badge` (`sync-state` + `data-severity`),
the sentences, `sync-error/queued/worker/no-channel/last-run` kept. `PlanBudgets`: `Card`
titled by the plan, each budget a `BudgetMeter` — a `div role="progressbar"` with
`aria-valuenow/max`, a token-coloured fill (`--ml-indigo`; `--color-warning` near the limit;
`--color-danger` at it), the sentence and `<small data-state>` kept (the e2e reads it);
`plan-panel`, `plan-none`, `budget-*` kept. `Attempts`: `Card` list, each entry a row with a
status `Badge`, the reason, and cancel/retry `Button variant="ghost" size="sm"` (`cancel-*`,
`retry-*`, `job-action`); `attempts`, `jobs-failed` kept; the demo's "no invented log" note
stays as an `EmptyState kind="chart"`-style sentence.

**Admin.** `ui/Table` for the workspace table (`admin-workspaces`; ≤760px stacked `Card`s with
`<dl>`), the plan picker as is, the pack kind on `ui/Select`, units/months/note on `ui/Input`,
the override `ui/Checkbox`, actions `Button size="sm"`; feedback via `toast()` AND a
`role="status"` line per row (tests read text). `WorkspaceRow` keeps its mutation state.
**Demo mode** `/admin?demo=1` (reachable signed-out, like `/sync?demo=1`): `adminDemo.ts`
serves `public/fixtures/admin.json` — six workspaces: the owner's root, a founding partner,
a Paddle-active client, a past_due one, a retired-to-owner one, one on no plan — and applies
`set_workspace_plan` / `grant_pack` / `delete_workspace` locally (a reducer over the rows)
with the same refusals as the RPCs (`paddle_subscription_active`, `billing_root`,
`last_workspace`) so the dialog's sentences are exercised; the page carries an eyebrow Badge
«مثال توضيحي» and the provenance line the dashboard uses. `useIsPlatformAdmin` is bypassed
only in demo mode (the gate reads `demo`). New strings: the demo eyebrow/lead (2 keys).

**Words.** `opsEyebrow`'s companion «معاينة تجريبية» → «مثال توضيحي» wherever the ops page
prints it (reuse `dashDemoTag`).

**report.css ends.** Account's live rules move verbatim to `apps/web/src/account.css`
(auth card, auth-or/providers/switch/link, `.account-trust*`, `form.rp-card`, `.rp-page`
shell bits it needs — `Account.tsx` imports it); `report.css` is deleted; the
`noReportCss` guard widens to all of `apps/web/src`. `PlanPanel` (account) keeps working on
the moved rules until phase 5 replaces it with `BudgetMeter`.

## Testing

- Unit: `BudgetMeter` (fill % and state colour by `budgetState`), `Catalogue` (kind tabs
  filter, select-page/clear/fit, estimate + exceeds, save disabled rule), `CataloguePreview`
  (opens, iframe src, Escape), `WorkspaceRow` (plan change calls the RPC / demo reducer; pack
  grant validation; delete refusal sentences), `adminDemo` reducer (each refusal).
- e2e: the ~16 `/sync` tests in `dashboard.spec.ts` stay; only selectors change (native
  `<dialog>` → `getByRole("dialog")`, native select → `pick()`, kind buttons → `getByRole("tab")`).
  New `tests/e2e/admin.spec.ts` on `/admin?demo=1`: table renders six rows; changing a plan
  updates the row; granting a pack shows the done sentence; the delete dialog refuses the
  Paddle-active row with its sentence, deletes the no-plan row after the name is typed; at
  390px the rows stack and nothing overflows. `app-shell.spec.ts`'s forbidden-path tests
  unchanged. `account`/`pricing`/`legal` suites unchanged (CSS moved verbatim; before/after
  screenshots of `/account` signed-out).
- `npm run check` green; `public-build` project still green.

## Out of scope

The account/billing page redesign (phase 5) beyond the verbatim CSS move; the tour (6);
any RPC or arithmetic change; a real admin session in e2e.
