import { test, expect } from "@playwright/test";

test("landing demo filters illustrative comments and connects to the real dashboard", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "وراء كل تعليق",
  );
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const demo = page.locator(".lp-demo-frame");
  await expect(demo).toContainText("٤ تعليقات مؤلّفة");
  await expect(demo.locator(".lp-example-comment")).toHaveCount(4);
  await demo.getByRole("button", { name: "مختلط", exact: true }).click();
  await expect(demo.locator(".lp-example-comment")).toHaveCount(1);
  await expect(demo.getByRole("img")).toHaveAttribute(
    "aria-label",
    /مختلط: ١٠٠٪/,
  );
  await expect(demo).toContainText("المقدمة طويلة");
  await demo.getByRole("button", { name: "الكل", exact: true }).click();
  await expect(demo.locator(".lp-example-comment")).toHaveCount(4);
  await page
    .getByRole("button", { name: "الوكالات والفرق", exact: true })
    .click();
  await expect(page.locator(".lp-audience-panel")).toContainText(
    "لكل عميل جمهوره",
  );
  await page
    .locator("summary")
    .filter({ hasText: "هل يمكنني ربط قناتي الآن؟" })
    .click();
  await expect(page.locator("details[open]")).toContainText(
    "جُمعت تعليقات حقيقية",
  );
  await page
    .getByRole("link", { name: "استكشف اللوحة", exact: false })
    .first()
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("total")).toHaveText("6");
  await page.reload();
  await expect(page.getByTestId("total")).toHaveText("6");
  await page.getByRole("link", { name: "الرئيسية", exact: true }).click();
  await page.getByRole("link", { name: "فتح الحساب", exact: false }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("الحساب");
});

test("mobile landing has working navigation, keyboard access, and no page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.locator(".lp-skip")).toBeFocused();
  const menu = page.getByRole("button", { name: "القائمة الرئيسية" });
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("navigation", { name: "تنقل صفحة الهبوط" })
    .getByRole("link", { name: "شاهد التجربة" })
    .click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
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
  await expect(page.locator(".lp-hero-art img")).toHaveJSProperty(
    "naturalWidth",
    1536,
  );
});
