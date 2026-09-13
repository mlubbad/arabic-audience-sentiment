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
test("platform owns UI and browser tests but not shared dependency files", () => {
  assert.deepEqual(
    violations("platform", ["apps/web/src/a.tsx", "tests/e2e/test.ts"]),
    [],
  );
  assert.deepEqual(
    violations("platform", [
      "apps/web/package.json",
      "package-lock.json",
      "workers/python/test.py",
      "docs/agent-reports/worker.md",
      // Moved to the schema lane; asserted here so the move cannot regress.
      "supabase/migrations/new.sql",
    ]),
    [
      "apps/web/package.json",
      "package-lock.json",
      "workers/python/test.py",
      "docs/agent-reports/worker.md",
      "supabase/migrations/new.sql",
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

test("platform can ship application contracts with features; cross-language protocol stays coordinated", () => {
  assert.deepEqual(
    violations("platform", [
      "packages/contracts/src/comments.ts",
      "packages/contracts/src/usage.test.ts",
      "packages/contracts/src/dashboard.ts",
    ]),
    [],
  );
  assert.deepEqual(
    violations("platform", [
      "packages/contracts/package.json",
      "packages/contracts/src/index.ts",
      "packages/contracts/src/jobs.ts",
      "packages/contracts/protocols/worker-v1.json",
    ]),
    [
      "packages/contracts/package.json",
      "packages/contracts/src/index.ts",
      "packages/contracts/src/jobs.ts",
      "packages/contracts/protocols/worker-v1.json",
    ],
  );
});

test("schema lane owns the database and nothing else; platform no longer does", () => {
  assert.deepEqual(
    violations("schema", [
      "supabase/migrations/20260913_add_sync_runs.sql",
      "supabase/tests/sync_runs.test.ts",
      "docs/agent-reports/schema.md",
    ]),
    [],
  );
  assert.deepEqual(
    violations("schema", [
      "apps/web/src/a.tsx",
      "packages/contracts/src/comments.ts",
      "workers/python/x.py",
    ]),
    [
      "apps/web/src/a.tsx",
      "packages/contracts/src/comments.ts",
      "workers/python/x.py",
    ],
  );
  // One writer per area: the database left the platform lane when this arrived.
  assert.deepEqual(violations("platform", ["supabase/migrations/x.sql"]), [
    "supabase/migrations/x.sql",
  ]);
  assert.equal(expectedBranch("schema"), "codex/agent-c-schema");
});
