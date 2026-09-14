import { expect, test } from "@playwright/test";

test("the inner app has a usable mobile navigation and account entry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/account");

  await expect(
    page.getByRole("link", { name: "مشاعر الجمهور — الرئيسية" }),
  ).toBeVisible();
  const menu = page.getByRole("button", { name: "قائمة التطبيق" });
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("navigation", { name: "التنقل الرئيسي" })
    .getByRole("link", { name: "حالة المزامنة" })
    .click();
  await expect(page).toHaveURL(/\/sync$/);
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "حالة الجمع",
  );
  await page.goto("/dashboard");
  const filters = page.getByRole("form", { name: "فلاتر التقرير" });
  await expect(filters).toBeHidden();
  await expect(page.getByRole("heading", { name: "الملخص" })).toBeVisible();
  await page.getByRole("button", { name: "إظهار الفلاتر" }).click();
  await expect(filters).toBeVisible();
  await expect(page.getByLabel("المشاعر", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("the front door is in the header, on every route", async ({ page }) => {
  // Session state is true of every route, so it is shown on every route.
  // Signing out used to live in the body of the account page — leaving meant
  // first navigating to a settings screen — and signing in was reachable only
  // by guessing that "الحساب ومساحات العمل" was also the front door.
  for (const route of ["/dashboard", "/sync", "/account"]) {
    await page.goto(route);
    const header = page.locator(".app-header");
    const enter = header.getByRole("link", { name: "تسجيل الدخول" });
    await expect(enter, route).toBeVisible();
    await expect(enter).toHaveAttribute("href", "/account");
  }

  // And it survives the phone, where the nav collapses behind a menu: leaving
  // must not require opening one first.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(
    page.locator(".app-header").getByRole("link", { name: "تسجيل الدخول" }),
  ).toBeVisible();

  // Exactly one control, not one per screen.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/account");
  await expect(page.getByRole("link", { name: "تسجيل الدخول" })).toHaveCount(1);
});

test("the connection result and unknown route offer working recovery paths", async ({
  page,
}) => {
  await page.goto("/connected?code=declined");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "لم يكتمل الربط",
  );
  await page.getByRole("link", { name: "العودة إلى الحساب" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "لم نجد الصفحة التي تبحث عنها.",
  );
  await page.getByRole("link", { name: "فتح لوحة البيانات" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
