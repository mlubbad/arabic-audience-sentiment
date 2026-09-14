import { test, expect } from "@playwright/test";
test("Arabic fixture shell filters consistent totals and supports an empty state", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("total")).toHaveText("6");
  await expect(page.locator(".rp-hero")).not.toContainText("موضوعات");
  // The source strip, driven by the data mode rather than written by hand.
  const source = page.getByTestId("source");
  await expect(source).toHaveAttribute("data-mode", "sanitized_fixture");
  await expect(source).toContainText("بيانات اصطناعية");
  // Fixture mode must say plainly that a correction goes nowhere.
  await expect(page.getByTestId("data-mode")).toContainText("لا تُرسل");
  // And it must not claim a collection that never happened.
  await expect(source).toContainText("لا يمثل أي جمهور حقيقي");
  await page
    .getByLabel("البحث في التعليقات والمؤلفين")
    .fill("غير موجود نهائياً");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(
    page.getByRole("heading", { name: "لا توجد تعليقات مطابقة" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "إعادة ضبط الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("6");
  await page.getByLabel("الفيديو", { exact: true }).selectOption("video-2");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("2");
});
test("shows actual pending fetch then safe error with working retry", async ({
  page,
}) => {
  // StrictMode mounts the tree twice, so the initial load issues more than one
  // request. Hold *every* failing request until released, not just the first:
  // holding one and letting the next fail immediately made the query settle
  // while the assertion was still on its way, so whether the pending state was
  // ever observable came down to scheduling. It passed for months and then
  // failed the moment a render-blocking stylesheet made goto return later.
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  let failing = true;
  await page.route("**/fixtures/dashboard.json", async (route) => {
    if (!failing) return route.continue();
    await pending;
    await route.fulfill({ status: 503, body: "unavailable" });
  });
  await page.goto("/dashboard");
  await expect(page.getByTestId("loading")).toBeVisible();
  await expect(page.locator(".rp-hero")).not.toContainText("قراءة 0 تعليقًا");
  await expect(page.locator(".rp-hero")).not.toContainText("موضوعات");
  release();
  await expect(page.getByRole("alert")).toContainText("تعذر تحميل");
  await expect(page.getByTestId("total")).toHaveCount(0);
  failing = false;
  await page.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(page.getByTestId("total")).toHaveText("6");
});

test("video filter offers the videos in the current dataset, including unfamiliar ids", async ({
  page,
}) => {
  await page.route("**/fixtures/dashboard.json", async (route) => {
    const response = await route.fetch();
    const fixture = await response.json();
    fixture.comments = fixture.comments.map(
      (comment: { video_id: string }) => ({
        ...comment,
        video_id:
          comment.video_id === "video-2"
            ? "new-channel-video"
            : comment.video_id,
      }),
    );
    await route.fulfill({ json: fixture });
  });
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("6");
  const select = page.getByLabel("الفيديو", { exact: true });
  await expect(select.locator('option[value="new-channel-video"]')).toHaveCount(
    1,
  );
  await expect(select.locator('option[value="video-2"]')).toHaveCount(0);
  await select.selectOption("new-channel-video");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("2");
  await expect(select.locator('option[value="video-1"]')).toHaveCount(1);
});
test("mobile shell fits viewport and exposes honest live-configuration state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("6");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "قائمة التطبيق" }).click();
  await page.getByRole("link", { name: "الحساب ومساحات العمل" }).click();
  await expect(
    page.getByText("تسجيل الدخول غير متاح في هذه المعاينة"),
  ).toBeVisible();
});

test("paginates with cursors without changing totals or repeating rows", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("6");
  const rows = () =>
    page.locator('[data-testid="comments-table"] tbody tr td:nth-child(2)');

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
  await page.getByLabel("الفيديو", { exact: true }).selectOption("video-1");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("4");
  await expect(page.getByTestId("page-state")).toContainText("الصفحة 1");
});

test("a slow response for old filters cannot overwrite newer filters", async ({
  page,
}) => {
  await page.goto("/dashboard");
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
  await page.getByLabel("الفيديو", { exact: true }).selectOption("video-1");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  // The previous screen stays put behind a refresh indicator instead of blanking.
  await expect(page.getByTestId("updating")).toBeVisible();
  await expect(page.getByTestId("total")).toHaveText("6");

  // Filter B is applied before A returns, and answers immediately: 2 rows.
  await page.getByLabel("الفيديو", { exact: true }).selectOption("video-2");
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
  await page.goto("/dashboard");
  await page.getByLabel("عدد التعليقات في الصفحة").selectOption("5");
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr'),
  ).toHaveCount(5);

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
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr'),
  ).toHaveCount(2);
  // The stack came back with it, so "previous" is not offering a page that is gone.
  await expect(
    page.getByRole("button", { name: "الصفحة السابقة" }),
  ).toBeDisabled();
});

test("a human correction overrides the model and moves every aggregate together", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("6");
  const distribution = page
    .getByRole("listitem")
    .filter({ hasText: "إيجابي:" });
  await expect(distribution).toHaveText("إيجابي: 1 (25٪)");

  // Row one is the model's single positive comment.
  const row = page.locator('[data-testid="comments-table"] tbody tr').first();
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
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr').first(),
  ).toContainText("سلبي");
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr').first(),
  ).toContainText("مراجعة بشرية");
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
  await page.goto("/dashboard");
  await expect(page.getByText("المقام: 4 تعليقًا")).toBeVisible();

  // This row has no usable prediction, so it is outside the denominator.
  const row = page
    .locator('[data-testid="comments-table"] tbody tr')
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
  await page.goto("/dashboard");
  const row = page.locator('[data-testid="comments-table"] tbody tr').first();
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
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr').first(),
  ).not.toContainText("مراجعة بشرية");
});

async function downloadCsv(page: import("@playwright/test").Page) {
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "تصدير CSV" }).click();
  const download = await wait;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return {
    name: download.suggestedFilename(),
    text: Buffer.concat(chunks).toString("utf8"),
  };
}

test("exports every filtered comment, not just the visible page", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("6");
  // Shrink the page so a page-limited export would be obviously wrong.
  await page.getByLabel("عدد التعليقات في الصفحة").selectOption("5");
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr'),
  ).toHaveCount(5);

  const all = await downloadCsv(page);
  expect(all.name).toMatch(/^comments-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(all.text.startsWith("\uFEFF")).toBe(true);
  const header = all.text.replace(/^\uFEFF/, "").split("\r\n")[0];
  expect(header.split(",")[0]).toBe("comment_id");
  // Six data rows for six filtered comments, despite five being on screen.
  expect(all.text.trim().split("\r\n")).toHaveLength(7);

  // A narrower filter must produce a narrower file, through the same rules.
  await page.getByLabel("الفيديو", { exact: true }).selectOption("video-2");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("2");
  const filtered = await downloadCsv(page);
  expect(filtered.text.trim().split("\r\n")).toHaveLength(3);
});

test("exports the corrected label rather than the superseded prediction", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const row = page.locator('[data-testid="comments-table"] tbody tr').first();
  await row.getByRole("button", { name: "تصحيح" }).click();
  await page.getByLabel("التصنيف الصحيح").selectOption("negative");
  await page.getByLabel("سبب التصحيح").fill("تصنيف خاطئ");
  await page.getByRole("button", { name: "حفظ التصحيح" }).click();
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr').first(),
  ).toContainText("مراجعة بشرية");

  const { text } = await downloadCsv(page);
  const line = text.split("\r\n").find((l) => l.startsWith("fixture-1,"))!;
  expect(line).toContain(",negative,human_review,");
});

test("neutralises spreadsheet formulas in the file but not on screen", async ({
  page,
}) => {
  const attack = '=HYPERLINK("http://attacker.example","اضغط")';
  await page.route("**/fixtures/dashboard.json", async (route) => {
    const fixture = await (await route.fetch()).json();
    fixture.comments[0].text_raw = attack;
    await route.fulfill({ json: fixture });
  });
  await page.goto("/dashboard");
  // The dashboard shows the real stored text, escaped as text by React.
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr').first(),
  ).toContainText(attack);

  const { text } = await downloadCsv(page);
  const line = text.split("\r\n").find((l) => l.startsWith("fixture-1,"))!;
  // A spreadsheet sees a quoted string beginning with an apostrophe, so it
  // displays the text instead of evaluating it.
  expect(line).toContain(`"'${attack.replace(/"/g, '""')}"`);
  expect(line).not.toContain(`,${attack.slice(0, 5)}`);
});

test("shows the plan limit while there is still room to act", async ({
  page,
}) => {
  await page.goto("/sync");
  const analysis = page.getByTestId("budget-comment_analysis");
  // 74 of 100 is past the 70% notice threshold but not yet critical.
  await expect(analysis).toContainText("74 من 100 — يتبقى 26");
  await expect(analysis).toContainText("74٪");
  await expect(analysis.locator("small")).toHaveAttribute(
    "data-state",
    "warning",
  );
  await expect(analysis).toContainText("اقترب الاستهلاك من الحد");
  // The backfill budget is separate and healthy.
  const backfill = page.getByTestId("budget-historical_backfill");
  await expect(backfill.locator("small")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("plan-none")).toHaveCount(0);
});

test("escalates to a spent state instead of only warning", async ({ page }) => {
  await page.route("**/fixtures/dashboard.json", async (route) => {
    const fixture = await (await route.fetch()).json();
    fixture.plan.budgets[0] = {
      event_type: "comment_analysis",
      used: 100,
      allowance: 100,
      remaining: 0,
    };
    await route.fulfill({ json: fixture });
  });
  await page.goto("/sync");
  const analysis = page.getByTestId("budget-comment_analysis");
  await expect(analysis.locator("small")).toHaveAttribute(
    "data-state",
    "exhausted",
  );
  await expect(analysis).toContainText("نفد الحد");
  // A spent allowance must not be presented as a failure of the data. The
  // budget lives on the operations page now, so the claim is checked where the
  // data is — the property is unchanged, only the two halves sit apart.
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("6");
});

test("distinguishes no activated plan from no allowance left", async ({
  page,
}) => {
  await page.route("**/fixtures/dashboard.json", async (route) => {
    const fixture = await (await route.fetch()).json();
    fixture.plan = null;
    await route.fulfill({ json: fixture });
  });
  await page.goto("/sync");
  await expect(page.getByTestId("plan-none")).toContainText(
    "لا توجد خطة مفعّلة",
  );
  await expect(page.getByTestId("plan-none")).toContainText(
    "لا يعني ذلك نفاد الحد",
  );
  await expect(page.getByTestId("budget-comment_analysis")).toHaveCount(0);
});

async function applyFilter(
  page: import("@playwright/test").Page,
  label: string,
  value: string,
) {
  // Exact: several filter labels are substrings of others, so a loose match
  // silently resolves to more than one control.
  await page.getByLabel(label, { exact: true }).selectOption(value);
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
}

test("separates replies from top-level comments", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("6");
  await applyFilter(page, "نوع المشاركة", "comments");
  await expect(page.getByTestId("total")).toHaveText("4");
  await expect(page.getByTestId("replies-count")).toHaveText("0");
  await applyFilter(page, "نوع المشاركة", "replies");
  await expect(page.getByTestId("total")).toHaveText("2");
  await expect(page.getByTestId("replies-count")).toHaveText("2");
});

test("separates known from unknown publication dates", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("unknown-dates")).toHaveText("1");
  // Assert the rendered sentence, not just the number: a test that only reads
  // the span passed while the surrounding text rendered literal escape
  // characters on screen.
  await expect(
    page.getByText("تعليقات بلا تاريخ: 1", { exact: true }),
  ).toBeVisible();
  await applyFilter(page, "التاريخ", "known");
  await expect(page.getByTestId("total")).toHaveText("5");
  await expect(page.getByTestId("unknown-dates")).toHaveText("0");
  await applyFilter(page, "التاريخ", "unknown");
  await expect(page.getByTestId("total")).toHaveText("1");
  // A comment with no date is still a comment, not a defect.
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr'),
  ).toContainText("تعليق لم يُحلل بعد");
});

test("a date range and an explicit unknown-date selection cannot contradict", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.getByLabel("التاريخ").selectOption("unknown");
  // Ranges apply to known dates only, so they are disabled rather than silently
  // producing an empty screen.
  await expect(page.getByLabel("من تاريخ")).toBeDisabled();
  await expect(page.getByLabel("إلى تاريخ (غير شامل)")).toBeDisabled();
  await page.getByLabel("التاريخ").selectOption("all");
  await expect(page.getByLabel("من تاريخ")).toBeEnabled();
});

test("filters by video kind", async ({ page }) => {
  await page.goto("/dashboard");
  await applyFilter(page, "نوع الفيديو", "video");
  await expect(page.getByTestId("total")).toHaveText("4");
  await applyFilter(page, "نوع الفيديو", "short");
  await expect(page.getByTestId("total")).toHaveText("2");
});

test("filters by comment type using the types actually present", async ({
  page,
}) => {
  await page.goto("/dashboard");
  // The list is derived from the data, not hard-coded per channel.
  await expect(page.getByLabel("نوع التعليق").locator("option")).toHaveText([
    "كل الأنواع",
    "اقتراح",
    "سؤال",
  ]);
  await applyFilter(page, "نوع التعليق", "سؤال");
  await expect(page.getByTestId("total")).toHaveText("1");
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr'),
  ).toContainText("معلومة عن موعد الحلقة");
  // The list must not shrink to the types left on screen, or the filter would
  // be a one-way door: once narrowed, the other types could never be chosen.
  await expect(page.getByLabel("نوع التعليق").locator("option")).toHaveText([
    "كل الأنواع",
    "اقتراح",
    "سؤال",
  ]);
  await applyFilter(page, "نوع التعليق", "اقتراح");
  await expect(page.getByTestId("total")).toHaveText("1");
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr'),
  ).toContainText("أتمنى تحسين الصوت");
});

test("filters by review status and resets every control together", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await applyFilter(page, "حالة المراجعة", "reviewed");
  await expect(page.getByTestId("total")).toHaveText("0");

  await page.getByRole("button", { name: "إعادة ضبط الفلاتر" }).click();
  const row = page.locator('[data-testid="comments-table"] tbody tr').first();
  await row.getByRole("button", { name: "تصحيح" }).click();
  await page.getByLabel("التصنيف الصحيح").selectOption("negative");
  await page.getByLabel("سبب التصحيح").fill("تصنيف خاطئ");
  await page.getByRole("button", { name: "حفظ التصحيح" }).click();
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr').first(),
  ).toContainText("مراجعة بشرية");

  await applyFilter(page, "حالة المراجعة", "reviewed");
  await expect(page.getByTestId("total")).toHaveText("1");
  await applyFilter(page, "حالة المراجعة", "unreviewed");
  await expect(page.getByTestId("total")).toHaveText("5");

  // Reset must clear every control, not only the ones with visible values.
  await page.getByRole("button", { name: "إعادة ضبط الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("6");
  for (const [label, value] of [
    ["نوع المشاركة", "all"],
    ["التاريخ", "all"],
    ["نوع الفيديو", ""],
    ["نوع التعليق", ""],
    ["حالة المراجعة", "all"],
  ] as const) {
    await expect(page.getByLabel(label)).toHaveValue(value);
  }
});

test("the export follows the new filters too", async ({ page }) => {
  await page.goto("/dashboard");
  await applyFilter(page, "نوع المشاركة", "replies");
  await expect(page.getByTestId("total")).toHaveText("2");
  const { text } = await downloadCsv(page);
  expect(text.trim().split("\r\n")).toHaveLength(3);
});

async function openReview(
  page: import("@playwright/test").Page,
  rowText: string,
) {
  await page
    .locator('[data-testid="comments-table"] tbody tr')
    .filter({ hasText: rowText })
    .getByRole("button", { name: "تصحيح" })
    .click();
}

test("shows no history for a comment that has never been reviewed", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await openReview(page, "المحتوى واضح ومفيد");
  await expect(page.getByTestId("review-history")).toContainText(
    "لا توجد مراجعات سابقة",
  );
});

test("says a correction no longer applies once the text changed", async ({
  page,
}) => {
  await page.goto("/dashboard");
  // This row carries a human verdict made against text that was later edited.
  const row = page
    .locator('[data-testid="comments-table"] tbody tr')
    .filter({ hasText: "هذا النص تغير" });
  await expect(row).toContainText("غير محلل / قديم");
  await expect(row).not.toContainText("مراجعة بشرية");

  await openReview(page, "هذا النص تغير");
  const entries = page.getByTestId("review-history").getByRole("listitem");
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText("إيجابي");
  await expect(entries.first().locator("small")).toHaveAttribute(
    "data-state",
    "superseded_by_edit",
  );
  await expect(entries.first()).toContainText("لا تنطبق بعد تغيّر النص");
});

test("marks a legacy amendment as unverified rather than a human review", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const row = page
    .locator('[data-testid="comments-table"] tbody tr')
    .filter({ hasText: "موعد الحلقة" });
  // It must not be counted as a human review, and the model label still stands.
  await expect(row).toContainText("محايد");
  await expect(row).not.toContainText("مراجعة بشرية");

  await openReview(page, "موعد الحلقة");
  const entry = page
    .getByTestId("review-history")
    .getByRole("listitem")
    .first();
  await expect(entry.locator("small")).toHaveAttribute(
    "data-state",
    "legacy_unverified",
  );
  await expect(entry).toContainText("تعديل موروث");
});

test("keeps every verdict and marks which one is in force", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await openReview(page, "المحتوى واضح ومفيد");
  await page.getByLabel("التصنيف الصحيح").selectOption("negative");
  await page.getByLabel("سبب التصحيح").fill("أول تصحيح");
  await page.getByRole("button", { name: "حفظ التصحيح" }).click();
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr').first(),
  ).toContainText("مراجعة بشرية");

  await openReview(page, "المحتوى واضح ومفيد");
  await page.getByLabel("التصنيف الصحيح").selectOption("mixed");
  await page.getByLabel("سبب التصحيح").fill("إعادة نظر");
  await page.getByRole("button", { name: "حفظ التصحيح" }).click();
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr').first(),
  ).toContainText("مختلط");

  await openReview(page, "المحتوى واضح ومفيد");
  const entries = page.getByTestId("review-history").getByRole("listitem");
  // Append-only: the first verdict is kept, not overwritten.
  await expect(entries).toHaveCount(2);
  // Newest first, and only one is in force.
  await expect(entries.nth(0)).toContainText("مختلط");
  await expect(entries.nth(0).locator("small")).toHaveAttribute(
    "data-state",
    "in_force",
  );
  await expect(entries.nth(1)).toContainText("سلبي");
  await expect(entries.nth(1).locator("small")).toHaveAttribute(
    "data-state",
    "superseded_by_review",
  );
});

test("compares videos using each video's own denominator", async ({ page }) => {
  await page.goto("/dashboard");
  const one = page.getByTestId("compare-video-1");
  const two = page.getByTestId("compare-video-2");
  await expect(one).toContainText("4");
  await expect(two).toContainText("2");

  // Every comment on video-2 is unanalysed, so it must say so rather than
  // render 0% positive as though that had been measured.
  await expect(two).toContainText("لا توجد تعليقات محللة");
  await expect(one).toContainText("إيجابي 1 (25٪)");

  // Give video-2 exactly one analysed comment, so the two videos no longer
  // share a denominator with each other or with the whole filtered set.
  await page
    .locator('[data-testid="comments-table"] tbody tr')
    .filter({ hasText: "تعليق لم يُحلل بعد" })
    .getByRole("button", { name: "تصحيح" })
    .click();
  await page.getByLabel("التصنيف الصحيح").selectOption("positive");
  await page.getByLabel("سبب التصحيح").fill("مراجعة يدوية");
  await page.getByRole("button", { name: "حفظ التصحيح" }).click();

  // Whole set: 5 analysed, 2 positive -> 40%. video-2 alone: 1 of 1 -> 100%.
  await expect(page.getByText("المقام: 5 تعليقًا")).toBeVisible();
  await expect(two).toContainText("إيجابي 1 (100٪)");
  await expect(one).toContainText("إيجابي 1 (25٪)");
});

test("the comparison follows the same filters as everything else", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("compare-video-2")).toBeVisible();
  // video-2 has no replies, so it leaves the comparison entirely.
  await applyFilter(page, "نوع المشاركة", "replies");
  await expect(page.getByTestId("total")).toHaveText("2");
  await expect(page.getByTestId("compare-video-1")).toContainText("2");
  await expect(page.getByTestId("compare-video-2")).toHaveCount(0);
});

test("does not present comment-scoped figures as lifetime video metrics", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("comparison-scope")).toContainText(
    "ضمن الفلاتر الحالية",
  );
});

async function withSync(page: import("@playwright/test").Page, sync: unknown) {
  await page.route("**/fixtures/dashboard.json", async (route) => {
    const fixture = await (await route.fetch()).json();
    fixture.sync = sync;
    await route.fulfill({ json: fixture });
  });
}

test("states plainly that nothing has synced and no worker is connected", async ({
  page,
}) => {
  await page.goto("/sync");
  const panel = page.getByTestId("sync-panel");
  await expect(panel.getByTestId("sync-state")).toHaveAttribute(
    "data-severity",
    "critical",
  );
  await expect(panel).toContainText("لم تُنفذ أي مزامنة، ولا يوجد عامل متصل");
  // Disconnected collection must say what it means for freshness without
  // assuming a particular machine or deployment architecture.
  await expect(panel.getByTestId("sync-worker")).toContainText(
    "لن تُحدَّث البيانات تلقائيًا حتى يعود عامل الجمع",
  );
  await expect(panel.getByTestId("sync-last-run")).toContainText(
    "لا يوجد تشغيل سابق",
  );
});

test("shows queued work with no worker as stalled, not as a healthy last run", async ({
  page,
}) => {
  await withSync(page, {
    worker: { connected: false, last_heartbeat_at: "2026-09-12T09:00:00Z" },
    queued_jobs: 3,
    last_run: {
      started_at: "2026-09-13T11:00:00Z",
      ended_at: "2026-09-13T11:30:00Z",
      status: "succeeded",
      source: "youtube_data_api_public",
      error_code: null,
      coverage: { videos_seen: 5, comments_collected: 900, complete: true },
    },
  });
  await page.goto("/sync");
  const panel = page.getByTestId("sync-panel");
  await expect(panel.getByTestId("sync-state")).toHaveAttribute(
    "data-severity",
    "critical",
  );
  await expect(panel).toContainText("مهام منتظرة ولا يوجد عامل متصل");
  await expect(panel.getByTestId("sync-queued")).toContainText("3");
});

test("does not present a partial collection as a completed one", async ({
  page,
}) => {
  await withSync(page, {
    worker: { connected: true, last_heartbeat_at: "2026-09-13T11:59:00Z" },
    queued_jobs: 0,
    last_run: {
      started_at: "2026-09-13T11:00:00Z",
      ended_at: "2026-09-13T11:30:00Z",
      status: "partial",
      source: "youtube_data_api_public",
      error_code: "source_ended_without_completion",
      coverage: { videos_seen: 5, comments_collected: 120, complete: false },
    },
  });
  await page.goto("/sync");
  const panel = page.getByTestId("sync-panel");
  await expect(panel.getByTestId("sync-state")).toHaveAttribute(
    "data-severity",
    "warning",
  );
  await expect(panel).toContainText("التغطية جزئية وليست اكتمالًا");
  await expect(panel.getByTestId("sync-error")).toContainText(
    "source_ended_without_completion",
  );
  await expect(panel.getByTestId("sync-last-run")).toContainText(
    "لم يُثبت اجتياز المصدر بالكامل",
  );
});

test("reads a malformed sync block as unknown rather than healthy", async ({
  page,
}) => {
  await withSync(page, { worker: "yes please", queued_jobs: "many" });
  await page.goto("/sync");
  const panel = page.getByTestId("sync-panel");
  await expect(panel.getByTestId("sync-state")).toHaveAttribute(
    "data-severity",
    "unknown",
  );
  await expect(panel).toContainText("لا تتوفر بيانات عن حالة المزامنة");
  // The dashboard still works; sync health is not load-bearing for it.
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("6");
});

test("the skip link is the first stop and reaches the content", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "انتقل إلى المحتوى" });
  await expect(skip).toBeFocused();
  // A skip link that stays parked off-screen while focused helps nobody who can
  // see the page, so assert it actually arrives on screen.
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#content")).toBeVisible();
});

test("every filter is reachable and operable from the keyboard alone", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("6");
  // Drive the participation filter without touching the mouse.
  await page.getByLabel("نوع المشاركة").focus();
  await expect(page.getByLabel("نوع المشاركة")).toBeFocused();
  await page.getByLabel("نوع المشاركة").selectOption("replies");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("total")).toHaveText("2");
});

test("opening a correction moves focus into it and gives it back on cancel", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const trigger = page
    .locator('[data-testid="comments-table"] tbody tr')
    .first()
    .getByRole("button", { name: "تصحيح" });
  await trigger.click();
  // A panel that appears below the fold is useless if focus stays behind it.
  await expect(page.getByRole("form", { name: "تصحيح التصنيف" })).toBeFocused();
  await page.getByRole("button", { name: "إلغاء" }).click();
  await expect(trigger).toBeFocused();
});

test("focus returns to the row after a correction is saved", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const trigger = page
    .locator('[data-testid="comments-table"] tbody tr')
    .first()
    .getByRole("button", { name: "تصحيح" });
  await trigger.click();
  await page.getByLabel("التصنيف الصحيح").selectOption("negative");
  await page.getByLabel("سبب التصحيح").fill("تصنيف خاطئ");
  await page.getByRole("button", { name: "حفظ التصحيح" }).click();
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr').first(),
  ).toContainText("مراجعة بشرية");
  await expect(trigger).toBeFocused();
});

test("no figure is carried by colour alone", async ({ page }) => {
  await page.goto("/dashboard");
  // The chart duplicates the list beside it, so it is kept out of the
  // accessibility tree rather than announced as an unlabelled canvas.
  await expect(page.locator(".rp-chart-donut")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(
    page.getByRole("listitem").filter({ hasText: "إيجابي:" }),
  ).toHaveText("إيجابي: 1 (25٪)");
  // Same for the plan meters: the numbers are text beside the bar. They moved
  // to the operations page, and the rule follows them.
  await page.goto("/sync");
  await expect(page.locator("progress").first()).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.getByTestId("budget-comment_analysis")).toContainText(
    "74 من 100 — يتبقى 26",
  );
});

test("every table header declares what it heads", async ({ page }) => {
  await page.goto("/dashboard");
  // Wait for a table to exist before counting headers. Without this the
  // evaluate ran against a page whose data had not arrived: it counted zero
  // headers, found zero of them faulty, and passed — an accessibility test
  // that never once looked at a table. It stayed green through every change
  // to both tables because there was nothing in the DOM to be wrong.
  const comments = page.getByRole("table", { name: /التعليقات ضمن الفلاتر/ });
  await expect(comments).toBeVisible();
  const headers = await page.evaluate(() =>
    [...document.querySelectorAll("table th")].map((th) => ({
      scope: th.getAttribute("scope"),
      text: (th.textContent ?? "").trim().slice(0, 20),
    })),
  );
  expect(headers.length).toBeGreaterThan(0);
  // A th with no scope is ambiguous: the reader is told this cell is a header
  // and not told what it heads. Row headers are legitimate — the figure tables
  // under the charts name each row — so the rule is "declared", not "col".
  expect(headers.filter((h) => h.scope !== "col" && h.scope !== "row")).toEqual(
    [],
  );
  // And a table needs a name that is on the page, not only in the tree.
  await expect(
    page.locator("table caption", { hasText: "مقارنة الفيديوهات ضمن الفلاتر" }),
  ).toBeVisible();
});

test("a chart that cannot be seen can still be read", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("table", { name: /التعليقات ضمن/ }),
  ).toBeVisible();
  // The timing panels draw into a canvas and are hidden from the accessibility
  // tree, which is right — "canvas" announced aloud helps nobody. What was
  // missing is what the canvas says. Every chart that is drawn publishes its
  // figures as a table; a chart with no figures beside it is a panel that
  // exists only for readers who can see it.
  const drawn = page.locator(".rp-chart:not([hidden]), .rp-chart-tall");
  const figures = page.locator(".rp-figures");
  await expect(figures).toHaveCount(await drawn.count());
  const first = figures.first();
  await expect(first).not.toHaveAttribute("open", "");
  await first.getByText("عرض الأرقام").click();
  await expect(first.locator("table")).toBeVisible();
  // The same number the bar is tall.
  await expect(first.locator("tbody tr").first()).toContainText(/\d/);
});

test("an empty page says which empty it is", async ({ page }) => {
  await page.goto("/dashboard");
  const empty = page.getByTestId("empty-state");
  await page
    .getByLabel("البحث في التعليقات والمؤلفين")
    .fill("لا يطابق هذا شيئًا");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(empty).toBeVisible();
  // Filters excluded everything, and the workspace is not empty. Telling this
  // reader that no collection has run would be false; telling the reader of an
  // uncollected workspace to widen their filters is advice that cannot work,
  // and for a new client on their first screen it was the only advice offered.
  await expect(empty).toContainText("لا توجد تعليقات مطابقة لهذه الفلاتر");
  await expect(empty).toContainText("6 تعليقًا محفوظًا");
  // And the page carries the control that resolves it, under its own name —
  // the filter bar's button already owns "إعادة ضبط الفلاتر".
  await empty.getByRole("button", { name: "اعرض كل التعليقات" }).click();
  await expect(page.getByTestId("total")).toHaveText("6");
});

test("a workspace with nothing collected is not told to change its filters", async ({
  page,
}) => {
  // The state a new client meets on their very first screen, and the one the
  // fixture cannot otherwise produce. It used to read "غيّر الفلاتر أو أعد
  // ضبطها لعرض بيانات الاختبار" — advice that cannot work for a reader with no
  // filters set, offering test data on a page reading their own channel.
  await page.route("**/fixtures/dashboard.json", async (route) => {
    const fixture = await (await route.fetch()).json();
    fixture.comments = [];
    await route.fulfill({ json: fixture });
  });
  await page.goto("/dashboard");
  const empty = page.getByTestId("empty-state");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("لم تصل تعليقات بعد");
  await expect(empty).not.toContainText("الفلاتر أو أعد ضبطها");
  // And it points at the two places where a collection can actually begin.
  await expect(empty.getByRole("link", { name: /حالة الجمع/ })).toHaveAttribute(
    "href",
    "/sync",
  );
  await expect(empty.getByRole("link", { name: /اربط قناة/ })).toHaveAttribute(
    "href",
    "/account",
  );
});

test("the report index lists every section and marks the one in view", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const links = page.locator(".rp-nav-links a");
  // Wait for the sections to exist before comparing them to the index. The
  // header test in this file spent its life asserting against a page whose
  // data had not arrived — it counted nothing, found nothing wrong, and
  // passed. The same trap is one line away here.
  await expect(page.locator("#rp-comments")).toBeVisible();
  // One list drives both the index and the page, so a section cannot exist in
  // one and not the other. Two did: مقارنة الفيديوهات and أكثر التعليقات
  // السلبية تفاعلًا were on the page and absent from the index enumerating it.
  const ids = await links.evaluateAll((els) =>
    els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!.slice(1)),
  );
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) await expect(page.locator(`#${id}`)).toHaveCount(1);
  const sections = await page
    .locator("main section.rp-section[id]")
    .evaluateAll((els) => els.map((e) => e.id));
  expect(new Set(ids)).toEqual(new Set(sections));

  // And the index says where the reader is.
  await page.locator("#rp-comments").scrollIntoViewIfNeeded();
  await expect(links.filter({ hasText: "التعليقات" }).last()).toHaveAttribute(
    "aria-current",
    "true",
  );

  // An index to nothing is worse than no index: at zero rows every section it
  // names is unrendered, and a link that does nothing reads as a broken page.
  await page
    .getByLabel("البحث في التعليقات والمؤلفين")
    .fill("لا يطابق هذا شيئًا");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(links).toHaveCount(0);
});

test("one figure in a row leads, and each wears its own slice's colour", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const row = page.locator(".rp-figures-row");
  await expect(row).toBeVisible();
  const read = (tone: string) =>
    row.locator(`[data-tone="${tone}"] strong`).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: parseFloat(cs.fontSize), color: cs.color };
    });
  const [negative, positive, none] = await Promise.all([
    read("negative"),
    read("positive"),
    read("none"),
  ]);
  // The section's own prose says the negative count is the one to act on.
  // Three identical filled blocks said nothing was. Emphasis spent everywhere
  // is emphasis spent nowhere, so exactly one of the three carries it.
  expect(negative.size).toBeGreaterThan(positive.size);
  expect(positive.size).toEqual(none.size);

  // And the row speaks the donut's language. These numbers used to be yellow
  // on indigo, eight pixels under a chart calling the same two things teal and
  // red — one fact wearing two colour languages within a single glance.
  const token = (name: string) =>
    page.evaluate(
      (n) =>
        getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
      name,
    );
  const asRgb = async (hex: string) =>
    page.evaluate((h) => {
      const d = document.createElement("span");
      d.style.color = h;
      document.body.append(d);
      const c = getComputedStyle(d).color;
      d.remove();
      return c;
    }, hex);
  expect(negative.color).toBe(await asRgb(await token("--sentiment-negative")));
  expect(positive.color).toBe(await asRgb(await token("--sentiment-positive")));
});

test("no Arabic label is letter-spaced", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("table", { name: /التعليقات ضمن/ }),
  ).toBeVisible();
  // Arabic letters join. Tracking runs after shaping, so the connected forms
  // are drawn with gaps between them — the word comes apart, and it reads as a
  // rendering fault rather than as a style. Latin tracking on a Latin label is
  // a taste question; on Arabic it is a defect, which is why this is asserted
  // rather than left to the eye.
  const tracked = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((el) =>
        [...el.childNodes].some(
          (n) =>
            n.nodeType === 3 && /[\u0600-\u06FF]/.test(n.textContent ?? ""),
        ),
      )
      .map((el) => ({
        text: (el.textContent ?? "").trim().slice(0, 24),
        spacing: getComputedStyle(el).letterSpacing,
      }))
      // Only positive tracking pulls joins apart; the headings tighten very
      // slightly, which closes nothing.
      .filter((x) => x.spacing !== "normal" && parseFloat(x.spacing) > 0.2),
  );
  expect(tracked).toEqual([]);
});

test("a marker on a card says something true about the card", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const tags = page.locator(".rp-insight-tag");
  await expect(tags.first()).toBeVisible();
  // These four readings are independent — coverage, reply share, concentration,
  // datedness — so numbering them 1..4 asserted a sequence that does not exist.
  // A marker earns its place by naming its card, not by counting it.
  const texts = await tags.allTextContents();
  expect(texts.length).toBeGreaterThan(1);
  for (const t of texts) expect(t.trim()).not.toMatch(/\d/);
  expect(new Set(texts).size).toBe(texts.length);
});

test("a budget bar shows the state its sentence reports", async ({ page }) => {
  await page.goto("/sync");
  const near = page.getByTestId("budget-comment_analysis");
  await expect(near).toContainText("اقترب الاستهلاك من الحد");
  // The bar used to take the browser's own accent — Chrome paints <progress>
  // green — so a panel warning about a limit showed a reassuring green bar,
  // and a different colour in every browser. Colour and sentence now come
  // from one state.
  const fill = await near.locator("progress").evaluate((el) => {
    const warning = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-warning")
      .trim();
    return { appearance: getComputedStyle(el).appearance, warning };
  });
  expect(fill.appearance).toBe("none");
  expect(fill.warning).not.toBe("");
});

test("a sync failure reads as a sentence, not as a raw code", async ({
  page,
}) => {
  await withSync(page, {
    worker: { connected: true, last_heartbeat_at: "2026-09-13T11:59:00Z" },
    queued_jobs: 0,
    last_run: {
      started_at: "2026-09-13T11:00:00Z",
      ended_at: "2026-09-13T11:30:00Z",
      status: "blocked",
      source: "youtube_data_api_public",
      error_code: "source_access_denied",
      coverage: { videos_seen: 1, comments_collected: 0, complete: false },
    },
  });
  await page.goto("/sync");
  const detail = page.getByTestId("sync-error");
  // The explanation leads; the identifier is supporting detail for support.
  await expect(detail).toContainText("رفض المصدر الوصول");
  await expect(detail).toContainText("source_access_denied");
});

test("the history says who reviewed and why", async ({ page }) => {
  await page.goto("/dashboard");
  await openReview(page, "المحتوى واضح ومفيد");
  await page.getByLabel("التصنيف الصحيح").selectOption("negative");
  await page.getByLabel("سبب التصحيح").fill("النموذج قرأ السخرية حرفيًا");
  await page.getByRole("button", { name: "حفظ التصحيح" }).click();
  await expect(page.getByRole("form", { name: "تصحيح التصنيف" })).toHaveCount(
    0,
  );

  await openReview(page, "المحتوى واضح ومفيد");
  const entry = page
    .getByTestId("review-history")
    .getByRole("listitem")
    .first();
  await expect(entry.getByTestId("review-reason")).toContainText(
    "النموذج قرأ السخرية حرفيًا",
  );
  // The reviewer is attributed from the session context, and fixture mode says
  // plainly that the session is a local test one rather than inventing a user.
  await expect(entry.getByTestId("review-by")).toContainText(
    "مراجع محلي (جلسة اختبار)",
  );
});

test("an imported amendment shows no reviewer and states no reason", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await openReview(page, "موعد الحلقة");
  const entry = page
    .getByTestId("review-history")
    .getByRole("listitem")
    .first();
  await expect(entry.getByTestId("review-by")).toContainText("مراجع غير معروف");
  // No reason element at all, rather than an empty quote implying one exists.
  await expect(entry.getByTestId("review-reason")).toHaveCount(0);
  await expect(entry.locator("small")).toHaveAttribute(
    "data-state",
    "legacy_unverified",
  );
});

test("ranks engaged negatives and keeps unknown engagement out of the ranking", async ({
  page,
}) => {
  await page.goto("/dashboard");
  // Only one negative to begin with, so the list is short but real.
  await expect(page.getByTestId("engaged-fixture-2")).toContainText("48");
  await expect(page.getByTestId("engaged-unranked")).toHaveCount(0);

  // Correct a liked positive to negative: it must join the ranking below the
  // more engaged one, ranked on the effective label rather than the model's.
  await openReview(page, "المحتوى واضح ومفيد");
  await page.getByLabel("التصنيف الصحيح").selectOption("negative");
  await page.getByLabel("سبب التصحيح").fill("تصنيف خاطئ");
  await page.getByRole("button", { name: "حفظ التصحيح" }).click();
  const ranked = page.getByTestId("engaged-panel").getByRole("listitem");
  await expect(ranked).toHaveCount(2);
  await expect(ranked.nth(0)).toContainText("48");
  await expect(ranked.nth(1)).toContainText("12");

  // Now correct the comment whose like count is unknown. It is negative, so it
  // counts as excluded, but it must not be ranked as though it had zero likes.
  await openReview(page, "تعليق لم يُحلل بعد");
  await page.getByLabel("التصنيف الصحيح").selectOption("negative");
  await page.getByLabel("سبب التصحيح").fill("مراجعة يدوية");
  await page.getByRole("button", { name: "حفظ التصحيح" }).click();
  await expect(ranked).toHaveCount(2);
  await expect(page.getByTestId("engaged-unranked")).toContainText(
    "عدد غير معروف ليس صفرًا",
  );
});

test("the engagement panel follows the filters and says so when empty", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("engaged-fixture-2")).toBeVisible();
  // The only negative lives on video-1, so filtering to video-2 empties it.
  await applyFilter(page, "الفيديو", "video-2");
  await expect(page.getByTestId("engaged-empty")).toBeVisible();
  await expect(page.getByTestId("engaged-panel")).toContainText(
    "الإعجابات لا تُرجِّح التصنيف",
  );
});

test("the export carries engagement, with unknown left empty not zero", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const { text } = await downloadCsv(page);
  const header = text
    .replace(/^\uFEFF/, "")
    .split("\r\n")[0]
    .split(",");
  expect(header.slice(-2)).toEqual(["likes_raw", "likes_value"]);
  const row = (id: string) =>
    text
      .split("\r\n")
      .find((l) => l.startsWith(`${id},`))!
      .split(",");
  expect(row("fixture-2").slice(-2)).toEqual(["48", "48"]);
  // Unknown engagement exports as empty, never as a zero somebody could sum.
  expect(row("fixture-5").slice(-2)).toEqual(["", ""]);
});
