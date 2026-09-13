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
  server: { host: "127.0.0.1", strictPort: true, port: 5173 },
});
