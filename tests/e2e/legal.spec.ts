import { expect, test } from "@playwright/test";

// Signed out, no backend: the two documents must open from the landing
// footer and read whole, because that is how a reviewer at Google or Paddle
// reaches them — and how a visitor deciding whether to grant a scope does.
test("the privacy policy opens from the landing footer and reads whole", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "الصفحات القانونية" })
    .getByRole("link", { name: "سياسة الخصوصية" })
    .click();
  await expect(page).toHaveURL(/\/privacy-policy$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "سياسة الخصوصية",
  );
  await expect(page).toHaveTitle(/سياسة الخصوصية — مشاعر الجمهور/);
  // The two pages Google requires an API client to link, as anchors.
  await expect(
    page.getByRole("link", { name: "سياسة خصوصية Google" }).first(),
  ).toHaveAttribute("href", "https://policies.google.com/privacy");
  await expect(
    page.getByRole("link", { name: "شروط خدمة YouTube" }).first(),
  ).toHaveAttribute("href", "https://www.youtube.com/t/terms");
  // The contents jump to the section it names.
  await page
    .getByRole("navigation", { name: "محتويات الصفحة" })
    .getByRole("link", { name: "الاحتفاظ والحذف" })
    .click();
  await expect(page).toHaveURL(/#retention$/);
  await expect(
    page.getByRole("heading", { level: 2, name: "الاحتفاظ والحذف" }),
  ).toBeInViewport();
});

test("the terms page is reached from the landing nav and carries the two YouTube/Google links its terms require", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "الصفحات القانونية" })
    .getByRole("link", { name: "شروط الاستخدام" })
    .click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "شروط الاستخدام",
  );
  await expect(
    page.getByRole("heading", { level: 2, name: "الإلغاء والاسترداد" }),
  ).toBeVisible();
  // YouTube API Services Terms, III.A: a client's terms page links both.
  await expect(
    page.getByRole("link", { name: "شروط خدمة YouTube" }).first(),
  ).toHaveAttribute("href", "https://www.youtube.com/t/terms");
  await expect(
    page.getByRole("link", { name: "سياسة خصوصية Google" }).first(),
  ).toHaveAttribute("href", "https://policies.google.com/privacy");
  await expect(
    page.getByRole("link", { name: "شروط الشراء لدى Paddle" }),
  ).toHaveAttribute(
    "href",
    "https://www.paddle.com/legal/checkout-buyer-terms",
  );
  // And back to the other document from its own foot.
  await page
    .getByRole("navigation", { name: "الصفحات القانونية" })
    .getByRole("link", { name: "سياسة الخصوصية" })
    .click();
  await expect(page).toHaveURL(/\/privacy-policy$/);
});

test("the documents follow the interface language", async ({ page }) => {
  await page.goto("/privacy-policy");
  await page.getByTestId("language-switch").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Privacy Policy",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".legal-page")).toHaveAttribute("dir", "ltr");
});
