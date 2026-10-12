import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// The watchdog exists because a run queued for a runner label that no runner
// carries never leaves the queue on its own and holds its `concurrency` group
// (2026-10-10/11). So it must never depend on CI_RUNNER itself, it must be
// allowed to cancel runs, it must use the force endpoint (the only cancel that
// bypasses an `always()` job), and it must only ever touch queued runs, never
// one waiting on concurrency or approval, and never itself.
const workflow = readFileSync(".github/workflows/queue-watchdog.yml", "utf8");

describe("the queue watchdog", () => {
  test("runs on the hosted runner by name, never on CI_RUNNER", () => {
    expect(workflow).toMatch(/^ {4}runs-on: ubuntu-latest$/m);
    expect(workflow).not.toContain("vars.CI_RUNNER");
  });

  test("runs on a schedule and may cancel runs", () => {
    expect(workflow).toMatch(/^ {2}schedule:$/m);
    expect(workflow).toMatch(/^ {2}actions: write$/m);
  });

  test("cancels by force, only queued runs, never itself", () => {
    expect(workflow).toContain("/force-cancel");
    expect(workflow).toContain("status=queued");
    expect(workflow).not.toContain("status=pending");
    expect(workflow).toContain('[ "$id" = "$GITHUB_RUN_ID" ] && continue');
  });

  test("checks out nothing and uses no third-party action", () => {
    expect(workflow).not.toMatch(/^ {6}- uses:/m);
  });
});
