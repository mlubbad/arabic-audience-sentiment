import { test, expect } from "@playwright/test";
test("Arabic fixture shell filters consistent totals and supports an empty state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("total")).toHaveText("6");
  await expect(page.getByText("بيانات اصطناعية للاختبار فقط")).toBeVisible();
  await page
    .getByLabel("البحث في التعليقات والمؤلفين")
    .fill("غير موجود نهائياً");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(page.getByText("لا توجد تعليقات مطابقة")).toBeVisible();
  await page.getByRole("button", { name: "إعادة ضبط الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("6");
  await page.getByLabel("الفيديو").selectOption("video-2");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("2");
});
test("shows actual pending fetch then safe error with working retry", async ({
  page,
}) => {
  // StrictMode mounts the tree twice, so the initial load issues more than one
  // request. Gate on a flag rather than a request index, and hold only the first
  // request so the pending state is observable rather than raced past.
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  let failing = true;
  let held = false;
  await page.route("**/fixtures/dashboard.json", async (route) => {
    if (!failing) return route.continue();
    if (!held) {
      held = true;
      await pending;
    }
    await route.fulfill({ status: 503, body: "unavailable" });
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("جارٍ تحميل");
  release();
  await expect(page.getByRole("alert")).toContainText("تعذر تحميل");
  await expect(page.getByTestId("total")).toHaveCount(0);
  failing = false;
  await page.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(page.getByTestId("total")).toHaveText("6");
});
test("mobile shell fits viewport and exposes honest live-configuration state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("total")).toHaveText("6");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "الحساب ومساحات العمل" }).click();
  await expect(page.getByText("إعداد Supabase غير متوفر")).toBeVisible();
});
