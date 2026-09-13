import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Dedicated credential-free browser test for the signed-in UI boundary. The
// API origin is intercepted by the test; no external Supabase project is used.
const port = Number(process.env.E2E_LIVE_PORT ?? 5334);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/live",
  use: { baseURL: origin, viewport: { width: 1280, height: 800 } },
  webServer: {
    command: `npm run dev -w @sentiment/web -- --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: false,
    env: {
      VITE_ENV_DIR: resolve("tests/e2e"),
      VITE_SUPABASE_URL: "http://127.0.0.1:8765",
      VITE_SUPABASE_PUBLISHABLE_KEY: "local-test-publishable-key",
      VITE_DASHBOARD_SOURCE: "live",
    },
  },
  reporter: "list",
});
