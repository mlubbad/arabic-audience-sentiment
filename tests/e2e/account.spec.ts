import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * The signed-in account page, driven on its demo (`/account?demo=1`): three
 * fixture workspaces in local state, every door replayed through
 * `reduceAccountDemo`, which refuses exactly what the migrations refuse and
 * in the same shape — so the sentence a card says here is the sentence the
 * live page would say.
 *
 * `AuthEntry`'s only coverage is `Account.entry.test.ts` (static markup
 * against a mocked client) — the e2e build has no Supabase client, so
 * `/account` here never reaches it; `app-shell.spec.ts` exercises the same
 * no-client build and finds `Unavailable`, not `AuthEntry`. This file
 * drives the page behind the session, plus the one test that keeps the
 * demo gate honest — `/account` with no `?demo` on this build shows
 * `Unavailable` instead.
 */

/** Fixture ids: `public/fixtures/account.json`, three rows «a1..a3». */
const id = (n: 1 | 2 | 3) => `00000000-0000-4000-8000-0000000000a${n}`;

/** The workspaces list: `ul.db-ws-list > li`, one `Card` per row. */
const cards = (page: Page) => page.locator("ul.db-ws-list > li");

/** One workspace's card, found by the `channel-<id>` test id it always
 *  carries (connected, needing relink, or none — the id never leaves the
 *  DOM the way a door does when a state stops offering it). */
const card = (page: Page, n: 1 | 2 | 3): Locator =>
  page
    .locator("ul.db-ws-list > li")
    .filter({ has: page.getByTestId(`channel-${id(n)}`) });

const CHANNEL_NONE = "لا توجد قناة مرتبطة بعد";
const RENAME_DONE = "تغيّر الاسم.";
const DISCONNECT_DONE = "فُصلت القناة؛ لن تُقرأ حتى تُربط من جديد.";
const RETIRE_LAST = "لا يمكن إنهاء آخر مساحة لك؛ أنشئ أخرى أولًا.";
const CREATE_DONE = "تم إنشاء مساحة العمل";
const DEMO_EXTERNAL_NOTE =
  "هذا الإجراء يفتح خدمة خارجية ولا يعمل في النسخة التوضيحية.";
const WORKSPACE_NAME_LABEL = "اسم مساحة العمل";
const CREATE_WORKSPACE = "إنشاء مساحة عمل";

test.beforeEach(async ({ page }) => {
  await page.goto("/account?demo=1");
  await expect(cards(page)).toHaveCount(3);
});

test("the demo opens on the account head, three workspaces and the plan panel", async ({
  page,
}) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "الحساب ومساحات العمل",
  );
  await expect(page.locator(".db-hero")).toContainText("مثال توضيحي");
  await expect(page.getByTestId("account-demo-note")).toBeVisible();
  await expect(page.getByTestId("account-demo-note")).toContainText(
    "مثال توضيحي",
  );

  // The three cards, by name.
  await expect(card(page, 1)).toContainText("قناة سالم للتقنية");
  await expect(card(page, 2)).toContainText("مطبخ ريم");
  await expect(card(page, 3)).toContainText("عميل جديد");
  await expect(card(page, 3).getByTestId(`channel-${id(3)}`)).toHaveText(
    CHANNEL_NONE,
  );

  // The plan panel: the first workspace's three budgets, each a meter, and
  // the two doors a Paddle plan opens (manage, topup — no upgrade/contact).
  const panel = page.getByTestId("account-plan-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("قناة سالم للتقنية");
  await expect(panel.locator('li[data-testid^="plan-"]')).toHaveCount(3);
  await expect(panel.getByRole("progressbar")).toHaveCount(3);
  const manage = panel.locator('[data-action="manage"]');
  const topup = panel.locator('[data-action="topup"]');
  await expect(manage).toHaveText("إدارة الاشتراك");
  await expect(topup).toHaveText("إضافة 10,000 تعليق");
});

test("renaming a workspace updates its name and says so in the card", async ({
  page,
}) => {
  const r = card(page, 2);
  await r.getByTestId(`rename-${id(2)}`).click();
  const form = r.getByTestId(`rename-form-${id(2)}`);
  await expect(form).toBeVisible();
  await form.getByLabel(WORKSPACE_NAME_LABEL).fill("مطبخ ريم الجديد");
  await form.getByRole("button", { name: "حفظ الاسم" }).click();

  await expect(r.locator("h3")).toContainText("مطبخ ريم الجديد");
  await expect(r.getByRole("status")).toHaveText(RENAME_DONE);
  // The other cards did not move.
  await expect(cards(page)).toHaveCount(3);
});

test("disconnecting a channel asks first, then the card shows no channel", async ({
  page,
}) => {
  const r = card(page, 1);
  await r.getByTestId(`disconnect-${id(1)}`).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute(
    "data-testid",
    `disconnect-dialog-${id(1)}`,
  );

  await dialog.getByTestId(`disconnect-confirm-${id(1)}`).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(r.getByTestId(`channel-${id(1)}`)).toHaveText(CHANNEL_NONE);
  await expect(r.getByRole("status")).toHaveText(DISCONNECT_DONE);
});

test("retiring workspaces removes them until the last one refuses", async ({
  page,
}) => {
  // Third workspace goes: two cards left.
  await card(page, 3)
    .getByTestId(`retire-${id(3)}`)
    .click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId(`retire-confirm-${id(3)}`).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);

  // Second workspace goes: one card left.
  await card(page, 2)
    .getByTestId(`retire-${id(2)}`)
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId(`retire-confirm-${id(2)}`).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(cards(page)).toHaveCount(1);

  // The last workspace refuses: the reducer's own sentence, on the one
  // remaining card, which stays.
  const last = card(page, 1);
  await last.getByTestId(`retire-${id(1)}`).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId(`retire-confirm-${id(1)}`).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(last.getByRole("status")).toHaveText(RETIRE_LAST);
  await expect(cards(page)).toHaveCount(1);
});

test("creating a workspace adds a fourth card", async ({ page }) => {
  await page
    .getByLabel(WORKSPACE_NAME_LABEL, { exact: true })
    .fill("مساحة رابعة");
  await page.getByRole("button", { name: CREATE_WORKSPACE }).click();

  await expect(cards(page)).toHaveCount(4);
  await expect(cards(page).last()).toContainText("مساحة رابعة");
  await expect(page.getByRole("status").last()).toHaveText(CREATE_DONE);
});

test("pressing connect in the demo opens the external-service note instead of leaving", async ({
  page,
}) => {
  const r = card(page, 2);
  await r.getByTestId(`connect-${id(2)}`).click();

  await expect(r.getByRole("status")).toHaveText(DEMO_EXTERNAL_NOTE);
});

test("pressing top-up in the demo opens the external-service note instead of Paddle", async ({
  page,
}) => {
  const panel = page.getByTestId("account-plan-panel");
  await panel.locator('[data-action="topup"]').click();
  await expect(panel.getByRole("status")).toHaveText(DEMO_EXTERNAL_NOTE);
});

test("at 390px the three cards stack and nothing scrolls sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(cards(page)).toHaveCount(3);
  await expect(page.getByTestId("account-plan-panel")).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test("without ?demo the page says the account is unavailable, not the demo account", async ({
  page,
}) => {
  await page.goto("/account");
  await expect(page.getByTestId("account-unavailable")).toBeVisible();
  await expect(page.getByTestId("account-plan-panel")).toHaveCount(0);
});
