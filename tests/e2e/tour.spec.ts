import { test, expect, type Page } from "@playwright/test";

/**
 * The onboarding tour, driven end to end — see the design doc's "Testing"
 * and `.superpowers/sdd/2026-09-18-onboarding-tour/task-3-report.md`'s
 * notes for this file (wait for the step's progress text rather than
 * counting clicks; don't assert Radix's `data-side`).
 *
 * `playwright.config.ts` seeds every project's `storageState` with
 * `tour:v1=seen` so the welcome never blocks the rest of the suite; this
 * file opts back out with an empty `storageState` so the tour starts the
 * way a first-time reader meets it. `reducedMotion: "reduce"` skips the
 * veil's smooth `scrollIntoView`, so a step's card is already in its final
 * place once `tour-progress` reads the step's number.
 */
test.use({
  storageState: { cookies: [], origins: [] },
  reducedMotion: "reduce",
});

const KEY = "tour:v1";

const storedTour = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), KEY);

/** The one lit element at a step: carries `data-tour-active` and the
 *  step's own `data-tour` name — asserted together, so a wrong anchor
 *  fails here rather than passing on any lit element at all. */
const litAnchor = (page: Page, id: string) =>
  page.locator(`[data-tour="${id}"][data-tour-active]`);

const pathOf = (page: Page) => new URL(page.url()).pathname;

test("the full walk: welcome, all seven steps across three pages, finish, and replay", async ({
  page,
}) => {
  await page.goto("/dashboard?demo=1&tour=1");

  const welcome = page.getByTestId("tour-welcome");
  await expect(welcome).toBeVisible();
  await page.getByTestId("tour-start").click();

  const progress = page.getByTestId("tour-progress");
  const next = page.getByTestId("tour-next");

  // Step 1: the rail, on the page the tour started on.
  await expect(progress).toHaveText("1 من 7");
  await expect(litAnchor(page, "rail")).toBeVisible();
  expect(pathOf(page)).toBe("/dashboard");

  // Step 2: the first workspace card, on /account.
  await next.click();
  await expect(progress).toHaveText("2 من 7");
  await expect(page).toHaveURL(/\/account\?demo=1/);
  await expect(litAnchor(page, "workspace")).toBeVisible();

  // Step 3: that workspace's setup path, still on /account.
  await next.click();
  await expect(progress).toHaveText("3 من 7");
  expect(pathOf(page)).toBe("/account");
  await expect(litAnchor(page, "setup")).toBeVisible();

  // Step 4: the video catalogue, on /sync.
  await next.click();
  await expect(progress).toHaveText("4 من 7");
  await expect(page).toHaveURL(/\/sync\?demo=1/);
  await expect(litAnchor(page, "catalogue")).toBeVisible();

  // Step 5: the selection bar, still on /sync.
  await next.click();
  await expect(progress).toHaveText("5 من 7");
  expect(pathOf(page)).toBe("/sync");
  await expect(litAnchor(page, "selection")).toBeVisible();

  // Step 6: the filter bar, back on /dashboard.
  await next.click();
  await expect(progress).toHaveText("6 من 7");
  await expect(page).toHaveURL(/\/dashboard\?demo=1/);
  await expect(litAnchor(page, "filters")).toBeVisible();

  // Step 7: the section nav, still on /dashboard — the last step's button
  // reads «إنهاء», not «التالي».
  await next.click();
  await expect(progress).toHaveText("7 من 7");
  expect(pathOf(page)).toBe("/dashboard");
  await expect(litAnchor(page, "sections")).toBeVisible();
  await expect(next).toHaveText("إنهاء");

  await next.click();
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
  await expect.poll(() => storedTour(page)).toBe("seen");

  // A fresh visit no longer opens the welcome on its own.
  await page.goto("/dashboard?demo=1");
  await expect(page.getByTestId("tour-welcome")).toHaveCount(0);

  // The rail's replay button starts it again regardless of memory.
  await page.getByTestId("tour-replay").click();
  await expect(page.getByTestId("tour-welcome")).toBeVisible();
});

test("dismissing the auto-started welcome remembers, and it does not return on reload", async ({
  page,
}) => {
  await page.goto("/dashboard?demo=1");

  const welcome = page.getByTestId("tour-welcome");
  await expect(welcome).toBeVisible();
  await page.getByTestId("tour-later").click();
  await expect(welcome).toHaveCount(0);
  await expect.poll(() => storedTour(page)).toBe("dismissed");

  await page.reload();
  await expect(page.getByTestId("tour-welcome")).toHaveCount(0);
});

test("at 390×844 step 1 lights the rail menu button and the card fits the screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard?demo=1&tour=1");

  await expect(page.getByTestId("tour-welcome")).toBeVisible();
  await page.getByTestId("tour-start").click();

  await expect(page.getByTestId("tour-progress")).toHaveText("1 من 7");
  await expect(litAnchor(page, "rail-menu")).toBeVisible();

  const box = await page.getByTestId("tour-card").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(358);
  expect(box!.x).toBeGreaterThanOrEqual(0);

  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(scrollWidth).toBeLessThanOrEqual(390);
});

test("Escape on step 3 ends the tour as seen, with no card left open", async ({
  page,
}) => {
  await page.goto("/dashboard?demo=1&tour=1");

  await expect(page.getByTestId("tour-welcome")).toBeVisible();
  await page.getByTestId("tour-start").click();

  const progress = page.getByTestId("tour-progress");
  const next = page.getByTestId("tour-next");
  await expect(progress).toHaveText("1 من 7");
  await next.click();
  await expect(progress).toHaveText("2 من 7");
  await next.click();
  await expect(progress).toHaveText("3 من 7");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
  await expect.poll(() => storedTour(page)).toBe("seen");
});
