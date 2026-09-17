import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The built public pages, served by `vite preview` (the `public-build`
 * project in playwright.config.ts), read the way a visitor gets them before
 * the bundle lands: the prerendered HTML and whatever stylesheet the page
 * links. The dev server never serves that page, and a rule that travelled
 * with a lazy chunk — the pricing and legal pages' own stylesheets, on
 * 2026-09-17 — left them painting as the landing's type and reflowing once
 * the chunk arrived. Every test above this one runs with JavaScript on
 * against the dev server and could not see it.
 *
 * Each address says which page it must be: `vite preview` once answered
 * `/pricing` with the landing (its SPA fallback), and a test that only looked
 * for `.pricing-cards` "where present" passed on the wrong page.
 */

const PAGES: { path: string; kind: "landing" | "pricing" | "legal" }[] = [
  { path: "/", kind: "landing" },
  { path: "/en", kind: "landing" },
  { path: "/pricing", kind: "pricing" },
  { path: "/en/pricing", kind: "pricing" },
  { path: "/privacy-policy", kind: "legal" },
];

/** The legal document's measure, read from its own stylesheet rather than
 *  written here twice. */
const legalMaxWidth = () => {
  const css = readFileSync("apps/web/src/legal.css", "utf8");
  const m = css.match(/\.legal\s*\{[^}]*?max-width:\s*([^;]+);/);
  if (!m) throw new Error("legal.css: no `.legal { max-width }` to read");
  return m[1].trim();
};

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const { path, kind } of PAGES) {
    test(`${path} is styled by the HTML it arrives as`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
      if (kind === "landing")
        await expect(page.locator(".lp-page .lp-hero")).toHaveCount(1);
      if (kind === "pricing") {
        await expect(page.locator(".pricing-cards")).toHaveCSS(
          "display",
          "grid",
        );
        // The pricing page's own title size, not the landing hero's clamp
        // (66px at this viewport) leaking through the shared `.landing`.
        const h1 = await page
          .locator("h1")
          .evaluate((el) => getComputedStyle(el).fontSize);
        expect(h1).not.toBe("66px");
      }
      if (kind === "legal")
        await expect(page.locator(".legal")).toHaveCSS(
          "max-width",
          legalMaxWidth(),
        );
      // Nothing wider than the viewport, in either direction: the document
      // does not scroll sideways, and no visible box reaches past either
      // edge. "Visible": a decorative bleed inside an `overflow: hidden`
      // section (the closing band's orbit) is measured as what its clipping
      // ancestors let through, not as its own box.
      const overflow = await page.evaluate(() => {
        const w = innerWidth;
        const out: string[] = [];
        if (document.documentElement.scrollWidth > w)
          out.push(`document ${document.documentElement.scrollWidth} > ${w}`);
        const clips = (v: string) => v !== "visible";
        for (const el of document.body.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          let left = r.left;
          let right = r.right;
          for (let a = el.parentElement; a; a = a.parentElement) {
            if (!clips(getComputedStyle(a).overflowX)) continue;
            const c = a.getBoundingClientRect();
            left = Math.max(left, c.left);
            right = Math.min(right, c.right);
          }
          if (right > w + 1 || left < -1)
            out.push(
              `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} ${Math.round(left)}..${Math.round(right)}`,
            );
        }
        return out;
      });
      expect(overflow).toEqual([]);
    });
  }
});

test("each language's H1 is set in its own face", async ({ page }) => {
  // The English page takes the Latin face the prerender preloads for it;
  // without `.landing:lang(en)` it set in the Arabic face and swapped later.
  await page.goto("/en");
  const en = await page
    .locator("h1")
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(en.startsWith('"Readex Pro"')).toBe(true);
  await page.goto("/");
  const ar = await page
    .locator("h1")
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(ar.startsWith('"Audience Arabic"')).toBe(true);
});
