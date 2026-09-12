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
  await expect(page.getByTestId("loading")).toBeVisible();
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

test("paginates with cursors without changing totals or repeating rows", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("total")).toHaveText("6");
  const rows = () => page.locator("tbody tr td:nth-child(2)");

  // 25 per page holds the whole fixture, so there is nothing to page through.
  await expect(
    page.getByRole("button", { name: "الصفحة التالية" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "الصفحة السابقة" }),
  ).toBeDisabled();

  await page.getByLabel("عدد التعليقات في الصفحة").selectOption("5");
  await expect(page.getByTestId("page-state")).toContainText("الصفحة 1");
  await expect(rows()).toHaveCount(5);
  const first = await rows().allInnerTexts();

  await page.getByRole("button", { name: "الصفحة التالية" }).click();
  await expect(page.getByTestId("page-state")).toContainText("الصفحة 2");
  await expect(rows()).toHaveCount(1);
  const second = await rows().allInnerTexts();

  // Aggregates describe the filtered set, not the page.
  await expect(page.getByTestId("total")).toHaveText("6");
  expect(new Set([...first, ...second]).size).toBe(6);
  await expect(
    page.getByRole("button", { name: "الصفحة التالية" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "الصفحة السابقة" }).click();
  await expect(page.getByTestId("page-state")).toContainText("الصفحة 1");
  expect(await rows().allInnerTexts()).toEqual(first);

  // A new filter must start at page one rather than reusing a stale cursor.
  await page.getByRole("button", { name: "الصفحة التالية" }).click();
  await expect(page.getByTestId("page-state")).toContainText("الصفحة 2");
  await page.getByLabel("الفيديو").selectOption("video-1");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("4");
  await expect(page.getByTestId("page-state")).toContainText("الصفحة 1");
});

test("a slow response for old filters cannot overwrite newer filters", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("total")).toHaveText("6");

  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let holdNext = false;
  await page.route("**/fixtures/dashboard.json", async (route) => {
    if (holdNext) {
      holdNext = false;
      await held;
    }
    await route.continue();
  });

  // Filter A is slow: one video, 4 rows.
  holdNext = true;
  await page.getByLabel("الفيديو").selectOption("video-1");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  // The previous screen stays put behind a refresh indicator instead of blanking.
  await expect(page.getByTestId("updating")).toBeVisible();
  await expect(page.getByTestId("total")).toHaveText("6");

  // Filter B is applied before A returns, and answers immediately: 2 rows.
  await page.getByLabel("الفيديو").selectOption("video-2");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("2");

  // A now returns. Its result belongs to a filter screen the user has left.
  release();
  await page.waitForTimeout(500);
  await expect(page.getByTestId("total")).toHaveText("2");
});

test("recovers to page one when the row a cursor points at disappears", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("عدد التعليقات في الصفحة").selectOption("5");
  await expect(page.locator("tbody tr")).toHaveCount(5);

  // The dataset shrinks before the next page is requested, so the cursor names a
  // row that no longer exists. This is the real backend case, not a UI mistake.
  await page.route("**/fixtures/dashboard.json", async (route) => {
    const original = await route.fetch();
    const fixture = await original.json();
    fixture.comments = fixture.comments.slice(0, 2);
    await route.fulfill({ json: fixture });
  });

  await page.getByRole("button", { name: "الصفحة التالية" }).click();
  await expect(page.getByTestId("cursor-notice")).toContainText(
    "أُعيد العرض من الصفحة الأولى",
  );
  await expect(page.getByTestId("page-state")).toContainText("الصفحة 1");
  await expect(page.getByTestId("total")).toHaveText("2");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  // The stack came back with it, so "previous" is not offering a page that is gone.
  await expect(
    page.getByRole("button", { name: "الصفحة السابقة" }),
  ).toBeDisabled();
});

test("a human correction overrides the model and moves every aggregate together", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("total")).toHaveText("6");
  const distribution = page
    .getByRole("listitem")
    .filter({ hasText: "إيجابي:" });
  await expect(distribution).toHaveText("إيجابي: 1 (25٪)");

  // Row one is the model's single positive comment.
  const row = page.locator("tbody tr").first();
  await expect(row).toContainText("إيجابي");
  await row.getByRole("button", { name: "تصحيح" }).click();

  await expect(page.getByTestId("review-text")).toContainText(
    "المحتوى واضح ومفيد",
  );
  // Fixture mode must say plainly that nothing is persisted.
  await expect(page.getByTestId("review-scope")).toContainText(
    "لا يُرسل إلى أي خادم",
  );

  await page.getByLabel("التصنيف الصحيح").selectOption("negative");
  await page.getByLabel("سبب التصحيح").fill("تصنيف خاطئ من النموذج");
  await page.getByRole("button", { name: "حفظ التصحيح" }).click();

  // The corrected label replaces the prediction and is marked as human.
  await expect(page.locator("tbody tr").first()).toContainText("سلبي");
  await expect(page.locator("tbody tr").first()).toContainText("مراجعة بشرية");
  // The denominator is unchanged, but the buckets moved with the verdict.
  await expect(distribution).toHaveText("إيجابي: 0 (0٪)");
  await expect(
    page.getByRole("listitem").filter({ hasText: "سلبي:" }),
  ).toHaveText("سلبي: 2 (50٪)");
  await expect(page.getByTestId("total")).toHaveText("6");
  await expect(page.getByText("المقام: 4 تعليقًا")).toBeVisible();
});

test("correcting an unanalysed comment adds it to the sentiment denominator", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("المقام: 4 تعليقًا")).toBeVisible();

  // This row has no usable prediction, so it is outside the denominator.
  const row = page
    .locator("tbody tr")
    .filter({ hasText: "تعليق لم يُحلل بعد" });
  await expect(row).toContainText("غير محلل / قديم");
  await row.getByRole("button", { name: "تصحيح" }).click();
  await page.getByLabel("التصنيف الصحيح").selectOption("mixed");
  await page.getByLabel("سبب التصحيح").fill("مراجعة يدوية");
  await page.getByRole("button", { name: "حفظ التصحيح" }).click();

  await expect(page.getByText("المقام: 5 تعليقًا")).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "مختلط:" }),
  ).toHaveText("مختلط: 2 (40٪)");
  // Still six comments; only the analysed share changed.
  await expect(page.getByTestId("total")).toHaveText("6");
});

test("refuses a correction written against text that changed meanwhile", async ({
  page,
}) => {
  await page.goto("/");
  const row = page.locator("tbody tr").first();
  await row.getByRole("button", { name: "تصحيح" }).click();
  await page.getByLabel("سبب التصحيح").fill("تصنيف خاطئ");

  // The comment is edited after the reviewer read it, so the verdict now belongs
  // to a version of the text that no longer exists.
  await page.route("**/fixtures/dashboard.json", async (route) => {
    const fixture = await (await route.fetch()).json();
    fixture.comments[0].text_raw = "نص مُعدَّل بعد فتح شاشة التصحيح";
    fixture.comments[0].content_hash = "hash-after-the-edit";
    await route.fulfill({ json: fixture });
  });

  await page.getByRole("button", { name: "حفظ التصحيح" }).click();
  await expect(page.getByTestId("review-error")).toContainText(
    "تغيّر نص التعليق",
  );
  // Nothing was recorded, so the model's label still stands.
  await expect(page.locator("tbody tr").first()).not.toContainText(
    "مراجعة بشرية",
  );
});
