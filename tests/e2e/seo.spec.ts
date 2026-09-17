import { test, expect, type Page } from "@playwright/test";

/** What a search engine and a share card read off a public page, in the
 *  browser: the head React 19 hoists, the structured data, and the English
 *  addresses. The prerendered files are checked by scripts/prerender.mjs at
 *  build time; this is the same page as the client renders it, which is
 *  what hydration has to agree with. */

const head = (page: Page) =>
  page.evaluate(() => {
    const one = (sel: string) => document.querySelectorAll(sel).length;
    const ld = document.querySelector('script[type="application/ld+json"]');
    return {
      lang: document.documentElement.lang,
      title: document.title,
      titles: one("title"),
      description: document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
      descriptions: one('meta[name="description"]'),
      robots: document
        .querySelector('meta[name="robots"]')
        ?.getAttribute("content"),
      canonical: document
        .querySelector('link[rel="canonical"]')
        ?.getAttribute("href"),
      alternates: [...document.querySelectorAll('link[rel="alternate"]')].map(
        (l) => `${l.getAttribute("hreflang")} ${l.getAttribute("href")}`,
      ),
      ogTitle: document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content"),
      ogImage: document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute("content"),
      graph: ld
        ? (
            JSON.parse(ld.textContent ?? "{}") as {
              "@graph": { "@type": string; mainEntity?: unknown[] }[];
            }
          )["@graph"]
        : null,
    };
  });

test("the Arabic landing carries its title, description, canonical, alternates and FAQ data", async ({
  page,
}) => {
  await page.goto("/");
  const h = await head(page);
  expect(h.lang).toBe("ar");
  expect(h.title).toBe("تحليل تعليقات يوتيوب بالعربية — مشاعر الجمهور");
  expect(h.titles).toBe(1);
  expect(h.descriptions).toBe(1);
  expect(h.description).toContain("تعليقات يوتيوب");
  // The flag is off in this suite's environment: still noindex.
  expect(h.robots).toBe("noindex, nofollow");
  expect(h.canonical).toMatch(/^https:\/\/[^/]+\/$/);
  expect(h.alternates).toHaveLength(3);
  expect(h.alternates[1]).toMatch(/^en https:\/\/[^/]+\/en$/);
  expect(h.ogTitle).toBe(h.title);
  expect(h.ogImage).toMatch(/\/landing\/og-audience-sentiment\.jpg$/);
  const faq = h.graph?.find((n) => n["@type"] === "FAQPage");
  expect(faq?.mainEntity).toHaveLength(8);
  // The page's own H1 says the phrase, once, in a sentence.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "تعليقات يوتيوب",
  );
  // The hero no longer renders an `<img>` — the redesign's ProductWindow
  // stands in its place, and the sentence that used to be the image's alt
  // is kept, unseen, as the figure's caption (same keyword, still indexed).
  await expect(page.locator(".lp-hero-figure figcaption")).toContainText(
    /تعليقات يوتيوب/,
  );
});

test("/en is the English landing, from its first paint, and links to English pages", async ({
  page,
}) => {
  await page.goto("/en");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("lang", "en");
  await expect(html).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "YouTube comments",
  );
  const h = await head(page);
  expect(h.title).toBe("Arabic YouTube Comment Analysis — Audience Sentiment");
  expect(h.canonical).toMatch(/\/en$/);
  expect(h.alternates[0]).toMatch(/^ar https:\/\/[^/]+\/$/);
  // The switch is a link back to the Arabic address.
  await expect(page.getByTestId("language-switch")).toHaveAttribute(
    "href",
    "/",
  );
  await expect(page.getByTestId("language-switch")).toHaveText("العربية");
  // Every link to a page that exists in two languages goes to the English one.
  const nav = page.getByRole("navigation", { name: "Landing page navigation" });
  await expect(nav.getByRole("link", { name: "Pricing" })).toHaveAttribute(
    "href",
    "/en/pricing",
  );
  const legal = page.getByRole("navigation", { name: "Legal pages" });
  await expect(
    legal.getByRole("link", { name: "Privacy Policy" }),
  ).toHaveAttribute("href", "/en/privacy-policy");
  // And reading it set the preference: the product opens in English.
  await page
    .getByRole("link", { name: "Explore the demo dashboard" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(html).toHaveAttribute("lang", "en");
  // From the product, the brand goes back to the English landing.
  await expect(
    page.getByRole("link", { name: "Audience Sentiment — home" }),
  ).toHaveAttribute("href", "/en");
});

test("the pricing page exists in both languages with offers in its structured data", async ({
  page,
}) => {
  await page.goto("/en/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "YouTube comment analysis pricing",
  );
  await expect(
    page.getByRole("heading", { name: "Creator Plus" }),
  ).toBeVisible();
  const h = await head(page);
  expect(h.lang).toBe("en");
  expect(h.canonical).toMatch(/\/en\/pricing$/);
  const app = h.graph?.find((n) => n["@type"] === "SoftwareApplication") as
    | { offers?: { name: string; price: string }[] }
    | undefined;
  expect(app?.offers?.map((o) => `${o.name} ${o.price}`)).toEqual([
    "Free 0.00",
    "Creator 12.00",
    "Creator Plus 29.00",
    "Agency 99.00",
  ]);
  await page.getByTestId("language-switch").click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "أسعار تحليل تعليقات يوتيوب",
  );
});

test("the legal documents have English addresses and title themselves", async ({
  page,
}) => {
  await page.goto("/en/terms");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle(/Terms of Service — Audience Sentiment/);
  const h = await head(page);
  expect(h.canonical).toMatch(/\/en\/terms$/);
  expect(h.description?.length).toBeGreaterThan(60);
  expect(h.description?.length).toBeLessThanOrEqual(160);
  await page.goto("/privacy-policy");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page).toHaveTitle(/سياسة الخصوصية — مشاعر الجمهور/);
});

test("the product's own pages are never indexed", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toBeVisible();
  expect(await head(page)).toMatchObject({ robots: "noindex, nofollow" });
});
