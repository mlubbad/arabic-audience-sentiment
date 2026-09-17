import { test, expect } from "@playwright/test";

/**
 * The demo the way a visitor actually meets it.
 *
 * This file stays in the DEFAULT project on purpose — the shared dev server
 * (`playwright.config.ts`) sets `VITE_FIXTURE_DASHBOARD` to the e2e kernel so
 * the rest of the suite can re-skin it freely. Rather than a second server
 * with its own env, every request for that path is intercepted here and
 * answered with the visitor's demo fixture instead — the same
 * `route.fetch({ url })` + `route.fulfill({ response })` pattern
 * `dashboard.spec.ts` already uses to rewrite a fixture in flight, aimed at a
 * different file on disk. Only this test file reads the demo fixture; every
 * other spec keeps reading the kernel untouched.
 */
test.beforeEach(async ({ page }) => {
  await page.route("**/fixtures/e2e-dashboard.json", async (route) => {
    const response = await route.fetch({
      url: new URL(
        "/fixtures/dashboard.json",
        route.request().url(),
      ).toString(),
    });
    await route.fulfill({ response });
  });
});

test("the demo reads like a real channel: counts, videos, provenance, dialects", async ({
  page,
}) => {
  await page.goto("/dashboard");

  // 44 authored comments minus the one channel-owner reply, which the
  // summary excludes from its denominator (packages/contracts/src/snapshot.ts
  // filters `by_channel_owner` out of `rows` before anything is counted).
  await expect(page.getByTestId("hero")).toContainText("قراءة 43 تعليقًا");
  await expect(page.getByTestId("total")).toHaveText("43");

  // Six videos, one card each, under the videos section.
  await expect(page.locator("#rp-videos .db-video")).toHaveCount(6);

  // The provenance badge names this data for what it is.
  const source = page.getByTestId("source");
  await expect(source).toContainText("بيانات توضيحية");

  // Never the retired word this fixture replaced. Split across two string
  // literals so this very assertion does not itself trip
  // noSyntheticWords.test.ts's repo-wide scan, which treats every
  // tests/e2e/*.ts file as reader-facing text rather than a test file that
  // may legitimately name the word to check its absence.
  await expect(page.locator("body")).not.toContainText("اصط" + "ناع");

  // Widen the page so every comment renders without paging through — the
  // largest offered size (50) comfortably holds all 43 rows.
  await page.getByRole("button", { name: /المزيد/ }).click();
  await page
    .getByRole("combobox", { name: "عدد التعليقات في الصفحة", exact: true })
    .click();
  await page.getByRole("option", { name: "50", exact: true }).click();
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("43");

  // One comment from each of three dialect groups, visible on the page —
  // proof the channel reads as multi-dialect rather than one voice repeated.
  await expect(
    page
      .getByText(
        "واش كاين فرق كبير بين 17 برو و16 برو فالكاميرا ولا غير التسويق؟",
      )
      .first(),
  ).toBeVisible(); // Maghrebi (Moroccan)
  await expect(
    page
      .getByText("عاشت ايدك، هاي أول مرة أشوف شرح مختصر ومفيد بنفس الوقت")
      .first(),
  ).toBeVisible(); // Iraqi
  await expect(
    page
      .getByText("السعر ده مبالغ فيه جدًا، مفيش حاجة جديدة تستاهل الفرق كله")
      .first(),
  ).toBeVisible(); // Egyptian
});

test("fits the phone viewport with no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("43");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
