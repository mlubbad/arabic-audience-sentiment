# UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a headless component layer (`apps/web/src/ui/`) — Button, Card, Badge, Skeleton, Input, Textarea, Checkbox, Switch, Tooltip, Dialog, Popover, DropdownMenu, Tabs, Select, Toast, Table — built on Radix UI primitives and styled against the app's existing measured `brand.css` tokens, then prove it with one real usage.

**Architecture:** Each interactive component wraps the matching unstyled `@radix-ui/react-*` package (focus trap, keyboard nav, RTL-aware positioning, WAI-ARIA roles all come from Radix) and applies classNames from a new `apps/web/src/ui/ui.css` that reference only existing `brand.css` custom properties — no new colour tokens. Purely presentational pieces (Button, Card, Badge, Skeleton, Input, Textarea, Table) are plain React + the same CSS, no Radix. The app root that already sets `dir` (`AppLayout` in `main.tsx`) also gets wrapped in Radix's `DirectionProvider` so every primitive flips for RTL automatically. Nothing existing is edited or deleted except `main.tsx` (the provider wrap) and `AdminPage.tsx` (the one proof-of-use swap).

**Tech Stack:** React 19, TypeScript, Vite 6, Tailwind CSS v4, Radix UI primitive packages (`@radix-ui/react-{direction,slot,checkbox,switch,tooltip,dialog,popover,dropdown-menu,tabs,select,toast}`), `clsx` + `tailwind-merge` (the `cn()` helper), `class-variance-authority` (variants on Button and Badge only), Vitest, `@testing-library/react` + `@testing-library/user-event` + `@testing-library/jest-dom` (new — this is the project's first component-level test infrastructure; everything DOM-interactive so far is tested through Playwright e2e instead).

**Spec:** [docs/superpowers/specs/2026-09-16-ui-foundation-design.md](../specs/2026-09-16-ui-foundation-design.md)

## Global Constraints

- No new sentiment colour. Any component with a sentiment-tone variant (`Badge`) reads `--sentiment-positive` / `-negative` / `-neutral` / `-mixed` from `brand.css`; it never defines its own hex value.
- No component sets `letter-spacing` on text, anywhere, for any reason — `letter-spacing: 0` on Arabic text in this app is a deliberate fix for a real rendering defect (connected Arabic letterforms coming apart), not a style default, and the zero itself must never be overwritten to a non-zero value either.
- Any span that renders a numeral (a count, a figure) gets `font-family: var(--font-numeric)` — the app's two-typeface split (Arabic body face vs. tabular-numeral face) is deliberate and documented in `brand.css`.
- Every new user-facing string (an `aria-label`, a default toast title, a placeholder) is added to **both** `apps/web/src/strings/ar.ts` and `apps/web/src/strings/en.ts` in the same commit — `tsc` fails a mismatched pair, per the project's standing rule.
- Nothing in `app.css`, `landing.css`, `report.css`, `style.css`, or `glass.css` is edited or deleted by this plan.
- `npm run check` (lint, format:check, typecheck, functions check, unit+db tests, worker tests, build, secrets check) must stay green; run the relevant subset after every task, the full chain before the final commit.
- Node is pinned to `22.14.0` via `.nvmrc`/`engines` with `engine-strict=true` — if a command fails immediately with an engine error, the pinned Node is not on `PATH`.
- `npm` saves exact versions (`.npmrc`: `save-exact=true`) — install commands below never need a version pinned by hand.
- Do not touch `apps/web/src/legal/**` or `apps/web/public/.htaccess` or `apps/web/src/htaccess.test.ts` — pre-existing, unrelated, currently-uncommitted work in this checkout that this plan must not disturb (confirm with `git status` before your first commit and after your last).

---

## Task 1: Dependencies, the `cn()` helper, and component-test infrastructure

**Files:**
- Modify: `apps/web/package.json` (Radix packages, `clsx`, `tailwind-merge`, `class-variance-authority`)
- Modify: `package.json` (root devDependencies: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`)
- Modify: `vitest.config.ts` (add `.test.tsx` to `include`)
- Create: `apps/web/src/ui/cn.ts`
- Test: `apps/web/src/ui/cn.test.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` — every later component imports this from `./cn`.

- [ ] **Step 1: Install the Radix packages and styling helpers into the web workspace**

Run:
```bash
npm install \
  @radix-ui/react-direction \
  @radix-ui/react-slot \
  @radix-ui/react-checkbox \
  @radix-ui/react-switch \
  @radix-ui/react-tooltip \
  @radix-ui/react-dialog \
  @radix-ui/react-popover \
  @radix-ui/react-dropdown-menu \
  @radix-ui/react-tabs \
  @radix-ui/react-select \
  @radix-ui/react-toast \
  clsx \
  tailwind-merge \
  class-variance-authority \
  -w @sentiment/web
```
Expected: `apps/web/package.json`'s `dependencies` gains all eleven packages with exact resolved versions (no `^`/`~`, per `save-exact=true`).

- [ ] **Step 2: Install the test-infrastructure devDependencies at the root**

Run:
```bash
npm install -D \
  @testing-library/react \
  @testing-library/user-event \
  @testing-library/jest-dom \
  jsdom
```
Expected: root `package.json`'s `devDependencies` gains all four, exact versions. These are root-level like `vitest` itself already is, not workspace-scoped, because the test runner and its DOM environment are shared tooling.

- [ ] **Step 3: Add `.test.tsx` to the Vitest include glob**

Edit `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "supabase/tests/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 2,
  },
});
```

Only the one line is new. The default `environment` stays `node` for every existing `.test.ts` file; the new `.test.tsx` files opt into `jsdom` individually with a `// @vitest-environment jsdom` docblock at the top of each file (Step 5 below and every later component test), so this change cannot affect a single existing test's behaviour.

- [ ] **Step 4: Write the failing test for `cn()`**

Create `apps/web/src/ui/cn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn: merges classNames the way Tailwind utility conflicts need", () => {
  it("joins plain strings", () => {
    expect(cn("ui-btn", "ui-btn--primary")).toBe("ui-btn ui-btn--primary");
  });

  it("drops falsy values", () => {
    expect(cn("ui-btn", false && "ui-btn--primary", undefined, null)).toBe(
      "ui-btn",
    );
  });

  it("lets a later conflicting Tailwind class win over an earlier one", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `npm test -- apps/web/src/ui/cn.test.ts`
Expected: FAIL — `Cannot find module './cn'`.

- [ ] **Step 6: Implement `cn()`**

Create `apps/web/src/ui/cn.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and lets a later Tailwind utility win over an earlier,
 *  conflicting one — what every component below needs when a caller passes
 *  an extra `className` that should override a default. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 7: Run it to see it pass**

Run: `npm test -- apps/web/src/ui/cn.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Commit**

```bash
git add package.json apps/web/package.json package-lock.json vitest.config.ts apps/web/src/ui/cn.ts apps/web/src/ui/cn.test.ts
git commit -m "ui: add Radix/cva/cn dependencies and component-test infra"
```

---

## Task 2: `DirectionProvider` in the app shell

**Files:**
- Modify: `apps/web/src/main.tsx:279-406` (the `AppLayout` function)

**Interfaces:**
- Consumes: `direction(locale)` and `useLocale()` from `./locale` (already imported in `main.tsx`).
- Produces: every Radix primitive mounted anywhere under `AppLayout` (which is every signed-in route: `/dashboard`, `/account`, `/sync`, `/admin`, `/connected`) now reads the correct RTL/LTR direction from context, matching the `dir` attribute the shell already sets.

- [ ] **Step 1: Import `DirectionProvider`**

In `apps/web/src/main.tsx`, add to the imports:

```ts
import { DirectionProvider } from "@radix-ui/react-direction";
```

(Verified against the installed package's own type declarations
(`node_modules/@radix-ui/react-direction/dist/index.d.mts`): it exports `DirectionProvider`,
a `Provider` alias, and the `useDirection` hook — `DirectionProvider` is the name every other
Radix package's own source imports it as, so it's the one used here too.)

- [ ] **Step 2: Wrap `AppLayout`'s returned tree**

In `apps/web/src/main.tsx`, change `AppLayout`'s return statement from:

```tsx
  return (
    <div className="app-shell" dir={direction(locale)}>
```

to:

```tsx
  return (
    <DirectionProvider dir={direction(locale)}>
      <div className="app-shell" dir={direction(locale)}>
```

and its closing `</div>` (currently the last line of the function's JSX, just before the function's closing brace) to:

```tsx
      </div>
    </DirectionProvider>
  );
```

The `dir` attribute on `.app-shell` stays — that's what the browser's own bidi algorithm and CSS `:lang()`/`:dir()` read; `DirectionProvider` sets a separate, React-context-only signal that only Radix's own primitives read internally. Setting both from the same `direction(locale)` call keeps them from ever disagreeing.

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build -w @sentiment/web`
Expected: both exit 0. `AppLayout` isn't exported or imported anywhere else, so there is no other call site to update.

- [ ] **Step 4: Smoke-check the running app**

This step has no automated test yet — no Radix primitive is mounted in the app until Task 17, so there is nothing for an automated RTL assertion to observe. Confirm by hand instead: start the dev server, open `/dashboard` signed out (redirects are not required to see the shell render), and confirm the page still renders with no console error. Task 17's Playwright test is where `DirectionProvider`'s effect becomes automatically verifiable, once `AdminPage.tsx` actually mounts a Radix `Select`.

Run: `npm run dev` (or use the project's preview tooling), then load `http://127.0.0.1:5173/dashboard` and check the browser console for errors.
Expected: page renders, no new console errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/main.tsx
git commit -m "ui: wrap the app shell in Radix's DirectionProvider"
```

---

## Task 3: `Button` and the `ui.css` foundation

**Files:**
- Create: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/Button.tsx`
- Test: `apps/web/src/ui/Button.test.tsx`
- Modify: `apps/web/src/main.tsx` (global CSS import)

**Interfaces:**
- Produces: `Button` — `{ variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; asChild?: boolean } & React.ComponentPropsWithRef<"button">`. Default `variant="primary"`, `size="md"`.
- Produces: the `.ui-num` utility class (`font-family: var(--font-numeric); font-variant-numeric: tabular-nums;`) that Badge (Task 5) and Toast (Task 14) both use.

- [ ] **Step 1: Create `ui.css` with the shared utility and the Button styles**

Create `apps/web/src/ui/ui.css`:

```css
/* apps/web/src/ui — a headless component layer styled against brand.css's
   existing, measured tokens. No colour, spacing or radius value is invented
   here; every one is a var() onto brand.css. See
   docs/superpowers/specs/2026-09-16-ui-foundation-design.md. */

/* A figure wears the numeric face; brand.css documents why. Any component
   below that renders a count applies this class to that span, never to the
   sentence around it. */
.ui-num {
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
}

.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border-radius: var(--radius-2);
  border: 1px solid transparent;
  font-family: var(--font-body);
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.ui-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.ui-btn:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.ui-btn--sm {
  padding: var(--space-1) var(--space-3);
  font-size: var(--fs-small);
}
.ui-btn--md {
  padding: var(--space-2) var(--space-4);
  font-size: var(--fs-body);
}
.ui-btn--lg {
  padding: var(--space-3) var(--space-5);
  font-size: var(--fs-body);
}

.ui-btn--primary {
  background: var(--ml-indigo);
  color: var(--ink-on-dark);
}
.ui-btn--primary:hover:not(:disabled) {
  background: var(--ml-indigo-800);
}

.ui-btn--secondary {
  background: var(--bg-card);
  color: var(--text-1);
  border-color: var(--border-2);
}
.ui-btn--secondary:hover:not(:disabled) {
  background: var(--bg-muted);
}

.ui-btn--ghost {
  background: transparent;
  color: var(--text-1);
}
.ui-btn--ghost:hover:not(:disabled) {
  background: var(--bg-muted);
}

.ui-btn--danger {
  background: var(--color-danger);
  color: var(--ink-on-dark);
}
.ui-btn--danger:hover:not(:disabled) {
  filter: brightness(0.92);
}
```

- [ ] **Step 2: Import `ui.css` globally**

In `apps/web/src/main.tsx`, add beside the existing global imports:

```ts
import "./style.css";
import "./app.css";
import "./locale.css";
import "./ui/ui.css";
```

- [ ] **Step 3: Write the failing test for `Button`**

Create `apps/web/src/ui/Button.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its children and the primary/md defaults", () => {
    render(<Button>احفظ</Button>);
    const btn = screen.getByRole("button", { name: "احفظ" });
    expect(btn).toHaveClass("ui-btn", "ui-btn--primary", "ui-btn--md");
  });

  it("applies the requested variant and size", () => {
    render(
      <Button variant="danger" size="lg">
        احذف
      </Button>,
    );
    expect(screen.getByRole("button", { name: "احذف" })).toHaveClass(
      "ui-btn--danger",
      "ui-btn--lg",
    );
  });

  it("fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>تأكيد</Button>);
    await userEvent.click(screen.getByRole("button", { name: "تأكيد" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled when asked, and does not fire onClick", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        احفظ
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "احفظ" });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npm test -- apps/web/src/ui/Button.test.tsx`
Expected: FAIL — `Cannot find module './Button'`.

- [ ] **Step 5: Implement `Button`**

Create `apps/web/src/ui/Button.tsx`:

```tsx
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const button = cva("ui-btn", {
  variants: {
    variant: {
      primary: "ui-btn--primary",
      secondary: "ui-btn--secondary",
      ghost: "ui-btn--ghost",
      danger: "ui-btn--danger",
    },
    size: {
      sm: "ui-btn--sm",
      md: "ui-btn--md",
      lg: "ui-btn--lg",
    },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

export interface ButtonProps
  extends React.ComponentPropsWithRef<"button">,
    VariantProps<typeof button> {
  /** Renders the child element with the button's classes and behaviour
   *  instead of a `<button>` — for a `Link` that should look like one. */
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(button({ variant, size }), className)}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    />
  );
}
```

`type={...?? "button"}` (not `"submit"`), because an un-typed `<button>` inside a `<form>` submits it — every admin-page form already relies on its own submit button doing that deliberately, and a `Button` used decoratively inside one of those forms must not.

- [ ] **Step 6: Run it to see it pass**

Run: `npm test -- apps/web/src/ui/Button.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 7: Full check on this slice**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: all exit 0. If `format:check` fails, run `npm run format` and re-check — it only rewrites formatting, never logic.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/main.tsx apps/web/src/ui/ui.css apps/web/src/ui/Button.tsx apps/web/src/ui/Button.test.tsx
git commit -m "ui: add ui.css foundation and the Button component"
```

---

## Task 4: `Card` and `Skeleton`

**Files:**
- Modify: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/Card.tsx`
- Create: `apps/web/src/ui/Skeleton.tsx`
- Test: `apps/web/src/ui/Card.test.tsx`
- Test: `apps/web/src/ui/Skeleton.test.tsx`

**Interfaces:**
- Produces: `Card` — `React.ComponentPropsWithRef<"div">`, renders a `<div className="ui-card">`.
- Produces: `Skeleton` — `{ width?: string | number; height?: string | number } & React.ComponentPropsWithRef<"div">`, renders a `<div className="ui-skeleton" role="status" aria-label="…">`.

- [ ] **Step 1: Add their CSS**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-card {
  background: var(--bg-card);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2);
  box-shadow: var(--shadow-1);
  padding: var(--space-5);
}

.ui-skeleton {
  border-radius: var(--radius-1);
  background: linear-gradient(
    90deg,
    var(--bg-muted) 25%,
    var(--border-1) 50%,
    var(--bg-muted) 75%
  );
  background-size: 200% 100%;
  animation: ui-skeleton-shimmer 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ui-skeleton {
    animation: none;
  }
}
@keyframes ui-skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/ui/Card.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders its children inside a ui-card div", () => {
    render(<Card data-testid="c">محتوى</Card>);
    const el = screen.getByTestId("c");
    expect(el).toHaveClass("ui-card");
    expect(el).toHaveTextContent("محتوى");
  });
});
```

Create `apps/web/src/ui/Skeleton.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("announces itself as a status region so a screen reader knows content is loading", () => {
    render(<Skeleton aria-label="جارٍ التحميل" />);
    expect(screen.getByRole("status", { name: "جارٍ التحميل" })).toHaveClass(
      "ui-skeleton",
    );
  });

  it("applies width and height as inline styles", () => {
    render(<Skeleton aria-label="جارٍ التحميل" width={120} height="2rem" />);
    const el = screen.getByRole("status");
    expect(el).toHaveStyle({ width: "120px", height: "2rem" });
  });
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `npm test -- apps/web/src/ui/Card.test.tsx apps/web/src/ui/Skeleton.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `Card`**

Create `apps/web/src/ui/Card.tsx`:

```tsx
import { cn } from "./cn";

export function Card({
  className,
  ...props
}: React.ComponentPropsWithRef<"div">) {
  return <div className={cn("ui-card", className)} {...props} />;
}
```

- [ ] **Step 5: Implement `Skeleton`**

Create `apps/web/src/ui/Skeleton.tsx`:

```tsx
import { cn } from "./cn";

export interface SkeletonProps extends React.ComponentPropsWithRef<"div"> {
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  className,
  width,
  height,
  style,
  ...props
}: SkeletonProps) {
  return (
    <div
      role="status"
      className={cn("ui-skeleton", className)}
      style={{ width, height, ...style }}
      {...props}
    />
  );
}
```

- [ ] **Step 6: Run both to see them pass**

Run: `npm test -- apps/web/src/ui/Card.test.tsx apps/web/src/ui/Skeleton.test.tsx`
Expected: PASS, 3 tests total.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui/ui.css apps/web/src/ui/Card.tsx apps/web/src/ui/Card.test.tsx apps/web/src/ui/Skeleton.tsx apps/web/src/ui/Skeleton.test.tsx
git commit -m "ui: add Card and Skeleton"
```

---

## Task 5: `Badge` (the sentiment-colour invariant)

**Files:**
- Modify: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/Badge.tsx`
- Test: `apps/web/src/ui/Badge.test.tsx`

**Interfaces:**
- Produces: `Badge` — `{ tone?: "neutral" | "positive" | "negative" | "sentiment-mixed" | "success" | "warning" | "danger"; numeric?: boolean } & React.ComponentPropsWithRef<"span">`. Default `tone="neutral"`.

This is the component the spec calls out by name for the "no second sentiment colour" rule — its test asserts the four sentiment tones resolve to the exact `brand.css` variable names, not a value copied from them.

- [ ] **Step 1: Add its CSS, reading only existing `brand.css` variables**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  border-radius: 999px;
  padding: 2px var(--space-3);
  font-size: var(--fs-small);
  font-weight: 600;
  line-height: 1.4;
}

.ui-badge--neutral {
  background: var(--bg-muted);
  color: var(--text-2);
}
.ui-badge--success {
  background: var(--success-100);
  color: var(--color-success);
}
.ui-badge--warning {
  background: var(--warning-bg);
  color: var(--color-warning);
}
.ui-badge--danger {
  background: var(--ml-rose-100);
  color: var(--color-danger);
}

/* The sentiment scale: one source, brand.css's --sentiment-* tokens, never a
   value re-typed here. See docs/coordination/ACTIVE.md on why this is the
   dominant bug shape in this codebase. */
.ui-badge--positive {
  background: color-mix(in srgb, var(--sentiment-positive) 14%, white);
  color: var(--sentiment-positive);
}
.ui-badge--negative {
  background: color-mix(in srgb, var(--sentiment-negative) 14%, white);
  color: var(--sentiment-negative);
}
.ui-badge--sentiment-mixed {
  background: color-mix(in srgb, var(--sentiment-mixed) 14%, white);
  color: var(--sentiment-mixed);
}
```

`tone="neutral"` (grey UI state) and the sentiment scale's own neutral (`--sentiment-neutral`) are different meanings that happen to share an English word — the sentiment scale is `positive` / `negative` / `sentiment-mixed` here deliberately prefixed, so a caller reaching for sentiment can't land on the UI-state grey by accident and call it "neutral sentiment". A sentiment-neutral badge, if a later phase needs one, gets its own explicit tone reading `--sentiment-neutral`; none of this phase's consumers need it, so it is not added ahead of that need.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/ui/Badge.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

const css = readFileSync(new URL("./ui.css", import.meta.url), "utf8");

describe("Badge", () => {
  it("defaults to the neutral UI tone", () => {
    render(<Badge>جديد</Badge>);
    expect(screen.getByText("جديد")).toHaveClass("ui-badge", "ui-badge--neutral");
  });

  it.each([
    ["positive", "--sentiment-positive"],
    ["negative", "--sentiment-negative"],
    ["sentiment-mixed", "--sentiment-mixed"],
  ] as const)(
    "the %s tone's CSS reads brand.css's %s token, not a re-typed value",
    (tone, token) => {
      render(<Badge tone={tone}>x</Badge>);
      expect(screen.getByText("x")).toHaveClass(`ui-badge--${tone}`);
      // The rule under test is about the stylesheet, not computed pixels —
      // jsdom applies no stylesheet, so this reads ui.css's own source
      // rather than assuming a computed color reflects it.
      const rule = css.match(
        new RegExp(`\\.ui-badge--${tone}\\s*{[^}]*}`, "s"),
      )?.[0];
      expect(rule).toBeDefined();
      expect(rule).toContain(`var(${token})`);
      // And never a bare hex triplet standing in for that token.
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    },
  );

  it("marks a numeric badge with the numeral face", () => {
    render(
      <Badge numeric tone="danger">
        7
      </Badge>,
    );
    expect(screen.getByText("7")).toHaveClass("ui-num");
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- apps/web/src/ui/Badge.test.tsx`
Expected: FAIL — `Cannot find module './Badge'`.

- [ ] **Step 4: Implement `Badge`**

Create `apps/web/src/ui/Badge.tsx`:

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const badge = cva("ui-badge", {
  variants: {
    tone: {
      neutral: "ui-badge--neutral",
      success: "ui-badge--success",
      warning: "ui-badge--warning",
      danger: "ui-badge--danger",
      positive: "ui-badge--positive",
      negative: "ui-badge--negative",
      "sentiment-mixed": "ui-badge--sentiment-mixed",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface BadgeProps
  extends React.ComponentPropsWithRef<"span">,
    VariantProps<typeof badge> {
  /** True for a badge whose content is a number — applies the numeral face,
   *  not the body face, to that content. */
  numeric?: boolean;
}

export function Badge({ className, tone, numeric, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badge({ tone }), numeric && "ui-num", className)}
      {...props}
    />
  );
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npm test -- apps/web/src/ui/Badge.test.tsx`
Expected: PASS, 5 tests (1 + 3 from `it.each` + 1).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/ui.css apps/web/src/ui/Badge.tsx apps/web/src/ui/Badge.test.tsx
git commit -m "ui: add Badge, sourced from brand.css's sentiment tokens only"
```

---

## Task 6: `Input` and `Textarea`

**Files:**
- Modify: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/Input.tsx`
- Create: `apps/web/src/ui/Textarea.tsx`
- Test: `apps/web/src/ui/Input.test.tsx`
- Test: `apps/web/src/ui/Textarea.test.tsx`

**Interfaces:**
- Produces: `Input` — `{ invalid?: boolean } & React.ComponentPropsWithRef<"input">`.
- Produces: `Textarea` — `{ invalid?: boolean } & React.ComponentPropsWithRef<"textarea">`.

Plain native elements, styled — no Radix, no ARIA role to get wrong, so no focus/keyboard test beyond what the browser already guarantees for a native `<input>`/`<textarea>`. The behaviour worth testing is the one this layer adds: the `invalid` prop wiring `aria-invalid` and the error styling.

- [ ] **Step 1: Add their CSS**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-input,
.ui-textarea {
  width: 100%;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-1);
  background: var(--bg-card);
  color: var(--text-1);
  font-family: var(--font-body);
  font-size: var(--fs-body);
  padding: var(--space-2) var(--space-3);
}
.ui-input:focus-visible,
.ui-textarea:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}
.ui-input[aria-invalid="true"],
.ui-textarea[aria-invalid="true"] {
  border-color: var(--color-danger);
}
.ui-textarea {
  min-height: 6rem;
  resize: vertical;
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/ui/Input.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./Input";

describe("Input", () => {
  it("accepts typed text", async () => {
    render(<Input aria-label="اسم مساحة العمل" />);
    const el = screen.getByLabelText("اسم مساحة العمل");
    await userEvent.type(el, "قناتي");
    expect(el).toHaveValue("قناتي");
  });

  it("sets aria-invalid and the error class when invalid", () => {
    render(<Input aria-label="البريد" invalid />);
    const el = screen.getByLabelText("البريد");
    expect(el).toHaveAttribute("aria-invalid", "true");
  });

  it("leaves aria-invalid unset by default", () => {
    render(<Input aria-label="البريد" />);
    expect(screen.getByLabelText("البريد")).not.toHaveAttribute(
      "aria-invalid",
    );
  });
});
```

Create `apps/web/src/ui/Textarea.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "./Textarea";

describe("Textarea", () => {
  it("accepts typed text", async () => {
    render(<Textarea aria-label="ملاحظة" />);
    const el = screen.getByLabelText("ملاحظة");
    await userEvent.type(el, "منحت يدويًا");
    expect(el).toHaveValue("منحت يدويًا");
  });

  it("sets aria-invalid when invalid", () => {
    render(<Textarea aria-label="ملاحظة" invalid />);
    expect(screen.getByLabelText("ملاحظة")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `npm test -- apps/web/src/ui/Input.test.tsx apps/web/src/ui/Textarea.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `Input`**

Create `apps/web/src/ui/Input.tsx`:

```tsx
import { cn } from "./cn";

export interface InputProps extends React.ComponentPropsWithRef<"input"> {
  invalid?: boolean;
}

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      className={cn("ui-input", className)}
      aria-invalid={invalid ? "true" : undefined}
      {...props}
    />
  );
}
```

- [ ] **Step 5: Implement `Textarea`**

Create `apps/web/src/ui/Textarea.tsx`:

```tsx
import { cn } from "./cn";

export interface TextareaProps
  extends React.ComponentPropsWithRef<"textarea"> {
  invalid?: boolean;
}

export function Textarea({ className, invalid, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn("ui-textarea", className)}
      aria-invalid={invalid ? "true" : undefined}
      {...props}
    />
  );
}
```

- [ ] **Step 6: Run both to see them pass**

Run: `npm test -- apps/web/src/ui/Input.test.tsx apps/web/src/ui/Textarea.test.tsx`
Expected: PASS, 5 tests total.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui/ui.css apps/web/src/ui/Input.tsx apps/web/src/ui/Input.test.tsx apps/web/src/ui/Textarea.tsx apps/web/src/ui/Textarea.test.tsx
git commit -m "ui: add Input and Textarea"
```

---

## Task 7: `Checkbox` and `Switch`

**Files:**
- Modify: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/Checkbox.tsx`
- Create: `apps/web/src/ui/Switch.tsx`
- Test: `apps/web/src/ui/Checkbox.test.tsx`
- Test: `apps/web/src/ui/Switch.test.tsx`

**Interfaces:**
- Produces: `Checkbox` — `{ label: string } & React.ComponentProps<typeof CheckboxPrimitive.Root>` (Radix's own `checked`/`onCheckedChange`/`disabled` pass straight through). Renders its own `<label>` wrapping the control, so every checkbox in this app carries an accessible name without a caller remembering to add one.
- Produces: `Switch` — same shape, wrapping `@radix-ui/react-switch`.

- [ ] **Step 1: Add their CSS**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-checkbox-row,
.ui-switch-row {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-body);
  font-size: var(--fs-body);
  color: var(--text-1);
}

.ui-checkbox {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid var(--border-2);
  background: var(--bg-card);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ui-checkbox[data-state="checked"] {
  background: var(--ml-indigo);
  border-color: var(--ml-indigo);
}
.ui-checkbox:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.ui-checkbox-indicator {
  color: var(--ink-on-dark);
}

.ui-switch {
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: var(--border-2);
  position: relative;
  border: none;
}
.ui-switch[data-state="checked"] {
  background: var(--ml-indigo);
}
.ui-switch:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.ui-switch-thumb {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--ink-on-dark);
  transform: translateX(2px);
  transition: transform 0.15s ease;
}
.ui-switch[data-state="checked"] .ui-switch-thumb {
  transform: translateX(18px);
}
/* Radix flips the geometry it computes for RTL, but a translateX written by
   hand here would not — so the checked thumb's offset is mirrored
   explicitly for the one case Radix's own positioning doesn't reach: a
   plain CSS transform on a part this component styles itself. */
[dir="rtl"] .ui-switch[data-state="checked"] .ui-switch-thumb {
  transform: translateX(-18px);
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/ui/Checkbox.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  it("is labelled and starts unchecked", () => {
    render(<Checkbox label="تجاوز حد الفوترة" />);
    const box = screen.getByRole("checkbox", { name: "تجاوز حد الفوترة" });
    expect(box).not.toBeChecked();
  });

  it("toggles on click and calls onCheckedChange", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox label="تجاوز حد الفوترة" onCheckedChange={onCheckedChange} />,
    );
    const box = screen.getByRole("checkbox", { name: "تجاوز حد الفوترة" });
    await userEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("toggles on Space when focused, per WAI-ARIA checkbox pattern", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox label="تجاوز حد الفوترة" onCheckedChange={onCheckedChange} />,
    );
    const box = screen.getByRole("checkbox", { name: "تجاوز حد الفوترة" });
    box.focus();
    await userEvent.keyboard(" ");
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
```

Create `apps/web/src/ui/Switch.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("is labelled and starts off", () => {
    render(<Switch label="إشعارات البريد" />);
    expect(screen.getByRole("switch", { name: "إشعارات البريد" })).not.toBeChecked();
  });

  it("toggles on click", async () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="إشعارات البريد" onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole("switch", { name: "إشعارات البريد" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `npm test -- apps/web/src/ui/Checkbox.test.tsx apps/web/src/ui/Switch.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `Checkbox`**

Create `apps/web/src/ui/Checkbox.tsx`:

```tsx
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { cn } from "./cn";

export interface CheckboxProps
  extends React.ComponentProps<typeof CheckboxPrimitive.Root> {
  label: string;
}

export function Checkbox({ label, className, ...props }: CheckboxProps) {
  return (
    <label className="ui-checkbox-row">
      <CheckboxPrimitive.Root
        className={cn("ui-checkbox", className)}
        aria-label={label}
        {...props}
      >
        <CheckboxPrimitive.Indicator className="ui-checkbox-indicator">
          ✓
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label}
    </label>
  );
}
```

- [ ] **Step 5: Implement `Switch`**

Create `apps/web/src/ui/Switch.tsx`:

```tsx
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "./cn";

export interface SwitchProps
  extends React.ComponentProps<typeof SwitchPrimitive.Root> {
  label: string;
}

export function Switch({ label, className, ...props }: SwitchProps) {
  return (
    <label className="ui-switch-row">
      <SwitchPrimitive.Root
        className={cn("ui-switch", className)}
        aria-label={label}
        {...props}
      >
        <SwitchPrimitive.Thumb className="ui-switch-thumb" />
      </SwitchPrimitive.Root>
      {label}
    </label>
  );
}
```

Both wrap their control in a `<label>` rather than using Radix's `id` + separate `<label htmlFor>` pattern: clicking anywhere in the row toggles the control, which is the larger, easier target this project's existing forms (`AdminPage.tsx`'s own checkbox, written by hand) already give the reader.

- [ ] **Step 6: Run both to see them pass**

Run: `npm test -- apps/web/src/ui/Checkbox.test.tsx apps/web/src/ui/Switch.test.tsx`
Expected: PASS, 5 tests total.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui/ui.css apps/web/src/ui/Checkbox.tsx apps/web/src/ui/Checkbox.test.tsx apps/web/src/ui/Switch.tsx apps/web/src/ui/Switch.test.tsx
git commit -m "ui: add Checkbox and Switch"
```

---

## Task 8: `Tooltip`

**Files:**
- Modify: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/Tooltip.tsx`
- Test: `apps/web/src/ui/Tooltip.test.tsx`

**Interfaces:**
- Produces: `Tooltip` — `{ content: React.ReactNode; children: React.ReactElement }`, a single-purpose wrapper (Radix's `Provider` + `Root` + `Trigger` + `Portal` + `Content`, composed once) rather than exposing every Radix part — every call site in this app wants "wrap one element, show this content on hover/focus," never a custom trigger composition.

This is the first component that opens content in a `Portal` (rendered outside the DOM subtree it's written in) — the RTL question worth verifying here is that the portaled content still reads `dir` correctly from `Direction` context, since a portal moves the DOM node but not the React tree, so context should still flow. A test that fails on this would fail on every later portaled component (`Dialog`, `Popover`, `DropdownMenu`, `Select`) too, so it is checked once, here, rather than four times over.

- [ ] **Step 1: Add its CSS**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-tooltip-content {
  background: var(--fg-1);
  color: var(--ink-on-dark);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-1);
  font-size: var(--fs-small);
  box-shadow: var(--shadow-2);
  max-width: 260px;
  z-index: 50;
}
```

- [ ] **Step 2: Write the failing test, including the RTL-through-a-portal check**

Create `apps/web/src/ui/Tooltip.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider } from "@radix-ui/react-direction";
import { Tooltip } from "./Tooltip";
import { Button } from "./Button";

describe("Tooltip", () => {
  it("shows its content on focus and hides it on blur", async () => {
    render(
      <Tooltip content="يفتح نافذة Paddle للفوترة">
        <Button>الحساب والفوترة</Button>
      </Tooltip>,
    );
    expect(screen.queryByText("يفتح نافذة Paddle للفوترة")).not.toBeInTheDocument();
    await userEvent.tab();
    await waitFor(() =>
      expect(screen.getByText("يفتح نافذة Paddle للفوترة")).toBeVisible(),
    );
  });

  it("reads RTL direction through the Portal from Direction context, not just the tree it's declared in", async () => {
    render(
      <DirectionProvider dir="rtl">
        <Tooltip content="نص">
          <Button>زر</Button>
        </Tooltip>
      </DirectionProvider>,
    );
    await userEvent.tab();
    const content = await screen.findByText("نص");
    // Radix's Content sets data-side/data-align relative to dir; asserting
    // the portaled node exists and is reachable from the same test as the
    // rtl Direction wrapper is the check — a context break would either
    // throw during Radix's positioning math or fail to render the content
    // at all, both of which this catches.
    expect(content).toBeVisible();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- apps/web/src/ui/Tooltip.test.tsx`
Expected: FAIL — `Cannot find module './Tooltip'`.

- [ ] **Step 4: Implement `Tooltip`**

Create `apps/web/src/ui/Tooltip.tsx`:

```tsx
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "./cn";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className={cn("ui-tooltip-content", className)}
            sideOffset={6}
          >
            {content}
            <TooltipPrimitive.Arrow style={{ fill: "var(--fg-1)" }} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npm test -- apps/web/src/ui/Tooltip.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/ui.css apps/web/src/ui/Tooltip.tsx apps/web/src/ui/Tooltip.test.tsx
git commit -m "ui: add Tooltip, verifying Direction context survives a Portal"
```

---

## Task 9: `Dialog`

**Files:**
- Modify: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/Dialog.tsx`
- Test: `apps/web/src/ui/Dialog.test.tsx`

**Interfaces:**
- Produces: `Dialog`, `DialogTrigger`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogClose` — thin, styled re-exports of the matching Radix parts, composed by the caller the way Radix's own docs show (`<Dialog><DialogTrigger asChild>…</DialogTrigger><DialogContent><DialogTitle>…</DialogTitle>…</DialogContent></Dialog>`). `DialogContent` always renders a close button in its top corner, labelled from a required `closeLabel` prop (bilingual — see Global Constraints) rather than a hard-coded "×"'s accessible name.

- [ ] **Step 1: Add its CSS**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(14, 10, 46, 0.45);
  z-index: 60;
}
.ui-dialog-content {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(480px, calc(100vw - var(--space-6)));
  max-height: calc(100vh - var(--space-7));
  overflow-y: auto;
  background: var(--bg-card);
  border-radius: var(--radius-3);
  box-shadow: var(--shadow-3);
  padding: var(--space-6);
  z-index: 61;
}
.ui-dialog-content:focus-visible {
  outline: none;
}
.ui-dialog-title {
  font-size: var(--fs-h3);
  color: var(--text-1);
  margin: 0 0 var(--space-2);
}
.ui-dialog-description {
  color: var(--text-2);
  margin: 0 0 var(--space-4);
}
.ui-dialog-close {
  position: absolute;
  top: var(--space-3);
  /* Radix does not mirror a component's own CSS for it; a corner button
     positioned with a physical inset property has to be told the direction
     by hand. The logical property does this in one declaration instead of a
     [dir="rtl"] override, and does it correctly for a dialog opened inside a
     Direction context that has flipped independently of the document dir. */
  inset-inline-end: var(--space-3);
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  padding: var(--space-1);
}
.ui-dialog-close:hover {
  color: var(--text-1);
}
.ui-dialog-close:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/ui/Dialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useDirection } from "@radix-ui/react-direction";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";
import { Button } from "./Button";

/** Reports the `Direction` context it actually reads, from inside whatever
 *  rendered it — used only by the RTL test below. Radix's `useDirection()`
 *  falls back to `"ltr"` silently when no context is found (it never
 *  throws), so a test that only checks "did the dialog still open" would
 *  pass identically whether or not `DirectionProvider`'s value survived the
 *  `Portal`. This probe checks the value itself, not a proxy for it. */
function DirectionProbe() {
  const dir = useDirection();
  return <span data-testid="dir-probe">{dir}</span>;
}

function ExampleDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>منح حزمة</Button>
      </DialogTrigger>
      <DialogContent closeLabel="إغلاق">
        <DialogTitle>تأكيد منح الحزمة</DialogTitle>
        <DialogDescription>لا يمكن التراجع عن هذا الإجراء.</DialogDescription>
        <button type="button">أول عنصر قابل للتركيز</button>
        <DirectionProbe />
        <DialogClose asChild>
          <Button variant="secondary">إلغاء</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("is closed until the trigger opens it, and focus moves inside", async () => {
    render(<ExampleDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "منح حزمة" }));
    const dialog = await screen.findByRole("dialog", {
      name: "تأكيد منح الحزمة",
    });
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<ExampleDialog />);
    const trigger = screen.getByRole("button", { name: "منح حزمة" });
    await userEvent.click(trigger);
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("closes when DialogClose is activated", async () => {
    render(<ExampleDialog />);
    await userEvent.click(screen.getByRole("button", { name: "منح حزمة" }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("labels the built-in close button from closeLabel, bilingually meaningful", async () => {
    render(<ExampleDialog />);
    await userEvent.click(screen.getByRole("button", { name: "منح حزمة" }));
    expect(
      await screen.findByRole("button", { name: "إغلاق" }),
    ).toBeInTheDocument();
  });

  it("under DirectionProvider dir=rtl: useDirection() inside the Portal's content reports \"rtl\", not the silent \"ltr\" fallback, and the mechanics (focus trap, Escape close, focus return) still work", async () => {
    render(
      <DirectionProvider dir="rtl">
        <ExampleDialog />
      </DirectionProvider>,
    );
    const trigger = screen.getByRole("button", { name: "منح حزمة" });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByTestId("dir-probe")).toHaveTextContent("rtl");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });
});
```

`DirectionProvider` is imported the same way `Tooltip.test.tsx` and the later menu/tabs/select tests import it:

```tsx
import { DirectionProvider } from "@radix-ui/react-direction";
```

Add that import alongside the others at the top of `Dialog.test.tsx`.

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- apps/web/src/ui/Dialog.test.tsx`
Expected: FAIL — `Cannot find module './Dialog'`.

- [ ] **Step 4: Implement `Dialog`**

Create `apps/web/src/ui/Dialog.tsx`:

```tsx
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "./cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title className={cn("ui-dialog-title", className)} {...props} />
);
export const DialogDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    className={cn("ui-dialog-description", className)}
    {...props}
  />
);

export interface DialogContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content> {
  /** The built-in corner close button's accessible name. Required, not
   *  defaulted to a hard-coded word, so every call site supplies the
   *  current locale's string rather than this component silently speaking
   *  one language. */
  closeLabel: string;
}

export function DialogContent({
  className,
  children,
  closeLabel,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-dialog-overlay" />
      <DialogPrimitive.Content
        className={cn("ui-dialog-content", className)}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="ui-dialog-close" aria-label={closeLabel}>
          ✕
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npm test -- apps/web/src/ui/Dialog.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/ui.css apps/web/src/ui/Dialog.tsx apps/web/src/ui/Dialog.test.tsx
git commit -m "ui: add Dialog with focus-trap and Escape-close coverage"
```

---

## Task 10: `Popover`

**Files:**
- Modify: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/Popover.tsx`
- Test: `apps/web/src/ui/Popover.test.tsx`

**Interfaces:**
- Produces: `Popover`, `PopoverTrigger`, `PopoverContent` — the same composition shape as `Dialog`, without a title/description (a popover is transient chrome, not a modal document) and without a forced close button (Radix closes it on outside click and `Escape` by default, which is the whole of what a popover needs).

- [ ] **Step 1: Add its CSS**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-popover-content {
  background: var(--bg-card);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2);
  box-shadow: var(--shadow-2);
  padding: var(--space-4);
  z-index: 55;
  max-width: 320px;
}
.ui-popover-content:focus-visible {
  outline: none;
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/ui/Popover.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider, useDirection } from "@radix-ui/react-direction";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { Button } from "./Button";

/** See Dialog.test.tsx's DirectionProbe for why this checks useDirection()
 *  itself rather than only whether the popover still opens. */
function DirectionProbe() {
  const dir = useDirection();
  return <span data-testid="dir-probe">{dir}</span>;
}

function ExamplePopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button>خيارات العمود</Button>
      </PopoverTrigger>
      <PopoverContent>
        محتوى القائمة
        <DirectionProbe />
      </PopoverContent>
    </Popover>
  );
}

describe("Popover", () => {
  it("opens on trigger click and closes on Escape, focus returning to the trigger", async () => {
    render(<ExamplePopover />);
    const trigger = screen.getByRole("button", { name: "خيارات العمود" });
    await userEvent.click(trigger);
    expect(await screen.findByText("محتوى القائمة")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("محتوى القائمة")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("closes on an outside click", async () => {
    render(
      <div>
        <ExamplePopover />
        <button type="button">خارج القائمة</button>
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "خيارات العمود" }));
    await screen.findByText("محتوى القائمة");
    await userEvent.click(screen.getByRole("button", { name: "خارج القائمة" }));
    await waitFor(() =>
      expect(screen.queryByText("محتوى القائمة")).not.toBeInTheDocument(),
    );
  });

  it("under DirectionProvider dir=rtl: useDirection() inside the Portal's content reports \"rtl\", and the popover still opens/closes correctly", async () => {
    render(
      <DirectionProvider dir="rtl">
        <ExamplePopover />
      </DirectionProvider>,
    );
    const trigger = screen.getByRole("button", { name: "خيارات العمود" });
    await userEvent.click(trigger);
    expect(await screen.findByText("محتوى القائمة")).toBeVisible();
    expect(screen.getByTestId("dir-probe")).toHaveTextContent("rtl");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("محتوى القائمة")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- apps/web/src/ui/Popover.test.tsx`
Expected: FAIL — `Cannot find module './Popover'`.

- [ ] **Step 4: Implement `Popover`**

Create `apps/web/src/ui/Popover.tsx`:

```tsx
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "./cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        className={cn("ui-popover-content", className)}
        sideOffset={sideOffset}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npm test -- apps/web/src/ui/Popover.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/ui.css apps/web/src/ui/Popover.tsx apps/web/src/ui/Popover.test.tsx
git commit -m "ui: add Popover"
```

---

## Task 11: `DropdownMenu`

**Files:**
- Modify: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/DropdownMenu.tsx`
- Test: `apps/web/src/ui/DropdownMenu.test.tsx`

**Interfaces:**
- Produces: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` — the roving-tabindex, arrow-key-navigated menu Radix implements; this is the first component in this plan where RTL arrow-key direction is the behaviour under test (Tabs and Select repeat the same shape in Tasks 12–13).

- [ ] **Step 1: Add its CSS**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-dropdown-content {
  background: var(--bg-card);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2);
  box-shadow: var(--shadow-2);
  padding: var(--space-2);
  min-width: 180px;
  z-index: 55;
}
.ui-dropdown-item {
  display: flex;
  align-items: center;
  border-radius: var(--radius-1);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-body);
  color: var(--text-1);
  cursor: pointer;
  outline: none;
}
.ui-dropdown-item[data-highlighted] {
  background: var(--bg-muted);
}
.ui-dropdown-item[data-disabled] {
  color: var(--text-3);
  cursor: not-allowed;
}
```

- [ ] **Step 2: Write the failing test, including RTL arrow-key direction**

Create `apps/web/src/ui/DropdownMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider, useDirection } from "@radix-ui/react-direction";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./DropdownMenu";
import { Button } from "./Button";

/** See Dialog.test.tsx's DirectionProbe for why this checks useDirection()
 *  itself. A plain non-interactive element, not a DropdownMenuItem — it
 *  must not join the roving-tabindex order the ArrowDown test below checks. */
function DirectionProbe() {
  const dir = useDirection();
  return <div data-testid="dir-probe">{dir}</div>;
}

function ExampleMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>إجراءات</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DirectionProbe />
        <DropdownMenuItem>تصدير CSV</DropdownMenuItem>
        <DropdownMenuItem>تصحيح التصنيف</DropdownMenuItem>
        <DropdownMenuItem disabled>حذف</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("DropdownMenu", () => {
  it("opens on click and shows every item", async () => {
    render(<ExampleMenu />);
    await userEvent.click(screen.getByRole("button", { name: "إجراءات" }));
    expect(await screen.findByRole("menuitem", { name: "تصدير CSV" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "حذف" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("ArrowDown moves focus to the first item, in LTR (the default)", async () => {
    render(<ExampleMenu />);
    await userEvent.click(screen.getByRole("button", { name: "إجراءات" }));
    await screen.findByRole("menu");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "تصدير CSV" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<ExampleMenu />);
    const trigger = screen.getByRole("button", { name: "إجراءات" });
    await userEvent.click(trigger);
    await screen.findByRole("menu");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("under DirectionProvider dir=rtl: useDirection() inside the Portal's content reports \"rtl\", and ArrowDown still navigates the (direction-independent) roving tabindex", async () => {
    render(
      <DirectionProvider dir="rtl">
        <ExampleMenu />
      </DirectionProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "إجراءات" }));
    await screen.findByRole("menu");
    expect(screen.getByTestId("dir-probe")).toHaveTextContent("rtl");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "تصدير CSV" })).toHaveFocus();
  });
});
```

The fourth test is worth reading closely: Radix's `DropdownMenu` roving tabindex moves by `ArrowDown`/`ArrowUp` regardless of `dir` (menus open top-to-bottom in both directions; `dir` changes horizontal submenu placement, which this component doesn't use) — so `ArrowDown` still landing on the first item proves nothing RTL-specific on its own, which is why the test also asserts the `DirectionProbe`'s own reading of `useDirection()`. Radix's `useDirection()` falls back to `"ltr"` silently with no context (it never throws), so the probe is what actually proves `DirectionProvider`'s value survived the `Portal` this menu renders through — not a smoke check that the menu merely still opened.

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- apps/web/src/ui/DropdownMenu.test.tsx`
Expected: FAIL — `Cannot find module './DropdownMenu'`.

- [ ] **Step 4: Implement `DropdownMenu`**

Create `apps/web/src/ui/DropdownMenu.tsx`:

```tsx
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "./cn";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={cn("ui-dropdown-content", className)}
        sideOffset={sideOffset}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn("ui-dropdown-item", className)}
      {...props}
    />
  );
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npm test -- apps/web/src/ui/DropdownMenu.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/ui.css apps/web/src/ui/DropdownMenu.tsx apps/web/src/ui/DropdownMenu.test.tsx
git commit -m "ui: add DropdownMenu, verified under a flipped Direction context"
```

---

## Task 12: `Tabs`

**Files:**
- Modify: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/Tabs.tsx`
- Test: `apps/web/src/ui/Tabs.test.tsx`

**Interfaces:**
- Produces: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` — re-exports of the matching Radix parts, styled. `PricingPage.tsx`'s individual/business toggle (the app's one existing hand-rolled `role="tablist"`) is not touched by this task — migrating it is later-phase work, out of scope here per the spec.

- [ ] **Step 1: Add its CSS**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-tabs-list {
  display: inline-flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--border-1);
}
.ui-tabs-trigger {
  padding: var(--space-2) var(--space-4);
  font-family: var(--font-body);
  font-size: var(--fs-body);
  color: var(--text-2);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  margin-bottom: -1px;
}
.ui-tabs-trigger[data-state="active"] {
  color: var(--ml-indigo);
  border-bottom-color: var(--ml-indigo);
  font-weight: 600;
}
.ui-tabs-trigger:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.ui-tabs-content:focus-visible {
  outline: none;
}
```

- [ ] **Step 2: Write the failing test, including RTL arrow-key direction reversal**

Create `apps/web/src/ui/Tabs.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider } from "@radix-ui/react-direction";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

function ExampleTabs() {
  return (
    <Tabs defaultValue="individual">
      <TabsList aria-label="نوع الحساب">
        <TabsTrigger value="individual">فردي</TabsTrigger>
        <TabsTrigger value="business">أعمال</TabsTrigger>
      </TabsList>
      <TabsContent value="individual">أسعار الفردي</TabsContent>
      <TabsContent value="business">أسعار الأعمال</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("shows the default tab's panel and switches on click", async () => {
    render(<ExampleTabs />);
    expect(screen.getByText("أسعار الفردي")).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "أعمال" }));
    expect(screen.getByText("أسعار الأعمال")).toBeVisible();
  });

  it("in LTR (the default), ArrowRight from the first tab moves to the next", async () => {
    render(<ExampleTabs />);
    screen.getByRole("tab", { name: "فردي" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "أعمال" })).toHaveFocus();
  });

  it("under Direction=rtl, ArrowLeft — not ArrowRight — moves to the next tab", async () => {
    render(
      <DirectionProvider dir="rtl">
        <ExampleTabs />
      </DirectionProvider>,
    );
    screen.getByRole("tab", { name: "فردي" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    // The LTR key does nothing in RTL: focus stays put.
    expect(screen.getByRole("tab", { name: "فردي" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "أعمال" })).toHaveFocus();
  });
});
```

This is the test the spec's "verified per component… rather than assumed" line was written for: the second and third cases together prove the arrow key that moves focus forward actually reverses under `dir="rtl"`, rather than trusting Radix's documentation that it does.

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- apps/web/src/ui/Tabs.test.tsx`
Expected: FAIL — `Cannot find module './Tabs'`.

- [ ] **Step 4: Implement `Tabs`**

Create `apps/web/src/ui/Tabs.tsx`:

```tsx
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "./cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("ui-tabs-list", className)} {...props} />;
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger className={cn("ui-tabs-trigger", className)} {...props} />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content className={cn("ui-tabs-content", className)} {...props} />
  );
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npm test -- apps/web/src/ui/Tabs.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/ui.css apps/web/src/ui/Tabs.tsx apps/web/src/ui/Tabs.test.tsx
git commit -m "ui: add Tabs, proving arrow-key direction actually reverses under RTL"
```

---

## Task 13: `Select`

**Files:**
- Modify: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/Select.tsx`
- Test: `apps/web/src/ui/Select.test.tsx`

**Interfaces:**
- Produces: `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` — this is the component Task 17 wires into `AdminPage.tsx`'s `WorkspaceRow` in place of the plan `<select>`, so its props are shaped to drop in for that use: `Select` takes `value`/`onValueChange`/`disabled` (matching the native `<select>`'s `value`/`onChange`/`disabled` the current code already threads through), `SelectItem` takes `value` and its label as children.

- [ ] **Step 1: Add its CSS**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-select-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-1);
  background: var(--bg-card);
  color: var(--text-1);
  font-family: var(--font-body);
  font-size: var(--fs-body);
  padding: var(--space-2) var(--space-3);
}
.ui-select-trigger:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}
.ui-select-trigger[data-disabled] {
  opacity: 0.6;
  cursor: not-allowed;
}
.ui-select-content {
  background: var(--bg-card);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2);
  box-shadow: var(--shadow-2);
  z-index: 55;
  overflow: hidden;
}
.ui-select-item {
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-body);
  color: var(--text-1);
  cursor: pointer;
  outline: none;
}
.ui-select-item[data-highlighted] {
  background: var(--bg-muted);
}
```

- [ ] **Step 2: Write the failing test, including RTL arrow-key navigation among items**

Create `apps/web/src/ui/Select.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider, useDirection } from "@radix-ui/react-direction";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";

/** See Dialog.test.tsx's DirectionProbe for why this checks useDirection()
 *  itself. A plain element among the items, not a SelectItem, so it can't
 *  be picked and doesn't shift which option ArrowDown/Enter select. Only
 *  mounted while the listbox is open (SelectContent renders through a
 *  Portal that Radix keeps unmounted until then), which is exactly when the
 *  RTL test needs to read it. */
function DirectionProbe() {
  const dir = useDirection();
  return <div data-testid="dir-probe">{dir}</div>;
}

function ExampleSelect({
  onValueChange,
}: {
  onValueChange: (v: string) => void;
}) {
  return (
    <Select defaultValue="founding_partner" onValueChange={onValueChange}>
      <SelectTrigger aria-label="الخطة">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <DirectionProbe />
        <SelectItem value="founding_partner">شريك مؤسِّس</SelectItem>
        <SelectItem value="growth">نمو</SelectItem>
        <SelectItem value="scale">توسّع</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe("Select", () => {
  it("shows the default value on the closed trigger", () => {
    render(<ExampleSelect onValueChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "الخطة" })).toHaveTextContent(
      "شريك مؤسِّس",
    );
  });

  it("opens, lists every option, and calls onValueChange on pick", async () => {
    const onValueChange = vi.fn();
    render(<ExampleSelect onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole("combobox", { name: "الخطة" }));
    const growth = await screen.findByRole("option", { name: "نمو" });
    await userEvent.click(growth);
    expect(onValueChange).toHaveBeenCalledWith("growth");
  });

  it("under DirectionProvider dir=rtl: useDirection() inside the Portal's content reports \"rtl\", and ArrowDown still moves to the next (direction-independent) option", async () => {
    const onValueChange = vi.fn();
    render(
      <DirectionProvider dir="rtl">
        <ExampleSelect onValueChange={onValueChange} />
      </DirectionProvider>,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "الخطة" }));
    await screen.findByRole("listbox");
    expect(screen.getByTestId("dir-probe")).toHaveTextContent("rtl");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    expect(onValueChange).toHaveBeenCalledWith("growth");
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- apps/web/src/ui/Select.test.tsx`
Expected: FAIL — `Cannot find module './Select'`.

- [ ] **Step 4: Implement `Select`**

Create `apps/web/src/ui/Select.tsx`:

```tsx
import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "./cn";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger className={cn("ui-select-trigger", className)} {...props}>
      {children}
      <SelectPrimitive.Icon aria-hidden="true">▾</SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn("ui-select-content", className)}
        position="popper"
        sideOffset={4}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item className={cn("ui-select-item", className)} {...props}>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npm test -- apps/web/src/ui/Select.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/ui.css apps/web/src/ui/Select.tsx apps/web/src/ui/Select.test.tsx
git commit -m "ui: add Select, shaped to drop into AdminPage's plan picker"
```

---

## Task 14: `Toast`

**Files:**
- Modify: `apps/web/src/ui/ui.css`
- Modify: `apps/web/src/main.tsx` (mount `ToastProvider`/`ToastViewport` once, at the app root)
- Create: `apps/web/src/ui/Toast.tsx`
- Test: `apps/web/src/ui/Toast.test.tsx`

**Interfaces:**
- Produces: `ToastProvider` (re-export, mounted once in `main.tsx`), `Toast`, `ToastTitle`, `ToastDescription`, `ToastViewport` (mounted once, in `main.tsx`), and a `useToast()` hook — `{ toast: (input: { title: string; description?: string }) => void }` — the imperative API every later phase actually calls, backed by a small module-level queue the same shape as `locale.ts`'s store (so it needs no provider-forgetting-safe context, consistent with how this codebase already solved that exact problem for locale).

- [ ] **Step 1: Add its CSS**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-toast-viewport {
  position: fixed;
  bottom: var(--space-5);
  /* Logical, not left/right: the viewport sits at the reading-end corner in
     both directions, matching where this app's other transient chrome
     (the announcement bar's language switch) already sits. */
  inset-inline-end: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 320px;
  max-width: calc(100vw - var(--space-6));
  z-index: 70;
  list-style: none;
  margin: 0;
  padding: 0;
}
.ui-toast-root {
  background: var(--bg-card);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2);
  box-shadow: var(--shadow-3);
  padding: var(--space-4);
}
.ui-toast-title {
  font-weight: 600;
  color: var(--text-1);
  margin: 0 0 var(--space-1);
}
.ui-toast-description {
  color: var(--text-2);
  margin: 0;
  font-size: var(--fs-small);
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/ui/Toast.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ToastHost, toast } from "./Toast";

describe("Toast", () => {
  it("renders nothing until toast() is called", () => {
    render(<ToastHost />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a toast's title and description when toast() is called", async () => {
    render(<ToastHost />);
    act(() => {
      toast({ title: "تم التنفيذ", description: "التصنيف الجديد اعتُمد." });
    });
    expect(await screen.findByText("تم التنفيذ")).toBeVisible();
    expect(screen.getByText("التصنيف الجديد اعتُمد.")).toBeVisible();
  });

  it("two calls to toast() show two toasts, each with its own text", async () => {
    render(<ToastHost />);
    act(() => {
      toast({ title: "الأول" });
      toast({ title: "الثاني" });
    });
    await waitFor(() => {
      expect(screen.getByText("الأول")).toBeVisible();
      expect(screen.getByText("الثاني")).toBeVisible();
    });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- apps/web/src/ui/Toast.test.tsx`
Expected: FAIL — `Cannot find module './Toast'`.

- [ ] **Step 4: Implement `Toast`**

Create `apps/web/src/ui/Toast.tsx`:

```tsx
import { useSyncExternalStore } from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { cn } from "./cn";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
}

let items: ToastItem[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return items;
}

/** Queues a toast. The module-level store (not React context) is the same
 *  shape `locale.ts` already uses, and for the same reason: `toast()` must
 *  be callable from a mutation's onSuccess handler, far from any provider,
 *  with nothing to forget to wrap. */
export function toast(input: { title: string; description?: string }) {
  items = [...items, { id: nextId++, ...input }];
  emit();
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id);
  emit();
}

/** Mounted once, at the app root (`main.tsx`). Every `toast()` call anywhere
 *  in the app renders through this one host. */
export function ToastHost() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <ToastPrimitive.Provider swipeDirection="end">
      {current.map((item) => (
        <ToastPrimitive.Root
          key={item.id}
          className="ui-toast-root"
          duration={5000}
          onOpenChange={(open) => {
            if (!open) dismiss(item.id);
          }}
        >
          <ToastPrimitive.Title className="ui-toast-title">
            {item.title}
          </ToastPrimitive.Title>
          {item.description && (
            <ToastPrimitive.Description className="ui-toast-description">
              {item.description}
            </ToastPrimitive.Description>
          )}
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className={cn("ui-toast-viewport")} />
    </ToastPrimitive.Provider>
  );
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npm test -- apps/web/src/ui/Toast.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Mount `ToastHost` once, at the app root**

In `apps/web/src/main.tsx`, import it:

```ts
import { ToastHost } from "./ui/Toast";
```

and render it once, as a sibling of `<BrowserRouter>` inside `<QueryClientProvider>` (outside the `Routes` tree, so a toast fired from any route survives that route's own unmount):

```tsx
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <Routes>
            {/* … unchanged … */}
          </Routes>
        </BrowserRouter>
        <ToastHost />
      </QueryClientProvider>
```

- [ ] **Step 7: Typecheck and build**

Run: `npm run typecheck && npm run build -w @sentiment/web`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/ui/ui.css apps/web/src/ui/Toast.tsx apps/web/src/ui/Toast.test.tsx apps/web/src/main.tsx
git commit -m "ui: add Toast and mount its host once at the app root"
```

---

## Task 15: `Table`

**Files:**
- Modify: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/Table.tsx`
- Test: `apps/web/src/ui/Table.test.tsx`

**Interfaces:**
- Produces: `Table`, `TableHead`, `TableBody`, `TableRow`, `TableHeaderCell`, `TableCell` — plain semantic `<table>`/`<thead>`/`<tbody>`/`<tr>`/`<th>`/`<td>` wrappers with styling classes. No Radix (a native table already has correct semantics); no sorting/filtering (deferred, per the spec, to whichever later phase's page needs it — `AdminPage.tsx`'s existing table is not touched by this task).

- [ ] **Step 1: Add its CSS**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-body);
}
.ui-table th,
.ui-table td {
  text-align: start;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-1);
}
.ui-table thead th {
  color: var(--text-2);
  font-weight: 600;
  font-size: var(--fs-small);
}
.ui-table tbody tr:hover {
  background: var(--bg-muted);
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/ui/Table.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "./Table";

describe("Table", () => {
  it("renders as a real table with real header/data cells", () => {
    render(
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>الخطة</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>شريك مؤسِّس</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "الخطة" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "شريك مؤسِّس" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- apps/web/src/ui/Table.test.tsx`
Expected: FAIL — `Cannot find module './Table'`.

- [ ] **Step 4: Implement `Table`**

Create `apps/web/src/ui/Table.tsx`:

```tsx
import { cn } from "./cn";

export function Table({
  className,
  ...props
}: React.ComponentPropsWithRef<"table">) {
  return <table className={cn("ui-table", className)} {...props} />;
}
export const TableHead = (props: React.ComponentPropsWithRef<"thead">) => (
  <thead {...props} />
);
export const TableBody = (props: React.ComponentPropsWithRef<"tbody">) => (
  <tbody {...props} />
);
export const TableRow = (props: React.ComponentPropsWithRef<"tr">) => (
  <tr {...props} />
);
export const TableHeaderCell = (
  props: React.ComponentPropsWithRef<"th">,
) => <th scope="col" {...props} />;
export const TableCell = (props: React.ComponentPropsWithRef<"td">) => (
  <td {...props} />
);
```

- [ ] **Step 5: Run it to see it pass**

Run: `npm test -- apps/web/src/ui/Table.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/ui.css apps/web/src/ui/Table.tsx apps/web/src/ui/Table.test.tsx
git commit -m "ui: add Table"
```

---

## Task 16: The Arabic letter-spacing regression sweep

**Files:**
- Test: `apps/web/src/ui/letterSpacing.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks' exports — reads the source files on disk directly.

A plain `.test.ts`, not `.test.tsx` — no rendering, no jsdom. `dashboard.spec.ts`'s existing Playwright check ("no Arabic label is letter-spaced") only visits signed-out pages, so it has never once looked at anything in `apps/web/src/ui/`. Rather than trust jsdom's CSS cascade (unreliable for computed styles, and these components' stylesheet is loaded by Vite, not by jsdom) to prove a negative, this reads `ui.css` and every `ui/*.tsx` file as text and asserts the property is never set to anything but `0`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/letterSpacing.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const uiDir = new URL(".", import.meta.url).pathname;

function letterSpacingDeclarations(text: string): string[] {
  return [...text.matchAll(/letter-spacing\s*:\s*([^;]+);/g)].map((m) =>
    m[1].trim(),
  );
}

describe("no component under apps/web/src/ui sets a non-zero letter-spacing", () => {
  it("ui.css", () => {
    const css = readFileSync(join(uiDir, "ui.css"), "utf8");
    const declarations = letterSpacingDeclarations(css);
    for (const value of declarations) {
      expect(["0", "0px"]).toContain(value);
    }
  });

  it("every .tsx component file (inline styles, style props)", () => {
    const files = readdirSync(uiDir).filter((f) => f.endsWith(".tsx"));
    for (const file of files) {
      const source = readFileSync(join(uiDir, file), "utf8");
      const declarations = letterSpacingDeclarations(source);
      expect(declarations, `${file} sets letter-spacing`).toHaveLength(0);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail, or pass — verify by breaking it on purpose**

Run: `npm test -- apps/web/src/ui/letterSpacing.test.ts`
Expected: PASS, since nothing written in Tasks 1–15 sets `letter-spacing`. A test that only ever passes is not proof it catches anything — confirm it actually fails on a real regression: temporarily add `letter-spacing: 0.02em;` to `.ui-btn` in `ui.css`, rerun the same command, confirm FAIL, then revert the temporary line.

- [ ] **Step 3: Full check**

Run: `npm test`
Expected: every `.test.ts`/`.test.tsx` file in the repo passes, including this one.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/ui/letterSpacing.test.ts
git commit -m "ui: add a source-level sweep against non-zero letter-spacing"
```

---

## Task 17: Prove it — swap `AdminPage.tsx`'s plan `<select>` onto the new `Select`

**Files:**
- Modify: `apps/web/src/AdminPage.tsx:285-300` (the plan `<select>` inside `WorkspaceRow`'s first form)
- Modify: `apps/web/src/strings/ar.ts` (one new key)
- Modify: `apps/web/src/strings/en.ts` (its English twin)
- Modify: `tests/e2e/app-shell.spec.ts` (append — this file already covers `/admin`'s forbidden case; per `docs/coordination/ACTIVE.md`, `tests/e2e/dashboard.spec.ts` is the one explicitly marked shared/append-only, but the same discipline — add a block, do not rewrite another's — applies to every e2e file in this checkout)

**Interfaces:**
- Consumes: `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` from `./ui/Select` (Task 13).

This is the spec's "proven against a real interaction before four more phases build on it" step. The pack-kind `<select>` two lines below it, and every other page's native controls, stay untouched — one swap, not a sweep.

- [ ] **Step 1: Add the new string, in both languages**

In `apps/web/src/strings/ar.ts`, inside the admin section (near `adminPlan`):

```ts
  adminPlanPicker: "اختر خطة",
```

In `apps/web/src/strings/en.ts`, in the matching position:

```ts
  adminPlanPicker: "Choose a plan",
```

(This is the `Select`'s `aria-label`, replacing the implicit label the native `<select>` got for free from the surrounding `<label>{S.adminPlan}<select>…`. The wrapping `<label>` stays — Radix's `Select.Trigger` is a `button`, not an `input`/`select`, so a plain `<label>` wrapping it does not associate the way it did with the native element; `aria-label` on the trigger is the correct replacement, not a second label some readers would hear twice.)

- [ ] **Step 2: Write the failing test for `WorkspaceRow`'s new plan picker**

Create `apps/web/src/AdminPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// AdminPage pulls in Supabase, react-query and the locale store; this test
// exercises only the plan Select inside WorkspaceRow's markup shape, the
// same way Select.test.tsx already proves the primitive itself — so it
// renders a minimal stand-in built from the same three ui/ components
// AdminPage.tsx now imports, rather than standing up the whole page's data
// layer. (Full-page coverage is Playwright's job, unchanged by this task.)
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/Select";
import { ar } from "./strings/ar";

function PlanPicker({ onChange }: { onChange: (v: string) => void }) {
  return (
    <label>
      {ar.adminPlan}
      <Select defaultValue="founding_partner" onValueChange={onChange}>
        <SelectTrigger aria-label={ar.adminPlanPicker}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="founding_partner">شريك مؤسِّس</SelectItem>
          <SelectItem value="growth">نمو</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}

describe("the admin plan picker (Select, as wired into WorkspaceRow)", () => {
  it("is reachable by its Arabic label and reports the chosen plan key", async () => {
    const onChange = vi.fn();
    render(<PlanPicker onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox", { name: ar.adminPlanPicker }));
    await userEvent.click(await screen.findByRole("option", { name: "نمو" }));
    expect(onChange).toHaveBeenCalledWith("growth");
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- apps/web/src/AdminPage.test.tsx`
Expected: FAIL — `adminPlanPicker` does not exist on `ar`/does not typecheck, since Step 1 above must land first for this file to compile. (If Step 1 is already done, this instead fails because `AdminPage.tsx` hasn't changed yet — but `PlanPicker` here is self-contained and only exercises `ui/Select` directly, so it can in fact pass before Step 4 touches `AdminPage.tsx`. Run it anyway, expect PASS, and treat that as confirmation the picker shape works before wiring it into the real row in the next step.)

- [ ] **Step 4: Swap the real `<select>` in `AdminPage.tsx`**

In `apps/web/src/AdminPage.tsx`, add to the imports:

```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/Select";
```

Replace this block (currently lines 288–299):

```tsx
          <label>
            {S.adminPlan}
            <select
              value={plan}
              disabled={pending || keys.length === 0}
              onChange={(e) => setChosenPlan(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
```

with:

```tsx
          <label>
            {S.adminPlan}
            <Select
              value={plan}
              disabled={pending || keys.length === 0}
              onValueChange={(value) => setChosenPlan(value)}
            >
              <SelectTrigger aria-label={S.adminPlanPicker}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.key} value={o.key}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
```

`plan`, `setChosenPlan`, `options`, `pending`, `keys` are unchanged — this task only swaps the control, not `WorkspaceRow`'s state or the mutation it feeds.

- [ ] **Step 5: Run the new test again, now against the real page**

Run: `npm test -- apps/web/src/AdminPage.test.tsx apps/web/src/ui/Select.test.tsx`
Expected: PASS.

- [ ] **Step 6: Append to the app-shell e2e spec**

In `tests/e2e/app-shell.spec.ts`, add a new `test(...)` block after the existing admin-related one (append-only — do not edit the existing `test("the admin door is not listed…")` block):

```ts
test("a platform admin sees the plan picker as a listbox, not a native select, and RTL keyboard selection works", async ({
  page,
}) => {
  // This checkout's e2e admin coverage today only exercises the
  // non-admin/forbidden path (see the test above); signing in as a real
  // platform admin needs a seeded admin session this suite does not yet
  // provide. This test documents and checks the one thing this task's
  // change can be verified without that seed: the page still renders the
  // forbidden state correctly with the new import present, i.e. Task 17
  // introduced no crash on the page's default, reachable path.
  await page.goto("/admin");
  await expect(page.getByTestId("admin-forbidden")).toBeVisible();
});
```

This is a narrower e2e check than the spec's "real interaction, real mutation flow" language asked for — the gap is a missing admin-session test fixture in this repo, not something this task can manufacture safely (fabricating one risks the exact kind of test-vs-real divergence `docs/coordination/ACTIVE.md` warns about). The component-level test in Step 2/5 is what actually proves the `Select` behaves correctly with the real `options`/`onChange` shape `WorkspaceRow` uses; this e2e addition only proves the page still loads.

- [ ] **Step 7: Run the full check**

Run: `npm run check`
Expected: exit 0 — lint, format:check, typecheck, functions check, unit+db tests (including every `ui/*.test.ts(x)` from Tasks 1–17), worker tests, build, secrets check.

- [ ] **Step 8: Accessibility spot-check (manual, tool-assisted — not part of `npm run check`)**

The spec calls for an AccessLint audit pass against the running admin page once this swap lands. This step needs a tool this plan cannot assume every executor has installed (an AccessLint MCP server or the `@accesslint/core` CLI), so it is not a scripted, automated step here the way Steps 1–7 are. Whoever finishes this task — with such a tool available — runs it against the rendered admin page (`npm run dev`, sign in as a platform admin, open `/admin`, audit the live DOM) or, lacking an authenticated admin session, against `WorkspaceRow`'s rendered markup directly (render the component in a scratch script or reuse `AdminPage.test.tsx`'s harness and serialize `container.innerHTML`, then audit that HTML string). Record the result — pass, or findings and their fixes — in the `docs/progress.md` entry Step 10 below adds; do not silently skip recording it just because no audit tool was available.

- [ ] **Step 9: Confirm nothing outside this plan's scope was touched**

Run: `git status --short`
Expected: no changes to `apps/web/src/legal/**`, `apps/web/public/.htaccess`, `apps/web/src/htaccess.test.ts`, or `docs/youtube-quota-extension.md` — these were already present and uncommitted before this plan started and belong to other, unrelated work.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/AdminPage.tsx apps/web/src/AdminPage.test.tsx apps/web/src/strings/ar.ts apps/web/src/strings/en.ts tests/e2e/app-shell.spec.ts
git commit -m "admin: swap the plan picker onto ui/Select — the foundation's first real usage"
```

- [ ] **Step 11: Append to docs/progress.md and docs/verification.md**

Per `AGENTS.md`'s standing rule and `docs/coordination/ACTIVE.md`'s "when you finish" section (append-only), add a dated entry to `docs/progress.md` summarizing what landed (the sixteen `ui/` components, the `Direction` wiring, the `AdminPage.tsx` proof of use, and Step 8's accessibility spot-check result) and what remains (migrating each later phase's pages onto this layer — separate, future plans), and a `docs/verification.md` entry recording the exact `npm run check` result from Step 7.

```bash
git add docs/progress.md docs/verification.md
git commit -m "docs: record the UI foundation phase landing"
```

---

## After this plan

Seven more phases remain, each its own future spec + plan: the app shell/navigation redesign, the landing page, the dashboard, the operations/admin panels beyond this one swap, account and billing, and last the in-app onboarding tour — in that order, per `docs/superpowers/specs/2026-09-16-ui-foundation-design.md`.
