import { test } from "node:test";
import assert from "node:assert/strict";
import { violations, expectedBranch } from "./check-ownership.mjs";

test("worker writes only Python and its own report", () => {
  assert.deepEqual(
    violations("worker", [
      "workers/python/src/a.py",
      "workers/python/uv.lock",
      "docs/agent-reports/worker.md",
    ]),
    [],
  );
  assert.deepEqual(
    violations("worker", [
      "apps/web/src/a.tsx",
      "docs/progress.md",
      "packages/contracts/src/index.ts",
    ]),
    [
      "apps/web/src/a.tsx",
      "docs/progress.md",
      "packages/contracts/src/index.ts",
    ],
  );
});
test("platform owns UI/SQL/browser tests but not shared dependency files", () => {
  assert.deepEqual(
    violations("platform", [
      "apps/web/src/a.tsx",
      "supabase/migrations/new.sql",
      "tests/e2e/test.ts",
    ]),
    [],
  );
  assert.deepEqual(
    violations("platform", [
      "apps/web/package.json",
      "package-lock.json",
      "workers/python/test.py",
      "docs/agent-reports/worker.md",
    ]),
    [
      "apps/web/package.json",
      "package-lock.json",
      "workers/python/test.py",
      "docs/agent-reports/worker.md",
    ],
  );
});
test("unknown lanes fail closed, integration has explicit ownership, and lane branches are distinct", () => {
  assert.throws(() => violations("typo", ["a"]), /Unknown lane/);
  assert.deepEqual(
    violations("integration", ["packages/contracts/src/index.ts"]),
    [],
  );
  assert.equal(expectedBranch("worker"), "codex/agent-a-worker");
  assert.notEqual(expectedBranch("worker"), expectedBranch("platform"));
});
