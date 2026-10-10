import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Each lane drives its own dev server. Never adopt one that is already
// listening: a server left running by another worktree serves that lane's code,
// so the suite would pass or fail against the wrong build while looking healthy.
const port = Number(process.env.E2E_PORT ?? 5173);
const origin = `http://127.0.0.1:${port}`;

// The built site, served by `vite preview`: what a visitor without JavaScript
// (or before the bundle lands) actually gets — the prerendered HTML and the
// entry's CSS. The dev server never shows that page, so a stylesheet that
// travelled with a lazy chunk (the pricing and legal pages', 2026-09-17) was
// invisible to every test above until it was served built.
//
// Opt-in, never by default: `npm run test:e2e:build` sets E2E_BUILD=1. The
// build writes `apps/web/dist` — in this suite's fixture mode — and
// scripts/deploy-preview.sh ships that directory as it finds it, so a default
// `npm run test:e2e` that rebuilt would leave a fixture build where the next
// deploy looks. With the variable unset, nothing here touches `dist`.
const withBuild = process.env.E2E_BUILD === "1";
const previewPort = 4175;
const previewOrigin = `http://127.0.0.1:${previewPort}`;

// The suite decides how the app is configured, rather than inheriting it.
// tests/e2e holds no .env files, so pointing Vite's envDir there means
// apps/web/.env.local is not read and these tests describe fixture mode on
// every machine. A developer with a live project configured used to fail
// one test here, which made the result a property of the laptop.
const env = {
  VITE_ENV_DIR: resolve("tests/e2e"),
  VITE_SUPABASE_URL: "",
  VITE_SUPABASE_PUBLISHABLE_KEY: "",
  VITE_DASHBOARD_SOURCE: "",
  // The e2e kernel, not the visitor's demo fixture — both webServer entries
  // share it, so the built-site suite (E2E_BUILD=1) reads the same data.
  VITE_FIXTURE_DASHBOARD: "/fixtures/e2e-dashboard.json",
};

// The onboarding tour opens its welcome dialog on the first visit to a
// signed-in or demo page that this browser has no memory of — which is every
// test's first visit, and the dialog would sit over whatever the test came to
// press. Every project therefore starts with the tour already "seen" in the
// origin's localStorage (`apps/web/src/tour/tourState.ts`, key `tour:v1`);
// the tour's own suite opts back out with `test.use({ storageState: ... })`.
const tourSeen = (forOrigin: string) => ({
  cookies: [],
  origins: [
    { origin: forOrigin, localStorage: [{ name: "tour:v1", value: "seen" }] },
  ],
});

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: origin,
    viewport: { width: 1280, height: 800 },
    storageState: tourSeen(origin),
    // CI points this at the runner's own Chrome (`PW_CHANNEL=chrome`) instead
    // of downloading Chromium on every run; unset, Playwright's Chromium.
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  projects: [
    {
      name: "default",
      testIgnore: /public-build\.spec\.ts/,
    },
    ...(withBuild
      ? [
          {
            name: "public-build",
            testMatch: /public-build\.spec\.ts/,
            use: {
              baseURL: previewOrigin,
              storageState: tourSeen(previewOrigin),
            },
          },
        ]
      : []),
  ],
  webServer: [
    {
      // One npm layer on purpose: `npm run dev -- --port X` does not forward
      // the flag, because the root dev script is itself an npm run and npm
      // consumes it. --strictPort makes Vite exit on an occupied port instead
      // of quietly moving to another one.
      command: `npm run dev -w @sentiment/web -- --port ${port} --strictPort`,
      url: origin,
      reuseExistingServer: false,
      env,
    },
    ...(withBuild
      ? [
          {
            // A full build (vite + prerender) then `vite preview` over
            // `dist`. The build is the slow part, hence the timeout.
            command: `npm run build -w @sentiment/web && npm run preview -w @sentiment/web -- --port ${previewPort} --strictPort`,
            url: previewOrigin,
            reuseExistingServer: false,
            env,
            timeout: 240_000,
          },
        ]
      : []),
  ],
  reporter: "list",
});
