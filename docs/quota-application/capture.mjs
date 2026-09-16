// Captures the in-app evidence screens for the quota request from the live
// preview, signed in as the account whose session JSON is given, and writes
// them under docs/quota-application/evidence/. Run from the repository root:
//   node docs/quota-application/capture.mjs /path/to/session.json /path/to/auth.txt
// Google-hosted screens (the consent screen, myaccount.google.com/permissions)
// cannot be captured here; they need the owner's own Google sign-in.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const [sessionPath, authPath] = process.argv.slice(2);
const session = JSON.parse(readFileSync(sessionPath, "utf8"));
const [user, pass] = readFileSync(authPath, "utf8").trim().split("\n");
const origin = "https://app.sky-develop.net";
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 1440, height: 900 },
  httpCredentials: { username: user, password: pass },
  locale: "ar",
});
const p = await ctx.newPage();
await p.goto(`${origin}/`);
await p.evaluate((s) => {
  localStorage.setItem("sb-ykqugctewsqvevhyqtbi-auth-token", JSON.stringify(s));
  localStorage.setItem("locale", "ar");
  // The owner's personal workspace, so the catalogue and dashboard have a
  // channel to show rather than the chooser.
  localStorage.setItem(
    "audience.workspace",
    JSON.stringify({ user: s.user.id, id: "d0c3b9fc-b813-439e-a32b-71dd357f0bb4" }),
  );
}, session);
const shot = async (path, name) => {
  await p.goto(`${origin}${path}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `docs/quota-application/evidence/${name}.png`, fullPage: false });
  console.log(`captured ${name}`);
};
// 02 — the account page with the connected channel and its disconnect door open.
await p.goto(`${origin}/account`, { waitUntil: "networkidle" });
await p.waitForTimeout(3000);
const ask = p.locator('[data-testid^="disconnect-"]').first();
if (await ask.count()) {
  await ask.click();
  await p.waitForTimeout(500);
}
await p.screenshot({ path: "docs/quota-application/evidence/02-account-connected-disconnect.png" });
console.log("captured 02-account-connected-disconnect");
// 04 — the catalogue with reported comment counts and the plan's budget.
await shot("/sync", "04-catalogue-comment-counts");
// 05 — the dashboard summary.
await shot("/dashboard", "05-dashboard-summary");
// 06 — the comments table with sentiment labels.
await p.goto(`${origin}/dashboard`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
// The comments section, reached the way a reader reaches it: the in-page nav.
const link = p.getByRole("link", { name: "التعليقات", exact: true }).first();
if (await link.count()) await link.click();
await p.waitForTimeout(1200);
await p.screenshot({ path: "docs/quota-application/evidence/06-comments-table-labels.png" });
console.log("captured 06-comments-table-labels");
await p.evaluate(() => localStorage.removeItem("sb-ykqugctewsqvevhyqtbi-auth-token"));
await b.close();
