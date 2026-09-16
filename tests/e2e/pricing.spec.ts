import { expect, test } from "@playwright/test";

// Fixture mode, signed out: the page reads the six-row fixture catalogue and
// must be readable without a backend or a session. The words are B1's
// (`strings/ar.ts`): the title is "الأسعار" and the business segment is
// "وكالات ومؤسسات" — the brief's draft names were written before those landed.
test("the pricing page shows two segments and a yearly switch", async ({
  page,
}) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "الأسعار",
  );
  await expect(page.getByRole("heading", { name: "منشئ بلس" })).toBeVisible();
  const business = page.getByRole("tab", { name: "وكالات ومؤسسات" });
  await business.click();
  await expect(business).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "وكالة" })).toBeVisible();
  await expect(page.getByText("الأكثر اختيارًا")).toBeVisible();
  await expect(page.getByText("$99", { exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "سنوي" }).click();
  await expect(page.getByText("$79", { exact: true })).toBeVisible();
  await expect(page.getByText("تُدفع $948 سنويًا")).toBeVisible();
  // media is not self-serve: it asks to be contacted rather than starting a checkout
  await expect(
    page.getByRole("button", { name: "تواصل معنا" }).first(),
  ).toBeVisible();
});

test("the pricing page is linked from the landing and free sends to the account", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "تنقل صفحة الهبوط" })
    .getByRole("link", { name: "الأسعار" })
    .click();
  await expect(page).toHaveURL(/\/pricing$/);
  await page.getByRole("button", { name: "ابدأ مجانًا" }).click();
  await expect(page).toHaveURL(/\/account$/);
});
