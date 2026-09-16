# Landing Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the landing page's seven sections on `ui/` + `brand.css` under the same words, with a live `ProductWindow` in the hero, one `PublicShell` for the three public pages, an `Accordion` FAQ and a sheet-style mobile menu — and delete the old `Landing.tsx` / `landing.css`.

**Architecture:** New code lives in `apps/web/src/public/` (the shell) and `apps/web/src/landing/` (sections, `ProductWindow`, demo data, shared page CSS). Every new file is additive and unreachable until Task 10 switches the route import; the pricing and legal pages adopt the shell in Task 4 and stop importing the old `landing.css` at that moment. No element is ever styled by the old file and a new one at once, because no page imports both.

**Tech Stack:** React 19, React Router 7, Radix (`react-accordion` new, `react-dialog`, `react-tabs`), `class-variance-authority`, Vite 6 prerender + hydration, Vitest (jsdom, `globals: false`), Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-landing-redesign-design.md`

## Global Constraints

- **Copy is frozen.** No string in `apps/web/src/strings/ar.ts` / `en.ts` changes; no new key is needed by this plan. Section `id`s stay: `why`, `experience`, `questions`; heading ids `hero-title`, `why-title`, `experience-title`, `audience-title`, `trust-title`, `faq-title`; skip target `#landing-content` on the landing.
- **Tokens only.** Colours come from `brand.css` variables; sentiment colours only from `--sentiment-positive|negative|neutral|mixed`. No hex literal in any new `.css` or `.tsx` except `--lp-dark: #25223f` (the one page-private token the spec keeps).
- **`letter-spacing: 0` on Arabic is load-bearing.** Negative tracking only under `.landing:lang(en)` / `[dir="ltr"]` selectors. `ui/letterSpacing.test.ts` forbids non-zero `letter-spacing` anywhere under `ui/`.
- **Legend selectors are a contract.** The e2e colour test reads `.lp-dot.positive`, `.lp-dot.negative`, `.lp-dot.mixed` and `.lp-dot:not(.positive):not(.negative):not(.mixed)`; `ProductWindow` renders exactly `<i className={\`lp-dot ${label}\`} />`.
- **Another session edits this checkout.** Before every commit run `git status --short`; stage only your own files by exact path (`git add <path> …`), never `git add -A` / `-u` / `.`. Never edit, stage or stash `apps/web/src/landing.css`, `docs/verification.md`, or any file that is modified and not yours. The old `landing.css` is deleted only in Task 10 and only if `git status` shows it clean.
- **Dependencies** are exact-pinned (`.npmrc` has `save-exact=true`); install with `npm i -w @sentiment/web <pkg>@<exact>` and commit `package.json` + `package-lock.json`.
- **Tests:** unit files that render DOM start with `// @vitest-environment jsdom` and import `"@testing-library/jest-dom/vitest"`; `vitest.setup.ts` already registers RTL cleanup. Run a file with `npx vitest run <path>`. e2e: `npm run build && npm run test:e2e -- <file> > /tmp/e2e.log 2>&1; echo exit=$?` (redirect, then read the file — the exit code is otherwise lost).
- **Format before commit:** `npx prettier --write <the files you touched>` (not `npm run format`, which reflows files that are not yours).
- **Docs are append-only:** `docs/progress.md`, `docs/decisions.md`, `docs/coordination/ACTIVE.md` — dated entries at the end, never edited above.
- **Commit message style** in this repo is a sentence describing what changed and why, no `feat:` prefix. End every commit with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/src/ui/Accordion.tsx` (+ `.test.tsx`) | Radix accordion styled on tokens; trigger inside a heading |
| `apps/web/src/ui/Dialog.tsx` (+ `.test.tsx`) | gains `variant="sheet"` |
| `apps/web/src/ui/ui.css` | accordion rules, sheet rules, `.ui-sr-only` |
| `apps/web/src/public/PublicShell.tsx` (+ `.test.tsx`), `public/public.css` | announcement, header, sheet menu, footer, skip link, `.landing` root + fonts |
| `apps/web/src/pricing.css`, `apps/web/src/legal.css` | rules moved verbatim from the old `landing.css` |
| `apps/web/src/PricingPage.tsx`, `LegalPage.tsx` | adopt `PublicShell`, import their own CSS |
| `apps/web/src/landing/demoData.ts` | the four comments, `shownFor`, `sharesFor`, numerals |
| `apps/web/src/landing/ProductWindow.tsx` (+ `.test.tsx`), `product-window.css` | the product picture, still / interactive |
| `apps/web/src/landing/landing.css` | container, rhythm, headings, eyebrow, reveal motion, dots |
| `apps/web/src/landing/useReveal.ts` | the one motion hook |
| `apps/web/src/landing/{Hero,Why,Demo,Benefits,Audience,Trust,Faq,Closing}.tsx` + `.css` | one section each |
| `apps/web/src/landing/Landing.tsx` (+ `Landing.test.tsx`) | composition |
| `apps/web/src/main.tsx`, `entry-prerender.tsx` | import the new `Landing` |
| `tests/e2e/landing.spec.ts` | selectors follow the new markup |
| `docs/*` | records |

Every section component has the signature `({ locale }: { locale: Locale }) => JSX.Element` and reads its strings with `useStrings(locale)`; `Locale` is from `../locale`, `useStrings` from `../strings`.

---

### Task 1: `ui/Accordion`

**Files:**
- Create: `apps/web/src/ui/Accordion.tsx`, `apps/web/src/ui/Accordion.test.tsx`
- Modify: `apps/web/src/ui/ui.css` (append), `apps/web/package.json`, `package-lock.json`

**Interfaces:**
- Produces: `Accordion` (Radix Root), `AccordionItem`, `AccordionTrigger({ headingLevel?: 2|3|4 })`, `AccordionContent`. The trigger renders `<hN class="ui-accordion-header"><button class="ui-accordion-trigger">…<span class="ui-accordion-chevron"/></button></hN>`.

- [ ] **Step 1: Install the primitive at its exact current version**

```bash
cd /Users/mlubbad/Documents/Codex/SentimentAnalysis
V=$(npm view @radix-ui/react-accordion version) && npm i -w @sentiment/web "@radix-ui/react-accordion@$V" && grep react-accordion apps/web/package.json
```
Expected: one line `"@radix-ui/react-accordion": "<V>"` with no `^`.

- [ ] **Step 2: Write the failing test**

`apps/web/src/ui/Accordion.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./Accordion";

function Faq() {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="one">
        <AccordionTrigger>سؤال أول</AccordionTrigger>
        <AccordionContent>جواب أول</AccordionContent>
      </AccordionItem>
      <AccordionItem value="two">
        <AccordionTrigger>سؤال ثانٍ</AccordionTrigger>
        <AccordionContent>جواب ثانٍ</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

describe("Accordion", () => {
  it("starts closed and opens on click, with the state on the trigger", async () => {
    render(<Faq />);
    const first = screen.getByRole("button", { name: "سؤال أول" });
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("جواب أول")).not.toBeInTheDocument();
    await userEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("جواب أول")).toBeVisible();
    await userEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "false");
  });

  it("puts each question in a level-3 heading, so the FAQ keeps its outline", () => {
    render(<Faq />);
    expect(
      screen.getByRole("heading", { level: 3, name: "سؤال أول" }),
    ).toBeInTheDocument();
  });

  it("moves between questions with the arrow keys and opens with Enter", async () => {
    render(<Faq />);
    screen.getByRole("button", { name: "سؤال أول" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    const second = screen.getByRole("button", { name: "سؤال ثانٍ" });
    expect(second).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("جواب ثانٍ")).toBeVisible();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run apps/web/src/ui/Accordion.test.tsx`
Expected: FAIL — cannot resolve `./Accordion`.

- [ ] **Step 4: Write the primitive**

`apps/web/src/ui/Accordion.tsx`:
```tsx
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { cn } from "./cn";

/** Radix Accordion on the brand tokens. The trigger sits inside a heading —
 *  level 3 by default — so a list of questions keeps its outline for a
 *  screen reader and for the FAQ structured data that mirrors the page. */
export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      className={cn("ui-accordion-item", className)}
      {...props}
    />
  );
}

export interface AccordionTriggerProps
  extends React.ComponentProps<typeof AccordionPrimitive.Trigger> {
  headingLevel?: 2 | 3 | 4;
}

export function AccordionTrigger({
  className,
  children,
  headingLevel = 3,
  ...props
}: AccordionTriggerProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <AccordionPrimitive.Header asChild>
      <Heading className="ui-accordion-header">
        <AccordionPrimitive.Trigger
          className={cn("ui-accordion-trigger", className)}
          {...props}
        >
          <span className="ui-accordion-trigger-text">{children}</span>
          <span className="ui-accordion-chevron" aria-hidden="true">
            ⌄
          </span>
        </AccordionPrimitive.Trigger>
      </Heading>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      className={cn("ui-accordion-content", className)}
      {...props}
    >
      <div className="ui-accordion-body">{children}</div>
    </AccordionPrimitive.Content>
  );
}
```

- [ ] **Step 5: Append the rules to `ui.css`**

At the end of `apps/web/src/ui/ui.css`:
```css
/* ---- Accordion ---- */
.ui-accordion-item {
  border-bottom: 1px solid var(--border-1);
}
.ui-accordion-header {
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}
.ui-accordion-trigger {
  all: unset;
  box-sizing: border-box;
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 44px;
  padding: var(--space-3) 0;
  font: inherit;
  font-weight: 600;
  color: var(--text-1);
  cursor: pointer;
  letter-spacing: 0;
  text-align: start;
}
.ui-accordion-trigger:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 3px;
  box-shadow: 0 0 0 3px var(--focus-halo);
  border-radius: var(--radius-1);
}
.ui-accordion-chevron {
  flex-shrink: 0;
  color: var(--ml-indigo);
  line-height: 1;
}
.ui-accordion-trigger[data-state="open"] .ui-accordion-chevron {
  transform: rotate(180deg);
}
.ui-accordion-content {
  overflow: hidden;
  color: var(--text-2);
}
.ui-accordion-body {
  padding: 0 0 var(--space-4);
}
@keyframes ui-accordion-down {
  from {
    height: 0;
  }
  to {
    height: var(--radix-accordion-content-height);
  }
}
@keyframes ui-accordion-up {
  from {
    height: var(--radix-accordion-content-height);
  }
  to {
    height: 0;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .ui-accordion-chevron {
    transition: transform 200ms ease;
  }
  .ui-accordion-content[data-state="open"] {
    animation: ui-accordion-down 220ms ease-out;
  }
  .ui-accordion-content[data-state="closed"] {
    animation: ui-accordion-up 180ms ease-in;
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run apps/web/src/ui/Accordion.test.tsx apps/web/src/ui/letterSpacing.test.ts`
Expected: both PASS (the `letter-spacing: 0` line is allowed; anything non-zero would fail the guard).

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/web/src/ui/Accordion.tsx apps/web/src/ui/Accordion.test.tsx apps/web/src/ui/ui.css
git add apps/web/src/ui/Accordion.tsx apps/web/src/ui/Accordion.test.tsx apps/web/src/ui/ui.css apps/web/package.json package-lock.json
git commit -m "ui/Accordion: Radix accordion on the brand tokens, the question inside a heading, the chevron and height animated only when motion is welcome

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `Dialog` sheet variant and `.ui-sr-only`

**Files:**
- Modify: `apps/web/src/ui/Dialog.tsx`, `apps/web/src/ui/Dialog.test.tsx`, `apps/web/src/ui/ui.css`

**Interfaces:**
- Produces: `DialogContent` accepts `variant?: "center" | "sheet"` (default `"center"`); renders `data-variant` and, for sheet, the class `ui-dialog-content--sheet`. `.ui-sr-only` hides text visually only.

- [ ] **Step 1: Write the failing test** — append to `apps/web/src/ui/Dialog.test.tsx` (keep its existing imports; add `DirectionProvider` from `@radix-ui/react-direction` if not already imported):

```tsx
it("as a sheet, marks itself so the stylesheet can anchor it to the inline-start edge", () => {
  render(
    <DirectionProvider dir="rtl">
      <Dialog open>
        <DialogContent variant="sheet" closeLabel="إغلاق" aria-describedby={undefined}>
          <DialogTitle>القائمة</DialogTitle>
        </DialogContent>
      </Dialog>
    </DirectionProvider>,
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("data-variant", "sheet");
  expect(dialog).toHaveClass("ui-dialog-content--sheet");
});

it("defaults to the centred variant", () => {
  render(
    <Dialog open>
      <DialogContent closeLabel="إغلاق" aria-describedby={undefined}>
        <DialogTitle>عنوان</DialogTitle>
      </DialogContent>
    </Dialog>,
  );
  expect(screen.getByRole("dialog")).toHaveAttribute("data-variant", "center");
});
```
(jsdom loads no stylesheet, so the anchoring itself is proven by the e2e mobile test in Task 10, not here.)

- [ ] **Step 2: Run it to see it fail** — `npx vitest run apps/web/src/ui/Dialog.test.tsx` → FAIL on `data-variant`.

- [ ] **Step 3: Implement** — in `Dialog.tsx` change the props and content:

```tsx
export interface DialogContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content> {
  /** … existing closeLabel doc … */
  closeLabel: string;
  /** `sheet` anchors the panel to the inline-start edge, full height —
   *  a navigation drawer. `center` is the modal every other caller wants. */
  variant?: "center" | "sheet";
}

export function DialogContent({
  className,
  children,
  closeLabel,
  variant = "center",
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-dialog-overlay" />
      <DialogPrimitive.Content
        className={cn(
          "ui-dialog-content",
          variant === "sheet" && "ui-dialog-content--sheet",
          className,
        )}
        data-variant={variant}
        {...props}
      >
```
(rest unchanged).

- [ ] **Step 4: Append the rules to `ui.css`**

```css
/* ---- Dialog, sheet variant ---- */
.ui-dialog-content--sheet {
  top: 0;
  left: auto;
  right: auto;
  inset-inline-start: 0;
  transform: none;
  height: 100dvh;
  max-height: none;
  width: min(360px, 88vw);
  border-radius: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
@keyframes ui-sheet-in-ltr {
  from {
    translate: -100% 0;
  }
  to {
    translate: 0 0;
  }
}
@keyframes ui-sheet-in-rtl {
  from {
    translate: 100% 0;
  }
  to {
    translate: 0 0;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .ui-dialog-content--sheet[data-state="open"] {
    animation: ui-sheet-in-ltr 220ms ease-out;
  }
  [dir="rtl"] .ui-dialog-content--sheet[data-state="open"] {
    animation-name: ui-sheet-in-rtl;
  }
}

/* ---- Visually hidden, still read ---- */
.ui-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 5: Run** `npx vitest run apps/web/src/ui/Dialog.test.tsx apps/web/src/ui/letterSpacing.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/web/src/ui/Dialog.tsx apps/web/src/ui/Dialog.test.tsx apps/web/src/ui/ui.css
git add apps/web/src/ui/Dialog.tsx apps/web/src/ui/Dialog.test.tsx apps/web/src/ui/ui.css
git commit -m "ui/Dialog gains a sheet variant anchored to the inline-start edge, and ui.css a visually-hidden helper

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `PublicShell` and `public.css`

**Files:**
- Create: `apps/web/src/public/PublicShell.tsx`, `apps/web/src/public/public.css`, `apps/web/src/public/PublicShell.test.tsx`
- Read (never edit): `apps/web/src/landing.css` lines 1–212 (fonts, `.landing` root, skip, announcement, header, brand, mark, nav, header CTA, menu) and its `.lp-footer*` / `.lp-legal` rules.

**Interfaces:**
- Produces:
  ```ts
  export type ShellLink = { href: string; label: string; kind: "route" | "anchor" };
  export function PublicShell(props: {
    locale: Locale; page: PublicPage; links: ShellLink[];
    mainId: string; mainClassName?: string; pageClassName?: string; children: ReactNode;
  }): JSX.Element
  ```
  Renders `<div class="landing {pageClassName}" dir=…>` → skip link to `#${mainId}` → announcement → header (brand, desktop nav `#landing-nav`, account CTA, menu button + sheet) → `<main id={mainId} class={mainClassName}>{children}</main>` → footer.

- [ ] **Step 1: Write the failing test**

`apps/web/src/public/PublicShell.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { DirectionProvider } from "@radix-ui/react-direction";
import { PublicShell } from "./PublicShell";
import { ar } from "../strings/ar";

vi.mock("../LanguageSwitch", () => ({
  LanguageSwitch: () => <a href="/en">English</a>,
}));

const links = [
  { href: "#why", label: ar.lpNavWhy, kind: "anchor" as const },
  { href: "/pricing", label: ar.pricingTitle, kind: "route" as const },
];

function Page() {
  return (
    <MemoryRouter>
      <DirectionProvider dir="rtl">
        <PublicShell locale="ar" page="home" links={links} mainId="landing-content">
          <h1>محتوى</h1>
        </PublicShell>
      </DirectionProvider>
    </MemoryRouter>
  );
}

describe("PublicShell", () => {
  it("wraps the page: skip link to main, brand, nav, account CTA, footer", () => {
    render(<Page />);
    expect(screen.getByRole("link", { name: ar.skipToContent })).toHaveAttribute(
      "href",
      "#landing-content",
    );
    expect(screen.getByRole("main")).toContainElement(screen.getByText("محتوى"));
    const nav = screen.getByRole("navigation", { name: ar.lpNavLabel });
    expect(within(nav).getByRole("link", { name: ar.lpNavWhy })).toHaveAttribute("href", "#why");
    expect(screen.getByRole("link", { name: new RegExp(ar.lpOpenAccount) })).toHaveAttribute(
      "href",
      "/account",
    );
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("opens the menu as a sheet, closes it on Escape and when a link is chosen", async () => {
    render(<Page />);
    const menu = screen.getByRole("button", { name: ar.lpMenuLabel });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveAttribute("data-variant", "sheet");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(menu);
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("link", { name: ar.lpNavWhy }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run apps/web/src/public/PublicShell.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Write the shell**

`apps/web/src/public/PublicShell.tsx`:
```tsx
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import "./public.css";
import { BrandMark } from "../BrandMark";
import { direction, otherLocale, type Locale } from "../locale";
import { useStrings } from "../strings";
import { LanguageSwitch } from "../LanguageSwitch";
import { LegalLinks } from "../LegalLinks";
import { publicPath, type PublicPage } from "../publicPaths";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../ui/Dialog";
import { cn } from "../ui/cn";

export type ShellLink = {
  href: string;
  label: string;
  /** `route` is a client-side navigation; `anchor` a plain hash link, which
   *  is the only kind that scrolls to a section of the page it is on. */
  kind: "route" | "anchor";
};

/** The chrome every public page shares — the announcement band, the header
 *  with its sheet menu on narrow screens, and the footer. The three pages
 *  used to copy this markup by hand and each import the whole landing
 *  stylesheet; now it is written once and the pages bring only their body. */
export function PublicShell({
  locale,
  page,
  links,
  mainId,
  mainClassName,
  pageClassName,
  children,
}: {
  locale: Locale;
  page: PublicPage;
  links: ShellLink[];
  mainId: string;
  mainClassName?: string;
  pageClassName?: string;
  children: ReactNode;
}) {
  const S = useStrings(locale);
  const [open, setOpen] = useState(false);
  const home = publicPath("home", locale);
  const pricing = publicPath("pricing", locale);
  const questions = page === "home" ? "#questions" : `${home}#questions`;
  const link = (l: ShellLink) =>
    l.kind === "route" ? (
      <Link key={l.href} to={l.href} onClick={() => setOpen(false)}>
        {l.label}
      </Link>
    ) : (
      <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
        {l.label}
      </a>
    );
  return (
    <div className={cn("landing", pageClassName)} dir={direction(locale)}>
      <a className="lp-skip" href={`#${mainId}`}>
        {S.skipToContent}
      </a>
      <div className="lp-announcement">
        {S.announcementLead} <span>{S.announcementTag}</span>
        <LanguageSwitch
          locale={locale}
          to={publicPath(page, otherLocale(locale))}
        />
      </div>
      <header className="lp-header">
        <Link className="lp-brand" to={home} aria-label={S.brandHomeLabel}>
          <BrandMark /> {S.brand}
          <span className="lp-brand-dot">.</span>
        </Link>
        <nav id="landing-nav" className="lp-nav" aria-label={S.lpNavLabel}>
          {links.map(link)}
        </nav>
        <Button asChild variant="secondary" size="sm" className="lp-header-cta">
          <Link to="/account">
            {S.lpOpenAccount}{" "}
            <span aria-hidden="true">{S.arrowUpForward}</span>
          </Link>
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="lp-menu"
              aria-label={S.lpMenuLabel}
            >
              {open ? S.menuClose : S.menuOpen}
            </Button>
          </DialogTrigger>
          <DialogContent
            variant="sheet"
            closeLabel={S.menuClose}
            className="lp-sheet"
            aria-describedby={undefined}
          >
            <DialogTitle className="lp-sheet-title">{S.lpNavLabel}</DialogTitle>
            <nav className="lp-sheet-nav" aria-label={S.lpNavLabel}>
              {links.map(link)}
              <Link to="/account" onClick={() => setOpen(false)}>
                {S.lpOpenAccount}
              </Link>
            </nav>
          </DialogContent>
        </Dialog>
      </header>
      <main id={mainId} className={mainClassName}>
        {children}
      </main>
      <footer className="lp-footer">
        <div>
          <Link className="lp-brand" to={home}>
            <BrandMark /> {S.brand}.
          </Link>
          <p>{S.lpFooterTagline}</p>
        </div>
        <nav aria-label={S.lpFooterNavLabel}>
          <Link to={pricing}>{S.pricingTitle}</Link>
          <Link to="/dashboard">{S.lpFooterDashboard}</Link>
          <Link to="/account">{S.lpFooterAccount}</Link>
          <a href={questions}>{S.lpNavFaq}</a>
        </nav>
        {/* Where a reviewer at Google or Paddle looks for them, and where a
            visitor expects them: the foot of the page, by their own titles. */}
        <LegalLinks className="lp-legal" locale={locale} />
        <div className="lp-footer-bottom">
          <span>{S.lpFooterVersion}</span>
          <span>{S.lpFooterPreview}</span>
        </div>
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Write `public.css`** — copy, byte for byte, from the OLD `apps/web/src/landing.css` (read it; do not edit it) these blocks, in this order: the two `@font-face` rules and their comment; `.landing { … }` (the root block with `--lp-dark`, the four `--lp-t-*` sizes, colour, font, line-height, `overflow: clip`); `.landing *`, `.landing a`, `.landing h1, h2, h3, p`, `.landing h1,h2,h3`, `.landing h2`, `.landing h3`, `.landing em`, `.landing section, article, form`, `.landing button`, the focus-visible rule, `.landing [id]`; `.lp-skip`, `.lp-skip:focus`; `.lp-announcement` (+ `span`); `.lp-header`; `.lp-brand`, `.lp-brand-dot`, `.lp-mark`; `.lp-nav`, `.lp-nav a:hover, .lp-footer nav a:hover`; every `.lp-footer*` rule and `.lp-legal*` rule; and the mobile media query's parts that concern `.lp-header`, `.lp-nav`, `.lp-menu` (the `.is-open` rules can be left out — the sheet replaces them). Then append, new:

```css
/* The account CTA is a ui/Button now; only its place in the row is ours. */
.lp-header .lp-header-cta {
  white-space: nowrap;
}
.lp-header .lp-header-cta span {
  margin-inline-start: 8px;
}
/* The menu button exists only where the nav cannot fit. */
.landing .lp-menu {
  display: none;
}
@media (max-width: 900px) {
  .landing .lp-nav {
    display: none;
  }
  .landing .lp-menu {
    display: inline-flex;
  }
  .lp-header .lp-header-cta {
    display: none;
  }
}
.lp-sheet-title {
  font-size: var(--lp-t-sm);
  color: var(--text-3);
  font-weight: 600;
}
.lp-sheet-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.lp-sheet-nav a {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-2);
  font-size: var(--lp-t-md);
  color: var(--text-1);
}
.lp-sheet-nav a:hover {
  background: var(--bg-muted);
  color: var(--ml-indigo);
}
```
If the old file's mobile query hides `.lp-header-cta` or sets `.lp-nav` differently, the new rules above win by order — check the rendered result in Step 6 rather than assuming.

- [ ] **Step 5: Run** `npx vitest run apps/web/src/public/PublicShell.test.tsx` → PASS. Then `npm run typecheck` → clean.

- [ ] **Step 6: Look at it once** — nothing renders the shell yet; it is verified on the pricing page in Task 4. Skip.

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/web/src/public/PublicShell.tsx apps/web/src/public/PublicShell.test.tsx apps/web/src/public/public.css
git add apps/web/src/public/PublicShell.tsx apps/web/src/public/PublicShell.test.tsx apps/web/src/public/public.css
git commit -m "PublicShell: the announcement, header with a sheet menu, and footer the three public pages share, written once, on public.css

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Pricing and legal pages adopt the shell; their rules move to their own files

**Files:**
- Create: `apps/web/src/pricing.css`, `apps/web/src/legal.css`
- Modify: `apps/web/src/PricingPage.tsx`, `apps/web/src/LegalPage.tsx`
- Read only: `apps/web/src/landing.css`

**Interfaces:**
- Consumes: `PublicShell`, `ShellLink` from Task 3.

- [ ] **Step 1: Capture "before" screenshots** so the move can be checked:

```bash
cd /Users/mlubbad/Documents/Codex/SentimentAnalysis && mkdir -p .superpowers/sdd/2026-09-17-landing-redesign/shots
cat > /tmp/shoot.mjs <<'EOF'
import { chromium } from "@playwright/test";
const [tag] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
for (const [name, url] of [["pricing","/pricing"],["privacy","/privacy"],["en-pricing","/en/pricing"]]) {
  await p.goto("http://localhost:4173" + url, { waitUntil: "networkidle" });
  await p.screenshot({ path: `.superpowers/sdd/2026-09-17-landing-redesign/shots/${name}-${tag}.png`, fullPage: true });
}
await b.close();
EOF
npm run build -w @sentiment/web > /tmp/build.log 2>&1; (npm run preview -w @sentiment/web -- --port 4173 --strictPort > /tmp/preview.log 2>&1 &) ; sleep 4; node /tmp/shoot.mjs before; pkill -f "vite preview" || true
```
(Check `tests/e2e` / `playwright.config.ts` for the exact preview command if `npm run preview` differs.)

- [ ] **Step 2: Create `pricing.css`** — copy from the old `landing.css`, byte for byte: every rule whose selector contains `.pricing` (48 rules, `grep -c "pricing" landing.css`), the `.lp-section-heading` rule(s) and the `.lp-section-heading` mobile rule, in their original order. Add one header comment: `/* Moved verbatim from landing.css on 2026-09-17; the pricing body is redesigned in phase 5, not here. */`. Create `legal.css` the same way with every `.legal*` rule.

- [ ] **Step 3: Rewrite the pricing page's chrome** — in `PricingPage.tsx` replace `import "./landing.css";` with `import "./pricing.css";`, add `import { PublicShell } from "./public/PublicShell";`, remove the now-unused imports (`BrandMark`, `LanguageSwitch`, `LegalLinks`, `otherLocale`, `direction` — keep whatever the body still uses; `tsc` and eslint will name the rest). Replace everything from `<div className="landing pricing-page" …>` through `</header>` and from `<footer …>` to the closing `</div>` with:

```tsx
    <PublicShell
      locale={locale}
      page="pricing"
      pageClassName="pricing-page"
      mainId="pricing-content"
      mainClassName="pricing"
      links={[
        { href: home, label: S.backHome, kind: "route" },
        { href: `${home}#questions`, label: S.lpNavFaq, kind: "anchor" },
        { href: "/dashboard", label: S.lpFooterDashboard, kind: "route" },
      ]}
    >
      <PageHead seo={pricingSeo(locale, S, catalogue.data ?? [])} />
      {/* …the existing children of <main>, unchanged… */}
    </PublicShell>
```
`PageHead` renders nothing visible, so its place inside `<main>` is fine.

- [ ] **Step 4: The legal page the same way** — `import "./legal.css"`, `PublicShell` with `page={key}` (the page's `key` is already a `PublicPage`), `pageClassName="legal-page"`, `mainId="legal-content"`, `mainClassName="legal"`, links `[{ href: home, label: S.backHome, kind: "route" }, { href: publicPath("pricing", locale), label: S.pricingTitle, kind: "route" }]`.

- [ ] **Step 5: Typecheck, unit, e2e for the two pages**

```bash
npm run typecheck && npm run lint && npx vitest run apps/web/src/PricingPage.test.tsx apps/web/src/LegalPage.test.tsx 2>/dev/null; npm run build -w @sentiment/web > /tmp/build.log 2>&1 && npm run test:e2e -- tests/e2e/pricing.spec.ts tests/e2e/legal.spec.ts tests/e2e/seo.spec.ts > /tmp/e2e.log 2>&1; echo exit=$?; tail -20 /tmp/e2e.log
```
Expected: exit=0. (If a unit test file for either page does not exist, skip that part.)

- [ ] **Step 6: "After" screenshots and compare** — rerun the Step 1 preview + `node /tmp/shoot.mjs after`. Open before/after pairs; the body of each page must be pixel-identical below the header. Differences are allowed only in the header row (CTA is a `ui/Button` now) — note them in the report.

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/web/src/PricingPage.tsx apps/web/src/LegalPage.tsx apps/web/src/pricing.css apps/web/src/legal.css
git add apps/web/src/PricingPage.tsx apps/web/src/LegalPage.tsx apps/web/src/pricing.css apps/web/src/legal.css
git commit -m "The pricing and legal pages wear PublicShell and carry their own stylesheets, moved verbatim out of landing.css

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `demoData` and `ProductWindow`

**Files:**
- Create: `apps/web/src/landing/demoData.ts`, `apps/web/src/landing/ProductWindow.tsx`, `apps/web/src/landing/product-window.css`, `apps/web/src/landing/ProductWindow.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // demoData.ts
  export const SENTIMENTS: readonly ["positive","mixed","neutral","negative"];
  export type Sentiment = (typeof SENTIMENTS)[number];
  export type Filter = "all" | Sentiment;
  export const examples: readonly { text: string; label: Sentiment }[];
  export function shownFor(filter: Filter): typeof examples;
  export function sharesFor(filter: Filter): { label: Sentiment; percent: number }[];
  export const numerals: Record<Locale, Intl.NumberFormat>;
  export function percentOf(locale: Locale, v: number): string;
  // ProductWindow.tsx
  export function ProductWindow(props: { mode: "still" | "interactive"; locale: Locale; initial?: Filter }): JSX.Element
  ```
  Root: `<div class="pw pw--{mode}" data-testid="product-window">`; comment rows keep the class `lp-example-comment`; the bar is `role="img"`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/landing/ProductWindow.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider } from "@radix-ui/react-direction";
import { ProductWindow } from "./ProductWindow";

const rtl = (el: React.ReactElement) => (
  <DirectionProvider dir="rtl">{el}</DirectionProvider>
);

describe("ProductWindow", () => {
  it("still: four comments, four equal shares, and no control that does nothing", () => {
    const { container } = render(rtl(<ProductWindow mode="still" locale="ar" />));
    expect(container.querySelectorAll(".lp-example-comment")).toHaveLength(4);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("إيجابي: ٢٥٪"));
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".lp-dot.positive, .lp-dot.negative, .lp-dot.mixed")).toHaveLength(3);
    expect(container.querySelectorAll(".lp-dot:not(.positive):not(.negative):not(.mixed)")).toHaveLength(1);
  });

  it("interactive: choosing a sentiment narrows the list, the bar and the count", async () => {
    const { container } = render(rtl(<ProductWindow mode="interactive" locale="ar" />));
    await userEvent.click(screen.getByRole("tab", { name: "مختلط" }));
    expect(container.querySelectorAll(".lp-example-comment")).toHaveLength(1);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringMatching(/مختلط: ١٠٠٪/));
    expect(container.querySelector(".pw-list")).toHaveAttribute("aria-live", "polite");
    await userEvent.click(screen.getByRole("tab", { name: "الكل" }));
    expect(container.querySelectorAll(".lp-example-comment")).toHaveLength(4);
  });

  it("uses Western digits and the ASCII percent sign in English", () => {
    render(<ProductWindow mode="still" locale="en" />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("Positive: 25%"));
  });
});
```

- [ ] **Step 2: Run** `npx vitest run apps/web/src/landing/ProductWindow.test.tsx` → FAIL (missing module).

- [ ] **Step 3: `demoData.ts`**

```ts
import type { Locale } from "../locale";

/* The demo's four comments. Their labels come from the shared strings rather
   than being written again here: a visitor who learns a word on this page
   meets the same word inside the product. The comments stay Arabic in every
   interface language — they are the data the product reads, not something
   it says — and carry their own `lang` where they render. */
export const SENTIMENTS = ["positive", "mixed", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];
export type Filter = "all" | Sentiment;

export const examples: readonly { text: string; label: Sentiment }[] = [
  { text: "شرح واضح، استفدت من الأمثلة كثيرًا 👏", label: "positive" },
  { text: "المحتوى جميل، لكن المقدمة طويلة قليلًا", label: "mixed" },
  { text: "أتمنى توضيح المصادر في الحلقة القادمة", label: "neutral" },
  { text: "الصوت غير واضح في هذا المقطع", label: "negative" },
];

export function shownFor(filter: Filter) {
  return examples.filter((c) => filter === "all" || c.label === filter);
}

/** Each label's share of the comments in the selection — 25% × 4 for `all`,
 *  100% of one colour for a single label. The same arithmetic the page has
 *  always shown. */
export function sharesFor(filter: Filter) {
  const shown = shownFor(filter);
  return SENTIMENTS.map((label) => ({
    label,
    percent:
      (shown.filter((c) => c.label === label).length / shown.length) * 100,
  }));
}

/* Arabic-Indic digits on the Arabic page — the one surface that uses them,
   as a landing does — and Western digits in English. */
export const numerals: Record<Locale, Intl.NumberFormat> = {
  ar: new Intl.NumberFormat("ar", { numberingSystem: "arab" }),
  en: new Intl.NumberFormat("en"),
};

export const percentOf = (locale: Locale, v: number) =>
  `${numerals[locale].format(v)}${locale === "ar" ? "٪" : "%"}`;
```

- [ ] **Step 4: `ProductWindow.tsx`**

```tsx
import { useState } from "react";
import "./product-window.css";
import { BrandMark } from "../BrandMark";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { Tabs, TabsList, TabsTrigger } from "../ui/Tabs";
import {
  SENTIMENTS,
  numerals,
  percentOf,
  sharesFor,
  shownFor,
  type Filter,
  type Sentiment,
} from "./demoData";

const toneOf = (label: Sentiment) =>
  label === "positive"
    ? "positive"
    : label === "negative"
      ? "negative"
      : label === "mixed"
        ? "sentiment-mixed"
        : "sentiment-neutral";

/** The one picture of the product on the page, drawn from the product's own
 *  parts. `still` is the hero's screenshot — no state, no handlers, and its
 *  filter row is plain text, because a picture must not offer controls that
 *  do nothing. `interactive` is the demo: the tabs filter the list, the bar
 *  and the count. Both render the same tree, so what a visitor touches in
 *  the demo is what they saw first. */
export function ProductWindow({
  mode,
  locale,
  initial = "all",
}: {
  mode: "still" | "interactive";
  locale: Locale;
  initial?: Filter;
}) {
  const S = useStrings(locale);
  const [filter, setFilter] = useState<Filter>(initial);
  const active = mode === "interactive" ? filter : initial;
  const shown = shownFor(active);
  const shares = sharesFor(active);
  const labels = S.labels;
  const pct = (v: number) => percentOf(locale, v);
  const barLabel = shares
    .map((c) => `${labels[c.label]}: ${pct(c.percent)}`)
    .join(S.listSeparator);
  const filters: Filter[] = ["all", ...SENTIMENTS];
  const nameOf = (f: Filter) => (f === "all" ? S.all : labels[f]);
  return (
    <div className={`pw pw--${mode}`} data-testid="product-window">
      <div className="pw-chrome">
        <span className="pw-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="pw-brand">
          <BrandMark /> {S.lpDemoBrand}
        </span>
        <span className="pw-caption">{S.lpDemoLabel}</span>
      </div>
      <Card className="pw-body">
        <span className="pw-label">{S.lpDemoChartLabel}</span>
        <div className="pw-figures">
          <Card className="pw-figure">
            <strong className="ui-num">{numerals[locale].format(shown.length)}</strong>
            <span>{S.lpDemoInSelection}</span>
          </Card>
          <Card className="pw-figure pw-figure--bar">
            <div className="pw-bar" role="img" aria-label={barLabel}>
              {shares.map((c) => (
                <i
                  key={c.label}
                  className={`pw-seg ${c.label}`}
                  style={{ flexGrow: c.percent }}
                />
              ))}
            </div>
            <div className="lp-legend">
              {shares.map((c) => (
                <span key={c.label}>
                  <i className={`lp-dot ${c.label}`} />
                  {labels[c.label]} <b className="ui-num">{pct(c.percent)}</b>
                </span>
              ))}
            </div>
          </Card>
        </div>
        {mode === "interactive" ? (
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList aria-label={S.lpDemoFilterLabel} className="pw-filters">
              {filters.map((f) => (
                <TabsTrigger key={f} value={f}>
                  {nameOf(f)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <div className="pw-filters pw-filters--still" aria-hidden="true">
            {filters.map((f) => (
              <span key={f} className={f === active ? "is-active" : undefined}>
                {nameOf(f)}
              </span>
            ))}
          </div>
        )}
        <div
          className="pw-list"
          aria-live={mode === "interactive" ? "polite" : undefined}
        >
          {shown.map((c) => (
            <div className="lp-example-comment" key={c.label}>
              <span className={`pw-avatar ${c.label}`} aria-hidden="true">
                {labels[c.label][0]}
              </span>
              <p lang="ar" dir="rtl">
                {c.text}
              </p>
              <Badge tone={toneOf(c.label)}>{labels[c.label]}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: `product-window.css`**

```css
/* The product window: one frame, two modes. Every colour is a token; the
   four sentiment marks are the same four the dashboard paints. */
.pw {
  --pw-radius: var(--radius-3);
  display: flex;
  flex-direction: column;
  border-radius: var(--pw-radius);
  background: var(--bg-card);
  box-shadow: var(--shadow-3);
  overflow: hidden;
  font-size: var(--lp-t-sm);
}
.pw-chrome {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--bg-muted);
  border-bottom: 1px solid var(--border-1);
}
.pw-dots {
  display: inline-flex;
  gap: 6px;
}
.pw-dots i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--border-2);
}
.pw-brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  color: var(--text-1);
}
.pw-brand .lp-mark {
  width: 18px;
  height: 18px;
}
.pw-caption {
  margin-inline-start: auto;
  color: var(--text-3);
  font-size: var(--lp-t-xs);
}
.pw-body.ui-card {
  border: 0;
  border-radius: 0;
  box-shadow: none;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.pw-label {
  font-size: var(--lp-t-xs);
  font-weight: 700;
  color: var(--text-3);
}
.pw-figures {
  display: grid;
  grid-template-columns: minmax(96px, auto) 1fr;
  gap: var(--space-3);
}
.pw-figure.ui-card {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.pw-figure strong {
  font-size: 28px;
  line-height: 1.1;
  color: var(--text-1);
}
.pw-figure span {
  color: var(--text-3);
  font-size: var(--lp-t-xs);
}
.pw-bar {
  display: flex;
  height: 14px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--bg-muted);
}
.pw-seg {
  flex-basis: 0;
  min-width: 0;
}
.pw-seg.positive {
  background: var(--sentiment-positive);
}
.pw-seg.negative {
  background: var(--sentiment-negative);
}
.pw-seg.mixed {
  background: var(--sentiment-mixed);
}
.pw-seg.neutral {
  background: var(--sentiment-neutral);
}
.lp-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: var(--lp-t-xs);
  color: var(--text-2);
}
.lp-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lp-legend b {
  color: var(--text-1);
}
.lp-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--sentiment-neutral);
}
.lp-dot.positive {
  background: var(--sentiment-positive);
}
.lp-dot.negative {
  background: var(--sentiment-negative);
}
.lp-dot.mixed {
  background: var(--sentiment-mixed);
}
.pw-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.pw-filters--still span {
  padding: 6px 12px;
  border-radius: 999px;
  color: var(--text-2);
}
.pw-filters--still span.is-active {
  background: var(--ml-indigo-50);
  color: var(--ml-indigo);
  font-weight: 700;
}
.pw-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.lp-example-comment {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2);
}
.lp-example-comment p {
  margin: 0;
  color: var(--text-1);
  font-size: var(--lp-t-sm);
  line-height: 1.6;
}
.pw-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  font-weight: 700;
  color: var(--fg-on-brand);
  background: var(--sentiment-neutral);
}
.pw-avatar.positive {
  background: var(--sentiment-positive);
}
.pw-avatar.negative {
  background: var(--sentiment-negative);
}
.pw-avatar.mixed {
  background: var(--sentiment-mixed);
}
@media (prefers-reduced-motion: no-preference) {
  .pw-seg {
    transition: flex-grow 240ms ease;
  }
}
@media (max-width: 520px) {
  .pw-figures {
    grid-template-columns: 1fr;
  }
  .lp-example-comment {
    grid-template-columns: 32px 1fr;
  }
  .lp-example-comment .ui-badge {
    grid-column: 2;
    justify-self: start;
  }
}
```
Confirm `--ml-indigo-50` and `--fg-on-brand` exist in `brand.css` (they do at the time of writing: `grep -n "ml-indigo-50\|fg-on-brand" apps/web/src/brand.css`).

- [ ] **Step 6: Run** `npx vitest run apps/web/src/landing/ProductWindow.test.tsx` → 3 PASS. `npm run typecheck` clean.

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/web/src/landing/demoData.ts apps/web/src/landing/ProductWindow.tsx apps/web/src/landing/ProductWindow.test.tsx apps/web/src/landing/product-window.css
git add apps/web/src/landing/demoData.ts apps/web/src/landing/ProductWindow.tsx apps/web/src/landing/ProductWindow.test.tsx apps/web/src/landing/product-window.css
git commit -m "ProductWindow: the landing's picture of the product, drawn from ui/ parts — still for the hero, interactive for the demo, one arithmetic in demoData

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Shared landing rules, the reveal hook, and the Hero

**Files:**
- Create: `apps/web/src/landing/landing.css`, `apps/web/src/landing/useReveal.ts`, `apps/web/src/landing/Hero.tsx`, `apps/web/src/landing/hero.css`, `apps/web/src/landing/Hero.test.tsx`

**Interfaces:**
- Consumes: `ProductWindow` (Task 5), `Badge`, `Button`.
- Produces: `Hero({ locale })`; `useReveal<T extends HTMLElement>(): RefObject<T | null>`; classes `.lp-container`, `.lp-section`, `.lp-section--muted`, `.lp-section-head`, `.lp-eyebrow`, `.lp-lead`, `.lp-caption`, `.lp-grid-3`, `.lp-reveal`.

- [ ] **Step 1: Failing test** — `apps/web/src/landing/Hero.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Hero } from "./Hero";
import { ar } from "../strings/ar";

describe("Hero", () => {
  it("carries the H1, the two actions, the still window and the alt sentence", () => {
    const { container } = render(
      <MemoryRouter>
        <Hero locale="ar" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("id", "hero-title");
    expect(screen.getByRole("link", { name: new RegExp(ar.lpExploreDashboard) })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: new RegExp(ar.lpSeeHow) })).toHaveAttribute("href", "#experience");
    expect(screen.getByTestId("product-window")).toHaveClass("pw--still");
    expect(screen.getByRole("figure")).toHaveTextContent(ar.lpHeroAlt);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: `landing.css`** (the page's shared rules; imported by `landing/Landing.tsx` in Task 10 and by nothing else)

```css
/* The landing's own rules — what every section shares. The chrome is in
   public/public.css and the root `.landing` block with it. */
.landing {
  --lp-space-section: clamp(72px, 10vw, 128px);
}
.lp-container {
  max-width: 1180px;
  padding-inline: clamp(16px, 5vw, 64px);
  margin-inline: auto;
}
.lp-section {
  padding-block: var(--lp-space-section);
}
.lp-section--muted {
  background: var(--bg-muted);
}
.lp-section-head {
  max-width: 720px;
  margin-inline: auto;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-7);
}
.lp-section-head--start {
  margin-inline: 0;
  text-align: start;
  align-items: flex-start;
}
.landing h1 {
  font-size: clamp(40px, 5.2vw, 68px);
  line-height: 1.22;
}
.landing h2 {
  font-size: clamp(28px, 3.4vw, 44px);
  line-height: 1.35;
}
/* Tracking tightens Latin display sizes only; on Arabic the joined letters
   need their zero. */
.landing:lang(en) h1 {
  letter-spacing: -1.5px;
}
.landing:lang(en) h2 {
  letter-spacing: -0.6px;
}
.landing:lang(ar) h1,
.landing:lang(ar) h2 {
  letter-spacing: 0;
}
.lp-eyebrow.ui-badge {
  gap: 6px;
  font-size: var(--lp-t-xs);
  font-weight: 700;
}
.lp-lead {
  font-size: var(--lp-t-lg);
  color: var(--text-2);
  max-width: 62ch;
}
.lp-caption {
  font-size: var(--lp-t-xs);
  color: var(--text-3);
}
.lp-grid-3 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-4);
}
/* Motion: sections below the fold rise 12px as they arrive. The hook adds
   `lp-reveal` only to sections that are not yet on screen, so the
   prerendered page never blinks, and without JavaScript nothing is hidden. */
@media (prefers-reduced-motion: no-preference) {
  .lp-reveal {
    opacity: 0;
    translate: 0 12px;
    transition:
      opacity 320ms ease-out,
      translate 320ms ease-out;
  }
  .lp-reveal.is-in {
    opacity: 1;
    translate: 0 0;
  }
}
```

- [ ] **Step 4: `useReveal.ts`**

```ts
import { useEffect, useRef } from "react";

/** Marks a section to rise into view once, the first time it is scrolled to.
 *  Sections already on screen at mount are left alone — the hero and, on a
 *  tall screen, the one after it — so hydration never hides what the
 *  prerender already painted. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    el.classList.add("lp-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
```

- [ ] **Step 5: `Hero.tsx`** (the hero never uses `useReveal`)

```tsx
import { Link } from "react-router";
import "./hero.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ProductWindow } from "./ProductWindow";

export function Hero({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <div className="lp-container lp-hero-grid">
        <div className="lp-hero-copy">
          <Badge tone="neutral" className="lp-eyebrow">
            <span className="lp-youtube" aria-hidden="true">
              ▶
            </span>
            {S.lpHeroEyebrow}
          </Badge>
          <h1 id="hero-title">
            {S.lpHeroLine1}
            <br />
            {S.lpHeroLine2}
            <br />
            <em>{S.lpHeroLine3}</em>
          </h1>
          <p className="lp-lead">{S.lpHeroLead}</p>
          <div className="lp-actions">
            <Button asChild size="lg">
              <Link to="/dashboard">
                {S.lpExploreDashboard}{" "}
                <span aria-hidden="true">{S.arrowForward}</span>
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <a href="#experience">
                {S.lpSeeHow}{" "}
                <span aria-hidden="true">{S.arrowDownForward}</span>
              </a>
            </Button>
          </div>
          <p className="lp-caption">{S.lpHeroCaption}</p>
        </div>
        {/* The sentence that was the illustration's alt is a place in the
            keyword map; it stays as the figure's caption, read and indexed,
            unseen. */}
        <figure className="lp-hero-figure">
          <span className="lp-hero-halo" aria-hidden="true" />
          <ProductWindow mode="still" locale={locale} />
          <figcaption className="ui-sr-only">{S.lpHeroAlt}</figcaption>
        </figure>
      </div>
      <div className="lp-container lp-value-strip">
        {[S.lpValue1, S.lpValue2, S.lpValue3, S.lpValue4].map((v) => (
          <Badge key={v} tone="neutral">
            {v}
          </Badge>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: `hero.css`**

```css
.lp-hero {
  position: relative;
  padding-block: clamp(40px, 6vw, 88px) clamp(48px, 7vw, 96px);
}
.lp-hero-grid {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: clamp(32px, 5vw, 72px);
  align-items: center;
}
.lp-hero-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
}
.lp-hero-copy h1 {
  margin: 0;
}
.lp-youtube {
  color: var(--fg-on-brand);
  background: var(--ml-rose);
  font: 10px var(--font-latin);
  padding: 3px 7px;
  border-radius: 6px;
}
.lp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
}
.lp-hero-figure {
  position: relative;
  margin: 0;
  aspect-ratio: 4 / 3;
  display: flex;
  align-items: center;
}
.lp-hero-figure .pw {
  width: 100%;
}
.lp-hero-halo {
  position: absolute;
  inset: -12% -8%;
  background: radial-gradient(
    closest-side,
    color-mix(in srgb, var(--ml-indigo) 12%, transparent),
    transparent
  );
  pointer-events: none;
  z-index: 0;
}
.lp-hero-figure .pw {
  position: relative;
  z-index: 1;
}
.lp-value-strip {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: clamp(32px, 5vw, 56px);
}
@media (max-width: 1023px) {
  .lp-hero-grid {
    grid-template-columns: 1fr;
  }
  .lp-hero-figure {
    max-width: 560px;
    aspect-ratio: auto;
  }
}
```

- [ ] **Step 7: Run** `npx vitest run apps/web/src/landing/Hero.test.tsx` → PASS; `npm run typecheck` clean.

- [ ] **Step 8: Commit**

```bash
npx prettier --write apps/web/src/landing/landing.css apps/web/src/landing/useReveal.ts apps/web/src/landing/Hero.tsx apps/web/src/landing/hero.css apps/web/src/landing/Hero.test.tsx
git add apps/web/src/landing/landing.css apps/web/src/landing/useReveal.ts apps/web/src/landing/Hero.tsx apps/web/src/landing/hero.css apps/web/src/landing/Hero.test.tsx
git commit -m "Landing hero on the design system: the still product window in place of the illustration, the alt sentence kept as its caption, and the page's shared rules and reveal hook

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Why, Benefits, Trust

**Files:**
- Create: `apps/web/src/landing/Why.tsx` + `why.css`, `Benefits.tsx` + `benefits.css`, `Trust.tsx` + `trust.css`, `apps/web/src/landing/Sections.test.tsx`

**Interfaces:**
- Consumes: `useReveal`, `.lp-*` classes from Task 6, `Card`, `Badge`, `Button`.
- Produces: `Why`, `Benefits`, `Trust` — each `({ locale })`.

- [ ] **Step 1: Failing test** — `apps/web/src/landing/Sections.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Why } from "./Why";
import { Benefits } from "./Benefits";
import { Trust } from "./Trust";
import { ar } from "../strings/ar";

const wrap = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

describe("the three text sections", () => {
  it("Why keeps its id and heading and links down to the demo", () => {
    const { container } = wrap(<Why locale="ar" />);
    expect(container.querySelector("section#why")).toHaveAttribute("aria-labelledby", "why-title");
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute("id", "why-title");
    expect(screen.getByRole("link", { name: new RegExp(ar.lpZoomIn) })).toHaveAttribute("href", "#experience");
  });
  it("Benefits renders three cards with their ordinals and level-3 headings", () => {
    wrap(<Benefits locale="ar" />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
    expect(screen.getByText(ar.lpBenefit1Tag)).toBeInTheDocument();
  });
  it("Trust keeps its labelled heading and three items", () => {
    const { container } = wrap(<Trust locale="ar" />);
    expect(container.querySelector("section[aria-labelledby='trust-title']")).not.toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: `Why.tsx` / `why.css`**

```tsx
import "./why.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { useReveal } from "./useReveal";

export function Why({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  return (
    <section
      ref={ref}
      className="lp-section lp-section--muted lp-why"
      id="why"
      aria-labelledby="why-title"
    >
      <div className="lp-container lp-section-head">
        <Badge tone="neutral" className="lp-eyebrow">
          {S.lpWhyEyebrow}
        </Badge>
        <h2 id="why-title">
          {S.lpWhyLine1}
          <br />
          <em>{S.lpWhyLine2}</em>
        </h2>
        <p className="lp-lead">{S.lpWhyLead}</p>
        <Button asChild variant="secondary">
          <a href="#experience">
            {S.lpZoomIn} <span aria-hidden="true">↓</span>
          </a>
        </Button>
      </div>
    </section>
  );
}
```
```css
.lp-why .lp-section-head {
  margin-bottom: 0;
}
.lp-why .lp-lead {
  text-align: center;
}
```

- [ ] **Step 4: `Benefits.tsx` / `benefits.css`**

```tsx
import "./benefits.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { useReveal } from "./useReveal";

export function Benefits({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  const items = [
    { tag: S.lpBenefit1Tag, title: S.lpBenefit1Title, text: S.lpBenefit1 },
    { tag: S.lpBenefit2Tag, title: S.lpBenefit2Title, text: S.lpBenefit2 },
    { tag: S.lpBenefit3Tag, title: S.lpBenefit3Title, text: S.lpBenefit3 },
  ];
  return (
    <section ref={ref} className="lp-section lp-benefits" aria-label={S.lpBenefit1Tag}>
      <div className="lp-container lp-grid-3">
        {items.map((b) => (
          <Card key={b.tag} className="lp-benefit">
            <Badge tone="neutral" numeric>
              {b.tag}
            </Badge>
            <h3>{b.title}</h3>
            <p>{b.text}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
```
Note: the old markup had the benefits inside the demo's `<section>`; here they are their own landmark, so the `aria-label` gives it a name — it is the first ordinal («01 / افهم»), the only existing string that names the trio. Keep it; no new string.
```css
.lp-benefits {
  padding-top: 0;
}
.lp-benefit.ui-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
}
.lp-benefit h3 {
  margin: 0;
}
.lp-benefit p {
  color: var(--text-2);
}
```

- [ ] **Step 5: `Trust.tsx` / `trust.css`**

```tsx
import "./trust.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { useReveal } from "./useReveal";

export function Trust({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  const items = [
    { glyph: "◉", title: S.lpTrust1Title, text: S.lpTrust1 },
    { glyph: "↻", title: S.lpTrust2Title, text: S.lpTrust2 },
    { glyph: S.arrowUpForward, title: S.lpTrust3Title, text: S.lpTrust3 },
  ];
  return (
    <section
      ref={ref}
      className="lp-section lp-section--muted lp-trust"
      aria-labelledby="trust-title"
    >
      <div className="lp-container">
        <div className="lp-section-head lp-section-head--start">
          <Badge tone="neutral" className="lp-eyebrow">
            {S.lpTrustEyebrow}
          </Badge>
          <h2 id="trust-title">
            {S.lpTrustLine1}
            <br />
            {S.lpTrustLine2} <em>{S.lpTrustLine3}</em>
          </h2>
          <p className="lp-lead">{S.lpTrustLead}</p>
        </div>
        <div className="lp-grid-3">
          {items.map((t) => (
            <Card key={t.title} className="lp-trust-item">
              <span className="lp-trust-glyph" aria-hidden="true">
                {t.glyph}
              </span>
              <h3>{t.title}</h3>
              <p>{t.text}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
```
```css
.lp-trust-item.ui-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
}
.lp-trust-glyph {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  background: var(--ml-indigo-50);
  color: var(--ml-indigo);
  font-size: 18px;
}
.lp-trust-item h3 {
  margin: 0;
}
.lp-trust-item p {
  color: var(--text-2);
}
```

- [ ] **Step 6: Run** `npx vitest run apps/web/src/landing/Sections.test.tsx` → PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/web/src/landing/Why.tsx apps/web/src/landing/why.css apps/web/src/landing/Benefits.tsx apps/web/src/landing/benefits.css apps/web/src/landing/Trust.tsx apps/web/src/landing/trust.css apps/web/src/landing/Sections.test.tsx
git add apps/web/src/landing/Why.tsx apps/web/src/landing/why.css apps/web/src/landing/Benefits.tsx apps/web/src/landing/benefits.css apps/web/src/landing/Trust.tsx apps/web/src/landing/trust.css apps/web/src/landing/Sections.test.tsx
git commit -m "Landing: the why, benefits and trust sections as cards and badges on the shared rhythm

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Demo and Audience

**Files:**
- Create: `apps/web/src/landing/Demo.tsx` + `demo.css`, `Audience.tsx` + `audience.css`, `apps/web/src/landing/DemoAudience.test.tsx`

**Interfaces:**
- Consumes: `ProductWindow` interactive, `Tabs`, `Card`, `Badge`, `Button`, `useReveal`.

- [ ] **Step 1: Failing test** — `apps/web/src/landing/DemoAudience.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { DirectionProvider } from "@radix-ui/react-direction";
import { Demo } from "./Demo";
import { Audience } from "./Audience";
import { ar } from "../strings/ar";

const wrap = (el: React.ReactElement) =>
  render(
    <MemoryRouter>
      <DirectionProvider dir="rtl">{el}</DirectionProvider>
    </MemoryRouter>,
  );

describe("Demo", () => {
  it("is the #experience section with the interactive window and the dashboard link", async () => {
    const { container } = wrap(<Demo locale="ar" />);
    expect(container.querySelector("section#experience")).toHaveAttribute("aria-labelledby", "experience-title");
    const win = screen.getByTestId("product-window");
    expect(win).toHaveClass("pw--interactive");
    await userEvent.click(within(win).getByRole("tab", { name: "سلبي" }));
    expect(win.querySelectorAll(".lp-example-comment")).toHaveLength(1);
    expect(screen.getByRole("link", { name: new RegExp(ar.lpDemoLink) })).toHaveAttribute("href", "/dashboard");
  });
});

describe("Audience", () => {
  it("switches between creators and agencies with tabs", async () => {
    wrap(<Audience locale="ar" />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute("id", "audience-title");
    expect(screen.getByText(ar.lpCreatorTitle)).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: ar.lpAgencies }));
    expect(screen.getByText(ar.lpAgencyTitle)).toBeVisible();
    expect(screen.queryByText(ar.lpCreatorTitle)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: `Demo.tsx` / `demo.css`**

```tsx
import { Link } from "react-router";
import "./demo.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ProductWindow } from "./ProductWindow";
import { useReveal } from "./useReveal";

export function Demo({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  return (
    <section
      ref={ref}
      className="lp-section lp-demo"
      id="experience"
      aria-labelledby="experience-title"
    >
      <div className="lp-container">
        <div className="lp-section-head">
          <Badge tone="neutral" className="lp-eyebrow">
            {S.lpExperienceEyebrow}
          </Badge>
          <h2 id="experience-title">
            {S.lpExperienceLine1}
            <br />
            <em>{S.lpExperienceLine2}</em>
          </h2>
          <p className="lp-lead">{S.lpExperienceLead}</p>
        </div>
        <div className="lp-demo-frame">
          <ProductWindow mode="interactive" locale={locale} />
        </div>
        <div className="lp-demo-after">
          <Button asChild variant="secondary">
            <Link to="/dashboard">
              {S.lpDemoLink} <span aria-hidden="true">{S.arrowForward}</span>
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
```
```css
.lp-demo .lp-lead {
  text-align: center;
}
.lp-demo-frame {
  max-width: 880px;
  margin-inline: auto;
}
.lp-demo-after {
  display: flex;
  justify-content: center;
  margin-top: var(--space-6);
}
```

- [ ] **Step 4: `Audience.tsx` / `audience.css`**

```tsx
import { useState } from "react";
import { Link } from "react-router";
import "./audience.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";
import { useReveal } from "./useReveal";

type Who = "creator" | "agency";

export function Audience({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  const [who, setWho] = useState<Who>("creator");
  const panels: Record<Who, { eyebrow: string; title: string; text: string; tags: readonly string[]; space: string }> = {
    creator: {
      eyebrow: S.lpForYou,
      title: S.lpCreatorTitle,
      text: S.lpCreatorText,
      tags: S.lpCreatorTags,
      space: S.lpYourChannelSpace,
    },
    agency: {
      eyebrow: S.lpForTeam,
      title: S.lpAgencyTitle,
      text: S.lpAgencyText,
      tags: S.lpAgencyTags,
      space: S.lpClientSpace,
    },
  };
  const panel = (k: Who) => {
    const p = panels[k];
    return (
      <TabsContent value={k} className="lp-audience-panel">
        <div className="lp-audience-copy">
          <Badge tone="neutral" className="lp-eyebrow">
            {p.eyebrow}
          </Badge>
          <h3>{p.title}</h3>
          <p>{p.text}</p>
          <div className="lp-tags">
            {p.tags.map((tag) => (
              <Badge key={tag} tone="neutral">
                ✓ {tag}
              </Badge>
            ))}
          </div>
          <Button asChild variant="ghost">
            <Link to="/dashboard">
              {S.lpExploreWork}{" "}
              <span aria-hidden="true">{S.arrowForward}</span>
            </Link>
          </Button>
        </div>
        <Card className="lp-workspace-window" aria-hidden="true">
          <span className="pw-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="lp-mini-label">{p.space}</span>
          <div className="lp-video-row">
            <span className="lp-youtube">▶</span>
            <div>
              <b>{S.lpVideoRow}</b>
              <i />
            </div>
          </div>
          <div className="lp-mini-bars">
            {[42, 76, 58, 92, 67, 84, 100].map((h, i) => (
              <i key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="lp-window-note">
            {S.lpWindowNote} <span>✓</span>
          </div>
          <span className="lp-caption">{S.lpArtCaption}</span>
        </Card>
      </TabsContent>
    );
  };
  return (
    <section ref={ref} className="lp-section lp-audience" aria-labelledby="audience-title">
      <div className="lp-container">
        <div className="lp-section-head">
          <Badge tone="neutral" className="lp-eyebrow">
            {S.lpAudienceEyebrow}
          </Badge>
          <h2 id="audience-title">
            {S.lpAudienceLine1}
            <br />
            {S.lpAudienceLine2}
          </h2>
        </div>
        <Tabs value={who} onValueChange={(v) => setWho(v as Who)}>
          <TabsList aria-label={S.lpAudienceTabsLabel} className="lp-audience-tabs">
            <TabsTrigger value="creator">{S.lpCreators}</TabsTrigger>
            <TabsTrigger value="agency">{S.lpAgencies}</TabsTrigger>
          </TabsList>
          {panel("creator")}
          {panel("agency")}
        </Tabs>
      </div>
    </section>
  );
}
```
(`S.lpCreatorTags` / `S.lpAgencyTags` are arrays in the strings; `readonly string[]` accepts them. If `tsc` reports a mismatch, widen to `ReadonlyArray<string>`.)
```css
.lp-audience-tabs {
  justify-content: center;
  margin-bottom: var(--space-6);
}
.lp-audience-panel {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: clamp(24px, 4vw, 56px);
  align-items: center;
}
.lp-audience-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}
.lp-audience-copy h3 {
  margin: 0;
  font-size: clamp(22px, 2.4vw, 28px);
}
.lp-audience-copy p {
  color: var(--text-2);
}
.lp-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.lp-workspace-window.ui-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  box-shadow: var(--shadow-3);
}
.lp-mini-label {
  font-size: var(--lp-t-xs);
  font-weight: 700;
  color: var(--text-3);
}
.lp-video-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.lp-video-row > div {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lp-video-row b {
  font-size: var(--lp-t-sm);
}
.lp-video-row i {
  display: block;
  height: 6px;
  width: 60%;
  border-radius: 999px;
  background: var(--bg-muted);
}
.lp-mini-bars {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 96px;
}
.lp-mini-bars i {
  flex: 1;
  border-radius: 4px 4px 0 0;
  background: linear-gradient(to top, var(--ml-indigo), var(--ml-indigo-300));
}
.lp-window-note {
  display: flex;
  justify-content: space-between;
  font-size: var(--lp-t-sm);
  color: var(--text-2);
}
.lp-window-note span {
  color: var(--sentiment-positive);
}
@media (max-width: 900px) {
  .lp-audience-panel {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Run** `npx vitest run apps/web/src/landing/DemoAudience.test.tsx` → PASS; typecheck.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/web/src/landing/Demo.tsx apps/web/src/landing/demo.css apps/web/src/landing/Audience.tsx apps/web/src/landing/audience.css apps/web/src/landing/DemoAudience.test.tsx
git add apps/web/src/landing/Demo.tsx apps/web/src/landing/demo.css apps/web/src/landing/Audience.tsx apps/web/src/landing/audience.css apps/web/src/landing/DemoAudience.test.tsx
git commit -m "Landing: the demo section is the interactive product window, and the audience section switches on ui/Tabs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: FAQ and Closing

**Files:**
- Create: `apps/web/src/landing/Faq.tsx` + `faq.css`, `Closing.tsx` + `closing.css`, `apps/web/src/landing/FaqClosing.test.tsx`

**Interfaces:**
- Consumes: `Accordion` (Task 1), `Button`, `Badge`, `BrandMark`, `useReveal`.

- [ ] **Step 1: Failing test** — `apps/web/src/landing/FaqClosing.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { Faq } from "./Faq";
import { Closing } from "./Closing";
import { ar } from "../strings/ar";

describe("Faq", () => {
  it("lists every question as a level-3 heading in the strings' order and opens one", async () => {
    const { container } = render(<Faq locale="ar" />);
    expect(container.querySelector("section#questions")).toHaveAttribute("aria-labelledby", "faq-title");
    const questions = ar.lpFaq.filter((_, i) => i % 2 === 0);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.trim());
    expect(headings).toEqual(questions);
    await userEvent.click(screen.getByRole("button", { name: questions[0] }));
    expect(screen.getByText(ar.lpFaq[1])).toBeVisible();
  });
});

describe("Closing", () => {
  it("carries the last call to action to the dashboard", () => {
    render(
      <MemoryRouter>
        <Closing locale="ar" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: new RegExp(ar.lpExploreDashboard) })).toHaveAttribute("href", "/dashboard");
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: `Faq.tsx` / `faq.css`**

```tsx
import "./faq.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/Accordion";
import { useReveal } from "./useReveal";

export function Faq({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  /* Question, answer, question, answer: a flat list in the strings, read in
     pairs, so a translation cannot carry a question without its answer or an
     answer under the wrong question. The DOM order is the FAQPage data's. */
  const pairs = Array.from({ length: S.lpFaq.length / 2 }, (_, i) => [
    S.lpFaq[i * 2],
    S.lpFaq[i * 2 + 1],
  ]);
  return (
    <section
      ref={ref}
      className="lp-section lp-section--muted lp-faq"
      id="questions"
      aria-labelledby="faq-title"
    >
      <div className="lp-container lp-faq-grid">
        <div className="lp-section-head lp-section-head--start">
          <Badge tone="neutral" className="lp-eyebrow">
            {S.lpFaqEyebrow}
          </Badge>
          <h2 id="faq-title">{S.lpFaqTitle}</h2>
          <p className="lp-lead">{S.lpFaqLead}</p>
        </div>
        <Accordion type="single" collapsible className="lp-faq-list">
          {pairs.map(([q, a], i) => (
            <AccordionItem key={q} value={`q${i}`}>
              <AccordionTrigger>{q}</AccordionTrigger>
              <AccordionContent>{a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
```
```css
.lp-faq-grid {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: clamp(24px, 5vw, 72px);
  align-items: start;
}
.lp-faq-list {
  background: var(--bg-card);
  border-radius: var(--radius-3);
  padding: 0 var(--space-5);
  box-shadow: var(--shadow-1);
}
.lp-faq-list .ui-accordion-item:last-child {
  border-bottom: 0;
}
@media (max-width: 900px) {
  .lp-faq-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: `Closing.tsx` / `closing.css`**

```tsx
import { Link } from "react-router";
import "./closing.css";
import { BrandMark } from "../BrandMark";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Button } from "../ui/Button";
import { useReveal } from "./useReveal";

export function Closing({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} className="lp-section lp-closing">
      <span className="lp-orbit" aria-hidden="true" />
      <div className="lp-container lp-closing-inner">
        <BrandMark />
        <h2>
          {S.lpFinalLine1}
          <br />
          <em>{S.lpFinalLine2}</em>
        </h2>
        <p className="lp-lead">{S.lpFinalLead}</p>
        <Button asChild size="lg" className="lp-closing-cta">
          <Link to="/dashboard">
            {S.lpExploreDashboard}{" "}
            <span aria-hidden="true">{S.arrowForward}</span>
          </Link>
        </Button>
        <span className="lp-caption">{S.lpFinalCaption}</span>
      </div>
    </section>
  );
}
```
```css
.lp-closing {
  position: relative;
  overflow: hidden;
  background: var(--lp-dark);
  color: var(--ink-on-dark);
  text-align: center;
}
.lp-closing-inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
}
.lp-closing .lp-mark {
  width: 44px;
  height: 44px;
  color: var(--ml-indigo-300);
}
.lp-closing h2 {
  margin: 0;
  color: var(--ink-on-dark);
}
.lp-closing em {
  color: var(--ml-indigo-300);
}
.lp-closing .lp-lead {
  color: var(--ink-on-dark-2);
  text-align: center;
}
.lp-closing .lp-caption {
  color: var(--ink-on-dark-2);
}
.lp-closing .lp-closing-cta {
  background: var(--ml-indigo-100);
  color: var(--ml-indigo-900);
}
.lp-orbit {
  position: absolute;
  inset: auto -20% -60% -20%;
  height: 120%;
  border-radius: 50%;
  background: conic-gradient(
    from 180deg,
    transparent,
    color-mix(in srgb, var(--ml-indigo-300) 18%, transparent),
    transparent
  );
  pointer-events: none;
}
```
(`--ink-on-dark`, `--ink-on-dark-2`, `--ml-indigo-100`, `--ml-indigo-900`, `--ml-indigo-300` all exist in `brand.css`.)

- [ ] **Step 5: Run** `npx vitest run apps/web/src/landing/FaqClosing.test.tsx` → PASS; typecheck.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/web/src/landing/Faq.tsx apps/web/src/landing/faq.css apps/web/src/landing/Closing.tsx apps/web/src/landing/closing.css apps/web/src/landing/FaqClosing.test.tsx
git add apps/web/src/landing/Faq.tsx apps/web/src/landing/faq.css apps/web/src/landing/Closing.tsx apps/web/src/landing/closing.css apps/web/src/landing/FaqClosing.test.tsx
git commit -m "Landing: the FAQ on ui/Accordion with each question a heading, and the closing band on the dark plane

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Cut over — compose the page, switch the route, retire the old files, update e2e

**Files:**
- Create: `apps/web/src/landing/Landing.tsx`, `apps/web/src/landing/Landing.test.tsx`
- Modify: `apps/web/src/main.tsx:25`, `apps/web/src/entry-prerender.tsx:25`, `tests/e2e/landing.spec.ts`
- Delete: `apps/web/src/Landing.tsx`; `apps/web/src/landing.css` **only if `git status --short apps/web/src/landing.css` prints nothing** — otherwise leave it on disk (nothing imports it any more) and say so in the report.

- [ ] **Step 1: Measure "before"** on the current build (the old page), with Playwright, mobile emulation:

```bash
cd /Users/mlubbad/Documents/Codex/SentimentAnalysis && cat > /tmp/vitals.mjs <<'EOF'
import { chromium, devices } from "@playwright/test";
const [tag] = process.argv.slice(2);
const b = await chromium.launch();
const runs = [];
for (let i = 0; i < 3; i++) {
  const ctx = await b.newContext({ ...devices["Pixel 5"] });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.__v = { lcp: 0, cls: 0 };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  });
  await p.goto("http://localhost:4173/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  runs.push(await p.evaluate(() => window.__v));
  await ctx.close();
}
await b.close();
runs.sort((a, b) => a.lcp - b.lcp);
console.log(tag, JSON.stringify({ median: runs[1], runs }));
EOF
npm run build -w @sentiment/web > /tmp/build.log 2>&1; (npm run preview -w @sentiment/web -- --port 4173 --strictPort > /tmp/preview.log 2>&1 &); sleep 4
node /tmp/vitals.mjs before | tee -a .superpowers/sdd/2026-09-17-landing-redesign/vitals.txt
ls -l apps/web/dist/assets/*.css | tee -a .superpowers/sdd/2026-09-17-landing-redesign/vitals.txt
pkill -f "vite preview" || true
```

- [ ] **Step 2: `landing/Landing.tsx`**

```tsx
import "./landing.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { publicPath } from "../publicPaths";
import { homeSeo } from "../seo";
import { PageHead, usePublicLocale } from "../PageHead";
import { PublicShell } from "../public/PublicShell";
import { Hero } from "./Hero";
import { Why } from "./Why";
import { Demo } from "./Demo";
import { Benefits } from "./Benefits";
import { Audience } from "./Audience";
import { Trust } from "./Trust";
import { Faq } from "./Faq";
import { Closing } from "./Closing";

/** `locale` comes from the route — `/` is Arabic and `/en` is English — not
 *  from the stored preference; see `publicPaths.ts`. */
export function Landing({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  // The language on the document and in the store, for as long as this
  // page is mounted — the shell does the same for itself.
  usePublicLocale(locale);
  return (
    <PublicShell
      locale={locale}
      page="home"
      mainId="landing-content"
      mainClassName="lp-main"
      links={[
        { href: "#why", label: S.lpNavWhy, kind: "anchor" },
        { href: "#experience", label: S.lpNavExperience, kind: "anchor" },
        { href: "#questions", label: S.lpNavFaq, kind: "anchor" },
        { href: publicPath("pricing", locale), label: S.pricingTitle, kind: "route" },
      ]}
    >
      <PageHead seo={homeSeo(locale, S)} />
      <Hero locale={locale} />
      <Why locale={locale} />
      <Demo locale={locale} />
      <Benefits locale={locale} />
      <Audience locale={locale} />
      <Trust locale={locale} />
      <Faq locale={locale} />
      <Closing locale={locale} />
    </PublicShell>
  );
}
```
Then `apps/web/src/landing/Landing.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { DirectionProvider } from "@radix-ui/react-direction";
import { Landing } from "./Landing";

vi.mock("../LanguageSwitch", () => ({ LanguageSwitch: () => <a href="/en">English</a> }));
vi.mock("../PageHead", () => ({ PageHead: () => null, usePublicLocale: () => {} }));

describe("Landing", () => {
  it("renders the eight sections in order under one H1, with the three anchors reachable", () => {
    const { container } = render(
      <MemoryRouter>
        <DirectionProvider dir="rtl">
          <Landing locale="ar" />
        </DirectionProvider>
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const ids = [...container.querySelectorAll("main section[id]")].map((s) => s.id);
    expect(ids).toEqual(["why", "experience", "questions"]);
    expect(container.querySelectorAll("main > section")).toHaveLength(8);
    expect(container.querySelectorAll("[data-testid='product-window']")).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Switch the importers** — in `apps/web/src/main.tsx` and `apps/web/src/entry-prerender.tsx` change `import { Landing } from "./Landing";` to `import { Landing } from "./landing/Landing";`. Then `git rm apps/web/src/Landing.tsx`. Then, if and only if `git status --short apps/web/src/landing.css` is empty: `git rm apps/web/src/landing.css`. Run `grep -rn "landing.css\|from \"./Landing\"" apps/web/src apps/web/scripts` — nothing may reference the old paths (the new `landing/landing.css` is a different file, imported as `./landing.css` from inside `landing/`).

- [ ] **Step 4: Update `tests/e2e/landing.spec.ts`** — in the first test replace the demo block with:

```ts
  const demo = page.locator("#experience [data-testid='product-window']");
  await expect(demo).toContainText("4 تعليقات مؤلّفة");
  await expect(demo.locator(".lp-example-comment")).toHaveCount(4);
  await demo.getByRole("tab", { name: "مختلط", exact: true }).click();
  await expect(demo.locator(".lp-example-comment")).toHaveCount(1);
  await expect(demo.getByRole("img")).toHaveAttribute("aria-label", /مختلط: ١٠٠٪/);
  await expect(demo).toContainText("المقدمة طويلة");
  await demo.getByRole("tab", { name: "الكل", exact: true }).click();
  await expect(demo.locator(".lp-example-comment")).toHaveCount(4);
  await page.getByRole("tab", { name: "الوكالات والفرق", exact: true }).click();
  await expect(page.locator(".lp-audience-panel[data-state='active']")).toContainText("لكل عميل جمهوره");
  await page.getByRole("button", { name: "هل يمكنني ربط قناتي الآن؟" }).click();
  await expect(page.getByRole("region", { name: "هل يمكنني ربط قناتي الآن؟" })).toContainText("جُمعت تعليقات حقيقية");
```
In the mobile test replace the menu block with:
```ts
  const menu = page.getByRole("button", { name: "القائمة الرئيسية" });
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "شاهد التجربة" })
    .click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#experience")).toBeInViewport();
```
and replace the final `.lp-hero-art img` assertion with:
```ts
  await expect(page.locator(".lp-hero [data-testid='product-window']")).toBeVisible();
  expect(await page.locator(".lp-hero img").count()).toBe(0);
```
Leave the three computed-style tests untouched — they must pass as written.

- [ ] **Step 5: Run everything**

```bash
npx vitest run apps/web/src/landing apps/web/src/public apps/web/src/ui && npm run typecheck && npm run lint
npm run build -w @sentiment/web > /tmp/build.log 2>&1; echo build=$?; grep -c "<h1" apps/web/dist/index.html
npm run test:e2e -- tests/e2e/landing.spec.ts tests/e2e/seo.spec.ts tests/e2e/pricing.spec.ts tests/e2e/legal.spec.ts tests/e2e/language.spec.ts > /tmp/e2e.log 2>&1; echo exit=$?; grep -E "passed|failed" /tmp/e2e.log
```
Expected: build=0, the prerendered `index.html` contains the H1 and `data-testid="product-window"`, e2e exit=0. If the contrast or Arabic-floor test fails, fix the offending token/size in the section's CSS (never in `brand.css`) and rerun.

- [ ] **Step 6: Measure "after"** — repeat Step 1's preview + `node /tmp/vitals.mjs after | tee -a …/vitals.txt` and the CSS byte listing. Record: LCP after ≤ before, CLS after ≤ before, landing CSS bytes ≤ 60% of the old file's minified size (the old size is in the "before" listing). If a budget is missed, say so in the report — do not hide it.

- [ ] **Step 7: Look at it** — `.superpowers/sdd/2026-09-17-landing-redesign/shots/landing-after-{desktop,mobile}.png` via the Step-1 style script at 1280×900 and 390×844, full page. Read them: no overflow, no overlapping text, the window legible on mobile.

- [ ] **Step 8: Commit** (one commit; list the deleted files in `git add` too)

```bash
npx prettier --write apps/web/src/landing/Landing.tsx apps/web/src/landing/Landing.test.tsx apps/web/src/main.tsx apps/web/src/entry-prerender.tsx tests/e2e/landing.spec.ts
git add apps/web/src/landing/Landing.tsx apps/web/src/landing/Landing.test.tsx apps/web/src/main.tsx apps/web/src/entry-prerender.tsx tests/e2e/landing.spec.ts apps/web/src/Landing.tsx
git status --short apps/web/src/landing.css | grep -q . || git add apps/web/src/landing.css
git commit -m "The landing is the new page: eight sections composed under PublicShell, the old Landing.tsx and landing.css retired, the browser tests reading the new markup

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Records and the full check

**Files:**
- Modify (append only): `docs/progress.md`, `docs/decisions.md`, `docs/coordination/ACTIVE.md`, `docs/landing.md` (append a dated section), `docs/seo.md` (append one line under §2's table: the hero alt sentence now lives in the figure's caption)
- Modify: `docs/verification.md` — **only if `git status --short docs/verification.md` is empty**; otherwise BLOCK on that file alone and finish the rest.

- [ ] **Step 1: `npm run check`** → all green (unit, db, worker, build incl. 8 prerendered pages, secrets). Paste the tallies into the records.

- [ ] **Step 2: Append** to `docs/progress.md` a `## 2026-09-17 — landing rebuilt on the design system` entry (what changed, the file map, the before/after vitals from `vitals.txt`, the CSS byte ratio, which e2e tests were rewritten and why); to `docs/decisions.md` an entry recording: the still/interactive `ProductWindow`, the alt-sentence-as-caption decision, the `PublicShell` and the verbatim CSS moves, the reveal hook's "never hide what is already on screen" rule, the sheet variant; to `docs/coordination/ACTIVE.md` a row for `apps/web/src/{public,landing}/**`, `pricing.css`, `legal.css`, `ui/Accordion.tsx` — done, commits `<first>…<last>`; to `docs/landing.md` a dated section pointing at the new folder and saying the illustration is no longer rendered (kept as provenance + OG source); to `docs/seo.md` the one-line note.

- [ ] **Step 3: `docs/verification.md`** (if clean): a dated entry with the check tallies, the e2e files run and their counts, the vitals before/after, and the screenshots' paths.

- [ ] **Step 4: Commit**

```bash
git add docs/progress.md docs/decisions.md docs/coordination/ACTIVE.md docs/landing.md docs/seo.md
git status --short docs/verification.md | grep -q . || git add docs/verification.md
git commit -m "docs: record the landing rebuild — what moved, what was measured, and where the old illustration went

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** shell (T3, T4), `ProductWindow` (T5), sections 1–8 (T6–T9), Accordion + sheet (T1, T2), motion (T6 hook + CSS), performance guardrails (T10 Steps 1/6), testing (each task + T10 Step 4/5), cut-over and deletion (T10), records (T11), alt-sentence caption (T6 + T11 seo note). The spec's "Dialog test asserts computed `inset-inline-start`" is replaced by the attribute assertion in T2 because jsdom loads no stylesheet — the anchoring is proven by the e2e mobile test.
- **Placeholders:** none; every component and rule is written out.
- **Type consistency:** `ShellLink` / `PublicShell` props identical in T3 and T4/T10; `ProductWindow` props identical in T5, T6, T8; `useReveal<HTMLElement>()` returns a ref accepted by `<section ref>` in React 19; `Filter`/`Sentiment` exported from `demoData` and used only there and in `ProductWindow`.
