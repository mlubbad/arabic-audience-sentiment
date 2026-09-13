import { defineConfig } from "@playwright/test";

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
  },
  reporter: "list",
});
