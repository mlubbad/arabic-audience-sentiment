import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Each lane drives its own dev server. Never adopt one that is already
// listening: a server left running by another worktree serves that lane's code,
// so the suite would pass or fail against the wrong build while looking healthy.
const port = Number(process.env.E2E_PORT ?? 5173);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: origin, viewport: { width: 1280, height: 800 } },
  webServer: {
    // One npm layer on purpose: `npm run dev -- --port X` does not forward the
    // flag, because the root dev script is itself an npm run and npm consumes
    // it. --strictPort makes Vite exit on an occupied port instead of quietly
    // moving to another one.
    command: `npm run dev -w @sentiment/web -- --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: false,
    // The suite decides how the app is configured, rather than inheriting it.
    // tests/e2e holds no .env files, so pointing Vite's envDir there means
    // apps/web/.env.local is not read and these tests describe fixture mode on
    // every machine. A developer with a live project configured used to fail
    // one test here, which made the result a property of the laptop.
    env: {
      VITE_ENV_DIR: resolve("tests/e2e"),
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_PUBLISHABLE_KEY: "",
      VITE_DASHBOARD_SOURCE: "",
    },
  },
  reporter: "list",
});
