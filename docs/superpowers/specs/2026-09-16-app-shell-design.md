# App shell — the rail's interactive pieces, rebuilt on ui/ (design)

2026-09-16. Approved in conversation; this is the written form. Second of the eight-part UI/UX
overhaul, following [2026-09-16-ui-foundation-design.md](2026-09-16-ui-foundation-design.md). That
phase built the component layer and proved it once, inside `AdminPage.tsx`. This phase is the
layer's second prover and the app shell's own polish pass: the two hand-rolled interactive
controls in `AppLayout` (`main.tsx`) and `RailState.tsx` move onto `ui/`, and the mobile menu's
focus behaviour is verified rather than assumed.

## What changes and why

The rail (`AppLayout` in `apps/web/src/main.tsx`) is a considered, documented decision — "a rail,
not a bar," carrying workspace identity and plan state that a top bar had nowhere to put — and
this phase does not revisit that call. What it does revisit is two controls inside the rail that
predate `ui/` and show it:

- **`SessionControl`** (`main.tsx`) is a bare `<Link>` when signed out and a `<span>` + `<button>`
  when signed in — no menu, just the two states side by side. A signed-in reader gets one action
  (sign out) with no room for a second (an account link) without the same ad hoc markup being
  written again.
- **`WorkspaceSwitch`** (`RailState.tsx`) is a native `<select>` when a reader has more than one
  workspace — unstyled against the rail's dark plane, and the second native `<select>` in this
  app after `AdminPage.tsx`'s, which Phase 0 already replaced.

Neither is broken. Both are the kind of hand-written control Phase 0's own retrospective names as
the shape to watch for: a second, ad hoc implementation of something `ui/` now has a tested,
`brand.css`-sourced, RTL-verified answer for.

## Approach

Swap `SessionControl`'s signed-in state onto `ui/DropdownMenu` (trigger: the reader's email;
items: an account link, sign out) and `WorkspaceSwitch`'s multi-workspace branch onto `ui/Select`
— the same component `AdminPage.tsx` already proved, now proving it a second time in a different
context (a dark rail plane instead of a light card), which is real evidence the component travels.

Considered and rejected: rebuilding the rail itself (a top bar, a collapsible sidebar, icon-only
mode). None of that was asked for, the current rail's rationale is sound and still holds, and
Phase 0's spec named this exact restraint — "no unrelated refactoring, stay focused on what serves
the current goal."

## Changes

**`SessionControl` — moves out of `main.tsx` into its own `apps/web/src/SessionControl.tsx`.**
`main.tsx` is a side-effecting entry point (it calls `createRoot(...).render(...)` at module load),
which is why nothing in this repo has ever imported it in a test and why `RailState.tsx` already
lives apart from it. A component test for the new menu needs the component importable on its own;
extracting it is the same move the rail's own state already made, for the same reason. Behaviour:
signed out, unchanged (`<Link to="/account">`). Signed in: `DropdownMenu` (Phase 0's Task-11
primitive) whose trigger is the reader's email (or `S.yourAccount` if the provider gave none —
today's fallback, kept), with two items — `S.railAccountLink` (new string, both languages) linking
to `/account`, and the existing sign-out action, still guarded by the same `busy`/`failed` state
and the same `role="alert"` failure message. The trigger keeps the rail's own ink: it renders
`asChild` over the existing `.app-session-who`-styled element, not as a `ui-btn` — a light button
box on the dark rail plane would be the one thing on that plane not measured by `rail.test.ts`,
and would look like it. Only the dropped-down menu (which portals to `body`) wears `ui/`'s light
panel styling, where it belongs.

**`WorkspaceSwitch` (`RailState.tsx`)** — the `options.length > 1` branch's native `<select>`
becomes `ui/Select`, reading the same `place`/`options`/`setChosen` this function already computes
— no change to `workspaceState`, `useWorkspaceSelection`, or the single-workspace `<strong>`
fallback. `aria-label={S.changeWorkspace}` moves from the native element to `SelectTrigger`, same
string, same meaning (Radix's trigger is a `button`, not a form control a wrapping `<label>` would
associate with — the same reasoning Phase 0's `AdminPage.tsx` swap already established). The
"choose" state's empty `<option value="">` placeholder becomes `SelectValue`'s `placeholder` prop,
showing the same `S.choosePlaceholder` string. Same dark-plane rule as the session trigger: the
`SelectTrigger` on the rail keeps rail ink, not a light `ui-select-trigger` box — the plan decides
whether by a rail-scoped override or a `className` pass-through, but the listbox itself (portaled)
wears `ui/`'s light styling.

**Mobile menu focus (`AppLayout`, `main.tsx`)** — unchanged behaviour, newly verified: opening the
rail on a narrow viewport should move focus into it, and closing it (via a destination link, or the
menu button itself) should return focus to the toggle. This is already the kind of thing Phase 0
found un-verified defaults break silently; this phase adds the e2e assertion, not new behaviour.

## Out of scope

`DESTINATIONS`, `NavIcon`, the announcement bar, `LanguageSwitch`, `CollectionState`/plan-panel
state, and the rail's own structure and CSS classes (`.app-rail`, `.app-nav`, …) are untouched.
Tooltips on nav items were pitched and dropped — nothing in the current rail is icon-only or
under-labelled enough to need one; adding them now would be building ahead of a need, which is
exactly what Phase 0's "deferred, added only when a phase that needs one starts" component list
already warns against for the primitives themselves, and applies the same way to using one.

## Testing

- `SessionControl`'s new `DropdownMenu`: a jsdom component test (`SessionControl.test.tsx`,
  Phase 0's convention) covering: closed until the email trigger is activated, the account item
  linking to `/account`, and sign-out still calling the same `supabase.auth.signOut()` path with
  the same busy/failed states — `./session` and `./supabase` mocked the way `RailState.test.ts`
  already mocks `./session`.
- `WorkspaceSwitch`'s `ui/Select` swap **breaks two existing assertions, on purpose, and they
  must move, not be deleted.** `RailState.test.ts` renders with `renderToStaticMarkup` and asserts
  raw HTML — `<option value="…" selected="">` for the chosen workspace, and
  `<option value="" selected="">` for the placeholder. Radix `Select` renders neither: the
  listbox is portaled and mounted only when open, and `SelectValue` resolves the chosen item's text
  from items that register on mount — which never happens under static server rendering, so a
  static render shows an empty trigger. Those two workspace cases move to a new jsdom
  `RailState.test.tsx` (same mocks, real `render`/`userEvent`), asserting the trigger shows the
  chosen name (or the placeholder), and that picking an option calls `setChosen` with that
  workspace's id — the same shape as `AdminPage.test.tsx`. The single-workspace `<strong>` case,
  the "only one switch" source scan, and every `CollectionState` case stay in the static file
  untouched — nothing about them changes.
- Mobile menu focus: one Playwright assertion in `tests/e2e/app-shell.spec.ts` (already the home
  for this file's shell-level tests, per Phase 0's Task 17) — narrow viewport, open the menu,
  assert focus moved into `#app-rail`, close it, assert focus returned to the toggle button.
