import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const fixture = JSON.parse(
  readFileSync(
    new URL("../../apps/web/public/fixtures/dashboard.json", import.meta.url),
    "utf8",
  ),
);
const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization,apikey,x-client-info,content-type",
  "content-type": "application/json",
};
const jwt = [
  Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
  Buffer.from(
    JSON.stringify({
      sub: USER,
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url"),
  "local-test-signature",
].join(".");

function liveSnapshot(workspace: string) {
  const isA = workspace === A;
  return {
    ...fixture,
    mode: "live",
    revision: `local-${workspace}`,
    comments: fixture.comments
      .slice(0, 1)
      .map((comment: Record<string, unknown>) => ({
        ...comment,
        workspace_id: workspace,
        text_raw: isA ? "TENANT_A_PRIVATE_COMMENT" : "TENANT_B_OWN_COMMENT",
        video_title: isA ? "فيديو أ" : "فيديو ب",
      })),
  };
}

test("switching workspaces and signing out never paints the prior tenant's comments", async ({
  page,
}) => {
  let releaseB!: () => void;
  const pendingB = new Promise<void>((resolve) => {
    releaseB = resolve;
  });
  await page.route("http://127.0.0.1:8765/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (url.pathname === "/auth/v1/token")
      return route.fulfill({
        headers,
        json: {
          access_token: jwt,
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "local-refresh",
          user: {
            id: USER,
            aud: "authenticated",
            role: "authenticated",
            email: "pilot@example.invalid",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-09-01T00:00:00Z",
          },
        },
      });
    if (url.pathname === "/auth/v1/logout")
      return route.fulfill({ headers, json: {} });
    if (url.pathname === "/rest/v1/workspaces")
      return route.fulfill({
        headers,
        json: [
          { id: A, name: "مساحة أ" },
          { id: B, name: "مساحة ب" },
        ],
      });
    if (url.pathname === "/rest/v1/rpc/dashboard_snapshot") {
      const workspace = route.request().postDataJSON().w as string;
      if (workspace === B) await pendingB;
      return route.fulfill({ headers, json: liveSnapshot(workspace) });
    }
    return route.fulfill({ headers, json: [] });
  });

  await page.goto("/account");
  await page.getByLabel("البريد الإلكتروني").fill("pilot@example.invalid");
  await page.getByLabel("كلمة المرور").fill("local-test-password");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(
    page.getByRole("button", { name: "تسجيل الخروج" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "لوحة الاختبار" }).click();
  await page.getByTestId("ws-choose").getByLabel("مساحة العمل").selectOption(A);
  await expect(
    page.getByRole("cell", { name: "TENANT_A_PRIVATE_COMMENT" }),
  ).toBeVisible();

  await page.getByLabel("تغيير مساحة العمل").selectOption(B);
  await expect(page.getByText("TENANT_A_PRIVATE_COMMENT")).toHaveCount(0);
  await expect(page.getByTestId("source-scope")).toContainText("مساحة ب");
  releaseB();
  await expect(
    page.getByRole("cell", { name: "TENANT_B_OWN_COMMENT" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "الحساب ومساحات العمل" }).click();
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(
    page.getByRole("button", { name: "تسجيل الدخول" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "لوحة الاختبار" }).click();
  await expect(page.getByTestId("source")).toHaveAttribute(
    "data-mode",
    "sanitized_fixture",
  );
  await expect(page.getByText("TENANT_A_PRIVATE_COMMENT")).toHaveCount(0);
  await expect(page.getByText("TENANT_B_OWN_COMMENT")).toHaveCount(0);
});
