import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * The operator's page, driven on its demo (`/admin?demo=1`): six fixture
 * workspaces in local state, every lever replayed through `reduceAdminDemo`,
 * which refuses exactly what the migrations refuse and in the same shape —
 * so the sentence a row says here is the sentence the live page would say.
 *
 * The forbidden path (`/admin` without `?demo`) stays in `app-shell.spec.ts`;
 * this file drives the page behind the door.
 */

/** Fixture ids: `public/fixtures/admin.json`, rows 1–6 in order. */
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const row = (page: Page, n: number) => page.getByTestId(`admin-row-${id(n)}`);
const rows = (page: Page) => page.getByTestId(/^admin-row-/);

/** Choose an option in a ui/Select (Radix): open the labelled trigger, pick
 *  the option by its visible text. `dashboard.spec.ts` carries the same
 *  helper for a page with one select per label; here every row has its own
 *  "اختر خطة", so the trigger is found inside the row. The options portal to
 *  `document.body`, hence read from the page. */
async function pick(
  page: Page,
  within: Locator,
  label: string,
  option: string,
) {
  await within.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** The plan value on a wide-table row: the first `<td>` after the row's
 *  `<th scope="row">`. */
const planCell = (r: Locator) => r.getByRole("cell").first();

const DONE = "تم التنفيذ.";
const PADDLE_ACTIVE = "المساحة على اشتراك Paddle نشط؛ فعّل التجاوز لتغييره";
const BILLING_ROOT =
  "مساحات أخرى تُفوتر تحت هذه المساحة؛ لا يمكن حذفها ما دامت جذرًا للفوترة.";

test.beforeEach(async ({ page }) => {
  await page.goto("/admin?demo=1");
  await expect(rows(page)).toHaveCount(6);
});

test("the demo opens on six workspaces under the operator's head", async ({
  page,
}) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "إدارة المنصة",
  );
  await expect(page.locator(".db-hero")).toContainText("مثال توضيحي");
  await expect(page.getByTestId("admin-workspaces")).toBeVisible();
  // The table, not the cards: the row is a <tbody> here.
  await expect(page.getByTestId("admin-workspaces")).toHaveJSProperty(
    "tagName",
    "TABLE",
  );
  await expect(row(page, 2)).toContainText("قناة ريم للطبخ");
  await expect(planCell(row(page, 2))).toHaveText("creator_plus");
  await expect(row(page, 6)).toContainText("لا خطة");
});

test("setting a plan changes the row's plan cell and says so in the row", async ({
  page,
}) => {
  const r = row(page, 2);
  await pick(page, r, "اختر خطة", "وكالة");
  const form = r.getByTestId("admin-plan-form");
  await form.getByRole("button", { name: "تعيين الخطة" }).click();
  await expect(form.getByRole("status")).toHaveText(DONE);
  await expect(planCell(r)).toHaveText("agency");
  // The reducer marks the row admin-provided and active.
  await expect(r).toContainText("admin");
  // The other rows did not move.
  await expect(planCell(row(page, 1))).toHaveText("enterprise");
  await expect(rows(page)).toHaveCount(6);
});

test("a workspace on an active Paddle subscription refuses a plan until override is ticked", async ({
  page,
}) => {
  const r = row(page, 3);
  const form = r.getByTestId("admin-plan-form");
  await pick(page, r, "اختر خطة", "ميديا");
  await form.getByRole("button", { name: "تعيين الخطة" }).click();
  await expect(form.getByRole("status")).toHaveText(PADDLE_ACTIVE);
  await expect(planCell(r)).toHaveText("agency");

  await form
    .getByRole("checkbox", { name: "تجاوز اشتراك Paddle النشط" })
    .click();
  await form.getByRole("button", { name: "تعيين الخطة" }).click();
  await expect(form.getByRole("status")).toHaveText(DONE);
  await expect(planCell(r)).toHaveText("media");
  // Overridden, not moved off Paddle: the provider stays.
  await expect(r).toContainText("paddle");
});

test("a pack lands on an active plan and is refused where there is none", async ({
  page,
}) => {
  const grant = async (n: number) => {
    const form = row(page, n).getByTestId("admin-pack-form");
    const units = form.getByLabel("الوحدات", { exact: true });
    await units.fill("2500");
    await form.getByLabel("ملاحظة", { exact: true }).fill(`حزمة ${n}`);
    await form.getByRole("button", { name: "منح حزمة" }).click();
    return form.getByRole("status");
  };
  // Row 5 is on the free plan, active: the pack attaches.
  await expect(await grant(5)).toHaveText(DONE);
  // Row 6 never had a plan: grant_units refuses, named by its code.
  await expect(await grant(6)).toHaveText("تعذّر التنفيذ: no_active_plan");
  await expect(rows(page)).toHaveCount(6);
});

test("the pack form waits for a note: the note is the grant's idempotency key", async ({
  page,
}) => {
  const form = row(page, 5).getByTestId("admin-pack-form");
  await expect(form.getByRole("button", { name: "منح حزمة" })).toBeDisabled();
  await form.getByLabel("ملاحظة", { exact: true }).fill("x");
  await expect(form.getByRole("button", { name: "منح حزمة" })).toBeEnabled();
});

test("delete asks for the name typed back, refuses the billing root, and removes a free row", async ({
  page,
}) => {
  const openDelete = async (n: number, name: string) => {
    await row(page, n).getByRole("button", { name: "حذف نهائي" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`حذف «${name}» نهائيًا`);
    const confirm = dialog.getByRole("button", { name: "احذف نهائيًا" });
    // The footprint is counted first; the button waits on the name.
    await expect(dialog).not.toContainText("جارٍ عدّ ما سيُحذف…");
    await expect(confirm).toBeDisabled();
    await dialog
      .getByLabel(`اكتب اسم المساحة «${name}» لتأكيد الحذف`)
      .fill(name);
    await expect(confirm).toBeEnabled();
    return { dialog, confirm };
  };

  // Row 1 is the billing root: counted (the demo sizes the figures by the
  // row), then refused with the migration's own sentence.
  const first = await openDelete(1, "مساحة العمل الشخصية");
  await expect(first.dialog).toContainText("1 قناة · 12 فيديو");
  await first.confirm.click();
  await expect(first.dialog.getByRole("alert")).toHaveText(BILLING_ROOT);
  await expect(rows(page)).toHaveCount(6);
  await first.dialog.getByRole("button", { name: "إلغاء" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Row 6 has no plan and no billing: it goes, and the table is five.
  const sixth = await openDelete(6, "مساحة بلا خطة");
  await expect(sixth.dialog).toContainText("0 قناة · 0 فيديو");
  await sixth.confirm.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, 6)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(5);
});

test("at 390px the six rows are six cards and nothing scrolls sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(rows(page)).toHaveCount(6);
  await expect(page.getByTestId("admin-workspaces")).toHaveJSProperty(
    "tagName",
    "DIV",
  );
  await expect(row(page, 2)).toContainText("قناة ريم للطبخ");
  // The card's levers are the same forms.
  await expect(row(page, 2).getByTestId("admin-plan-form")).toBeVisible();
  await expect(row(page, 2).getByTestId("admin-pack-form")).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test("navigates to users tab and tests user impersonation with escape hatch", async ({
  page,
}) => {
  await page.getByRole("link", { name: "المستخدمون" }).click();
  await expect(page).toHaveURL(/\/admin\/users\?demo=1/);

  // Users table is rendered
  await expect(page.getByTestId("admin-users")).toBeVisible();

  // Screenshot 1: Admin Users page with "حسابك الحالي" and "الدخول كـ" buttons
  await page.screenshot({
    path: "/Users/muhammed/.gemini/antigravity/brain/50d99fb8-09d4-4479-934d-83a629ce042c/ui-admin-users.png",
    fullPage: true,
  });

  // Current admin row has "(حسابك الحالي)"
  await expect(page.getByTestId("admin-user-current")).toBeVisible();
  await expect(page.getByTestId("admin-user-current")).toHaveText(
    "(حسابك الحالي)",
  );

  // Client users have "الدخول كـ" buttons
  const impersonateBtn = page.getByTestId(
    "admin-impersonate-00000000-0000-4000-8000-0000000000c2",
  );
  await expect(impersonateBtn).toBeVisible();

  // Click impersonate on client (reem@cooking.example)
  await impersonateBtn.click();

  // Impersonation banner is visible with user info
  const banner = page.getByTestId("impersonation-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("reem@cooking.example");

  // Screenshot 2: Active Impersonation state with banner and escape hatch
  await page.screenshot({
    path: "/Users/muhammed/.gemini/antigravity/brain/50d99fb8-09d4-4479-934d-83a629ce042c/ui-impersonating-user.png",
    fullPage: true,
  });

  // Exit button works to return to admin
  const exitBtn = page.getByTestId("impersonation-return-btn");
  await expect(exitBtn).toBeVisible();
  await exitBtn.click();

  // Banner disappears after exit
  await expect(banner).toHaveCount(0);
});
