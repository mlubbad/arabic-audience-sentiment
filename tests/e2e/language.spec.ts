import { test, expect } from "@playwright/test";

/** The interface language: Arabic by default, English on request, remembered
 *  across a reload, and carried on the document where CSS and the browser's
 *  bidi algorithm read it. The Arabic default is what keeps every other test
 *  in this suite valid — none of them set a language, and all of them locate
 *  controls by Arabic names. */
test("the shell opens in Arabic, switches to English on request, and remembers it", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("lang", "ar");
  await expect(html).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".app-shell")).toHaveAttribute("dir", "rtl");
  const rail = page.getByRole("navigation", { name: "التنقل الرئيسي" });
  await expect(rail.getByRole("link", { name: "نظرة عامة" })).toBeVisible();

  // The switch names the other language, in that language.
  const toEnglish = page.getByTestId("language-switch");
  await expect(toEnglish).toHaveText("English");
  await expect(toEnglish).toHaveAttribute("lang", "en");
  await toEnglish.click();

  await expect(html).toHaveAttribute("lang", "en");
  await expect(html).toHaveAttribute("dir", "ltr");
  await expect(page.locator(".app-shell")).toHaveAttribute("dir", "ltr");
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", {
        name: "Overview",
      }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/Overview — Audience Sentiment/);
  await expect(page.getByTestId("language-switch")).toHaveText("العربية");

  // Remembered: a reload comes back in English without asking.
  await page.reload();
  await expect(html).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("language-switch")).toHaveText("العربية");

  // And the way back is the same button.
  await page.getByTestId("language-switch").click();
  await expect(html).toHaveAttribute("lang", "ar");
  await expect(html).toHaveAttribute("dir", "rtl");
  await expect(rail.getByRole("link", { name: "نظرة عامة" })).toBeVisible();
});

test("the landing page stays Arabic whatever the shell was last set to", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.getByTestId("language-switch").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // The shell owns the document's language only while it is mounted.
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("in English, tracking returns to the Latin labels the Arabic rules had zeroed", async ({
  page,
}) => {
  // ACTIVE.md: every `letter-spacing: 0` in app.css is load-bearing for
  // Arabic. In English the same labels are Latin and take tracking again —
  // through :lang(en), so the Arabic rules are untouched.
  await page.goto("/dashboard");
  const caption = page.locator(".app-rail-caption");
  expect(
    await caption.evaluate((el) => getComputedStyle(el).letterSpacing),
  ).toBe("normal");
  await page.getByTestId("language-switch").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const spaced = await caption.evaluate(
    (el) => parseFloat(getComputedStyle(el).letterSpacing) > 0,
  );
  expect(spaced).toBe(true);
  const face = await page
    .locator(".app-shell")
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(face.startsWith('"Readex Pro"') || face.startsWith("Readex Pro")).toBe(
    true,
  );
});
