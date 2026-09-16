import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "supabase/tests/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 2,
    setupFiles: ["./vitest.setup.ts"],
  },
});
