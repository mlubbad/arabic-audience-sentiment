import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Where each job runs is one repository variable, not a label written into
// every job (2026-10-10: GitHub refused every hosted job on a billing block,
// and the only way to keep the gates running was a self-hosted runner). Unset,
// the variable leaves every job on `ubuntu-latest`, exactly as before.
//
// Two variables, not one: CI and Security run code from any agent's branch,
// while the deploy holds the production credentials. On a persistent runner a
// job can leave something behind for the next one, so the deploy never moves
// to the CI runner as a side effect of moving CI.
const CI_RUNNER = "runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}";
const DEPLOY_RUNNER = "runs-on: ${{ vars.DEPLOY_RUNNER || 'ubuntu-latest' }}";

function jobRunsOn(file: string): Map<string, string | undefined> {
  const workflow = readFileSync(`.github/workflows/${file}`, "utf8");
  const jobsBlock = workflow.slice(workflow.indexOf("\njobs:\n"));
  const starts = [...jobsBlock.matchAll(/^ {2}([a-z0-9_-]+):$/gm)];
  return new Map(
    starts.map((m, i) => {
      const body = jobsBlock.slice(m.index, starts[i + 1]?.index);
      return [m[1]!, body.match(/^ {4}(runs-on: .+)$/m)?.[1]];
    }),
  );
}

describe("where the jobs run", () => {
  test.each(["ci.yml", "security.yml", "codeql.yml"])(
    "every job in %s runs on CI_RUNNER, defaulting to ubuntu-latest",
    (file) => {
      const jobs = jobRunsOn(file);
      expect(jobs.size).toBeGreaterThan(0);
      for (const [job, runsOn] of jobs)
        expect({ job, runsOn }).toEqual({ job, runsOn: CI_RUNNER });
    },
  );

  test("every deploy job runs on DEPLOY_RUNNER, never on CI_RUNNER", () => {
    const jobs = jobRunsOn("deploy.yml");
    expect([...jobs.keys()].sort()).toEqual(["deploy", "required-checks"]);
    for (const [job, runsOn] of jobs)
      expect({ job, runsOn }).toEqual({ job, runsOn: DEPLOY_RUNNER });
  });
});

describe("the secret scan installs gitleaks on any runner", () => {
  const security = readFileSync(".github/workflows/security.yml", "utf8");
  const install = security.slice(
    security.indexOf("- name: Install gitleaks"),
    security.indexOf("- name: Scan full history"),
  );

  test("picks the archive for the runner's CPU and still verifies it", () => {
    // A self-hosted runner on an Apple Silicon Mac is linux/arm64; the x64
    // archive does not run there.
    expect(install).toContain('case "$RUNNER_ARCH" in');
    expect(install).toContain("X64) arch=x64");
    expect(install).toContain("ARM64) arch=arm64");
    expect(install).toContain("sha256sum -c -");
    expect(install).toContain("gitleaks_8.30.1_linux_${arch}.tar.gz");
  });

  test("installs into the job's temp directory, not a root-owned path", () => {
    // A self-hosted runner's user cannot write /usr/local/bin.
    expect(install).not.toContain("/usr/local/bin");
    expect(install).toContain("$RUNNER_TEMP");
    expect(install).toContain('>> "$GITHUB_PATH"');
  });

  test("no security job writes to the machine-wide /tmp", () => {
    // Hosted runners are fresh per job; a self-hosted machine is not, and
    // two runners on it would share /tmp between unrelated jobs.
    expect(security).not.toMatch(/\/tmp\//);
  });
});
