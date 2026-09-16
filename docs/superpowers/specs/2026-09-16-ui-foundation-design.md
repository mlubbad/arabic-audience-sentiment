# UI foundation — a headless component layer (design)

2026-09-16. Approved in conversation; this is the written form. First of an eight-part
UI/UX overhaul the user asked for before production launch: this piece, then the app
shell, the landing page, the dashboard, the operations/admin panels, account and billing,
and last an in-app onboarding tour. Each later piece is its own design; this file covers
only the foundation they will all sit on.

## What changes and why

The app has no component library. Every interactive element — buttons, cards, the one
tablist (`PricingPage.tsx`'s individual/business toggle) — is hand-written per page across
five CSS files (`app.css` 1728 lines, `landing.css` 1639, `report.css` 1316, `style.css`
404, `glass.css` 196) plus `brand.css`. There is no dialog, dropdown, popover, select,
tabs-with-panels, toast, or tooltip anywhere in `apps/web/src` today — confirmed by grep,
not assumed. Every later phase of the overhaul needs at least one of these (a confirm
dialog on the admin page, a plan picker, a toast on save, tour tooltips in the last phase),
and building each by hand, per page, is how this codebase's own retrospective names its
dominant bug: "one meaning with two implementations" (`docs/coordination/ACTIVE.md`) — six
prior instances, none caught by a test, all found by noticing the shape.

`brand.css` is not what "no component library" usually means here, though. It is a
measured token system: WCAG contrast and CVD (colour-vision-deficiency) simulation back
every colour decision (`palette.ts`, `scripts/validate-palette.mjs`), two type families are
split by job (Arabic body vs. tabular numerals), and every token carries a comment saying
why it has the value it has. That work stays the single source of truth. The gap this
phase closes is interaction, not colour: focus trapping, roving tabindex, `Escape`-to-close,
arrow-key navigation, RTL-aware positioning — the parts a hand-rolled `<div>` gets wrong in
ways that don't show up until a keyboard or screen-reader user hits them.

## Approach

**Radix UI primitives (unstyled), styled against the existing `brand.css` custom
properties. No `shadcn` CLI scaffold.** Radix's packages (`@radix-ui/react-dialog`,
`-dropdown-menu`, `-popover`, `-tabs`, `-tooltip`, `-select`, `-toast`, `-checkbox`,
`-switch`, `-radio-group`, `-slot`) give WAI-ARIA-correct behaviour and ship no visual
opinion, so every className is one this project writes, referencing `--bg-card`,
`--text-1`, `--radius-2`, `--shadow-2`, and the rest of `brand.css` — no second token
system, no HSL variables shadcn's generator would otherwise introduce alongside the
measured palette.

Two alternatives considered:

- **`shadcn` CLI, as literally suggested.** Its generator writes components against its own
  token names (`--background`, `--primary`, `--ring`, ...) and its own Tailwind
  conventions, meaning either a parallel palette (the "two implementations" bug, on day
  one of fixing it) or a rewrite of every generated file before first use. Since the value
  the user actually asked for — Radix's interaction correctness, one place per component —
  is available without the generator, this option is dropped in favour of using Radix
  directly, which is what was said back to the user and not disputed.
- **Hand-write each primitive with no headless library.** Consistent with the codebase's
  from-scratch style, but re-derives focus-trap, roving tabindex and RTL-aware
  positioning per component — exactly the work Radix has already done and tests. Rejected:
  more code, the same bug shape ("we wrote our own dialog again") one level down.

## Components in scope (first wave)

Button, Input, Textarea, Select, Checkbox, Switch, Dialog, DropdownMenu, Popover, Tooltip,
Tabs, Toast, Card, Table (a styling wrapper — sorting/filtering is a later phase's concern
if a page needs it), Badge, Skeleton. Each lives at `apps/web/src/ui/<Name>.tsx`.

Deferred, added only when a phase that needs one starts: Combobox, DatePicker, a sortable
DataTable, Slider, Accordion. Pulling these in now with nothing to render them would be
building ahead of a need this project's own conventions warn against.

Two small additions the components need and the project doesn't have yet: `clsx` +
`tailwind-merge` behind one `cn()` helper (`apps/web/src/ui/cn.ts`), and
`class-variance-authority` for the handful of components with real variants (Button:
primary/secondary/ghost/danger × sm/md/lg; Badge: the four sentiment tones). Not applied
to components without variants — a `Card` does not need `cva` to have one shape.

## RTL and the two invariants this must not break

The app is Arabic-default, English-opt-in, direction switched at the document root via
`direction(locale)` (`locale.ts`). Radix's `DirectionProvider` wraps the app root in
`main.tsx` alongside the existing locale plumbing, so `Dialog`, `DropdownMenu`, `Popover`,
`Select` and `Tabs` all flip arrow-key direction and menu-open side automatically; this is
verified per component in Testing below rather than assumed from Radix's docs, because two
of this codebase's six recorded "one meaning, two implementations" bugs were exactly this
kind of assumption going unverified.

Two rules from `docs/coordination/ACTIVE.md`'s invariants carry over unchanged, because a
new component layer is precisely where they get lost by accident:

- **No new sentiment colour.** `Badge`'s sentiment variant reads `--sentiment-positive`
  `-negative` `-neutral` `-mixed` from `brand.css`. It does not define its own.
- **`letter-spacing: 0` on Arabic text is load-bearing**, not a style default. None of these
  components sets `letter-spacing` on text; any component that renders a numeral (a `Badge`
  count, a `Toast` with a figure) sets `font-family: var(--font-numeric)` on that span, the
  same split `brand.css` already documents. `dashboard.spec.ts`'s "no Arabic label is
  letter-spaced" check only runs signed-out pages today — Testing below adds the same
  assertion for the new components directly, so it isn't relying on that test's current
  blind spot.

All new UI strings (a `Toast`'s default label, a `Dialog`'s close-button `aria-label`) go
into `strings/ar.ts` with the typed English twin in `strings/en.ts`, per the existing rule
that `tsc` enforces — not a new rule for this phase, the standing one.

## Rollout: additive, proven once, not a big-bang swap

Nothing in `app.css`, `landing.css`, `report.css`, `style.css` or `glass.css` is deleted or
edited in this phase. The new components are added; nothing existing is migrated onto them
yet — that happens inside each later phase, as that phase's pages are touched. This phase
ends with one real usage, not zero: `AdminPage.tsx`'s `WorkspaceRow` has two bare
`<select>` elements today (plan choice, pack kind) with no keyboard-tested behaviour beyond
what the browser gives a native select for free. One of them — the plan `<select>` — moves
onto the new `Select`, so the library is proven inside a real form, in a real mutation flow
(`set_workspace_plan`), before four more phases build on it. The pack-kind `<select>` and
every other page's controls stay native until their own phase.

## Testing

- Per interactive primitive (`Dialog`, `DropdownMenu`, `Popover`, `Tabs`, `Select`): a
  Vitest + Testing Library case for focus entering on open and returning to the trigger on
  close, `Escape` closing it, and — under `dir="rtl"` — arrow keys moving the direction RTL
  implies, not LTR's default. This is what "Radix handles it" is being checked against,
  since assuming it is the failure mode this file names above.
- A component-level assertion (not a new suite; extend `dashboard.spec.ts`'s existing
  pattern) that no rendered node under `apps/web/src/ui/` carries a non-zero
  `letter-spacing` while its text content is Arabic.
- `scripts/validate-palette.mjs` gains no new colours in this phase (none are introduced),
  so no change there; a later phase that adds one (a new focus ring shade, say) runs it
  against that value before merging, per the existing convention.
- After the `AdminPage.tsx` `Select` swap lands, an `accesslint` audit pass against the
  running admin page — this phase's actual accessibility check, not a lint rule taken on
  faith.

## Out of scope here

The app shell/navigation redesign, every page's visual redesign, and the onboarding tour
are separate, later phases with their own designs. This phase does not touch
`Dashboard.tsx`, `Landing.tsx`, `Sync.tsx`, `Account.tsx`, `PricingPage.tsx`,
`SetupPath.tsx`, or any CSS file, beyond the one `AdminPage.tsx` `Select` swap named above.
`apps/web/src/legal/**` is unrelated, already-uncommitted work in this checkout from
outside this task; nothing here reads or touches it.
