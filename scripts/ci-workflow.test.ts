import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// CI splits `npm run check` into parallel jobs (2026-10-06). The split must not
// quietly drop a step: every command `check` chains has to appear as its own
// `run:` line in the workflow, and `verify` has to wait for every job.
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

const runLines = new Set(
  [...workflow.matchAll(/^\s+- run: (.+)$/gm)].map((m) => m[1]!.trim()),
);
const jobsBlock = workflow.slice(workflow.indexOf("\njobs:\n"));
const jobNames = [...jobsBlock.matchAll(/^ {2}([a-z0-9_-]+):$/gm)].map(
  (m) => m[1]!,
);

describe("CI workflow covers npm run check", () => {
  test("runs every step of `check` as its own job step", () => {
    const steps = pkg.scripts.check!.split("&&").map((s) => s.trim());
    expect(steps.length).toBeGreaterThan(5);
    for (const step of steps) expect(runLines).toContain(step);
  });

  test("also runs the snapshot check and the browser suite", () => {
    expect(runLines).toContain("npm run db:snapshot:check");
    expect(runLines).toContain("npm run test:e2e");
  });

  test("verify needs every other job and fails unless all succeeded", () => {
    const others = jobNames.filter((name) => name !== "verify");
    expect(jobNames).toContain("verify");
    expect(others.length).toBeGreaterThan(1);
    const needs = workflow.match(/^ {4}needs: \[(.+)\]$/m)?.[1];
    expect(
      needs
        ?.split(",")
        .map((s) => s.trim())
        .sort(),
    ).toEqual(others.sort());
    expect(workflow).toMatch(/^ {4}if: always\(\) && /m);
    for (const job of others)
      expect(workflow).toContain(`\${{ needs.${job}.result }}`);
  });
});

// Minutes are billed on this private repo (the billing block of 2026-10-10):
// a draft PR runs no job, the checks run once it is marked ready and again on
// main. Every job of the three PR workflows carries the guard, and each
// workflow listens for `ready_for_review`, or a PR made ready would never be
// checked.
describe("a draft pull request spends no CI minutes", () => {
  for (const file of ["ci.yml", "security.yml", "codeql.yml"]) {
    const text = readFileSync(`.github/workflows/${file}`, "utf8");
    const body = text.slice(text.indexOf("\njobs:\n"));
    const jobs = body.split(/^ {2}(?=[a-z0-9_-]+:$)/m).slice(1);

    test(`${file} runs again when a draft is marked ready`, () => {
      expect(text).toMatch(
        /^ {2}pull_request:\n(?: {4}#.*\n)* {4}types: \[opened, synchronize, reopened, ready_for_review\]$/m,
      );
    });

    test(`every job in ${file} skips a draft`, () => {
      expect(jobs.length).toBeGreaterThan(0);
      for (const job of jobs)
        expect(job).toMatch(
          /^ {4}if: (?:always\(\) && )?github\.event\.pull_request\.draft != true$/m,
        );
    });
  }
});
