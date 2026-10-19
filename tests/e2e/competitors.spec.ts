import { expect, test } from "@playwright/test";

test("competitors route explains fixture mode in Arabic and English", async ({
  page,
}) => {
  await page.goto("/competitors");
  await expect(
    page.getByText("سجّل الدخول واربط قناة لعرض المنافسين"),
  ).toBeVisible();
  await page.goto("/en/competitors");
  await expect(
    page.getByText("Sign in and connect a channel to see competitors"),
  ).toBeVisible();
});
