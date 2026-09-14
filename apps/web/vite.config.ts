import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwind()],
  // Where .env files are read from. The browser suite points this at a
  // directory holding none, so the app under test is configured by the suite
  // and not by whatever .env.local the developer happens to have. Without it a
  // configured Supabase project silently changes what the app renders, and a
  // test asserting the unconfigured notice fails on one machine and passes on
  // another — which is worse than failing everywhere.
  envDir: process.env.VITE_ENV_DIR || undefined,
  build: {
    // Not `assets`, and not a matter of taste. The preview host sits behind a
    // CDN this project has no purge credential for, and on 2026-09-15 every
    // URL under `assets/` was pinned at the edge to a `401` marked
    // `immutable` — a year-long cache entry that no request could dislodge,
    // because a content hash only changes when the content does. The bug that
    // caused it is fixed in public/.htaccess; this rename is how the build
    // that was already poisoned got a set of addresses that were not.
    //
    // It must stay in step with the sweep in scripts/deploy-preview.sh, which
    // deletes the previous build's files from this directory by name.
    assetsDir: "static",
  },
  server: { host: "127.0.0.1", strictPort: true, port: 5173 },
});
