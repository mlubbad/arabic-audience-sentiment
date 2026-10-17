import { test, expect } from "@playwright/test";

test("landing demo filters illustrative comments and connects to the real dashboard", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "افهم مشاعر جمهورك",
  );
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const demo = page.locator("#experience [data-testid='product-window']");
  await expect(demo).toContainText("4 تعليقات مؤلّفة");
  await expect(demo.locator(".lp-example-comment")).toHaveCount(4);
  await demo.getByRole("tab", { name: "مختلط", exact: true }).click();
  await expect(demo.locator(".lp-example-comment")).toHaveCount(1);
  await expect(demo.getByRole("img")).toHaveAttribute(
    "aria-label",
    /مختلط: ١٠٠٪/,
  );
  await expect(demo).toContainText("المقدمة طويلة");
  await demo.getByRole("tab", { name: "الكل", exact: true }).click();
  await expect(demo.locator(".lp-example-comment")).toHaveCount(4);
  await page.getByRole("tab", { name: "الوكالات والفرق", exact: true }).click();
  await expect(
    page.locator(".lp-audience-panel[data-state='active']"),
  ).toContainText("لكل عميل جمهوره");
  await page.getByRole("button", { name: "هل يمكنني ربط قناتي الآن؟" }).click();
  await expect(
    page.getByRole("region", { name: "هل يمكنني ربط قناتي الآن؟" }),
  ).toContainText("جُمعت تعليقات حقيقية");
  await page
    .getByRole("link", { name: "استكشف اللوحة", exact: false })
    .first()
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("total")).toHaveText("6");
  await page.reload();
  await expect(page.getByTestId("total")).toHaveText("6");
  // Back to the landing by the brand lockup, which is where that path lives
  // now. The rail lists the product's own parts and no longer carries
  // "الرئيسية" as a peer destination — a marketing page is not a section of
  // the application, and the logo has always been the way back to it.
  await page.getByRole("link", { name: "مشاعر الجمهور — الرئيسية" }).click();
  await page.getByRole("link", { name: "فتح الحساب", exact: false }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("الحساب");
});

test("mobile landing has working navigation, keyboard access, and no page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  // Headless Chromium (CI) loads a page with focus on nothing, so a bare
  // page.keyboard.press("Tab") is swallowed and never reaches the document.
  // Pressing from <body> seats focus inside the page first, so Tab lands on
  // the first tabbable element — the skip link. (Local browsers focus the
  // document on load, which is why this only reproduces in CI.)
  await page.locator("body").press("Tab");
  await expect(page.locator(".lp-skip")).toBeFocused();
  // Radix's Dialog sets `aria-hidden` on the header while the sheet is open
  // (correct isolation for assistive tech), which takes the trigger out of
  // Playwright's role-based accessibility tree — a plain attribute selector
  // reads the same DOM node without that filtering.
  const menu = page.locator('button[aria-label="القائمة الرئيسية"]');
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "شاهد التجربة" })
    .click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  // The scroll happens from PublicShell's own onCloseAutoFocus, right as the
  // sheet finishes closing — toBeInViewport retries until Playwright's
  // default timeout, no fixed wait needed.
  await expect(page.locator("#experience")).toBeInViewport();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.locator(".lp-hero [data-testid='intro-player']"),
  ).toBeVisible();
  expect(await page.locator(".lp-hero img").count()).toBe(0);
});

/**
 * The landing page kept a second design system, and the second one failed.
 *
 * This is the surface a visitor meets first, and it was written before the
 * dashboard's palette was measured — so it carried its own purple, its own
 * ink, six spellings of "secondary grey", and eight type sizes whose smallest
 * was 10px. Nothing failed, because every test that guarded this page read
 * `Landing.tsx` and the system was in `landing.css`.
 *
 * These three read what the browser actually computed, which is the only place
 * a stylesheet's inheritance can be checked.
 */
test("every word a visitor can read clears its contrast floor", async ({
  page,
}) => {
  await page.goto("/");
  // `.lp-donut` was the old demo's chart; the redesign's ProductWindow has no
  // element by that name, so this now waits on the equivalent readiness
  // marker — the rendered demo itself — before scanning contrast.
  await page.waitForSelector("[data-testid='product-window']");
  const failing = await page.evaluate(() => {
    const lum = (r: number, g: number, b: number) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    // A `color-mix()` result (background or text) serializes on this build
    // as `color(srgb r g b [/ a])` with 0-1 components, not legacy
    // `rgb(0-255)` — read that form too, scaled up, rather than reading past
    // it: the four sentiment badge tones are `color-mix()` on both
    // properties (ui.css), a live expression by design.
    const parse = (c: string) => {
      const nums = (c.match(/[\d.]+/g) ?? []).map(Number);
      if (c.startsWith("color(srgb")) {
        const [r, g, b, a] = nums;
        const rgb = [r, g, b].map((v) => Math.round(v * 255));
        return a === undefined ? rgb : [...rgb, a];
      }
      return nums;
    };
    // The ground a translucent layer sits on, not the layer itself.
    const groundOf = (el: Element) => {
      let e: Element | null = el;
      while (e) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c.length && (c[3] === undefined || c[3] > 0.9)) return c;
        e = e.parentElement;
      }
      return [255, 255, 255];
    };
    const out: { where: string; ratio: number; need: number }[] = [];
    for (const el of document.querySelectorAll(".landing *")) {
      // Decoration is exempt, and says so in the markup rather than here: an
      // element hidden from the accessibility tree carries no words.
      if (el.closest("[aria-hidden='true']")) continue;
      const cs = getComputedStyle(el);
      if (!(el as HTMLElement).offsetParent && cs.position !== "fixed")
        continue;
      if (parseFloat(cs.opacity) < 0.5) continue;
      const hasText = [...el.childNodes].some(
        (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 2,
      );
      if (!hasText) continue;
      const fg = parse(cs.color);
      const bg = groundOf(el);
      const a = lum(fg[0], fg[1], fg[2]);
      const b = lum(bg[0], bg[1], bg[2]);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight) || 400;
      const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
      if (ratio < need)
        out.push({
          where: `${el.className || el.tagName} ${size}px ${cs.color}`,
          ratio: Math.round(ratio * 100) / 100,
          need,
        });
    }
    return out;
  });
  // Six inks failed when this was written — 3.09, 3.47, 3.57, 3.82, 4.03 and
  // 4.25 — and they were six spellings of the same intent, all now --text-3.
  expect(failing).toEqual([]);
});

test("no Arabic on the landing is set below the readable floor", async ({
  page,
}) => {
  await page.goto("/");
  const tooSmall = await page.evaluate(() => {
    const out: { where: string; size: number }[] = [];
    for (const el of document.querySelectorAll(".landing *")) {
      if (el.closest("[aria-hidden='true']")) continue;
      const hasArabic = [...el.childNodes].some(
        (n) => n.nodeType === 3 && /[؀-ۿ]/.test(n.textContent ?? ""),
      );
      if (!hasArabic) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      // 13px. Arabic letters join, and what separates one from the next is
      // small beside the body of the glyph; this page sets them in a display
      // face delivered as a .ttf. Ten sizes on this page were below this.
      if (size < 13) out.push({ where: `${el.className || el.tagName}`, size });
    }
    return out;
  });
  expect(tooSmall).toEqual([]);
});

test("the landing teaches the colour language the dashboard speaks", async ({
  page,
}) => {
  await page.goto("/");
  const token = (name: string) =>
    page.evaluate(
      (n) =>
        getComputedStyle(document.documentElement)
          .getPropertyValue(n)
          .trim()
          .toLowerCase(),
      name,
    );
  const asRgb = async (hex: string) =>
    page.evaluate((h) => {
      const d = document.createElement("div");
      d.style.color = h;
      document.body.append(d);
      const c = getComputedStyle(d).color;
      d.remove();
      return c;
    }, hex);
  // The donut was the first thing a visitor learned about this product's
  // colours, and it taught purple-is-positive against the dashboard's teal.
  for (const [cls, name] of [
    ["positive", "--sentiment-positive"],
    ["negative", "--sentiment-negative"],
    ["mixed", "--sentiment-mixed"],
  ] as const) {
    await expect(page.locator(`.lp-dot.${cls}`).first()).toHaveCSS(
      "background-color",
      await asRgb(await token(name)),
    );
  }
  // The neutral dot carries no modifier class — it is the rule's own default,
  // which is where a stale hex hides longest.
  await expect(
    page.locator(".lp-dot:not(.positive):not(.negative):not(.mixed)").first(),
  ).toHaveCSS(
    "background-color",
    await asRgb(await token("--sentiment-neutral")),
  );
});
