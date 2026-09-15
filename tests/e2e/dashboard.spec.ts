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
  await page.getByRole("link", { name: "المصادر والحساب" }).click();
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

test("a filter change replaces the numbers without ever emptying the screen", async ({
  page,
}) => {
  // This used to be a test about a slow response for a filter the reader had
  // already left, held open with a route interceptor. That race is gone: a
  // filter change issues no request at all, so there is no late answer that
  // could arrive and repaint a newer screen.
  //
  // What remains worth holding is the property that race was threatening —
  // that the reader never sees the page go blank between two filters. It is
  // now true by construction rather than by a placeholder callback, and true
  // even on a connection that has died, because nothing is being waited on.
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("6");

  // Nothing may be served from here on. If a filter change needed the source,
  // every assertion below would hang rather than quietly pass.
  await page.route("**/fixtures/dashboard.json", (route) => route.abort());

  const apply = page.getByRole("button", { name: "تطبيق الفلاتر" });
  await page.getByLabel("الفيديو", { exact: true }).selectOption("video-1");
  await apply.click();
  await expect(page.getByTestId("total")).toHaveText("4");
  await expect(page.getByText("تعذر تحميل البيانات")).toBeHidden();

  await page.getByLabel("الفيديو", { exact: true }).selectOption("video-2");
  await apply.click();
  await expect(page.getByTestId("total")).toHaveText("2");

  await page.getByRole("button", { name: "إعادة ضبط الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("6");
  await expect(page.getByText("تعذر تحميل البيانات")).toBeHidden();
});

test("both pages come from one read, so they cannot disagree", async ({
  page,
}) => {
  // The previous version of this test shrank the fixture between page one and
  // page two and checked that the cursor recovered. Paging cannot reach that
  // state any more: it does not re-read, so the second page is drawn from the
  // same rows as the first and the two cannot come from different result sets.
  // The recovery itself still exists for the case that can still produce a
  // stale cursor — a re-read while the reader is on a later page — and is
  // tested against deriveSnapshot directly, in data.test.ts.
  await page.goto("/dashboard");
  await page.getByLabel("عدد التعليقات في الصفحة").selectOption("5");
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr'),
  ).toHaveCount(5);

  // The source is withdrawn. Paging must be unaffected, because it is a
  // question about rows that are already here.
  await page.route("**/fixtures/dashboard.json", (route) => route.abort());

  await page.getByRole("button", { name: "الصفحة التالية" }).click();
  await expect(page.getByTestId("page-state")).toContainText("الصفحة 2");
  await expect(page.getByTestId("total")).toHaveText("6");
  await expect(page.getByText("تعذر تحميل البيانات")).toBeHidden();

  await page.getByRole("button", { name: "الصفحة السابقة" }).click();
  await expect(page.getByTestId("page-state")).toContainText("الصفحة 1");
  await expect(
    page.locator('[data-testid="comments-table"] tbody tr'),
  ).toHaveCount(5);
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
  await page.goto("/sync?demo=1");
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
  await page.goto("/sync?demo=1");
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
  await page.goto("/sync?demo=1");
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
  await page.goto("/sync?demo=1");
  const panel = page.getByTestId("sync-panel");
  await expect(panel.getByTestId("sync-state")).toHaveAttribute(
    "data-severity",
    "critical",
  );
  await expect(panel).toContainText(
    "لم تُنفذ أي مزامنة بعد، والجمع متوقّف الآن",
  );
  // Disconnected collection must say what it means for freshness without
  // assuming a particular machine or deployment architecture.
  await expect(panel.getByTestId("sync-worker")).toContainText(
    "لن تُحدَّث البيانات حتى يعود",
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
  await page.goto("/sync?demo=1");
  const panel = page.getByTestId("sync-panel");
  await expect(panel.getByTestId("sync-state")).toHaveAttribute(
    "data-severity",
    "critical",
  );
  await expect(panel).toContainText("مهام منتظرة والجمع متوقّف");
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
  await page.goto("/sync?demo=1");
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
  await page.goto("/sync?demo=1");
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
  await page.goto("/sync?demo=1");
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

test("running text is set to a readable measure", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("table", { name: /التعليقات ضمن/ }),
  ).toBeVisible();
  // A line has a width past which the eye loses the return sweep; the
  // conventional band is 50-60 characters. Nothing capped these, and at a
  // 1204px desktop the section intros ran to 194 characters — three times
  // the top of the band, and the longest lines on the page were the ones
  // explaining how to read it.
  const wide = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(
      ".rp-sub, .rp-hero p, .rp-page .muted, .rp-page .rp-metric-note",
    )) {
      const text = (el.textContent ?? "").trim();
      if (text.length < 90) continue;
      const cs = getComputedStyle(el);
      // Measure in the font's own ch, which is what the cap is written in.
      const probe = document.createElement("span");
      probe.style.cssText = `position:absolute;visibility:hidden;font:${cs.font}`;
      probe.textContent = "0";
      el.appendChild(probe);
      const ch = probe.getBoundingClientRect().width;
      probe.remove();
      const chars = el.getBoundingClientRect().width / ch;
      if (chars > 70)
        out.push({ chars: Math.round(chars), t: text.slice(0, 30) });
    }
    return out;
  });
  expect(wide).toEqual([]);
});

test("a figure and a sentence each keep their own face", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("table", { name: /التعليقات ضمن/ }),
  ).toBeVisible();
  const first = (v: string) => v.split(",")[0].replace(/["']/g, "").trim();
  const seen = await page.evaluate(() => {
    const fam = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).fontFamily : null;
    };
    return {
      figure: fam(".rp-metric-value"),
      sentence: fam(".rp-sub"),
      heading: fam(".rp-section h2"),
    };
  });
  // Two families with two jobs. The split used to happen by accident — one
  // orphan rule, plus `tabular-nums` sending the browser hunting the stack for
  // a face with a tnum table — so it landed on a different set of elements
  // than anyone had chosen, and nothing said why.
  expect(first(seen.figure!)).toBe("Readex Pro");
  expect(first(seen.sentence!)).toBe("Audience Arabic");
  expect(first(seen.heading!)).toBe("Audience Arabic");
});

test("the two pinned panes stack instead of hiding one another", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const index = page.locator(".rp-nav");
  await expect(index).toBeVisible();
  await page.evaluate(() =>
    window.scrollTo({ top: 1400, behavior: "instant" }),
  );
  // The report's index is pinned, and whatever chrome stands above or beside
  // it must not cover it. When the chrome was a band across the top, both were
  // pinned to 0 and the index was the one that disappeared. The rail is a
  // column now, so the index should reach the very top of the viewport — an
  // offset left over from the old header would leave a gap with nothing in it.
  const boxes = await page.evaluate(() => {
    const r = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect() : null;
    };
    const h = r(".app-rail")!;
    const n = r(".rp-nav")!;
    return {
      navTop: n.top,
      navBottom: n.bottom,
      railOverlapsNav: h.right > n.left && h.left < n.right,
    };
  });
  // The index is at the top of the viewport, and the rail beside it does not
  // overlap it horizontally.
  expect(boxes.navTop).toBeLessThan(40);
  expect(boxes.navBottom).toBeLessThan(400);
  expect(boxes.railOverlapsNav).toBe(false);
});

test("every pane keeps a solid the reader can fall back to", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("table", { name: /التعليقات ضمن/ }),
  ).toBeVisible();
  // Glass is a lens, so the text on it has no fixed contrast unless the pane
  // itself carries enough of its own colour. Where backdrop-filter is off —
  // Reduce Transparency, an older engine — that solid is the entire surface.
  const thin = await page.evaluate(() => {
    const out: { sel: string; alpha: number }[] = [];
    // The rail is not on this list: it is an opaque dark plane by design, not
    // a pane you can see through, so it has no tint alpha to keep above a
    // floor. Only the translucent surfaces are checked.
    for (const sel of [".rp-card", ".rp-nav", ".review"]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const parts = m[1]
        .split(/[,\s/]+/)
        .filter(Boolean)
        .map(Number);
      const alpha = parts.length > 3 ? parts[3] : 1;
      if (alpha < 0.6) out.push({ sel, alpha });
    }
    return out;
  });
  expect(thin).toEqual([]);
});

test("the report says what it is narrowed to, wherever you have read to", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const summary = page.getByTestId("active-filters");
  await expect(summary).toBeHidden();

  await page.getByLabel("الفيديو", { exact: true }).selectOption("video-2");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("2");

  // Ten controls can be set and forgotten, and every figure on the page is
  // quietly conditional on them. A narrowed report read as a whole one is not
  // a smaller answer, it is a wrong one — so the condition travels with the
  // one bar that stays on screen.
  await expect(summary).toContainText("مُصفّى");
  await expect(summary).toContainText("فيديو محدَّد");

  // And it is still there after the filter panel is long out of view.
  await page.evaluate(() =>
    window.scrollTo({ top: 2500, behavior: "instant" }),
  );
  await expect(summary).toBeInViewport();

  await summary.getByRole("button", { name: "اعرض الكل" }).click();
  await expect(page.getByTestId("total")).toHaveText("6");
  await expect(summary).toBeHidden();
});

test("escape leaves the correction overlay", async ({ page }) => {
  await page.goto("/dashboard");
  const row = page.locator('[data-testid="comments-table"] tbody tr').first();
  const trigger = row.getByRole("button", { name: "تصحيح" });
  await trigger.click();
  const form = page.getByRole("form", { name: "تصحيح التصنيف" });
  await expect(form).toBeVisible();

  // The form takes focus and sits above the page. An overlay that can only be
  // left by finding its cancel button is a trap for exactly the reader who
  // cannot see where that button is.
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("the export sits above the table it exports", async ({ page }) => {
  await page.goto("/dashboard");
  const table = page.locator('[data-testid="comments-table"] table');
  await expect(table).toBeVisible();
  // It exports the whole filtered set, not the page on screen — so the reader
  // needs to know it exists before they start scrolling rows, not after. A
  // control found only at the end is a control found after it was needed.
  const order = await page.evaluate(() => {
    const ex = document.querySelector(".export")!;
    const tb = document.querySelector('[data-testid="comments-table"] table')!;
    return {
      exportTop: ex.getBoundingClientRect().top + window.scrollY,
      tableTop: tb.getBoundingClientRect().top + window.scrollY,
      // Node.DOCUMENT_POSITION_FOLLOWING — the export precedes the table.
      precedes: !!(ex.compareDocumentPosition(tb) & 4),
    };
  });
  expect(order.precedes).toBe(true);
  expect(order.exportTop).toBeLessThan(order.tableTop);
});

test("the operations page does not simulate a broken machine for a stranger", async ({
  page,
}) => {
  await page.goto("/sync");
  const state = page.getByTestId("sync-signed-out");
  await expect(state).toBeVisible();
  await expect(state).toContainText("تتبع تشغيل قناتك");

  // It used to render the fixture's operating state to anyone who arrived: a
  // red line saying no sync had run and no worker was connected, and an amber
  // one saying a plan was at 74% — about a machine that is not theirs and is
  // not in trouble. An operations page answers a question only an owner has.
  await expect(page.getByTestId("sync-panel")).toHaveCount(0);
  await expect(page.getByTestId("plan-panel")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("لم تُنفَّذ أي مزامنة");
  await expect(page.locator("body")).not.toContainText("اقترب الاستهلاك");

  // And it offers both ways on: the one that makes the page real, and the one
  // and an explicit door to the demo — which stays reachable, because the
  // fixture operations page is the only surface the guarantees above can be
  // tested on without a live account. Ten tests in this file run on it.
  await expect(
    state.getByRole("link", { name: /سجّل الدخول/ }),
  ).toHaveAttribute("href", "/account");
  const demo = state.getByRole("link", { name: /كيف تبدو هذه الصفحة/ });
  await expect(demo).toHaveAttribute("href", "/sync?demo=1");
  await demo.click();
  await expect(page.getByTestId("sync-panel")).toBeVisible();
  await expect(page.getByTestId("sync-signed-out")).toHaveCount(0);
});

test("a budget bar shows the state its sentence reports", async ({ page }) => {
  await page.goto("/sync?demo=1");
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
  await page.goto("/sync?demo=1");
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

test("filtering does not re-read the source it cannot change", async ({
  page,
}) => {
  // The read takes a workspace and nothing else: `dashboard_snapshot(w)` has
  // one argument, and every filter on this page is applied afterwards, in the
  // browser, to the rows it returned. So a filter change cannot make the
  // request return anything different — and until this test existed, it
  // re-issued it anyway, because the query was keyed on the whole filter
  // object rather than on what the request depends on.
  //
  // On the fixture that is a local file and invisible. On a real account it is
  // the entire comment history: 611KB measured on a 376-comment channel, once
  // per filter change, six of them visible in one operator's network log. Each
  // is an independent chance to fail, and a failure does not degrade the
  // screen — it empties it, because every figure, every chart and the video
  // dropdown itself are read from that one response.
  let reads = 0;
  await page.route("**/fixtures/dashboard.json", async (route) => {
    reads++;
    await route.continue();
  });
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("6");
  const afterLoad = reads;
  expect(afterLoad).toBeGreaterThan(0);

  const apply = page.getByRole("button", { name: "تطبيق الفلاتر" });
  await page.getByLabel("الفيديو", { exact: true }).selectOption("video-2");
  await apply.click();
  await expect(page.getByTestId("total")).toHaveText("2");

  await page.getByLabel("المشاعر").selectOption("positive");
  await apply.click();
  await expect(page.getByTestId("active-filters")).toContainText("المشاعر");

  await page.getByRole("button", { name: "إعادة ضبط الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("6");

  // Three filter changes, no further reads. The source is the same bytes for
  // all of them.
  expect(reads).toBe(afterLoad);
});

test("drilling into a video from the comparison filters to it", async ({
  page,
}) => {
  // The path the operator actually took, and the one no test covered: the
  // video is chosen by clicking it in the comparison section rather than from
  // the dropdown in the filter form. The two wrote different filter objects —
  // `video_ids` from the form, `video_id` from the card — and only one of
  // those names exists in the contract, which is `.strict()`.
  //
  // So the click produced an unrecognised key at the root of the filters and
  // every figure on the page disappeared behind "وصلت بياناتك، لكن تعذّر
  // تطبيق الفلاتر عليها". Retrying could not help: the filters are state, and
  // re-deriving them throws again.
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("6");

  const card = page.getByTestId("rp-video-video-2");
  await card.scrollIntoViewIfNeeded();
  await card.click();

  await expect(page.getByTestId("load-error")).toBeHidden();
  await expect(page.getByTestId("total")).toHaveText("2");
  await expect(page.getByTestId("active-filters")).toContainText(
    "فيديو محدَّد",
  );
  await expect(card).toHaveAttribute("aria-pressed", "true");

  // Clicking it again clears the filter rather than leaving a key behind.
  await card.click();
  await expect(page.getByTestId("load-error")).toBeHidden();
  await expect(page.getByTestId("total")).toHaveText("6");
  await expect(card).toHaveAttribute("aria-pressed", "false");
});

// ---- the catalogue on the operations page (selective video sync) ----

test("the catalogue narrows by search and kind, and prices a selection live", async ({
  page,
}) => {
  await page.goto("/sync?demo=1");
  const cat = page.getByTestId("catalogue");
  await expect(cat.getByTestId(/^cat-row-/)).toHaveCount(5);
  await page.getByTestId("cat-search").fill("بث");
  await expect(cat.getByTestId(/^cat-row-/)).toHaveCount(1);
  // "Select the view" ticks what is shown — the one stream — and nothing else.
  await page.getByTestId("cat-select-page").click();
  await expect(page.getByTestId("cat-check-video-3")).toBeChecked();
  await page.getByTestId("cat-search").fill("");
  await expect(cat.getByTestId(/^cat-row-/)).toHaveCount(5);
  await expect(page.getByTestId("cat-check-video-4")).not.toBeChecked();
  await expect(page.getByTestId("cat-check-video-5")).not.toBeChecked();
  // Clear means clear: the two stored selections come off too, and saving
  // that would remove them, so the button is live.
  await page.getByTestId("cat-clear").click();
  for (const id of ["video-1", "video-2", "video-3", "video-4", "video-5"])
    await expect(page.getByTestId(`cat-check-${id}`)).not.toBeChecked();
  await expect(page.getByTestId("cat-save")).toBeEnabled();
  // With the stored two off, nothing is owed: the whole remainder is free.
  await expect(page.getByTestId("cat-estimate")).toContainText("حتى 0 تعليقًا");
  await expect(page.getByTestId("cat-estimate")).toContainText(
    "يتبقى بعدها 26",
  );
  // Back to what is stored, then narrow by kind.
  await page.getByTestId("cat-check-video-1").check();
  await page.getByTestId("cat-check-video-2").check();
  await expect(page.getByTestId("cat-save")).toBeDisabled();
  // The stored selections still owe what YouTube reports beyond what is
  // stored — video-1 7 of 5, video-2 3 of 2 — and the bar counts that
  // before anything new is ticked: 3 outstanding of the 26 remaining.
  await expect(page.getByTestId("cat-estimate")).toContainText(
    "المحدد: 2 فيديو · حتى 3 تعليقًا",
  );
  await expect(page.getByTestId("cat-estimate")).toContainText(
    "يتبقى بعدها 23",
  );
  await page.getByTestId("cat-kind-short").click();
  await expect(cat.getByTestId(/^cat-row-/)).toHaveCount(1);
  await page.getByTestId("cat-kind-all").click();
  // 26 units remain in the fixture plan; video-3 reports 18 and holds none,
  // on top of the 3 outstanding.
  await page.getByTestId("cat-check-video-3").check();
  await expect(page.getByTestId("cat-estimate")).toContainText(
    "حتى 21 تعليقًا",
  );
  await expect(page.getByTestId("cat-estimate")).toContainText("يتبقى بعدها 5");
  await page.getByTestId("cat-check-video-5").check();
  await expect(page.getByTestId("cat-estimate")).toContainText(
    "و1 بعدد غير معروف",
  );
  await expect(page.getByTestId("cat-save")).toBeEnabled();
});

test("the catalogue stops at the quota and says why", async ({ page }) => {
  await page.route("**/fixtures/dashboard.json", async (route) => {
    const fixture = await (await route.fetch()).json();
    fixture.plan.budgets[0] = {
      event_type: "comment_analysis",
      used: 90,
      allowance: 100,
      remaining: 10,
    };
    await route.fulfill({ json: fixture });
  });
  await page.goto("/sync?demo=1");
  await page.getByTestId("cat-check-video-3").check();
  await expect(page.getByTestId("cat-save")).toBeDisabled();
  await expect(page.getByTestId("cat-estimate")).toContainText(
    "يتجاوز ما تبقى",
  );
  await page.getByTestId("cat-fit").click();
  // Nothing fits 10 units (video-3 is 18, the rest are selected, off, or unknown).
  await expect(page.getByTestId("cat-check-video-3")).not.toBeChecked();
});

test("a disabled video cannot be selected and says so", async ({ page }) => {
  await page.goto("/sync?demo=1");
  await expect(page.getByTestId("cat-check-video-4")).toBeDisabled();
  await expect(page.getByTestId("cat-state-video-4")).toHaveText(
    "تعليقات معطّلة",
  );
  await expect(page.getByTestId("cat-state-video-1")).toContainText("جُمع 5");
});

test("at phone width the selection bar stays reachable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/sync?demo=1");
  await page.getByTestId("cat-check-video-3").check();
  const bar = page.getByTestId("cat-estimate");
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(700);
  // The same rule as "no Arabic label is letter-spaced" above, on the one
  // section that is new: positive tracking pulls Arabic joins apart. The
  // section heading inherits `.rp-section h2`'s -0.01em like every heading
  // on the page, which tightens by a fifth of a pixel and closes nothing —
  // so, as there, only positive tracking counts.
  const spacing = await page
    .getByTestId("catalogue")
    .evaluate((el) =>
      [...el.querySelectorAll("*")]
        .map((n) => getComputedStyle(n).letterSpacing)
        .filter((v) => v !== "normal" && parseFloat(v) > 0),
    );
  expect(spacing).toEqual([]);
});

test("the catalogue is paged by fifty, and the selection is not", async ({
  page,
}) => {
  // The pilot channel catalogued 4,456 videos; one list of them is a slow
  // paint on a phone. 120 here: three pages, the last one short.
  await page.route("**/fixtures/catalogue.json", async (route) => {
    const fixture = await (await route.fetch()).json();
    fixture.videos = Array.from({ length: 120 }, (_, i) => ({
      id: `video-${i + 1}`,
      external_video_id: String(i + 1).padStart(11, "0"),
      title: `فيديو رقم ${i + 1}`,
      kind: i % 7 === 0 ? "short" : "video",
      published_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      thumbnail_url: null,
      reported_comment_count: 1,
      comments_state: "open",
    }));
    fixture.selections = [];
    await route.fulfill({ json: fixture });
  });
  await page.goto("/sync?demo=1");
  const cat = page.getByTestId("catalogue");
  await expect(cat.getByTestId(/^cat-row-/)).toHaveCount(50);
  await expect(page.getByTestId("cat-page")).toHaveText("الصفحة 1 من 3");
  await expect(page.getByTestId("cat-prev")).toBeDisabled();
  // Newest first: the last video of the run is on the first page.
  await expect(page.getByTestId("cat-row-video-120")).toBeVisible();
  // A tick on page one survives a page change and still counts.
  await page.getByTestId("cat-check-video-120").check();
  await page.getByTestId("cat-next").click();
  await expect(page.getByTestId("cat-page")).toHaveText("الصفحة 2 من 3");
  await expect(cat.getByTestId(/^cat-row-/)).toHaveCount(50);
  await expect(page.getByTestId("cat-row-video-120")).toHaveCount(0);
  await expect(page.getByTestId("cat-estimate")).toContainText(
    "المحدد: 1 فيديو",
  );
  await page.getByTestId("cat-jump").fill("3");
  await expect(page.getByTestId("cat-page")).toHaveText("الصفحة 3 من 3");
  await expect(cat.getByTestId(/^cat-row-/)).toHaveCount(20);
  await expect(page.getByTestId("cat-next")).toBeDisabled();
  // "Select this page" is bounded by the page: 20 more, not 120.
  await page.getByTestId("cat-select-page").click();
  await expect(page.getByTestId("cat-estimate")).toContainText(
    "المحدد: 21 فيديو",
  );
  // A search goes back to page one of what matches.
  await page.getByTestId("cat-search").fill("رقم 11");
  await expect(page.getByTestId("cat-page")).toHaveText("الصفحة 1 من 1");
  // 11, 110–119: eleven titles carry "رقم 11".
  await expect(cat.getByTestId(/^cat-row-/)).toHaveCount(11);
});

test("each video links to YouTube and plays inside the page", async ({
  page,
}) => {
  await page.goto("/sync?demo=1");
  // A short goes to its own path; everything else to watch.
  await expect(page.getByTestId("cat-link-video-2")).toHaveAttribute(
    "href",
    "https://www.youtube.com/shorts/fixture0002",
  );
  await expect(page.getByTestId("cat-link-video-3")).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=fixture0003",
  );
  await expect(page.getByTestId("cat-link-video-3")).toHaveAttribute(
    "target",
    "_blank",
  );
  await expect(page.getByTestId("cat-link-video-3")).toHaveAttribute(
    "rel",
    /noopener/,
  );
  // Nothing is embedded until a video is opened.
  await expect(page.getByTestId("cat-preview-frame")).toHaveCount(0);
  await page.getByTestId("cat-open-video-3").click();
  const dialog = page.getByTestId("cat-preview");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(
    "بث اصطناعي ٣",
  );
  await expect(page.getByTestId("cat-preview-frame")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/fixture0003?autoplay=1&rel=0",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("cat-preview-frame")).toHaveCount(0);
  // The close button works too, and the ticks are untouched by watching.
  await page.getByTestId("cat-check-video-3").check();
  await page.getByTestId("cat-open-video-3").click();
  await page.getByTestId("cat-preview-close").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("cat-check-video-3")).toBeChecked();
});
