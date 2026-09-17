# The dashboard rebuilt on the design system (design)

2026-09-17. Phase 3 of the pre-launch UI roadmap (phase 0 `2026-09-16-ui-foundation-design.md`,
phase 1 `2026-09-16-app-shell-design.md`, phase 2 `2026-09-17-landing-redesign-design.md`).
Approved in conversation; this is the written form.

## What changes and why

`/dashboard` is the product. `apps/web/src/Dashboard.tsx` is 2,238 lines: one component holding
twenty-six pieces of state, five charts, four tables, 21 hand-written `<button>`s and 11 native
`<select>`s, a review "dialog" that is a `<form>` overlay with its own focus and Escape code,
and eight sections stacked on a page ~6,000 px tall under an eleven-field filter form that
opens above everything. Its stylesheet, `report.css` (1,316 lines, 62 `font-size`
declarations across 21 distinct values), is shared with `/sync`'s catalogue and operations
panels. Nothing on the page uses `ui/`.

What is right about it stays: the sections, their order and their ids (the e2e suite —
`tests/e2e/dashboard.spec.ts`, 76 tests — reads them by `data-testid` and by label), the
arithmetic in `data.ts` / `analytics.ts`, the Chart.js charts with their `ChartFigures` table
fallbacks, the honesty of every empty and partial state.

Decisions taken in conversation:

1. **Same structure, visual rebuild.** One page, eight sections in the same order, the same
   `data-testid`s and label texts; every control moves onto `ui/`; the filter form becomes a
   compact sticky bar; real loading, empty and mobile states.
2. **The filter bar is sticky and compact:** four controls visible (search, video, sentiment,
   period), the other six behind «المزيد», the applied filters as removable chips beneath.

## Structure

```
apps/web/src/dashboard/
  Dashboard.tsx          composition; owns the shared state and the queries (moved, not rewritten)
  filters.ts             the filter state's types, defaults, `applied(filters)` → chips, `countExtra()`
  FilterBar.tsx / filter-bar.css / FilterBar.test.tsx
  ActiveFilters.tsx      the chip row (data-testid="active-filters" kept)
  Hero.tsx / hero.css
  SectionNav.tsx / section-nav.css / SectionNav.test.tsx
  Provenance.tsx / provenance.css
  Summary.tsx / summary.css
  Videos.tsx / videos.css
  Voice.tsx / voice.css
  Timing.tsx / timing.css
  People.tsx / people.css
  Compare.tsx / compare.css
  Engaged.tsx / engaged.css
  Comments.tsx / comments.css        cards + tabs + export + table + pager
  CommentsTable.tsx                  the ui/Table body (and its ≤760px card form)
  ReviewDialog.tsx / ReviewDialog.test.tsx
  EmptyState.tsx / EmptyState.test.tsx
  chartOptions.ts                    one place for axes, grid, font, tooltip options
  dashboard.css                      the page's shared rules: section rhythm, headings, grids
apps/web/src/Dashboard.tsx           one-line re-export until main.tsx's import moves, then deleted
apps/web/src/report.css              stays — /sync, CataloguePanel, OperationsPanels import it;
                                     the dashboard stops importing it; phase 4 retires it
apps/web/src/ui/Skeleton.tsx         exists; used
```

Each section is a component `({ snapshot, S, … })` taking only what it renders — the props are
named in the plan, task by task — and each imports its own CSS. `Dashboard.tsx` keeps the
`useState`s, the `useQuery(["dashboard-source", …])`, the review/export mutations, the
`useActiveSection` scrollspy and `resolveMode`; nothing in `data.ts`, `analytics.ts`,
`dataSource.ts`, `videoPaging.ts`, `setup.ts` changes.

**No element is styled by `report.css` and a `dashboard/*.css` file at once:** the dashboard
imports none of `report.css`; the rules it needs are rewritten under `dashboard/`. Class names
that `report.css` also defines (`rp-hero`, `rp-nav`, …) are not reused — the new page uses
`db-*` classes — except where an e2e test reads a class (`.rp-hero`, `#rp-videos` and the
section ids): those exact ids and the three classes the suite names are kept on the new
elements.

## The filter bar

- `<div class="db-filterbar">` is `position: sticky; top: 0` inside `.app-main` (the shell's
  scroll container; verified in the plan's first task — if `.app-main` clips, the bar sticks
  to the element that scrolls). Level-2 glass, one row at ≥ 900 px:
  search (`ui/Input`, `aria-label` = the current label text «البحث في التعليقات والمؤلفين»),
  video (`ui/Select`, labelled «الفيديو»), sentiment (`ui/Select`, «المشاعر»), period
  (`ui/Popover` from a `Button variant="secondary"` that reads the current range; inside:
  date mode `Select` «التاريخ», from `Input type="date"` «من تاريخ», to «إلى تاريخ (غير
  شامل)»), then «المزيد (n)» — a `Popover` holding topic «الموضوع» (conditional, as today),
  video kind, participation «نوع المشاركة», comment type «نوع التعليق», review status, per
  page «عدد التعليقات في الصفحة» — and «تطبيق» (`Button`, `type="submit"`) / «إعادة ضبط»
  (`ghost`). The whole bar is one `<form id="report-filters">` (the suite finds it by role);
  every control keeps its current `<label>` text so `getByLabel` resolves, on `ui/Select` via
  `<label htmlFor>` the trigger button (a labelable element) — verified in `FilterBar.test`.
- `ActiveFilters`: under the bar, `data-testid="active-filters"`, one `Badge` per applied
  filter with a × `Button variant="ghost" size="sm"` that clears just that one; the wording of
  each chip is the current one (`filters.ts` moves that code).
- `formError` renders in the bar as today (`role="alert"`).
- Below 900 px the bar collapses to «الفلاتر (n)» (`Button`, n = applied count) which opens
  `ui/Dialog variant="sheet"` with the same form stacked; «تطبيق» closes the sheet.
- The URL is not involved (it is not today); state stays in `Dashboard.tsx`.

## Sections

Shared, in `dashboard.css`: `.db-section { padding-block: var(--space-7) }`, `.db-section >
h2` on `--fs-h2`, a lead `<p>` on `--text-2`, `.db-grid { display:grid; grid-template-columns:
repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-4) }`. Cards are `ui/Card`; numbers use
`.ui-num`; sentiment marks read `--sentiment-*` only (legend swatches keep their inline
`style={{ background: var(--sentiment-${key}) }}`).

1. **Hero** (`.rp-hero` kept, `db-hero`): eyebrow (`Badge tone="neutral"`, «نظرة عامة ·
   معاينة تجريبية» in fixture mode — that phrase names the visitor's fixture data and stays),
   `<h1>`, the reading line, the pills as `Badge`s, the sentiment headline row as four
   `Badge`s with the sentiment tone.
2. **SectionNav** (`.rp-nav` kept): a horizontally scrollable row of links styled like
   `ui/Tabs` triggers, `aria-current="true"` from `useActiveSection`; on narrow screens it
   scrolls, never wraps.
3. **Provenance** (`data-testid="data-mode"` kept): a row of `Badge`s (source, scope,
   coverage, persistence, freshness) in a `Card` with `padding: var(--space-3)`.
4. **Summary** (`#rp-summary`): five KPI `Card`s (`db-kpi`: value on `--fs-h2` `.ui-num`,
   label, one-line note) then four insight `Card`s (`db-insight`: title `<h3>`, sentence);
   both in `.db-grid`.
5. **Videos** (`#rp-videos`): each video a `Card` row: title, counts as `Badge numeric`, the
   inline sentiment bar (same four-segment bar the landing's `ProductWindow` draws — the
   `.pw-bar` rule is lifted into `ui.css` as `.ui-split` so both pages read one rule), a
   «تصفية» `Button variant="ghost" size="sm"`; pager as two `Button`s + `data-testid="page-state"`.
6. **Voice** (`#rp-voice`): the doughnut in a `Card` with its legend; the topics bar chart in
   a `Card`; the three figure `Card`s; `ChartFigures` unchanged under each chart (a `<details>`
   styled on `Accordion`'s tokens — not the Radix primitive, because the figures are a
   disclosure with no group semantics).
7. **Timing** (`#rp-timing`): three chart `Card`s in `.db-grid` (weekly spans two columns at
   ≥ 900 px); the "not enough to draw" states are `EmptyState kind="chart"` inside the card.
8. **People** (`#rp-people`): `ui/Tabs` for «الأكثر نشاطًا / الأكثر تأثيرًا»; ranked rows in
   one `Card`.
9. **Compare** (`#rp-compare`, `data-testid="comparison-scope"`, `compare-video-*` kept):
   `ui/Table` with the inline split bar; ≤ 760 px the table becomes stacked `Card`s (one per
   row, the header labels as `<dt>`), same test ids.
10. **Engaged** (`#rp-engaged`, `engaged-*` ids kept): ranked `Card` rows.
11. **Comments** (`#rp-comments`): `ui/Tabs` «الأكثر إعجابًا / الأحدث / النقدية» over the
    card list (each comment a `Card` with author, `Badge` sentiment + confidence, text, date,
    likes); the export `Button` with its sentence; `CommentsTable` on `ui/Table` (≤ 760 px:
    stacked cards); pager; the correction opens **`ReviewDialog`** — `ui/Dialog` (centred),
    the same fields (`«التصنيف الصحيح»`, `«الموضوع الصحيح»`, `«سبب التصحيح»` as `Select`
    / `Textarea`), `data-testid="review-*"` kept, `busy` while the mutation runs and the dialog
    refuses to close mid-flight (the pattern `DeleteWorkspaceDialog` set).

## Charts

Chart.js stays. `chartTheme.ts` stays the colour source (its parity test with `brand.css`
stands). `chartOptions.ts` exports `axes(locale)`, `grid()`, `tooltip(locale)`, `font()` used
by all five charts so they share one axis colour, one grid colour, one font, one tooltip
shape; today each chart repeats them. Canvases stay `aria-hidden` with `ChartFigures`.

## States

- **Loading:** `Skeleton` blocks in the shape of the hero, the bar, five KPI cards and two
  chart cards — `data-testid="loading"` kept on the wrapper, `role="status"` with the current
  sentence for screen readers.
- **Empty:** one `EmptyState` component with `kind: "workspace" | "filters" | "error" |
  "chart"`: `workspace` (no comments at all) shows `SetupPath` (live mode) and the two links;
  `filters` shows the reset `Button`; `error` shows the message and «أعد المحاولة»
  (`data-testid="load-error"` kept); `chart` is the in-card "not enough to draw" sentence.
  `data-testid="empty-state"` kept.
- **Fixture notice:** a `Card` with a neutral `Badge` «بيانات اصطناعية» and the three
  sentences at `--fs-small` — not the amber block.

## Mobile

- ≤ 900 px: filter sheet (above); SectionNav scrolls; `.db-grid` collapses to one column.
- ≤ 760 px: tables become stacked cards; KPI cards two per row; charts full width.
- No horizontal overflow at 320 / 390 / 768 (e2e asserts `scrollWidth <= innerWidth`).

## Testing

- Unit: `FilterBar.test.tsx` (labels resolve every control by `getByLabelText`; «المزيد» shows
  the count; apply submits the form with the values; reset restores defaults; a chip's × clears
  one filter), `SectionNav.test.tsx` (aria-current follows the prop), `ReviewDialog.test.tsx`
  (opens, validates the reason, refuses to close while busy, calls the mutation with the
  payload), `EmptyState.test.tsx` (four kinds).
- e2e: `tests/e2e/dashboard.spec.ts`'s 76 tests stay. Mechanical updates only: the 31
  `selectOption(...)` calls on filter selects move to a `pick(page, label, optionText)` helper
  (click the labelled trigger, click the option by role) added at the top of the file; nothing
  else changes unless a test named a class that no longer exists — then the test reads the
  kept `data-testid` instead. `app-shell.spec.ts` unchanged. Two tests added: the filter bar is
  still visible after scrolling 2,000 px; at 390 px the bar is the «الفلاتر» button and opening
  it shows the video select.
- `npm run check` green; `npm run test:e2e -- tests/e2e/dashboard.spec.ts tests/e2e/app-shell.spec.ts` green.

## Out of scope

`/sync`, `CataloguePanel`, `OperationsPanels`, `AdminPage` (phase 4); account and billing
(phase 5); the onboarding tour (phase 6); any change to `data.ts`, `analytics.ts`, the
fixture, or the arithmetic; copy — except the new keys the bar needs («المزيد», «الفلاتر»,
the chip × label) in both languages.
