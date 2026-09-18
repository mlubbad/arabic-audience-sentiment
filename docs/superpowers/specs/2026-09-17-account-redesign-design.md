# The account page on the design system, with a demo mode (design)

2026-09-17. Phase 5 of the pre-launch UI/UX redesign: `/account` — the way in
(sign-in / sign-up), the plan and its budgets, the workspaces and their channels,
and the last `rp-*` rules in the tree. Phase 4 (`/sync`, `/admin`) set the
pattern this phase follows: the page on `ui/` under the shared `pages.css`
rhythm, a `?demo=1` mode driven by a fixture and a pure reducer so the browser
suite can drive the signed-in page without a session, and the old stylesheet
deleted rather than kept.

## What exists

- `apps/web/src/Account.tsx` (648 lines): the head; `feedback()` status lines
  per scope (`page`, `auth`, `create`, `ws:<id>`); the **signed-out** entry (a
  sign-in / sign-up form on `client.auth.signInWithPassword` / `signUp`, the
  provider buttons from `authProviders.ts` with `data-provider` and `id="why-*"`
  reasons, Google One Tap via `useGoogleOneTap`, the «كيف تبدأ» story with
  `setupSteps`, the trust section `data-testid="account-trust"`); the
  **`!supabase`** card («الدخول غير متاح» + the dashboard door — what fixture
  mode shows today); the **signed-in** page (`insideAccount` line, `PlanPanel`,
  the workspaces list of `WorkspaceCard`s, the «مساحة أخرى» create form on
  `rpc("create_workspace")`). Reads `workspaces`, `clients`, `connection_status`,
  `jobs` (last 200) with one `Promise.all` per `reloads` tick.
- `WorkspaceCard.tsx` (305): name + inline rename form (`rename-form-*`,
  `rename-*`), the channel line (`channel-*`), `SetupPath` steps, the doors:
  `sync-*` (Link to `/sync`), `connect-*` → consent step (`connect-continue-*`)
  → `beginConnect` (leaves to Google), `relink-*`, `disconnect-*` → inline
  confirm (`disconnect-confirm-*`), `retire-*` → inline confirm
  (`retire-confirm-*`). RPCs `oauth_disconnect`, `rename_workspace`,
  `retire_workspace` (refuses `last_workspace`).
- `PlanPanel.tsx` (191): `usePlanUsage` → `rpc("usage_summary")`; `planPanelWords`
  gives title, status line, notice and the doors `upgrade` (Link `/pricing`),
  `manage` / `topup` (`openPortal` / `openCheckout` — Paddle), `contact`
  (mailto); budgets as native `<progress>` inside `plan-${event_type}` items;
  `account-plan-panel`, `plan-failed`, `plan-notice`.
- `SetupPath.tsx` (48): the three-step list, also rendered by the dashboard's
  empty state. `PlanCard.tsx`: the rail's plan card (phase 1 shell — untouched).
- `account.css` (494 lines, verbatim from `report.css`), plus dead
  `.app-shell .rp-*` blocks in `app.css` (~140 lines) and the `noReportCss`
  guard's four-file allow-list.
- Tests: `Account.entry.test.ts` / `Account.setup.test.ts` render the signed-out
  page to static markup and assert strings and attributes; e2e touches `/account`
  only signed-out (`app-shell.spec.ts`: the h1, one «تسجيل الدخول», the mobile
  menu, no invented trust numbers). **The signed-in page has no browser test.**

## Structure

`apps/web/src/account/`:

| File | Responsibility |
| --- | --- |
| `Account.tsx` | composition, data (`useAccountData`), the demo switch, feedback scopes |
| `AuthEntry.tsx` | the signed-out screen: the form card, providers, One Tap, story, trust |
| `Unavailable.tsx` | the `!supabase` card |
| `WorkspaceCard.tsx` | one workspace: name/rename, channel, `SetupPath`, doors |
| `ConfirmDialog.tsx` | the disconnect / retire confirmation on `ui/Dialog` (one component, words by kind) |
| `PlanPanel.tsx` | the plan card: status, notice, `BudgetMeter`s, doors |
| `CreateWorkspace.tsx` | the «مساحة أخرى» form card |
| `accountDemo.ts` | the demo fixture loader and reducer |
| `account.css` | the page's own rules on tokens (replaces the verbatim file) |

Moves: `SetupPath.tsx` stays at `apps/web/src/SetupPath.tsx` (the dashboard
renders it too) and is restyled on tokens with its rules in
`apps/web/src/setup-path.css`; `ops/BudgetMeter.tsx` → `ui/BudgetMeter.tsx`
(`/sync` imports the new path); `PlanCard.tsx` untouched.

Deleted: the old `Account.tsx`, `WorkspaceCard.tsx`, `PlanPanel.tsx`, the
verbatim `account.css`, every `.app-shell .rp-*` block in `app.css`, and the
`noReportCss` guard's allow-list — the guard now asserts **no `rp-` class in any
`.tsx` under `apps/web/src`** (element ids and anchors such as
`#rp-comments-title` stay legitimate) and that neither `report.css` nor the
verbatim `account.css` exists. `layers.test.ts` drops `account.css` from its
lists (the new `account.css` is tokens-only and joins the "no raw colour" list).

## The page

**Head.** `db-page` + `db-hero`: `Badge` eyebrow (`S.accountEyebrow`, and in demo
`S.accountEyebrow · S.dashDemoTag`), `h1 S.accountTitle`, lead `S.accountLead`
(demo: `S.accountDemoLead`, new). The `feedback("page")` line under it as today.

**Signed out — `AuthEntry`.** Two columns at ≥960px (`db-grid db-grid--entry`,
`minmax(0, 1fr) minmax(0, 1.1fr)`), stacked below. Left: a `Card` with the
form — `h2` (`S.authReturnTitle` / `S.authJoinTitle`), `ui/Input` for email and
password (labels visible, `autoComplete` as today), the submit `Button`
(`value="signin"` / `"signup"` — the same `submitter` reading), the «أو» rule,
the providers as `Button variant="outline"` rows with the provider mark and the
closed-reason `id="why-*"` sentences exactly as now (`data-provider` kept), the
switch line with a link `Button variant="link"`. Right: the story as a `Card`
(`S.howToStartEyebrow`, `S.howToStartTitle`, `SetupPath` from `setupSteps`)
and the trust `Card` (`data-testid="account-trust"`, `h3 S.trustTitle`, the
list, `S.trustNote`). One Tap unchanged (`useGoogleOneTap` mounted here).

**`!supabase` — `Unavailable`.** `EmptyState`-style `Card` (`db-empty--page`):
the symbol, `h2 S.accountUnavailableTitle`, `S.accountUnavailableLead`, the
dashboard door as a `Button asChild` link. Same two strings, no new ones.

**Signed in.** In order: the `insideAccount` line (`db-provenance` strip);
`PlanPanel`; the workspaces section (`db-section` header `S.workspacesTitle` +
`S.workspacesLead`; `Loading` / the empty `db-empty` with `S.noWorkspaceStrong`
+ `S.noWorkspaceLead`; else `<ul role="list">` of `WorkspaceCard`s);
`CreateWorkspace`.

**`PlanPanel`.** `Card` `data-testid="account-plan-panel"`, `aria-labelledby`
`plan-panel-heading`; `h2 S.planPanelTitle` + the place name (`db-muted`);
loading `role="status"`, none-chosen note, `plan-failed` alert; then `h3`
title, status line, `plan-notice` (`role="status"`), the budgets as a
`<ul role="list">` of `li data-testid="plan-${event_type}"` each holding a
`BudgetMeter` (`role="progressbar"`, the `<small data-state>` sentence — the
same component `/sync` uses, so the two pages can never disagree); the doors
as a `db-actions` row: `upgrade` → `Button asChild` Link, `contact` → `Button
asChild` mailto, `manage` / `topup` → `Button` (`data-action` kept on all four);
the press feedback line as today. `planPanelWords` untouched.

**`WorkspaceCard`.** `Card` as `li`: the name row (`h3` + rename door as
`Button variant="ghost" sm` `rename-*`; the rename form on `ui/Input` +
save/cancel `Button`s, `rename-form-*`, autofocus kept); the channel line
(`channel-*`: `bdi` handle, title, `S.channelIdLabel` + id) or `S.noChannel`;
`SetupPath` (`setup-${id}`); the doors row: `sync-*` (`Button asChild` Link),
`connect-*` / `relink-*` (`Button`), `disconnect-*` and `retire-*`
(`Button variant="ghost"`, retire in the danger tone). The connect consent step
stays **inline** (it is an explanation before leaving to Google, not a
confirmation): a `Card` level-2 with the sentence and `connect-continue-*` +
cancel. Disconnect and retire open `ConfirmDialog` (`ui/Dialog`, `closeTestId`),
whose confirm button carries `disconnect-confirm-*` / `retire-confirm-*` — the
test ids move from an inline block to the dialog; every other id stays.

**`CreateWorkspace`.** `Card` with `h2 S.anotherWorkspaceTitle`, the lead,
`ui/Input` `S.workspaceNameLabel` (required, `maxLength 120`), the feedback
line, the submit `Button` (`disabled={pending}`).

**Responsive.** ≤760px: cards stack, the doors row wraps, the meters keep their
sentence under the bar. No horizontal overflow at 390.

## Demo mode — `/account?demo=1`

`wantsDemo` as on `/sync` and `/admin`. In demo the page skips `useSession`'s
gate and the four reads: state comes from `apps/web/public/fixtures/account.json`
via `loadAccountDemo(signal)`:

```ts
type AccountDemo = {
  workspaces: { id: string; name: string }[];        // 3
  clients: { id: string; workspace_id: string }[];  // 2 (the third has none)
  channels: ChannelRow[];                            // 2 (statuses: "connected", "needs_relink")
  jobs: JobRow[];                                    // one succeeded, one failed
  usage: Record<string, UsageSummary>;               // by workspace id; the third absent (no plan chosen)
};
```

Rows: «قناة سالم للتقنية» (creator_plus, paddle, active, connected `@salem.yjarrib`,
last job succeeded), «مطبخ ريم» (free, admin, active, channel `needs_relink`,
last job failed), «عميل جديد» (no client, no channel, no usage). Ids
`00000000-0000-4000-8000-0000000000a1/a2/a3`; the same `demo-content.mjs`
vocabulary (no real people).

`reduceAccountDemo(state, action)` — pure, returns a new state, throws
`{ message, code }` objects the page maps with the same `S.*` it maps RPC errors
to:

| action | effect / refusal |
| --- | --- |
| `rename {w, name}` | sets the name; refuses `invalid_name` (empty after trim) |
| `retire {w}` | removes the workspace and its rows; refuses `last_workspace` when one would remain |
| `disconnect {w}` | removes the channel row and the client's connection (`channel` gone) |
| `connect {w}` | no state change; the page shows `S.demoExternalNote` (new) instead of leaving |
| `create {name}` | appends `{ id: next, name }` with no client / channel / usage |

The plan doors in demo: `upgrade` and `contact` are plain links (they work);
`manage` / `topup` show `S.demoExternalNote` in the press-feedback line instead
of calling Paddle. The selected workspace for `PlanPanel` is the first row
(`useWorkspaceSelection` is bypassed in demo).

New strings (both languages): `accountDemoLead` («نسخة توضيحية من صفحة الحساب:
مساحات عمل وخطة مثالية، والتغييرات تبقى في هذه الجلسة.» / "An illustrative
account page: example workspaces and a plan; changes stay in this session.")
and `demoExternalNote` («هذا الإجراء يفتح خدمة خارجية ولا يعمل في النسخة
التوضيحية.» / "This action opens an external service and does not run in the
illustrative copy."). Nothing else changes in copy; `dashDemoTag` is reused.

## Tests

- Unit: `accountDemo.test.ts` (fixture parses — `UsageSummarySchema` for every
  usage entry, `ChannelRow`/`JobRow` shapes; each action; each refusal; purity);
  `WorkspaceCard.test.tsx` (rename open/save payload, the consent step, the two
  dialogs' confirm ids, doors present per channel status); `PlanPanel.test.tsx`
  (meters per budget with `role=progressbar`, doors per `planPanelWords`,
  demo press → `demoExternalNote`); `AuthEntry` keeps `Account.entry.test.ts`
  green (same strings and attributes — the test file's imports move to
  `./account/…`); `Account.setup.test.ts` likewise.
- e2e `tests/e2e/account.spec.ts` (default project): `/account?demo=1` → h1,
  the demo eyebrow, 3 workspace cards, `account-plan-panel` with meters
  (`role=progressbar` count = the first workspace's budgets) and the `manage`
  + `topup` doors (paddle plan); rename the second workspace → name updates;
  disconnect the second → dialog → confirm → `channel-*` shows `S.noChannel`;
  retire the third → gone (2 cards); retire again until one remains →
  `S.retireLast`; create «مساحة رابعة» → a new card; press `topup` →
  `demoExternalNote`; 390px no horizontal overflow. The signed-out assertions in
  `app-shell.spec.ts` stay as they are (they still pass on `AuthEntry`).
- Guards: `noReportCss.test.ts` with no allow-list; `layers.test.ts` updated;
  `npm run check` green.

## Out of scope

Paddle flows themselves (sandbox rule stands); `PlanCard` in the rail; the
pricing page; auth providers' configuration; Google One Tap behaviour; the
dashboard's empty state beyond `SetupPath`'s restyle; phase 6 (the tour).

## As shipped

A few places where the build diverged from this design, worth recording
rather than treating as bugs:

- The story card renders a plain `ol.db-steps` (`AuthEntry.tsx`), not
  `SetupPath` — `SetupPath` needs per-step statuses the signed-out story
  never has. `Account.setup.test.ts` asserts `setupSteps.map(` there.
- `Unavailable` keeps the old page's four strings
  (`accountTryDashboardTitle`/`Lead`, `openDashboard`, plus the two this
  design called out), not two new ones.
- The fixture's second channel (`apps/web/public/fixtures/account.json`) is
  `reconnect_required`, not `needs_relink` — the real enum
  (`foundation.sql:22`). It has no disconnect door, so
  `tests/e2e/account.spec.ts` disconnects the **first** workspace, not the
  second.
- `reduceAccountDemo.disconnect` removes only the channel row; the client
  row stays, which is what keeps the connect door offered afterwards — not
  "the client's connection" as this design's demo-mode section put it.
- `app-shell.spec.ts` never renders `AuthEntry`: the e2e build carries no
  Supabase client, so `/account` there shows `Unavailable`, the same as the
  no-`?demo` case this file's own Tests section describes. `AuthEntry`'s
  only coverage is `Account.entry.test.ts`.
