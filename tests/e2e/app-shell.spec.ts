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
