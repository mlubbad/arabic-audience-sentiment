# The landing page rebuilt on the design system (design)

2026-09-17. Phase 2 of the pre-launch UI roadmap (`2026-09-16-ui-foundation-design.md`
is phase 0, `2026-09-16-app-shell-design.md` phase 1). Approved in conversation; this is
the written form.

## What changes and why

The landing (`Landing.tsx`, 512 lines; `landing.css`, 1735 lines) was built on
2026-09-13 from a Supermetrics-derived reference, before the product had a design system.
Phase 0 reached it only at the edges — sentiment colours from `brand.css`, a four-step type
scale, the glass header, the shared brand mark. What remains is structural: the hero shows
a generated 3D illustration that looks like no screen in the product; the demo section
draws its own donut and buttons in its own CSS; the seven sections each carry their own
spacing, container width and card styling; the FAQ is a bare `<details>`; the mobile menu
is a toggled `<nav>`; and `landing.css` also hosts the pricing page's 48 rules and the legal
pages' rules, so the three public pages copy the same header and footer markup by hand and
import the whole file.

The copy does not change. Every sentence on the page is a place in the keyword map
(`docs/seo.md` §2) and is guarded by `seo.test.ts` and `tests/e2e/seo.spec.ts`; the FAQ
questions feed the `FAQPage` JSON-LD in order. This is a rebuild of the surface — layout,
rhythm, components, mobile, motion — under the same words, the same section order and the
same section `id`s.

Decisions taken in conversation, in the order they were made:

1. Full visual rebuild; the seven sections keep their order and their words.
2. The hero carries a live product window built from `ui/` components, prerendered — not
   an image.
3. One `ProductWindow` component in two modes: still in the hero, interactive in the demo.
4. A rewrite into a `landing/` folder with one file per section, not an in-place edit and
   not Tailwind utilities.

## Structure

```
apps/web/src/public/
  PublicShell.tsx      announcement band, header, mobile sheet, footer, skip link
  public.css           the shell's rules only
  PublicShell.test.tsx
apps/web/src/landing/
  Landing.tsx          composition: <PublicShell> + the eight sections, PageHead, usePublicLocale
  Hero.tsx / hero.css
  Why.tsx / why.css
  Demo.tsx / demo.css
  Benefits.tsx / benefits.css
  Audience.tsx / audience.css
  Trust.tsx / trust.css
  Faq.tsx / faq.css
  Closing.tsx / closing.css
  ProductWindow.tsx / product-window.css / ProductWindow.test.tsx
  demoData.ts          the four authored comments and the share arithmetic
  landing.css          the page's shared rules only: `.landing` root, tokens, container, section rhythm, motion
apps/web/src/pricing.css   the 48 pricing rules, moved verbatim from the old landing.css
apps/web/src/legal.css     the legal rules, moved verbatim
apps/web/src/ui/Accordion.tsx (+ test)   new primitive
apps/web/src/ui/Dialog.tsx               gains variant="sheet"
```

`apps/web/src/Landing.tsx` becomes a one-line re-export of `./landing/Landing` until every
importer (`main.tsx`, `publicPaths`/route tables, tests) is moved, then it is deleted with
the old `landing.css`. There is no period in which an element on the page is styled by both
the old file and a new one: a section is cut over whole, or not at all.

`PricingPage.tsx` and `LegalPage.tsx` adopt `PublicShell` and import `pricing.css` /
`legal.css` in place of `landing.css`. Their bodies are not redesigned here (phase 5 owns
pricing); moving their rules is a cut-and-paste with the selectors unchanged, proven by a
before/after screenshot pair in the verification entry.

## The shell (`PublicShell`)

- Props: `locale`, `current: "home" | "pricing" | "legal"`, `children`. It renders the
  announcement band with `LanguageSwitch` (the `to` is `publicPath(current, otherLocale)`),
  the header, the `<main id="landing-content">` wrapper around `children`, and the footer
  with `LegalLinks`. The skip link targets `#landing-content` on every page, as today.
- Header: brand link (mark + name + dot), nav (`#why`, `#experience`, `#questions`,
  pricing) — on the pricing and legal pages the three hash links point to
  `publicPath("home", locale) + "#why"` etc. so they still work — and the account CTA as a
  `ui/Button variant="secondary" size="sm"` rendered `asChild` over a `Link`.
- Mobile (≤ 900px): the nav collapses behind one `ui/Button variant="ghost"` with
  `aria-controls`/`aria-expanded`; pressing it opens `ui/Dialog variant="sheet"` from the
  inline-start edge (right in RTL, left in LTR) containing the same nav links and the
  account CTA stacked at 44px min-height. Escape and overlay close it; focus lands on the
  first link on open and returns to the button on close (Radix does this); the page behind
  is `aria-hidden` and scroll-locked (Radix does this too). Choosing a link closes the
  sheet.
- The header is not sticky (`.landing { overflow: clip }` breaks `position: sticky`, as
  the current file documents); it stays a glass level-2 pane on the same tokens.

## `ProductWindow`

The one picture of the product on the page, drawn from the product's own parts.

- Props: `mode: "still" | "interactive"`, `locale`, and for interactive an optional
  `initial` label. Both modes render the same tree; `still` has no state, no handlers, and
  its filter row is plain `<span>`s with the first marked `aria-current="true"` rather than
  buttons — a screenshot must not offer controls that do nothing.
- Frame: a window chrome bar (three dots, the workspace name `S.lpDemoBrand`, the caption
  `S.lpDemoLabel` «مثال توضيحي · 4 تعليقات مؤلّفة» at the end) over a `ui/Card` body.
- Body, top to bottom: the label `S.lpDemoChartLabel`; two figures side by side in
  `ui/Card` at `padding: 12px` — comments in selection (`S.lpDemoInSelection`) and the
  four-way split as a **stacked distribution bar** (one `div` with four flex children, each
  `background: var(--sentiment-<label>)`, width = share%, `role="img"` with the same
  `aria-label` the donut carries today: every label and its percentage joined by
  `S.listSeparator`); a legend of four `<span>`s each with `<i class="lp-dot <label>">`
  (neutral carries no modifier — the e2e colour test reads exactly these selectors);
  the filter as `ui/Tabs` (`all` + four labels, `aria-label={S.lpDemoFilterLabel}`); and
  the comment list, each row an avatar initial, the Arabic text with `lang="ar"`
  `dir="rtl"`, and a `ui/Badge` with the sentiment tone (`positive` / `negative` / `sentiment-mixed` / `sentiment-neutral`). The list is `aria-live="polite"`
  in interactive mode only.
- The arithmetic moves to `demoData.ts` unchanged: `shown = examples.filter(all || match)`;
  each label's share = matches in `shown` / `shown.length` × 100; digits through
  `Intl.NumberFormat("ar", {numberingSystem: "arab"})` on the Arabic page and `"en"` on
  the English one, percent sign «٪» / `%`. A selected label therefore shows 100% of one
  colour and one comment, `all` shows 25% × 4 — the same numbers a visitor sees today.
- Rendered in the prerender like everything else; the still hero window is plain HTML
  before any script runs. No image request above the fold.

## Sections

All sections share: the container `.lp-container { max-width: 1180px; padding-inline:
clamp(16px, 5vw, 64px); margin-inline: auto }`; vertical rhythm `--lp-space-section:
clamp(72px, 10vw, 128px)`; headings on the existing four-step scale (`--lp-t-xs/sm/md/lg`)
plus `h1` `clamp(40px, 5.2vw, 68px)` and `h2` `clamp(28px, 3.4vw, 44px)`, both with the
current negative letter-spacing on Latin only — on Arabic `letter-spacing: 0` stays
load-bearing; eyebrows as `ui/Badge tone="neutral"`; cards as `ui/Card`; buttons as
`ui/Button`. Backgrounds alternate white → `var(--surface-2)` → white; only the closing
section is dark, on `--lp-dark`, the one page-private token that stays.

1. **Hero** (`aria-labelledby="hero-title"`): two columns `1.1fr 1fr` at ≥ 1024px, copy
   at the inline start, the still `ProductWindow` at the end tilted by nothing — flat,
   with the level-2 glass ring and a soft indigo halo behind it (`radial-gradient` on
   `--ml-indigo` at 12% alpha, `aria-hidden`). Below 1024px one column, the window under
   the copy, full width, `max-width: 560px`. Copy: eyebrow with the ▶ chip, the H1's three
   lines unchanged, the lead, two actions (`primary` → `/dashboard` «استكشف اللوحة
   التجريبية», `ghost` → `#experience` «شاهد كيف تعمل»), the caption `S.lpHeroNote`. The
   value strip (`S.lpValue1..4`) stays as the hero's last row, four `Badge`s in a wrapping
   flex row. The generated illustration, the two floating cards and the decorative
   `lp-hero-word` are removed from the hero; the illustration file stays on disk as the
   provenance original and the OG image source (`docs/landing.md`), and the sentence that
   was its `alt` (`S.lpHeroAlt`, a keyword-map place) becomes the `<figure>`'s
   visually-hidden `<figcaption>` around the still window, so the accessible name and the
   searchable sentence survive; `docs/seo.md` §2's "Hero image alt" row is annotated
   accordingly in the closing task.
2. **Why** (`id="why"`): the H2's two lines, the paragraph at `--lp-t-lg` and
   `max-width: 62ch`, the «قرّب الصورة ↓» text link to `#experience`. Centred, on
   `--surface-2`.
3. **Demo** (`id="experience"`): eyebrow «جرّب الفكرة», the H2, the lead, then the
   interactive `ProductWindow` full-width inside the container, then the text link «اكتشف
   الفلاتر والتصحيح والتصدير في اللوحة ←» to `/dashboard` as `Button variant="secondary"`.
4. **Benefits**: three `ui/Card`s in a grid `repeat(auto-fit, minmax(280px, 1fr))`, each
   with its ordinal label («01 / افهم») as a `Badge`, the H3, the paragraph. No icons — the
   ordinals are the marks.
5. **Audience** (`aria-labelledby="audience-title"`): eyebrow, H2, then `ui/Tabs` for
   creator / agency (the `audience` state as today), and the panel: eyebrow, H3, text, the
   three ✓ tags as `Badge tone="neutral"` with a leading ✓ glyph — not `positive`, because
   the sentiment green means one thing on this page and a feature tag is not it; the
   «استكشف تجربة العمل ←» link; and beside it the workspace mini-window (`lp-workspace-
   window`, rebuilt on `Card` with the same three lines: the space name, «فهمٌ أعمق
   للمحتوى», «تصفية واحدة، صورة متّسقة», the illustrative-data caption).
6. **Trust** (`aria-labelledby="trust-title"`): eyebrow, the H2's two lines, the lead, three
   `Card`s in the same grid as Benefits, each with its glyph (◉ ↻ ↖) in a 40px indigo-tint
   circle, the H3 and the paragraph. On `--surface-2`.
7. **FAQ** (`id="questions"`, `aria-labelledby="faq-title"`): eyebrow «قبل أن تبدأ», the
   H2, the lead, then `ui/Accordion type="single" collapsible` with one item per pair from
   `S.lpFaq`; the trigger is the question, the content the answer. The DOM order of the
   questions is the JSON-LD's order, as now.
8. **Closing**: dark band, the brand mark in `--ml-indigo-300`, the H2's two lines in
   white, the lead in `--ml-indigo-100`, the `primary` button to `/dashboard` (light
   indigo on dark, the current 44px treatment), the caption. The decorative `lp-orbit`
   ring is kept as one `aria-hidden` element with a `conic-gradient`, `prefers-reduced-
   motion` respected (it never animates).

Footer: brand, the three nav links, `LegalLinks`, the bottom line — unchanged in content,
restyled on the shell's tokens.

## New and changed primitives

- **`ui/Accordion`** — Radix Accordion (`@radix-ui/react-accordion`, a new exact-pinned dependency like its
  siblings), exports `Accordion`,
  `AccordionItem`, `AccordionTrigger`, `AccordionContent`. The trigger is a `<button>`
  inside an `<h3>` (Radix's `Header` renders the heading; the landing passes `asChild`
  with `h3`), 44px min-height, a chevron that rotates 180° on `[data-state=open]` with a
  `transform` transition under `prefers-reduced-motion: no-preference`; content animates
  height via Radix's `--radix-accordion-content-height` the same way. `letter-spacing: 0`
  on the trigger text. Styled in `ui.css` on `brand.css` tokens like every other
  primitive; test file proves open/close by click and keyboard, the `aria-expanded` state,
  and the DirectionProbe pattern is not needed (no portal).
- **`ui/Dialog variant="sheet"`** — `DialogContent` accepts `variant?: "center" | "sheet"`
  (default `center`). `sheet` anchors the content to the inline-start edge, full height,
  `max-width: 360px`, slide-in from that edge (`translateX` in the logical direction via
  `[dir="rtl"]` selectors), same overlay, same z-index slot (60/61). `Dialog.test.tsx`
  gains one case: a sheet in an RTL `DirectionProvider` has `data-variant="sheet"` and
  its computed `inset-inline-start` is `0`.

## Motion

One rule: `.lp-reveal { opacity: 0; translate: 0 12px; transition: opacity 320ms, translate
320ms }` and `.lp-reveal.is-in { opacity: 1; translate: 0 }`, applied by a single
`useReveal()` hook (an `IntersectionObserver` at `threshold: 0.15`, marks once, disconnects)
on each section's root — and the whole block sits inside
`@media (prefers-reduced-motion: no-preference)`, so with reduced motion the sections are
simply visible. The prerendered HTML carries no `.lp-reveal` (the hook adds the class on
mount), so a visitor without JavaScript, or before hydration, sees the page. The
distribution bar's segment widths transition 240ms under the same media query. Nothing
loops, nothing follows the scroll.

## Performance guardrails

The other session's Core Web Vitals work today (`3259f59`, `0f5a738`: WOFF2 preloads,
size-adjusted fallbacks, deferred Paddle.js, low-priority bundle) is kept whole. This
rebuild must not undo it:

- No new font, no new image above the fold; the hero's LCP element becomes the H1 (text,
  already in the prerendered HTML) instead of the 29 kB WebP.
- CLS on the hero: 0 — the still window has fixed proportions (`aspect-ratio: 4 / 3` at
  the container's width) so nothing shifts when scripts arrive.
- The landing's CSS (all `landing/*.css` + `public.css`) ≤ 60% of the old `landing.css`
  by bytes after Vite minification.
- Measured in the closing task with Lighthouse mobile against the preview build, before
  and after, recorded in `docs/verification.md`; a regression on LCP or CLS blocks the
  cut-over.

## Testing

- Unit (Vitest, jsdom): `ProductWindow.test.tsx` — still mode renders no buttons and the
  four shares at 25%; interactive mode: clicking a tab filters the list to one comment,
  the bar to one 100% segment, the live region updates; Arabic digits on `ar`, Western on
  `en`. `Accordion.test.tsx` as above. `PublicShell.test.tsx` — the sheet opens from the
  menu button, traps focus, closes on Escape and on a link. `Dialog.test.tsx` sheet case.
- e2e (Playwright, existing `landing.spec.ts`): the six tests stay; the demo test's
  selectors move from `.lp-demo-filters button` to the tab roles; the mobile test opens the
  sheet instead of the toggled nav; contrast, the Arabic size floor and the colour-language
  test run unchanged. `seo.spec.ts` unchanged. One new test: `/pricing` and the legal
  pages render the shared header and their own body.
- `npm run check` green; the prerender still writes all eight pages.

## Out of scope

Any change to copy or SEO data; redesign of the pricing or legal bodies (rules move,
selectors stay); new imagery; a dark theme for the landing; analytics or lead capture.
