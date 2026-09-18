# The in-app onboarding tour (design)

2026-09-18. Phase 6, the last of the pre-launch UI/UX redesign: a short guided tour a
new reader meets once after signing in, that walks the three signed-in pages and the
rail, and that can be replayed from the rail at any time. Built on `ui/` and `pages.css`,
lazy-loaded, driven by the same `?demo=1` pages the browser suites already use — so the
tour itself is browser-tested end to end without a session.

## Decisions taken in conversation

- **Where "seen" lives: the browser.** `localStorage` key `tour:v1`, beside the
  language and workspace-selection preferences. No migration, no RPC. The tour appears
  once per browser; the rail's «الجولة التعريفية» entry and `?tour=1` replay it.
- **Shape: a welcome dialog, then coach-marks.** One `ui/Dialog` («ابدأ الجولة» /
  «ليس الآن»), then seven anchored steps — a veil over the page with a lit hole around
  the real element and a `Popover` card beside it — across `/account`, `/sync` and
  `/dashboard`.

## What exists

`AppLayout` in `apps/web/src/main.tsx` renders the header, the rail (`#app-rail`, a
sheet under 900px opened by `.app-menu`), the routes and the footer; `useSession()`
gives `session`; each page computes `wantsDemo` from `?demo`. The rail has
`data-testid="rail-workspace"` (the workspace switch) and the nav `aria-label
S.navLabel`. Pages expose `data-testid="section-nav"`, `.db-filterbar`, `catalogue`,
`cat-save`, `sync-panel`, `account-plan-panel`, and the workspace cards. `ui/Popover`
wraps Radix (`Popover`, `PopoverTrigger`, `PopoverContent`); Radix's `Popover.Anchor`
accepts a `virtualRef`, which the tour uses to anchor a card to any rectangle. No
onboarding code exists.

## Structure — `apps/web/src/tour/`

| File | Responsibility |
| --- | --- |
| `tourSteps.ts` | the ordered step list: `{ id, route, anchor, placement, title: StringKey, body: StringKey }`; `TOUR_VERSION = 1` |
| `tourState.ts` | `readTour()` / `writeTour(v)` over `localStorage` (`"seen" \| "dismissed" \| null`, versioned: a different `TOUR_VERSION` reads as `null`); `wantsTour()` from `?tour=1` |
| `useTour.ts` | the machine: `status: "idle" \| "welcome" \| "running" \| "done"`, `index`, `start()`, `next()`, `back()`, `skip()`; navigates with `useNavigate` when the next step's `route` differs from the current one (preserving `?demo=1`); resolves the anchor after navigation with a short `MutationObserver`/`requestAnimationFrame` wait (≤ 1.5 s) and **skips a step whose anchor never appears** |
| `TourWelcome.tsx` | the `ui/Dialog`: title, three-line body, `Button` start (`data-testid="tour-start"`), `Button ghost` later (`tour-later`) |
| `Tour.tsx` | the running layer: `TourVeil` (fixed, `pointer-events: none`, a hole at the anchor's rect via `box-shadow: 0 0 0 200vmax var(--tour-veil)`, 8px padding, `--radius-md`), the card on `Popover open modal={false}` + `Popover.Anchor virtualRef` + `PopoverContent` (`role="dialog"`, `aria-labelledby` the title, `aria-describedby` the body, `onInteractOutside` prevented, `onEscapeKeyDown → skip`, `data-testid="tour-card"`), with `Badge` «N من 7» (`tour-progress`), `h2` title, `p` body, buttons `tour-back` (hidden on step 1), `tour-next` («التالي» / «إنهاء» on the last step), `tour-skip` (link variant); the anchor gets `data-tour-active` while lit and is scrolled into view (`scrollIntoView({ block: "center" })`, instant under `prefers-reduced-motion`) |
| `TourEntry.tsx` | the rail button «الجولة التعريفية» (`data-testid="tour-replay"`, `Button variant="ghost"`) rendered in `.app-rail-foot` above `SessionControl`; calls `start()` and closes the phone sheet |
| `tour.css` | the veil, the hole, the card layout, the `[data-tour-active]` outline (`--ml-indigo`, 2px, offset 4px), reduced-motion |
| `TourProvider.tsx` | context holding `useTour()`, mounted once in `AppLayout`; exposes `useTourControls()` for `TourEntry` |

The tour chunk (`Tour.tsx`, `TourWelcome.tsx`, `tour.css`) is `lazy()`-loaded from
`TourProvider` only when `status !== "idle"`; `TourEntry` and `tourState.ts` are tiny
and eager.

Anchors are `data-tour="<id>"` attributes on existing elements (no markup otherwise
changes): `rail` on `#app-rail`'s nav (`<nav className="app-nav">`), `rail-menu` on
`.app-menu`, `workspace` on the first workspace card's `li` in `account/Account.tsx`
(and the create card when there is none), `setup` on the first card's `SetupPath` `ol`,
`catalogue` on `ops/Catalogue.tsx`'s section, `selection` on `SelectionBar`'s card,
`filters` on `.db-filterbar`, `sections` on `section-nav`.

## The steps

| # | route | anchor | title / body (ar) |
| --- | --- | --- | --- |
| welcome | — | — | «جولة قصيرة في مشاعر الجمهور» / three sentences: what the three pages do; ~40 seconds; skip any time |
| 1 | current | `rail` (≥900px) or `rail-menu` (phone) | «التنقّل» / the three destinations and the workspace switch |
| 2 | `/account` | `workspace` | «مساحة العمل» / one per channel or client; rename, connect, retire here |
| 3 | `/account` | `setup` | «خطوات الإعداد» / the three steps and where each leads |
| 4 | `/sync` | `catalogue` | «الكتالوج» / choose what is collected; the estimate before saving |
| 5 | `/sync` | `selection` | «الحفظ» / nothing is collected until saved; the plan's remaining figure |
| 6 | `/dashboard` | `filters` | «الفلاتر» / every figure below follows them |
| 7 | `/dashboard` | `sections` | «الأقسام» / jump between sections; «انتهت الجولة — تجدها في الشريط الجانبي» |

Body texts are three lines at most (≤ 160 Arabic characters), written in the product's
voice (`docs/` copy rules: measured, no pitch), in both languages. Strings: `tourWelcomeTitle`,
`tourWelcomeBody`, `tourStart`, `tourLater`, `tourNext`, `tourBack`, `tourFinish`,
`tourSkip`, `tourProgress(n, total)`, `tourReplay`, `tourStep<Id>Title` ×7,
`tourStep<Id>Body` ×7 — 24 keys, nothing existing changes.

## Behaviour

- **Auto-start.** On the first render of `AppLayout` where `(session || wantsDemo)`
  and `readTour() === null` and the route is one of the three pages: `status = "welcome"`.
  «ليس الآن» → `writeTour("dismissed")`, never auto-again. Finishing or skipping →
  `writeTour("seen")`.
- **Replay.** `TourEntry` and `?tour=1` → `start()` regardless of storage (the query
  form also clears the flag so a support link «افتح مع الجولة» works on a browser that
  dismissed it).
- **Navigation.** Steps 2–7 change routes; `useTour` calls `navigate(route + search)`
  keeping `?demo=1` (and dropping `tour=1` after the first use). The layer survives
  route changes because it lives in `AppLayout`. Browser back during a tour ends it
  (`skip()`), so a stale hole never sits over the wrong page.
- **Missing anchor.** After navigation the step waits ≤ 1.5 s for its anchor; if it is
  not in the DOM (an empty dashboard, a signed-in account with no workspace), the step
  is skipped forward; if every remaining step is skipped, the tour ends as `seen`.
- **Phone (< 900px).** Step 1 anchors the menu button; steps 2–7 are unchanged (their
  anchors are in the page). The card's placement falls back to `bottom` and the card
  is `calc(100vw - 32px)` wide.
- **Keyboard.** Focus moves into the card on each step (Radix does this); `Tab` cycles
  within it (`FocusScope` trapped — `modal={false}` keeps the page scrollable, the trap
  is `trapped`); `Escape` skips; `Enter` on the focused button acts. The lit element
  itself is not focusable through the veil (the veil ignores pointer events only for
  itself; the hole is visual).
- **Reduced motion.** No veil fade, no scroll animation.

## Testing

- Unit: `tourState.test.ts` (versioning, null on a foreign version, `wantsTour`);
  `useTour.test.tsx` (welcome → running → done; `next` at the last step ends as
  `seen`; `skip` → `seen`; `later` → `dismissed`; route change requested when the
  next step's route differs; a missing anchor is skipped after the wait); `Tour.test.tsx`
  (card roles/labels, the progress badge, back hidden on step 1, «إنهاء» on the last,
  the veil hole tracks the anchor rect); `TourEntry` renders and starts.
- e2e `tests/e2e/tour.spec.ts` (default project): `/dashboard?demo=1&tour=1` → welcome
  dialog → start → step 1 on the rail (`tour-card` visible, `tour-progress` «1 من 7»)
  → next through `/account?demo=1` (steps 2–3), `/sync?demo=1` (4–5), back to the
  dashboard (6–7) — asserting the URL and the lit anchor (`[data-tour-active]` test id)
  at each — → finish → `localStorage.tour:v1 === "seen"` → reload `/dashboard?demo=1`
  → no welcome → `tour-replay` in the rail → welcome again; a second test: `tour-later`
  → `dismissed` → no welcome on reload; a third at 390×844: step 1 anchors `rail-menu`,
  the card fits (`boundingBox().width ≤ 358`), no horizontal overflow; a fourth:
  `Escape` on step 3 → `seen`, no card.
- Guards: `noReportCss`/`layers` unchanged in spirit — `tour.css` is tokens only;
  `npm run check` green.

## Out of scope

A tour of `/admin`; persistent contextual hints; analytics on tour completion; a
server-side «seen» flag (revisit if per-account behaviour is ever needed); the landing
page.
