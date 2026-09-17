# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/dashboard` on `ui/` + `brand.css` under the same eight sections, the same `data-testid`s and label texts, with a sticky compact filter bar, a real review dialog, skeleton/empty states and a mobile layout — and split the 2,238-line `Dashboard.tsx` into `apps/web/src/dashboard/`.

**Architecture:** Task 1 moves the file whole into `dashboard/` (git keeps history) and adds the shared foundations; Tasks 2–10 each cut one region out of `dashboard/Dashboard.tsx` into its own component + stylesheet, rewriting the markup on `ui/` with `db-*` classes and keeping every test id and label; Task 11 removes the `report.css` import, migrates the e2e selectors mechanically, and deletes the shim; Task 12 records. `report.css` itself survives for `/sync` (phase 4). No element is ever styled by `report.css` and a `dashboard/*.css` rule at once because the new markup carries no `rp-*` class.

**Tech Stack:** React 19, React Router 7, `@tanstack/react-query`, Radix via `ui/` (Select, Popover, Dialog incl. `variant="sheet"`, Tabs, Table, Badge, Button, Input, Textarea, Card, Skeleton, Tooltip), Chart.js + react-chartjs-2, Vitest (jsdom, `globals: false`), Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-dashboard-redesign-design.md`

## Global Constraints

- **Test ids and labels are a contract.** Every `data-testid` in `apps/web/src/Dashboard.tsx` today (46) stays on the equivalent element; every `<label>` text and `aria-label` stays; the section ids `rp-summary … rp-comments` stay; `<form id="report-filters" aria-label={S.filtersLabel}>` stays; the review form keeps `role="form"` with its `aria-label` (`S.reviewFormLabel` / `S.reviewTopicTitle`). `tests/e2e/dashboard.spec.ts` (76 tests) is the oracle; it is edited only in Task 11 and only where this plan's mapping table says.
- **No `rp-*` class on the new markup.** New classes are `db-*` (page) or `ui-*` (primitives). Exception: none — the classes the e2e reads are remapped in Task 11.
- **Copy frozen** except the keys this plan adds (Task 1). Sentences come from `S.*`.
- **Tokens only:** no hex in new CSS; sentiment colours only via `--sentiment-*` (legend swatches keep `style={{ background: \`var(--sentiment-${key})\` }}`); Chart.js colours stay in `chartTheme.ts`.
- **`letter-spacing: 0` on Arabic** — never set a non-zero `letter-spacing` in `dashboard/*.css`.
- **No arithmetic changes.** `data.ts`, `analytics.ts`, `dataSource.ts`, `videoPaging.ts`, `setup.ts`, `reviewHistory.ts`, `chartTheme.ts` are read-only. The `useMemo`s, `filtersFrom`, `applyFilters`, `reset`, `activeFilters`, `cards`, the review/export mutations and `useActiveSection` move as they are.
- **Another session edits this checkout.** `git status --short` before every commit; stage only your files by exact path; never `git add -A`/`-u`/`.`; never touch `docs/verification.md` or `.screenshots/`; never `npm run format` (use `npx prettier --write <files>`).
- **Tests run from the repo root** (`npx vitest run <file>`; the root config registers RTL cleanup). e2e: `npm run test:e2e -- tests/e2e/dashboard.spec.ts > /tmp/e2e.log 2>&1; echo exit=$?` — redirect, then read.
- **Docs append-only**; commit messages are sentences ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/src/dashboard/Dashboard.tsx` | the moved file; shrinks task by task to composition + state + queries |
| `apps/web/src/dashboard/dashboard.css` | page rhythm, `.db-section`, `.db-grid`, `.db-lead`, `.db-muted`, `.db-note` |
| `apps/web/src/dashboard/chartOptions.ts` (+test) | `axes`, `grid`, `tooltip`, `font` for all five charts |
| `apps/web/src/dashboard/filters.ts` (+test) | `FilterValues`, `EMPTY_FILTERS`, `extraCount(values)`, `chipsFor(values, ctx)` |
| `apps/web/src/dashboard/FilterBar.tsx` + `filter-bar.css` (+test) | sticky bar, «المزيد» popover, sheet on mobile |
| `apps/web/src/dashboard/ActiveFilters.tsx` | chips (`data-testid="active-filters"`) |
| `apps/web/src/dashboard/PageStates.tsx` + `page-states.css` (+test) | `Loading`, `EmptyState`, `LoadError`, `FixtureNotice` |
| `apps/web/src/dashboard/Hero.tsx` + `hero.css`, `SectionNav.tsx` + `section-nav.css` (+test), `Provenance.tsx` + `provenance.css` | the page head |
| `apps/web/src/dashboard/Summary.tsx` + `summary.css` | KPI + insight cards |
| `apps/web/src/dashboard/Videos.tsx` + `videos.css` | video rows + pager |
| `apps/web/src/dashboard/Voice.tsx` + `voice.css`, `Timing.tsx` + `timing.css`, `ChartFigures.tsx` | charts |
| `apps/web/src/dashboard/People.tsx` + `people.css`, `Compare.tsx` + `compare.css`, `Engaged.tsx` + `engaged.css` | lists and the comparison table |
| `apps/web/src/dashboard/Comments.tsx` + `comments.css`, `CommentsTable.tsx` | cards, export, table, pager |
| `apps/web/src/dashboard/ReviewDialog.tsx` (+test) | the correction dialog on `ui/Dialog` |
| `apps/web/src/ui/ui.css` | `.ui-split` (lifted from the landing's `.pw-bar`) |
| `apps/web/src/Dashboard.tsx` | one-line re-export until Task 11 deletes it |
| `tests/e2e/dashboard.spec.ts` | `pick()` helper + the mapping table (Task 11) |

**Prop convention.** Every section component receives `s` (the snapshot, `NonNullable<typeof result.data>`, typed as `Snapshot` exported from `dashboard/Dashboard.tsx` in Task 1: `export type Snapshot = ReturnType<typeof deriveSnapshot>;`), `S` (`Strings`), `lang` (`Locale`) and only the callbacks/state it uses, named exactly as in the task. `n` (the `en-US` number formatter, `Dashboard.tsx:71`) moves to `dashboard/format.ts` in Task 1 as `export const n = (v: number) => v.toLocaleString("en-US");` and every section imports it from there.

---

### Task 1: Foundations — move the file, shared CSS, `.ui-split`, chart options, strings, `Snapshot`

**Files:**
- Move: `apps/web/src/Dashboard.tsx` → `apps/web/src/dashboard/Dashboard.tsx` (`git mv`), then create the shim `apps/web/src/Dashboard.tsx`
- Create: `apps/web/src/dashboard/dashboard.css`, `apps/web/src/dashboard/format.ts`, `apps/web/src/dashboard/chartOptions.ts`, `apps/web/src/dashboard/chartOptions.test.ts`
- Modify: `apps/web/src/ui/ui.css` (append `.ui-split`), `apps/web/src/landing/ProductWindow.tsx` + `product-window.css` (use `.ui-split`), `apps/web/src/strings/ar.ts`, `apps/web/src/strings/en.ts` (three keys)

**Interfaces:**
- Produces: `dashboard/format.ts` → `n(v: number): string`; `dashboard/Dashboard.tsx` → `export type Snapshot`; `chartOptions.ts` → `axes(): {x, y}`, `grid(): {color}`, `font(): {family, size}`, `tooltip(): {…}`, `barOptions`, `lineOptions`, `doughnutOptions`; `ui.css` → `.ui-split`, `.ui-split > i.positive|.negative|.neutral|.mixed`; strings `S.moreFilters(n: number)`, `S.filtersButton(n: number)`, `S.removeFilter(label: string)`.

- [ ] **Step 1: Move the file and shim the old path**

```bash
cd /Users/mlubbad/Documents/Codex/SentimentAnalysis
mkdir -p apps/web/src/dashboard && git mv apps/web/src/Dashboard.tsx apps/web/src/dashboard/Dashboard.tsx
```
In the moved file, fix every relative import: `./report.css` → `../report.css`, `./analytics` → `../analytics`, and so on for all `./x` imports (there are ~20). Create `apps/web/src/Dashboard.tsx`:
```ts
/** Moved to ./dashboard/ — this re-export keeps main.tsx and any test that
 *  imports the old path working until the cut-over deletes it. */
export { Dashboard } from "./dashboard/Dashboard";
```
Add to the moved file, after `const defaults: Filters = …`: `export type Snapshot = ReturnType<typeof deriveSnapshot>;`. Replace the local `const n = …` (line 71) with `import { n } from "./format";` and create `apps/web/src/dashboard/format.ts` with that one export (keep the "Numerals pinned" comment).
Run `npm run typecheck` → clean; `npx vitest run apps/web/src/Dashboard` (any existing dashboard unit tests, e.g. `Dashboard.identity.test.ts`, `Dashboard.failure.test.ts`) → still pass (they import `./Dashboard`, which the shim serves; if one reads the SOURCE of `Dashboard.tsx` with `readFileSync`, point it at `dashboard/Dashboard.tsx` and say so).

- [ ] **Step 2: `dashboard.css`** (imported by `dashboard/Dashboard.tsx` right after `../report.css` — both are loaded until Task 11; they share no selector)

```css
/* The dashboard's shared rules. Every section brings its own file beside it;
   this one holds only what they all share. Classes are db-*; the old rp-*
   rules in report.css never match this page again. */
.db-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
.db-section {
  scroll-margin-top: 72px;
}
.db-section > header {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
.db-section > header h2 {
  font-size: var(--fs-h2);
  margin: 0;
}
.db-lead,
.db-muted,
.db-note {
  color: var(--text-2);
  max-width: 70ch;
}
.db-note {
  font-size: var(--fs-small);
  color: var(--text-3);
}
.db-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);
}
.db-grid--2 {
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}
.db-card-title {
  font-size: var(--fs-h3);
  margin: 0 0 var(--space-2);
}
.db-row-actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.db-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.db-pager p {
  margin: 0;
  color: var(--text-2);
}
@media (max-width: 760px) {
  .db-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .db-grid--2,
  .db-grid--charts {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 480px) {
  .db-grid {
    grid-template-columns: 1fr;
  }
}
```
Wrap the page: in `dashboard/Dashboard.tsx` change `<div className="rp-page">` to `<div className="rp-page db-page">` (the `rp-page` stays until Task 11 because `report.css`'s `.rp-page` sets the page padding the untouched sections still need; Task 11 drops it).

- [ ] **Step 3: `.ui-split` in `ui.css`** — append:

```css
/* ---- Split bar: one bar, four sentiment segments ---- */
.ui-split {
  display: flex;
  height: 12px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--bg-muted);
}
.ui-split > i {
  flex-basis: 0;
  min-width: 0;
  background: var(--sentiment-neutral);
}
.ui-split > i.positive {
  background: var(--sentiment-positive);
}
.ui-split > i.negative {
  background: var(--sentiment-negative);
}
.ui-split > i.mixed {
  background: var(--sentiment-mixed);
}
@media (prefers-reduced-motion: no-preference) {
  .ui-split > i {
    transition: flex-grow 240ms ease;
  }
}
```
Then in `apps/web/src/landing/ProductWindow.tsx` replace `className="pw-bar"` with `className="ui-split pw-bar"` and each segment's `className={\`pw-seg ${c.label}\`}` with `className={c.label}`; in `product-window.css` delete the `.pw-bar`, `.pw-seg*` colour rules and the `.pw-seg` transition (keep a `.pw-bar { height: 14px }` override only if you want the landing's slightly taller bar). Run `npx vitest run apps/web/src/landing/ProductWindow.test.tsx` → PASS. (The e2e colour-language test reads `.lp-dot`, not the bar — unaffected.)

- [ ] **Step 4: `chartOptions.ts`** — lift the shared defaults from `Dashboard.tsx:73-89` (`barOptions`) and the per-chart `options` objects at lines 1290–1321 (doughnut), 1406–1440 (topics bar), 1506–1521 (line), 1550–1562, 1587–1599 (bars). Read those blocks; write:

```ts
import {
  AXIS_TEXT,
  GRID_LINE,
} from "../chartTheme";

/* One family of charts. Every option the five charts share is written here
   once; a chart passes only what is its own (its data, its labels, a
   tooltip label formatter). Colours come from chartTheme, which a test pins
   to brand.css. */
export const font = () => ({ family: "Audience Arabic, Readex Pro, system-ui, sans-serif", size: 12 });
export const axes = () => ({
  x: { ticks: { color: AXIS_TEXT, font: font() }, grid: { display: false } },
  y: {
    beginAtZero: true,
    ticks: { color: AXIS_TEXT, precision: 0, font: font() },
    grid: { color: GRID_LINE },
  },
});
export const tooltip = () => ({
  backgroundColor: "rgba(20, 17, 58, 0.92)",
  titleFont: font(),
  bodyFont: font(),
  padding: 10,
  cornerRadius: 8,
});
export const barOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: { legend: { display: false }, tooltip: tooltip() },
  scales: axes(),
} as const;
export const lineOptions = {
  ...barOptions,
  animation: false,
  elements: { line: { tension: 0.3 }, point: { radius: 3 } },
} as const;
export const doughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  cutout: "62%",
  plugins: { legend: { display: false }, tooltip: tooltip() },
} as const;
```
`rgba(20, 17, 58, 0.92)` is `--text-1` (`#14113a`) at 92% — Chart.js cannot read a CSS variable; add the comment saying so and add to `chartOptions.test.ts` a check that the tooltip background's rgb equals `brand.css`'s `--text-1` (parse `--text-1:\s*(#[0-9a-f]{6})` from `apps/web/src/brand.css` and compare channels). Also test `barOptions.scales.y.beginAtZero === true` and `doughnutOptions.cutout === "62%"`.
Then make the five charts use them: doughnut `options={doughnutOptions}` (+ its own `plugins.tooltip.callbacks` merged with a spread if the existing block has one — read lines 1290–1321 and keep any `callbacks`), topics bar `options={{ ...barOptions, indexAxis: "y" as const, …existing callbacks }}`, line `lineOptions`, the two bars `barOptions`. Delete the local `barOptions`, `axisText`, `gridLine` (lines 73–89). Charts must render the same data; the three e2e chart tests (`weeks-unplottable`, `hours-excluded`, `unknown-dates`) do not read options.

- [ ] **Step 5: Strings** — add to `strings/ar.ts` next to `showFilters` (line ~ where `showFilters`/`hideFilters` live) and the same place in `en.ts`:

```ts
  moreFilters: (n: number) => (n > 0 ? `المزيد (${n})` : "المزيد"),
  filtersButton: (n: number) => (n > 0 ? `الفلاتر (${n})` : "الفلاتر"),
  removeFilter: (label: string) => `إزالة الفلتر: ${label}`,
```
```ts
  moreFilters: (n: number) => (n > 0 ? `More (${n})` : "More"),
  filtersButton: (n: number) => (n > 0 ? `Filters (${n})` : "Filters"),
  removeFilter: (label: string) => `Remove filter: ${label}`,
```
`npm run typecheck` → clean (the `Strings` type is derived from `ar`; `en` must match).

- [ ] **Step 6: Verify** — `npm run typecheck`, `npm run lint`, `npx vitest run apps/web/src/dashboard apps/web/src/landing/ProductWindow.test.tsx apps/web/src/Dashboard.identity.test.ts apps/web/src/Dashboard.failure.test.ts apps/web/src/chartTheme.test.ts` → PASS; `npm run test:e2e -- tests/e2e/dashboard.spec.ts > /tmp/e2e.log 2>&1; echo exit=$?` → 0 (nothing user-visible changed).

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/web/src/dashboard apps/web/src/Dashboard.tsx apps/web/src/ui/ui.css apps/web/src/landing/ProductWindow.tsx apps/web/src/landing/product-window.css apps/web/src/strings/ar.ts apps/web/src/strings/en.ts
git add apps/web/src/dashboard apps/web/src/Dashboard.tsx apps/web/src/ui/ui.css apps/web/src/landing/ProductWindow.tsx apps/web/src/landing/product-window.css apps/web/src/strings/ar.ts apps/web/src/strings/en.ts
git commit -m "The dashboard moves into dashboard/ whole, with the shared rules, one set of chart options, the split bar lifted into ui.css, and the three strings the filter bar will need

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `filters.ts`, `FilterBar`, `ActiveFilters`

**Files:**
- Create: `apps/web/src/dashboard/filters.ts`, `filters.test.ts`, `FilterBar.tsx`, `filter-bar.css`, `FilterBar.test.tsx`, `ActiveFilters.tsx`
- Modify: `apps/web/src/dashboard/Dashboard.tsx` — replace lines 771–975 (the toggle button, the `<form id="report-filters">`, `periodNote`, `formError`) and the `activeFilters` block at lines 739–756 inside `<nav>`; remove the `filtersOpen` state + its effect (296–306)

**Interfaces:**
- Produces:
  ```ts
  // filters.ts
  export type FilterValues = {
    query: string; video: string; sentiment: string; topic: string;
    videoKind: string; replies: "all" | "comments" | "replies";
    commentType: string; reviewStatus: "all" | "reviewed" | "unreviewed";
    dateMode: "all" | "known" | "unknown"; from: string; to: string; limit: number;
  };
  export const EMPTY_FILTERS: FilterValues; // "" / "all" / 25
  /** how many of the six "more" controls are set */
  export function extraCount(v: FilterValues): number;
  export type Chip = { key: keyof FilterValues | "period"; label: string };
  export function chipsFor(v: FilterValues, ctx: { S: Strings; labels: Record<Label,string>; topicName: (k: string) => string }): Chip[];
  // FilterBar.tsx
  export function FilterBar(props: {
    values: FilterValues; onChange: (patch: Partial<FilterValues>) => void;
    onApply: () => void; onReset: () => void; onLimitChange: (n: number) => void;
    formError: string; videoOptions: {id: string; title: string | null}[];
    topics: {key: string; name_ar: string; name_en: string; retired: boolean}[] | null; // null → no topic control
    commentTypes: string[]; S: Strings; lang: Locale; labels: Record<Label, string>;
  }): JSX.Element
  // ActiveFilters.tsx
  export function ActiveFilters(props: { chips: Chip[]; scope: string; onClear: (key: Chip["key"]) => void; onReset: () => void; S: Strings }): JSX.Element
  ```

- [ ] **Step 1: `filters.ts` + failing test**

`filters.ts` carries the chip logic from `Dashboard.tsx:579-596` (same strings, same order) and:
```ts
export const EMPTY_FILTERS: FilterValues = {
  query: "", video: "", sentiment: "", topic: "", videoKind: "", replies: "all",
  commentType: "", reviewStatus: "all", dateMode: "all", from: "", to: "", limit: 25,
};
export function extraCount(v: FilterValues) {
  return [v.topic, v.videoKind, v.commentType].filter(Boolean).length
    + (v.replies !== "all" ? 1 : 0) + (v.reviewStatus !== "all" ? 1 : 0) + (v.limit !== 25 ? 1 : 0);
}
export function chipsFor(v, { S, labels, topicName }): Chip[] {
  const out: Chip[] = [];
  if (v.query) out.push({ key: "query", label: S.chipSearch(v.query) });
  if (v.video) out.push({ key: "video", label: S.chipVideo });
  if (v.sentiment) out.push({ key: "sentiment", label: S.chipSentiment(labels[v.sentiment as Label] ?? v.sentiment) });
  if (v.topic) out.push({ key: "topic", label: S.chipTopic(v.topic === UNCLASSIFIED ? S.topicUnclassifiedOption : topicName(v.topic)) });
  if (v.videoKind) out.push({ key: "videoKind", label: S.chipVideoKind });
  if (v.commentType) out.push({ key: "commentType", label: S.chipCommentType });
  if (v.replies !== "all") out.push({ key: "replies", label: v.replies === "replies" ? S.chipRepliesOnly : S.chipCommentsOnly });
  if (v.reviewStatus !== "all") out.push({ key: "reviewStatus", label: v.reviewStatus === "reviewed" ? S.chipReviewedOnly : S.chipUnreviewedOnly });
  if (v.dateMode !== "all") out.push({ key: "dateMode", label: v.dateMode === "known" ? S.chipDatedOnly : S.chipUndatedOnly });
  if (v.from || v.to) out.push({ key: "period", label: S.chipPeriod });
  return out;
}
```
`filters.test.ts` (node env, imports `ar` from `../strings/ar`): `extraCount(EMPTY_FILTERS) === 0`; `extraCount({...EMPTY_FILTERS, topic:"x", replies:"replies", limit: 50}) === 3`; `chipsFor` on empty → `[]`; on `{query:"صوت", sentiment:"negative", from:"2026-01-01"}` → three chips with keys `query, sentiment, period` and labels `ar.chipSearch("صوت")`, `ar.chipSentiment(ar.labels.negative)`, `ar.chipPeriod`, in that order.

- [ ] **Step 2: Run** → FAIL; implement; PASS.

- [ ] **Step 3: `FilterBar.test.tsx` (failing)** — jsdom, render inside `DirectionProvider dir="rtl"` with `ar` strings, `values = EMPTY_FILTERS`, `videoOptions = [{id:"v1", title:"فيديو"}]`, `topics = null`, `commentTypes = []`:
  - every visible control resolves by label: `getByLabelText(ar.searchLabel)` is an input; `getByLabelText(ar.videoLabelText)` and `getByLabelText(ar.sentimentLabel)` have `role="combobox"`; the period button reads `ar.dateLabel`.
  - «المزيد» button reads `ar.moreFilters(0)`; clicking it shows `getByLabelText(ar.participationLabel)`, `getByLabelText(ar.reviewStatusLabel)`, `getByLabelText(ar.videoKindLabel)`, `getByLabelText(ar.perPageLabel)`; with `values.replies="replies"` the button reads `ar.moreFilters(1)`.
  - submitting the form (`fireEvent.submit(getByRole("form", { name: ar.filtersLabel }))`) calls `onApply` once; clicking `ar.resetFilters` calls `onReset`.
  - typing in search calls `onChange({ query: "x" })`; picking a sentiment (`userEvent.click(combobox)`, then `userEvent.click(getByRole("option", { name: ar.labels.negative }))`) calls `onChange({ sentiment: "negative" })`.
  - `formError="خطأ"` renders `getByRole("alert")` with that text.
  - a `matchMedia` stub for `(max-width: 900px)` returning `matches: true` → the bar renders the `ar.filtersButton(0)` button and no combobox until it is clicked; clicking it opens a `role="dialog"` containing the video combobox.

- [ ] **Step 4: `FilterBar.tsx`** — one `<form id="report-filters" aria-label={S.filtersLabel} className="db-filterbar" onSubmit={e => { e.preventDefault(); onApply(); }}>` with:
  - `const compact = useMediaQuery("(max-width: 900px)")` (tiny local hook: `useState(() => matchMedia(q).matches)` + `change` listener; guard `typeof window`).
  - Desktop row (`!compact`): `Search` (`ui/Input` with `id="f-query"`, `<label htmlFor="f-query" className="ui-sr-only">{S.searchLabel}</label>` — the label text is present for `getByLabel`, hidden visually; placeholder = `S.searchLabel`), `VideoSelect`, `SentimentSelect`, `PeriodPopover`, `MorePopover`, `Button type="submit"` «تطبيق», `Button variant="ghost" type="button"` «إعادة ضبط».
  - Each `ui/Select` is rendered by a local `Labelled` helper: `<div className="db-field"><label htmlFor={id}>{label}</label><Select value={value} onValueChange={…}><SelectTrigger id={id} aria-label={label}><SelectValue /></SelectTrigger><SelectContent>…</SelectContent></Select></div>` — the `aria-label` mirrors what the old `<select aria-label>` carried, so `getByLabel` resolves either way. Options: video → `S.allVideos` + `videoLabel(v.id, v.title, S)` (import from `../i18n`); sentiment → `S.allSentiments` + `labels`; topic (only when `topics !== null`) → `S.topicAll`, live topics by `lang`, then `UNCLASSIFIED` → `S.topicUnclassifiedOption`; videoKind → `S.allKinds/kindVideo/kindShort/kindStream`; participation → `S.commentsAndReplies/originalOnly/repliesOnly`; commentType (only when `commentTypes.length > 0`) → `S.allKinds` + types; reviewStatus → `S.all/reviewedByHuman/unreviewed`; dateMode → `S.allDates/knownDates/unknownDates`; perPage → 5/10/25/50 (`onLimitChange`). **Radix Select cannot hold an empty-string value** — map `""` ↔ the sentinel `"__all"` inside the component (`value={v || "__all"}`, `onValueChange={x => onChange({ video: x === "__all" ? "" : x })}`).
  - `PeriodPopover`: `Popover` from a `Button variant="secondary"` whose text is `values.from || values.to ? \`${values.from || "…"} → ${values.to || "…"}\` : S.dateLabel`, `aria-label={S.dateLabel}`; inside: the dateMode `Labelled` select, `<label htmlFor="f-from">{S.fromDate}<Input id="f-from" type="date" …/></label>`, `<label htmlFor="f-to">{S.toDate}…` (both `disabled={values.dateMode === "unknown"}`).
  - `MorePopover`: `Button variant="secondary"` reading `S.moreFilters(extraCount(values))`; inside, stacked: topic (conditional), videoKind, participation, commentType (conditional), reviewStatus, perPage.
  - `compact`: render only `<Button type="button" variant="secondary" onClick={() => setSheet(true)}>{S.filtersButton(chips)}</Button>` (`chips` = `chipsFor(values, …).length` passed in as `appliedCount` prop — add `appliedCount: number` to the props) and a `Dialog open={sheet}` with `DialogContent variant="sheet" closeLabel={S.cancel} aria-describedby={undefined}` holding `DialogTitle` = `S.filtersLabel` and the SAME controls stacked (reuse the same JSX via a `controls` variable rendered in both places — do not duplicate the option lists), then the apply/reset buttons; `onApply` also `setSheet(false)`.
  - `formError && <p role="alert" className="db-filterbar-error">{formError}</p>` and `<p className="db-note">{S.periodNote}</p>` under the row.

- [ ] **Step 5: `filter-bar.css`**

```css
.db-filterbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-4);
  margin-inline: calc(-1 * var(--space-4));
  background: var(--glass-2-tint);
  backdrop-filter: var(--glass-2-blur) var(--glass-lens);
  -webkit-backdrop-filter: var(--glass-2-blur) var(--glass-lens);
  border-bottom: var(--glass-2-edge);
  box-shadow: var(--glass-2-ring);
}
.db-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
}
.db-field > label {
  font-size: var(--fs-small);
  color: var(--text-2);
}
.db-filterbar .db-field--search {
  flex: 1 1 220px;
}
.db-filterbar-actions {
  display: flex;
  gap: var(--space-2);
  margin-inline-start: auto;
}
.db-filterbar-error {
  flex-basis: 100%;
  margin: 0;
  color: var(--color-danger);
}
.db-filterbar .db-note {
  flex-basis: 100%;
  margin: 0;
}
.db-popover-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 260px;
}
.db-sheet-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  overflow-y: auto;
}
```
Confirm `--glass-2-*` and `--color-danger` exist (`grep -n "glass-2-tint\|color-danger" apps/web/src/brand.css apps/web/src/glass.css`); if the glass tokens live in `glass.css`, `dashboard/Dashboard.tsx` must import `../glass.css` (check `main.tsx` — if the shell already imports it globally, do nothing).

- [ ] **Step 6: `ActiveFilters.tsx`** — `<p className="db-scope" data-testid="active-filters">` when `chips.length > 0`: `<span>{S.filteredLabel}</span>`, one `<Badge tone="neutral" className="db-chip">{label} <Button variant="ghost" size="sm" aria-label={S.removeFilter(label)} onClick={() => onClear(key)}>×</Button></Badge>` per chip, then `<Button variant="ghost" size="sm" onClick={onReset}>{S.showAll}</Button>`; else `<span className="db-scope">{scope}</span>`. (CSS in `filter-bar.css`: `.db-scope { display:flex; flex-wrap:wrap; gap: var(--space-2); align-items:center; color: var(--text-2); font-size: var(--fs-small) }`.)

- [ ] **Step 7: Wire into `Dashboard.tsx`** — keep the twelve `useState`s as they are (they are the source of truth the mutations and `filtersFrom` read); build `values: FilterValues = { query, video, sentiment, topic, videoKind, replies, commentType, reviewStatus, dateMode, from, to, limit }` and `onChange = (p) => { if ("query" in p) setQuery(p.query!); … }` (one `if` per key — twelve lines; `limit` goes through `onLimitChange = (n) => { goTo([]); setLimit(n); }` as today). `onClear(key)`: set that one state back to its `EMPTY_FILTERS` value (`period` clears both `from` and `to`), then `applyFilters()` — the chip removal applies immediately, unlike the form, because the chip IS the applied state. Replace lines 771–975 with `<FilterBar … />`; replace the chips block (739–756) with `<ActiveFilters chips={chipsFor(values, { S, labels, topicName })} scope={source.scope} onClear={onClear} onReset={reset} S={S} />` — note it moves OUT of `<nav className="rp-nav">` to directly below the bar (Task 4 rebuilds the nav). Delete `filtersOpen` and its effect, delete `activeFilters` (chips replace it). Keep `applyFilters`/`filtersFrom`/`reset` verbatim (`reset` also calls `setLimit(25)` — keep).

- [ ] **Step 8: Verify** — `npx vitest run apps/web/src/dashboard` → PASS; `npm run typecheck`; `npm run test:e2e -- tests/e2e/dashboard.spec.ts > /tmp/e2e.log 2>&1; echo exit=$?` — **expected: the 31 `selectOption` sites fail** (they need Task 11's `pick()`); record the count of failures and confirm every failure is a `selectOption`/`toBeFocused`-on-select assertion and nothing else (`grep -c "selectOption" /tmp/e2e.log`). If any OTHER test fails, fix the cause before committing.

- [ ] **Step 9: Commit**

```bash
npx prettier --write apps/web/src/dashboard
git add apps/web/src/dashboard/filters.ts apps/web/src/dashboard/filters.test.ts apps/web/src/dashboard/FilterBar.tsx apps/web/src/dashboard/filter-bar.css apps/web/src/dashboard/FilterBar.test.tsx apps/web/src/dashboard/ActiveFilters.tsx apps/web/src/dashboard/Dashboard.tsx
git commit -m "The dashboard's filters become a sticky bar: four controls in a row, six behind «المزيد», the applied ones as chips that clear one at a time, and a sheet on a phone

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Page states — loading skeleton, empty states, load error, fixture notice

**Files:**
- Create: `apps/web/src/dashboard/PageStates.tsx`, `page-states.css`, `PageStates.test.tsx`
- Modify: `apps/web/src/dashboard/Dashboard.tsx` — lines 976–1002 (pending/updating/error) and 1110–1161 (the two empty branches); the fixture notice is the block that renders `S.dashDemoTag`-related sentences — find it (`grep -n "fixtureNotice\|demoNotice\|synthetic" dashboard/Dashboard.tsx`) and replace it.

**Interfaces:**
- Produces: `Loading({ S })` (`data-testid="loading"`, `role="status"`), `Updating({ S })` (`data-testid="updating"`), `LoadError({ S, failure, onRetry })` (`data-testid="load-error"`, `data-testid="failure-code"`, retry `Button`), `EmptyState({ kind: "workspace" | "filters", S, setup?: ReactNode, onReset?: () => void, links?: {to: string; label: string}[] })` (`data-testid="empty-state"`), `ChartEmpty({ children, testId })` (in-card sentence), `FixtureNotice({ S })`.

- [ ] **Step 1: Failing test** — jsdom: `Loading` renders `getByRole("status")` with `ar.loadingComments` and at least 5 `.ui-skeleton` elements; `EmptyState kind="filters"` renders `ar.emptyNoMatchTitle` and a button `ar.resetFilters` that calls `onReset`; `EmptyState kind="workspace"` renders `ar.emptyNoCommentsTitle`, the `setup` node, and the two links; `LoadError failure="view:bad"` renders `ar.filtersFailed`, `failure="read:net"` renders `ar.loadFailed`, and `getByTestId("failure-code")` contains the code; retry button calls `onRetry`.

- [ ] **Step 2: Implement** — `Loading`: `<div role="status" data-testid="loading" className="db-loading"><span className="ui-sr-only">{S.loadingComments}</span><Skeleton className="db-sk-hero" /><Skeleton className="db-sk-bar" /><div className="db-grid">{5 × <Skeleton className="db-sk-kpi" />}</div><div className="db-grid db-grid--2">{2 × <Skeleton className="db-sk-chart" />}</div></div>` (check `ui/Skeleton`'s props — it takes `className`; if it needs `style` for size, set heights in CSS by class). `EmptyState`: `Card` with `<h2>`, lead, then `setup`, links as `Button asChild variant="secondary"` over `Link`, or the reset `Button`. `LoadError`: `Card` with `role="alert"`, the sentence, the code line, `Button` «أعد المحاولة» (`S.retry`). `FixtureNotice`: `Card className="db-fixture"` with `Badge tone="neutral"` and the current three sentences (keep their `S.*` keys and any `data-testid` they carry).
  Move the empty-branch markup from `Dashboard.tsx:1118-1161` into the two `EmptyState` renders (workspace branch passes `setup={mode === "live" ? <SetupPath …/> : null}` exactly as the current condition, with the `setupProgress(...)`/`latestJobFromSync` call kept in `Dashboard.tsx` and passed down).
  CSS: `.db-loading { display:flex; flex-direction:column; gap: var(--space-4) } .db-sk-hero{height:96px} .db-sk-bar{height:56px} .db-sk-kpi{height:112px} .db-sk-chart{height:280px} .db-empty{ text-align:center; padding: var(--space-7) var(--space-5) } .db-empty h2{ margin:0 0 var(--space-2) } .db-fixture{ display:flex; flex-direction:column; gap: var(--space-2); font-size: var(--fs-small); color: var(--text-2) }`.

- [ ] **Step 3: Verify** — `npx vitest run apps/web/src/dashboard/PageStates.test.tsx` PASS; typecheck; e2e `dashboard.spec.ts` — the tests named `empty` / `load-error` / `loading` still pass (`grep -n "empty-state\|load-error\|loading" tests/e2e/dashboard.spec.ts` lists them; run the file and confirm no new failures beyond Task 2's `selectOption` set).

- [ ] **Step 4: Commit** (`PageStates.tsx`, `page-states.css`, `PageStates.test.tsx`, `Dashboard.tsx`): "The dashboard's loading, empty, error and fixture states become one file: skeletons in the shape of the page, cards with one clear action, no amber block"

---

### Task 4: Hero, SectionNav, Provenance

**Files:**
- Create: `apps/web/src/dashboard/Hero.tsx` + `hero.css`, `SectionNav.tsx` + `section-nav.css` + `SectionNav.test.tsx`, `Provenance.tsx` + `provenance.css`
- Modify: `Dashboard.tsx` lines 656–770 (`<header className="rp-hero">` through `</aside>`); move `SECTIONS` and `useActiveSection` (139–191) into `SectionNav.tsx` (export both; `Dashboard.tsx` imports `useActiveSection` and `SECTIONS`).

**Interfaces:**
- `Hero({ s, S, workspaceName, range, labels })` → `<header className="db-hero" data-testid="hero">` (the e2e's `.rp-hero` maps to this test id in Task 11; keep `data-testid="hero-split"`).
- `SectionNav({ active, S, show })` → `<nav className="db-nav" aria-label={S.reportSectionsLabel} data-testid="section-nav">` with `<div className="db-nav-links">` links (`.rp-nav-links a` → `.db-nav-links a` in Task 11).
- `Provenance({ source })` → `<aside className="db-provenance" data-testid="source" data-mode={source.mode} data-tone={source.tone}>` keeping `source-scope`, `source-coverage`, `data-mode`, `source-freshness` test ids.

- [ ] **Step 1: Failing `SectionNav.test.tsx`** — renders 8 links from `SECTIONS` with `href="#rp-…"`; `active="rp-voice"` → that link has `aria-current="true"` and no other does; `show=false` → no links.
- [ ] **Step 2: Implement** — Hero: eyebrow `Badge tone="neutral"` (`S.dashEyebrow · workspaceName ?? S.dashDemoTag`), `<h1>`, the read sentence, pills as `Badge numeric` in `.db-pills`, the split row as `<p className="db-split" data-testid="hero-split">` with `<span>` + four `Badge`s with the sentiment `tone` mapping (positive→`positive`, negative→`negative`, mixed→`sentiment-mixed`, neutral→`sentiment-neutral`); the `S.readingStored` fallback kept. SectionNav: links styled like `ui-tabs-trigger` (`.db-nav-links { display:flex; gap: var(--space-1); overflow-x:auto; scrollbar-width:thin } .db-nav-links a { padding: 8px 12px; border-radius: var(--radius-2); white-space:nowrap; color: var(--text-2) } .db-nav-links a[aria-current="true"] { background: var(--ml-indigo-50); color: var(--ml-indigo); font-weight:600 }`) — it sits directly under the sticky filter bar and is NOT sticky itself (one sticky element; the e2e "index pinned" test at ~1223 is remapped in Task 11 to measure the filter bar instead — see the table). Provenance: a `Card` with `padding: var(--space-3)`, the badge as `<strong>` in a `Badge tone={source.tone === "warning" ? "warning" : "neutral"}`, the sentences in a wrapping flex row at `--fs-small`.
- [ ] **Step 3: Wire, verify** (vitest dashboard, typecheck, e2e unchanged-failure-set), **commit** (Hero/SectionNav/Provenance files + Dashboard.tsx): "The dashboard's head: hero, section index and provenance as their own components on the tokens"

---

### Task 5: Summary

**Files:** Create `Summary.tsx` + `summary.css`; modify `Dashboard.tsx` lines 1005–1109.

**Interfaces:** `Summary({ s, S })` → `<section className="db-section" id="rp-summary">`; keeps `data-testid` `owner-excluded`, `total`, `replies-count` and any other in the range (list them with `grep -n data-testid` on the range before cutting).

- [ ] Move the markup; KPI tiles → `<Card className="db-kpi"><strong className="db-kpi-value ui-num" data-testid=…>{value}</strong><span className="db-kpi-label">…</span><small className="db-note">…</small></Card>` in `.db-grid`; insight cards → `<Card className="db-insight"><p className="db-insight-tag">{tag}</p><p>{sentence}</p></Card>` (`.rp-insight-tag` → `.db-insight-tag` in Task 11). CSS: `.db-kpi { display:flex; flex-direction:column; gap:4px } .db-kpi-value { font-size: var(--fs-h2); line-height:1.1 } .db-kpi-label { color: var(--text-2) } .db-insight-tag { font-size: var(--fs-small); font-weight:700; color: var(--ml-indigo); margin:0 0 var(--space-1) }`. Verify as before; commit: "The dashboard's summary: KPI and insight cards on ui/Card in one grid".

---

### Task 6: Videos

**Files:** Create `Videos.tsx` + `videos.css`; modify `Dashboard.tsx` lines 1164–1278.

**Interfaces:** `Videos({ s, S, slice, page, perPage, onTurn, onPick })` where `slice = pageSlice(...)` computed in `Dashboard.tsx` as today, `onPick(videoId)` = `applyFilters({ video })`, `onTurn = turnVideoPage`; keeps `data-testid={\`rp-video-${v.id}\`}` and `video-page-state`.

- [ ] Each video a `<Card className="db-video" data-testid=…>`: title `<h3 className="db-card-title">`, the counts as `Badge numeric`, the split bar as `<div className="ui-split" role="img" aria-label={…same label as today…}>{four <i className={label} style={{flexGrow: pct}}/>}</div>` (read how the current inline bar computes its widths and keep that arithmetic), the «تصفية» action as `Button variant="ghost" size="sm"` (keep its current `aria-label`/text). Pager: `.db-pager` with two `Button variant="secondary" size="sm"` and the `<p data-testid="video-page-state" aria-live="polite">`. CSS: `.db-video { display:grid; grid-template-columns: 1fr auto; gap: var(--space-2) var(--space-4); align-items:center } .db-video .ui-split { grid-column: 1 / -1 }` + a 480px one-column rule. Verify; commit: "The dashboard's videos as cards with the shared split bar".

---

### Task 7: Voice and Timing (the charts)

**Files:** Create `ChartFigures.tsx` (moved from `Dashboard.tsx:101-133`, class `db-figures`), `Voice.tsx` + `voice.css`, `Timing.tsx` + `timing.css`; modify `Dashboard.tsx` lines 1279–1616.

**Interfaces:** `Voice({ s, S, lang, labels, topicName })` → `#rp-voice`; `Timing({ s, S, hours, weekdays, weeks })` → `#rp-timing`. Keep `data-testid`: `unmeasurable-*`, `topics-card`, `topics-unclassified`, `weeks-unplottable`, `hours-excluded`, `unknown-dates`, and the chart wrappers get `data-testid="chart-donut"`, `"chart-topics"`, `"chart-weekly"`, `"chart-hourly"`, `"chart-weekday"` (for the Task 11 remap of `.rp-chart-donut`, `.rp-chart-topics`, `.rp-chart`, `.rp-chart-tall`, `.rp-figures`, `.rp-figures-row`).

- [ ] Each chart in a `Card`: `<h3 className="db-card-title">`, the `<div className="db-chart" aria-hidden="true" data-testid=…>` (height 260px; `db-chart--tall` 320px for the weekly line) holding the `react-chartjs-2` element with `options` from `chartOptions.ts` (Task 1), the legend (doughnut) as today with the swatch inline style, the `ChartEmpty` states from Task 3 for the three "not enough to draw" sentences (keep their test ids on the sentence element), then `<ChartFigures …/>`. The three figure cards after the topics chart keep their classes → `db-figures-row` on their grid. `ChartFigures` renders `<details className="db-figures">` styled: `summary { cursor:pointer; color: var(--ml-indigo); font-size: var(--fs-small) } table { width:100%; font-size: var(--fs-small) }`. Timing grid: `.db-grid--charts { display:grid; grid-template-columns: 2fr 1fr 1fr; gap: var(--space-4) }` with the weekly card `grid-column: span 3` at ≤ 900px handled by the `db-grid--charts` mobile rule in `dashboard.css`. Verify (the three timing e2e tests + `topics-*` tests); commit: "The dashboard's charts in cards, one set of options, the figures table beside each".

---

### Task 8: People, Compare, Engaged

**Files:** Create `People.tsx` + `people.css`, `Compare.tsx` + `compare.css`, `Engaged.tsx` + `engaged.css`; modify `Dashboard.tsx` lines 1617–1828.

**Interfaces:** `People({ s, S, people, by, onBy })` (`peopleBy` state stays in `Dashboard.tsx`), `Compare({ s, S, labels, onPick })`, `Engaged({ s, S, lang })`. Keep every `data-testid` in the ranges (`rp-person-*`, `rp-anonymous`, `comparison-scope`, `compare-*`, `engaged-panel`, `engaged-empty`, `engaged-*`, `engaged-truncated`, `engaged-unranked`).

- [ ] People: `ui/Tabs` (`Tabs value={by} onValueChange={onBy}`, `TabsList aria-label={…the current group label…}`, two `TabsTrigger`s with the current button texts — the e2e clicks them by role `button`? check: `grep -n "الأكثر تأثيرًا\|الأكثر نشاطًا" tests/e2e/dashboard.spec.ts`; if it uses `getByRole("button")`, the Task 11 table maps it to `getByRole("tab")`), the ranked list as `<ol className="db-ranked">` of `Card` rows. Compare: `ui/Table` (`Table`, `TableHead`, `TableRow`, `TableHeader`, `TableCell`, `TableBody` — read `ui/Table.tsx` for the exact exports) with the split bar in the last cell; the `<caption>`/aria-label kept so `getByRole("table", { name: … })` still resolves; **≤ 760px**: render a second markup — `<div className="db-compare-cards">` of `Card`s each with `<dl>` (`<dt>` = column header, `<dd>` = value) — using the same `useMediaQuery` from Task 2 (move it to `dashboard/useMediaQuery.ts` now and import in both); rows keep `data-testid={\`compare-${v.id}\`}` in both forms. Engaged: `Card` rows with the like count as `Badge numeric`. Verify; commit: "The dashboard's commenters, comparison and most-engaged sections on tabs, table and cards".

---

### Task 9: Comments — cards, export, table, pager

**Files:** Create `Comments.tsx` + `comments.css`, `CommentsTable.tsx`; modify `Dashboard.tsx` lines 1829–2028 and 2200–2225 (leave the review form 2029–2199 in place for Task 10).

**Interfaces:** `Comments({ s, S, lang, labels, cards, cardTab, onCardTab, cursors, onGo, isFetching, cursorNotice, exporting, onExport, onReview, onTopicReview, topicName, mode, children })` — `children` is where `Dashboard.tsx` still renders the review form until Task 10 (then the dialog). Keep test ids: `comments-table`, `rp-cards`, `cursor-notice`, `export-error`, `topic-chip`, `page-state`, and every id inside the table rows (list them: `grep -n data-testid` on 1829–2028).

- [ ] Cards tabs → `ui/Tabs` (three triggers with the current texts; the card list is not a panel — same pattern as `ProductWindow`: pass `aria-controls={undefined}` on the triggers); each card a `Card` with author, sentiment `Badge` + confidence `small` (keep the `data-state`/`small` markup the e2e reads at lines ~406–693 — check whether those `locator("small")` calls target this section or `/sync`; if the dashboard, keep `<small data-state>` exactly), the text, date, likes. Export: `Button variant="secondary"` in `<div className="db-export">` (`.export` → `.db-export` in Task 11) with the sentence and `export-error`. Table: `CommentsTable` on `ui/Table` keeping the caption (`getByRole("table", { name: /التعليقات ضمن/ })`), columns, the sentiment/topic chips (`Badge`), the two correction `Button variant="ghost" size="sm"`s per row calling `onReview(c, e.currentTarget)` / `onTopicReview(c, e.currentTarget)`; ≤ 760px the stacked-card form with the same test ids. Pager as in Task 6. Verify; commit: "The dashboard's comments: tabs, cards, export and the table on ui/Table, stacked on a phone".

---

### Task 10: `ReviewDialog`

**Files:** Create `ReviewDialog.tsx`, `ReviewDialog.test.tsx`; modify `Dashboard.tsx` — remove lines 2029–2199 (the `<form className="review">`), the `reviewFormRef`, the focus effect (405–407) and the Escape effect (413–429); keep `reviewing`, `verdict`, `reviewKind`, `topicVerdict`, `reason`, `reviewTriggerRef`, `closeReview`, `startReview`, `startTopicReview`, `review`, `topicReview`.

**Interfaces:**
```ts
export function ReviewDialog(props: {
  reviewing: LabelledComment | null; kind: "sentiment" | "topic";
  verdict: Label; onVerdict: (l: Label) => void; topicVerdict: string; onTopicVerdict: (k: string) => void;
  reason: string; onReason: (r: string) => void; topics: Snapshot["topics"]; topicName: (k: string) => string;
  labels: Record<Label, string>; S: Strings; lang: Locale; persisted: boolean;
  busy: boolean; error: Error | null; onSubmit: () => void; onClose: () => void;
}): JSX.Element
```

- [ ] **Step 1: Failing test** (jsdom, `DirectionProvider dir="rtl"`): with `reviewing` set and `kind="sentiment"`, `getByRole("form", { name: ar.reviewFormLabel })` exists and **has focus**; `getByTestId("review-text")` shows the comment; `getByLabelText(ar.correctLabel)` is a combobox; `getByLabelText(ar.correctionReason)` is required; submitting with an empty reason does not call `onSubmit`; typing a reason and submitting calls `onSubmit` once; Escape calls `onClose`; with `busy=true` Escape does NOT call `onClose` and the save button is disabled; `error = new Error("stale_comment_text")` renders `getByTestId("review-error")` with `ar.reviewStale`; `kind="topic"` renders `getByRole("form", { name: ar.reviewTopicTitle })` and `getByLabelText(ar.correctTopicLabel)`; `persisted=false` renders `review-scope`.

- [ ] **Step 2: Implement** — `Dialog open={!!reviewing} onOpenChange={(next) => { if (!next && busy) return; if (!next) onClose(); }}`; `DialogContent closeLabel={S.cancel} aria-describedby={undefined} onOpenAutoFocus={(e) => { e.preventDefault(); formRef.current?.focus(); }} onCloseAutoFocus={(e) => { e.preventDefault(); /* Dashboard's closeReview focuses the trigger */ }}`; inside, the SAME form markup moved from lines 2030–2198 with: `<form ref={formRef} tabIndex={-1} aria-label={…} onSubmit={e => { e.preventDefault(); onSubmit(); }}>`, `<DialogTitle asChild><h3>…</h3></DialogTitle>`, the history `<ol className="db-history">` kept verbatim (test ids `review-history`, `review-by`, `review-reason`), the verdict select as `ui/Select` labelled `S.correctLabel` / `S.correctTopicLabel` (the `Labelled` helper from Task 2 — export it from `FilterBar.tsx` or move it to `dashboard/Labelled.tsx` now), the reason as `Input required maxLength={500}` labelled `S.correctionReason`, the error line, `Button type="submit" disabled={busy}` «حفظ» and `Button variant="ghost" type="button" onClick={onClose} disabled={busy}` «إلغاء», the fixture-scope note. Radix's Escape handling calls `onOpenChange(false)` → the busy guard above refuses it.
  In `Dashboard.tsx`: `<ReviewDialog reviewing={reviewing} kind={reviewKind} … busy={(reviewKind === "topic" ? topicReview : review).isPending} error={(…).error ?? null} onSubmit={() => (reviewKind === "topic" ? topicReview : review).mutate()} onClose={() => { review.reset(); topicReview.reset(); closeReview(); }} />` rendered as the `children` of `Comments` (Task 9) — the same place the form stood, so `getByRole("form")` inside `#rp-comments` scoping (if any test scopes it) still matches; check `grep -n "rp-comments.*form\|comments-table.*form" tests/e2e/dashboard.spec.ts` — if a test scopes the form inside the section, it will not find a portaled dialog; in that case the Task 11 table de-scopes that locator to `page.getByRole("form", …)`.

- [ ] **Step 3: Verify** — `npx vitest run apps/web/src/dashboard/ReviewDialog.test.tsx`; typecheck; e2e: the review tests (`grep -n "تصحيح" tests/e2e/dashboard.spec.ts | wc -l` ≈ 20) — expect the focus/Escape ones to pass and the `selectOption` ones to fail until Task 11.
- [ ] **Step 4: Commit**: "The correction form is a ui/Dialog: focus lands on the form, Escape closes it unless a save is in flight, and the row's button gets focus back".

---

### Task 11: Cut-over — drop `report.css`, migrate the e2e selectors, delete the shim

**Files:**
- Modify: `apps/web/src/dashboard/Dashboard.tsx` (remove `import "../report.css"` and the `rp-page` class; grep the file and every `dashboard/*.tsx` for `rp-` — only the section ids `id="rp-…"` may remain), `apps/web/src/main.tsx` + any test importing `./Dashboard` (→ `./dashboard/Dashboard`), `tests/e2e/dashboard.spec.ts`
- Delete: `apps/web/src/Dashboard.tsx` (the shim)
- Create: `apps/web/src/dashboard/noReportCss.test.ts`

- [ ] **Step 1: Guard test** — `noReportCss.test.ts` reads every `apps/web/src/dashboard/*.tsx` and asserts none contains `className="rp-` / `className={\`rp-` / `report.css`, and that `main.tsx` imports `./dashboard/Dashboard`.

- [ ] **Step 2: e2e helper** — at the top of `tests/e2e/dashboard.spec.ts`:
```ts
/** Choose an option in a ui/Select (Radix): open the labelled trigger, pick the
 *  option by its visible text. The native selects this file drove with
 *  selectOption() are gone; this is the one place that knows how the new
 *  control opens. */
async function pick(page: Page, label: string | RegExp, option: string) {
  await page.getByLabel(label).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
```
Replace each `await page.getByLabel(X).selectOption(V)` with `await pick(page, X, <the option's visible text>)` — `V` is a value (`"replies"`, `"negative"`, `"50"`, …); the option text is the string the old `<option>` rendered for it (`S.repliesOnly`, `ar.labels.negative`, `"50"`, …). Do it site by site (31); for the review dialog's selects the label is `"التصنيف الصحيح"` / `"الموضوع الصحيح"`. Where a test drove a filter that now lives behind «المزيد» (participation, review status, video kind, comment type, topic, per page) insert `await page.getByRole("button", { name: /المزيد/ }).click();` before the `pick` and after it press `Escape` only if the next action needs the popover closed (the apply button is outside the popover — clicking it closes the popover anyway). The keyboard test (~line 866–872): replace `.focus()` + `.toBeFocused()` + `selectOption` with: open «المزيد» by keyboard (`page.getByRole("button", { name: /المزيد/ }).focus(); keyboard.press("Enter")`), then `page.getByLabel("نوع المشاركة").focus(); expect(...).toBeFocused(); keyboard.press("Enter"); page.getByRole("option", { name: "الردود فقط" }).click()` — the assertion "operable from the keyboard alone" survives (keyboard opens, focus visible).

- [ ] **Step 3: Selector mapping** — apply exactly:

| old | new |
| --- | --- |
| `page.locator(".rp-hero")` (lines 8, 51, 52) | `page.getByTestId("hero")` |
| `page.locator(".rp-chart-donut")` (915) | `page.getByTestId("chart-donut")` |
| `page.locator(".rp-chart:not([hidden]), .rp-chart-tall")` (972) | `page.locator("[data-testid^='chart-']:not([hidden])")` |
| `page.locator(".rp-figures")` (973) | `page.locator(".db-figures")` |
| `page.locator(".rp-nav-links a")` (1035) | `page.locator(".db-nav-links a")` |
| `page.locator(".rp-figures-row")` (1075) | `page.locator(".db-figures-row")` |
| `page.locator(".rp-insight-tag")` (1148) | `page.locator(".db-insight-tag")` |
| the line-width selector list (1172) `.rp-sub, .rp-hero p, .rp-page .muted, .rp-page .rp-metric-note` | `.db-lead, .db-hero p, .db-page .db-muted, .db-page .db-note` |
| the font-family selectors at ~1201 (read the list) | the `db-*` equivalents of each (KPI value `.db-kpi-value`, a sentence `.db-lead`, …) |
| the pinned-index test (~1223–1260) measuring `.rp-nav` against `.app-rail` | measure `.db-filterbar` (the one sticky element now): `r(".db-filterbar")` and keep the same geometric assertions |
| the alpha-floor list (1269) `[".rp-card", ".rp-nav", ".review"]` | `[".ui-card", ".db-filterbar", "[role='dialog']"]` (open a review first for the last one, or drop `.review` and say so) |
| `document.querySelector(".export")` (1339) | `document.querySelector(".db-export")` |
| `card.locator(".rp-chart-topics")` (1925) | `card.getByTestId("chart-topics")` |
| `getByRole("form", { name: "تصحيح التصنيف" })` / `"تصحيح الموضوع"` | unchanged (the dialog's form keeps role + name); if a locator was scoped inside `#rp-comments`, de-scope to `page.` |
| People tabs clicked by `getByRole("button", { name: "الأكثر تأثيرًا" })` etc. | `getByRole("tab", …)` |
| Comments card tabs (`الأكثر إعجابًا` / `الأحدث` / `النقدية`) by button | `getByRole("tab", …)` |

- [ ] **Step 4: Two new tests** (append): (a) `"the filter bar stays on screen"` — goto `/dashboard`, `page.mouse.wheel(0, 2000)`, `expect(page.getByRole("form", { name: "الفلاتر" })).toBeInViewport()`; (b) `"at phone width the filters open as a sheet and nothing overflows"` — viewport 390×844, `expect(page.getByRole("button", { name: /الفلاتر/ })).toBeVisible()`, click it, `expect(page.getByRole("dialog").getByLabel("الفيديو")).toBeVisible()`, Escape, then for widths 320/390/768 assert `scrollWidth <= innerWidth`.

- [ ] **Step 5: Switch importers and delete the shim** — `main.tsx:25` (and `entry-prerender.tsx` if it imports Dashboard — grep) → `./dashboard/Dashboard`; `git rm apps/web/src/Dashboard.tsx`; any unit test that imported `./Dashboard` → `./dashboard/Dashboard`.

- [ ] **Step 6: Run everything** — `npx vitest run apps/web` (all), `npm run typecheck`, `npm run lint`, `npm run build -w @sentiment/web > /tmp/build.log 2>&1; echo $?`, `npm run test:e2e -- tests/e2e/dashboard.spec.ts tests/e2e/app-shell.spec.ts > /tmp/e2e.log 2>&1; echo exit=$?` → **78 + 8 passed**. Screenshots to `.superpowers/sdd/2026-09-17-dashboard-redesign/shots/`: `dashboard-desktop.png` (1280, full page), `dashboard-390.png`, `dashboard-390-sheet.png` (sheet open), `dashboard-review.png` (dialog open). Look at them: no overflow, no overlap, the bar readable over content when scrolled.

- [ ] **Step 7: Commit** (all touched paths + the deletion): "The dashboard is the new page: report.css no longer loads on it, the browser suite reads the new controls through one pick() helper, two tests for the sticky bar and the phone sheet, the old path deleted".

---

### Task 12: Records and the full check

**Files:** append to `docs/progress.md`, `docs/decisions.md`, `docs/coordination/ACTIVE.md`; `docs/verification.md` only if `git status --short docs/verification.md` is empty.

- [ ] `npm run check` → green; paste tallies.
- [ ] `docs/progress.md`: what moved where (the file map), the e2e migration (31 `pick()` sites, the selector table, 2 new tests), the screenshots' paths. `docs/decisions.md`: the sticky bar + «المزيد» split; `""`↔`"__all"` sentinel for Radix Select; the review dialog's focus rules (form focused on open, trigger on close, busy refuses close); the `.ui-split` lift; `report.css` kept for `/sync` until phase 4; chart tooltip colour hard-coded to `--text-1`'s value because canvas cannot read a variable (and the test that pins it). `ACTIVE.md`: the row for `apps/web/src/dashboard/**` done, and "phase 4: retire report.css".
- [ ] Commit: "docs: record the dashboard rebuild".

---

## Self-review

- **Spec coverage:** structure (T1, T11), filter bar + chips + sheet (T2), sections 1–11 (T4–T10), charts/options (T1, T7), states (T3), mobile (T2 sheet, T8/T9 stacked tables, T11 test), testing (each task + T11), out-of-scope respected (no data/analytics edits). The spec's `EmptyState kind="chart"` is `ChartEmpty` in T3/T7.
- **Placeholders:** the section tasks move existing code by line range and specify the transformation and the new CSS in full; no "TBD".
- **Type consistency:** `Snapshot` (T1) used by every section; `FilterValues`/`Chip` (T2) used by `ActiveFilters` and `Dashboard.tsx`; `Labelled` (T2) reused by T10; `useMediaQuery` (T2 → moved in T8) used by T8/T9; test ids listed per task match the e2e mapping in T11.
