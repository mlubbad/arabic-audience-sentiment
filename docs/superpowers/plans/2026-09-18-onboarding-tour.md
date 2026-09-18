# Onboarding Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A once-per-browser guided tour — a welcome dialog and seven anchored steps across `/account`, `/sync`, `/dashboard` — replayable from the rail and via `?tour=1`, lazy-loaded, browser-tested on the demo pages.

**Architecture:** `apps/web/src/tour/` holds the step list, the storage, the state machine (`useTour`), the layer (`Tour.tsx` = veil + Radix `Popover` on a virtual anchor), the welcome `Dialog`, the rail entry and a provider mounted once in `AppLayout`. Pages gain only `data-tour="…"` attributes.

**Tech Stack:** React 19, Radix Popover/Dialog via `ui/`, React Router `useNavigate`/`useLocation`, Vitest + `@testing-library/react`, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-onboarding-tour-design.md`

## Global Constraints

- **No page behaviour changes:** pages gain `data-tour` attributes only; every existing `data-testid` stays; no string changes beyond the 24 new keys named in the spec (exact `StringKey` names there).
- **Tokens only; no hex; no non-zero `letter-spacing`; no `rp-*`;** z-index: the veil at 58 (above the rail 55/menu 56, below dialog 60) and the card at 66 (above popover/select 65, below toast 70) — document both in `tour.css` beside the shell scale comment in `app.css`.
- **Lazy:** `Tour.tsx` + `TourWelcome.tsx` + `tour.css` load only when `status !== "idle"`; `main.tsx`'s eager bundle must not grow by more than the provider + entry + storage (check the build's `index-*.js` size before/after and report it).
- **Copy:** Arabic first, in the product's measured voice; each body ≤ 160 Arabic characters; English mirrors.
- **The other session's files** (`supabase/**`, `docs/oauth-*`, `apps/web/src/legal/*`, `.screenshots/`) untouched; stage by exact path and commit in ONE `git add … && git commit` step; never `npm run format` (scoped prettier on files you created is fine); NEVER push, never stash. Commit messages are sentences + blank line + `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. e2e in the FOREGROUND, 10-minute timeout; Playwright owns 5173, 5174 is not yours, 5175 for probes (kill after). Screenshots under `.superpowers/sdd/2026-09-18-onboarding-tour/shots/` only.

---

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/src/tour/tourSteps.ts` (+test) | `TOUR_VERSION`, `TourStep`, `TOUR_STEPS` (7), `stepsFor(width)` (phone swaps `rail`→`rail-menu`) |
| `apps/web/src/tour/tourState.ts` (+test) | `readTour`, `writeTour`, `clearTour`, `wantsTour(search)` |
| `apps/web/src/tour/useTour.ts` (+test) | the machine + navigation + anchor wait/skip |
| `apps/web/src/tour/TourProvider.tsx` | context; lazy mount of the layer; auto-start rule |
| `apps/web/src/tour/TourWelcome.tsx` | the welcome `Dialog` |
| `apps/web/src/tour/Tour.tsx` (+test) | veil + card |
| `apps/web/src/tour/TourEntry.tsx` (+test) | the rail button |
| `apps/web/src/tour/tour.css` | the layer's rules |
| `apps/web/src/strings/ar.ts`, `en.ts` | 24 keys |
| `apps/web/src/main.tsx`, `account/Account.tsx`, `account/WorkspaceCard.tsx`, `ops/Catalogue.tsx`, `ops/SelectionBar.tsx`, `dashboard/FilterBar.tsx`, `dashboard/SectionNav.tsx` | `data-tour` attributes; provider + entry in the rail |
| `tests/e2e/tour.spec.ts` | four tests |

---

### Task 1: steps, storage, strings

- [ ] `tourSteps.ts`: `export const TOUR_VERSION = 1; export type TourStepId = "rail" | "workspace" | "setup" | "catalogue" | "selection" | "filters" | "sections"; export type TourStep = { id: TourStepId; route: "/account" | "/sync" | "/dashboard" | null; anchor: string; placement: "top" | "bottom" | "start" | "end"; title: StringKey; body: StringKey }` (`route: null` = "the current page" for step 1); `TOUR_STEPS` in the spec's order; `stepsFor(phone: boolean)` returns the same list with step 1's `anchor` = `"rail-menu"` and `placement: "bottom"` when `phone`. Test: 7 steps, ids unique, every `title`/`body` key exists in `ar` and `en` (import the string objects), `stepsFor(true)[0].anchor === "rail-menu"`.
- [ ] `tourState.ts`: key `tour:v1` (derive from `TOUR_VERSION`); `readTour(): "seen" | "dismissed" | null` (anything else → null; storage access in `try/catch` → null); `writeTour(v)`; `clearTour()`; `wantsTour(search: string)` = `new URLSearchParams(search).has("tour")`. Test with `vi.stubGlobal("localStorage", …)` as `locale.test.ts` does.
- [ ] Strings (both files): the 24 keys — write the Arabic first (welcome title «جولة قصيرة في مشاعر الجمهور»; welcome body ≈ «ثلاث صفحات: الحساب لمساحات العمل وقنواتها، التشغيل لما يُجمع، ولوحة البيانات لما قاله الجمهور. الجولة أقل من دقيقة، وتُتخطّى في أي وقت.»; `tourStart` «ابدأ الجولة», `tourLater` «ليس الآن», `tourNext` «التالي», `tourBack` «السابق», `tourFinish` «إنهاء», `tourSkip` «تخطّي الجولة», `tourReplay` «الجولة التعريفية», `tourProgress: (n, total) => `${n} من ${total}``; step titles/bodies per the spec table — bodies ≤ 160 chars, one fact each, no pitch), then English mirrors. Commit: "The tour's steps, its memory in the browser, and its words".

### Task 2: `useTour` + `TourProvider` + `TourEntry` + anchors

- [ ] `useTour({ steps, navigate, location, phone })` → `{ status, index, step, anchorEl, start, next, back, skip, later }`. Rules: `start()` → `status="welcome"`; welcome's start → `running`, `index=0`; `next()` at the last index → `writeTour("seen")`, `status="done"` then `idle`; `skip()` → `seen`; `later()` → `dismissed`; `back()` decrements (min 0). When `step.route` differs from `location.pathname`, call `navigate({ pathname: step.route, search: keepDemo(location.search) })` where `keepDemo` keeps `demo` and drops `tour`. Anchor resolution: an effect on `[status, index, location.pathname]` polls `document.querySelector(`[data-tour="${step.anchor}"]`)` every animation frame up to 1500 ms; found → `anchorEl`; not found → `next()` (skip); if the last step is missing → end as `seen`. A `popstate` during `running` → `skip()`. Unit tests with a fake `navigate` and a jsdom DOM (insert/remove anchors with fake timers).
- [ ] `TourProvider` (`apps/web/src/tour/TourProvider.tsx`): `useTour` over `useNavigate`/`useLocation`/`useMediaQuery("(max-width: 900px)")` (reuse `ui/useMediaQuery`); auto-start effect: once per mount, if `(session || wantsDemo)` and `readTour() === null` and pathname ∈ the three pages → `start()`; if `wantsTour(search)` → `clearTour()` + `start()` (and the `tour` param is dropped on the first navigation). `const Layer = lazy(() => import("./Tour"))` rendered inside `<Suspense fallback={null}>` only when `status !== "idle"`. Exposes `useTourControls()` (`{ start }`). Props: `session`, `wantsDemo` come from `AppLayout`.
- [ ] `TourEntry.tsx`: `Button variant="ghost"` `data-testid="tour-replay"` `S.tourReplay`; `onClick` → `start()` + `onOpen?.()` (the provider passes nothing; `AppLayout` passes `() => setMenuOpen(false)`).
- [ ] Wire: `AppLayout` wraps its body in `<TourProvider session={session} wantsDemo={…}>` (compute `wantsDemo` from `search` the way pages do) and renders `<TourEntry onActivate={() => setMenuOpen(false)} />` in `.app-rail-foot` above `SessionControl`; `data-tour="rail"` on `<nav className="app-nav">`, `data-tour="rail-menu"` on `.app-menu`; `data-tour="workspace"` on the first `WorkspaceCard` `li` (pass a `tourAnchor?: string` prop from `Account.tsx` for index 0; when the list is empty put it on the `CreateWorkspace` card), `data-tour="setup"` on that card's `SetupPath` `ol` (pass through `SetupPath`'s props: add `tourAnchor?` → `data-tour`), `data-tour="catalogue"` on `Catalogue`'s section, `data-tour="selection"` on `SelectionBar`'s card, `data-tour="filters"` on `.db-filterbar`, `data-tour="sections"` on `section-nav`. No other page change. Typecheck + unit + `app-shell.spec.ts`. Commit: "The tour's machine, its provider in the shell, its rail entry, and the anchors on the pages".

### Task 3: `Tour.tsx` + `TourWelcome.tsx` + `tour.css`

- [ ] `TourWelcome` on `ui/Dialog` (`DialogContent closeLabel={S.tourLater}`, `DialogTitle` `S.tourWelcomeTitle`, `DialogDescription` `S.tourWelcomeBody`, `Button data-testid="tour-start"`, `Button variant="ghost" data-testid="tour-later"`; `onOpenChange(false)` → `later()`).
- [ ] `Tour` (default export of `Tour.tsx` so `lazy()` works; it renders `TourWelcome` when `status==="welcome"` and the layer when `running`): `TourVeil` — `div.tour-veil` fixed inset 0, `pointer-events: none`, z 58, containing `div.tour-hole` positioned at `anchorEl.getBoundingClientRect()` inflated by 8px (`position: fixed`, `box-shadow: 0 0 0 200vmax var(--tour-veil)`, `border-radius: var(--radius-md)`), updated on `scroll`/`resize` (passive listeners + `ResizeObserver` on the anchor); the anchor gets `data-tour-active=""` while lit, removed on change/unmount; `scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" })` on anchor change. Card — `<Popover open modal={false}><PopoverPrimitive.Anchor virtualRef={{ current: anchorEl }} /><PopoverContent side={…} align="center" collisionPadding={16} onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={skip} role="dialog" aria-labelledby aria-describedby data-testid="tour-card" className="tour-card">` with `Badge data-testid="tour-progress"` `S.tourProgress(index+1, total)`, `h2#tour-title`, `p#tour-body`, a `.db-actions` row: `Button variant="ghost" data-testid="tour-back"` (only when `index > 0`), `Button data-testid="tour-next"` (`S.tourNext` / `S.tourFinish` on the last), `Button variant="link" data-testid="tour-skip"`. `PopoverContent` from `ui/Popover` — if it lacks `Anchor`, export `PopoverAnchor = PopoverPrimitive.Anchor` from `ui/Popover.tsx`. Placement map: `start`/`end` → Radix `side` `"left"/"right"` flipped for RTL (read `document.dir`), `top`/`bottom` as is; phone → `bottom`.
- [ ] `tour.css` on tokens: `--tour-veil: color-mix(in srgb, var(--ink-1, #000) 55%, transparent)` — NO: no hex; use an existing overlay token (grep `ui.css` for the dialog overlay colour and reuse that token); the card `max-width: 360px` (`calc(100vw - 32px)` on phone), `padding: var(--space-4)`, glass level-2 tokens as `ui-popover-content` already has; `[data-tour-active] { outline: 2px solid var(--ml-indigo); outline-offset: 4px; position: relative; z-index: 59 }`; `@media (prefers-reduced-motion: reduce)` disables the veil transition.
- [ ] `Tour.test.tsx` (testing-library): with a fake machine — welcome renders the dialog with both buttons; running renders the card with `1 من 7`, no back on step 1, «إنهاء» on the last; the hole's inline `top/left/width/height` follows a stubbed `getBoundingClientRect`; `data-tour-active` set on the anchor and removed on unmount; Escape calls `skip`. Probe on 5175: `/dashboard?demo=1&tour=1` → welcome → start → step 1 lit on the rail → next → `/account?demo=1` step 2 …; screenshots `tour-welcome-1280.png`, `tour-step1-1280.png`, `tour-step4-1280.png`, `tour-step1-390.png` → `shots/`; look at them. Commit: "The tour's layer: a veil with a lit hole, a card beside it, and the welcome".

### Task 4: `tests/e2e/tour.spec.ts` + records

- [ ] The four tests from the spec's Testing section (each its own `page.goto`; assert URL + `getByTestId("tour-progress")` text + `page.locator("[data-tour-active]")` has the expected `data-tour` value at each step; `localStorage` read via `page.evaluate`). Run the suite, then the FULL e2e (expect 123 + 4) and `test:e2e:build`.
- [ ] `npm run check` green (report tallies). Append `docs/progress.md`, `docs/decisions.md` (browser-side memory; lazy layer; anchors as `data-tour` not test ids; skip-on-missing-anchor), `docs/coordination/ACTIVE.md` (phase 6 closed — the eight-phase redesign complete), `docs/verification.md` (only if `git status --short docs/verification.md` is empty). Commit: "The tour has a browser suite, and the eight-phase redesign is recorded complete".

## Self-review
Spec coverage: structure (T1–T3), steps/words (T1), behaviour (T2, T3), phone (T1 `stepsFor`, T3 placement), testing (T1–T4), records (T4). Interfaces: `useTour` return shape (T2) consumed by T3's `Tour`/`TourWelcome` via context; `stepsFor`/`TourStep` (T1) consumed by T2; `data-tour` anchor names (T2) match `TOUR_STEPS` (T1) — the T1 test can't check the DOM, so T4's e2e is the check.
