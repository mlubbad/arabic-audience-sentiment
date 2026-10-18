import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  issueCheck,
  issueFor,
  parseRun,
  planAlerts,
} from "./monitor-alerts.mjs";

const run = (...lines: string[]) =>
  [...lines, "2026-10-16T21:34:17+0000 DONE overall=x"].join("\n");
const at = "2026-10-16T21:34:14+0000";
const open = (number: number, check: string) => ({
  number,
  body: issueFor(
    { check, detail: "x" },
    { runUrl: "https://example.test/run", owner: "" },
  ).body,
});

describe("reading a monitor run", () => {
  test("reads each check's level and detail", () => {
    const checks = parseRun(
      run(
        `${at} OK rest 200`,
        `${at} FAIL freshness 16_of_18_collected_channels_stale_48h_7_never_collected`,
        `${at} WARN worker no_worker_for_45m`,
      ),
    );
    expect(Object.fromEntries(checks)).toEqual({
      rest: { level: "OK", detail: "200" },
      freshness: {
        level: "FAIL",
        detail: "16_of_18_collected_channels_stale_48h_7_never_collected",
      },
      worker: { level: "WARN", detail: "no_worker_for_45m" },
    });
  });

  test("a run that never finished is the monitor failing", () => {
    expect(parseRun(`${at} OK rest 200\n`).get("monitor")).toEqual({
      level: "FAIL",
      detail: "no_result",
    });
    expect(parseRun("").get("monitor")?.level).toBe("FAIL");
  });

  test("an exit code monitor.sh never gives is the monitor failing", () => {
    expect(parseRun(run(`${at} OK rest 200`), "143").get("monitor")).toEqual({
      level: "FAIL",
      detail: "exit_143",
    });
    for (const code of ["", "0", "1", "2"])
      expect(parseRun(run(`${at} OK rest 200`), code).has("monitor")).toBe(
        false,
      );
  });
});

describe("planning alerts", () => {
  test("opens one issue for a check that starts failing", () => {
    const plan = planAlerts(parseRun(run(`${at} FAIL rest http_504`)), []);
    expect(plan).toEqual({
      toOpen: [{ check: "rest", detail: "http_504" }],
      toClose: [],
    });
  });

  test("opens nothing while the check's issue is already open", () => {
    const plan = planAlerts(parseRun(run(`${at} FAIL rest http_504`)), [
      open(12, "rest"),
    ]);
    expect(plan).toEqual({ toOpen: [], toClose: [] });
  });

  test("closes the issue when the check is OK again", () => {
    const plan = planAlerts(parseRun(run(`${at} OK rest 200`)), [
      open(12, "rest"),
    ]);
    expect(plan.toClose).toEqual([
      { check: "rest", number: 12, detail: "200" },
    ]);
  });

  test("a warning or a check that was not measured is not a recovery", () => {
    const plan = planAlerts(
      parseRun(
        run(
          `${at} WARN freshness unreadable_counts`,
          `${at} FAIL monitor not_configured:WORKER_CREDENTIAL`,
        ),
      ),
      [open(3, "freshness"), open(4, "rest")],
    );
    expect(plan.toClose).toEqual([]);
    expect(plan.toOpen).toEqual([
      { check: "monitor", detail: "not_configured:WORKER_CREDENTIAL" },
    ]);
  });

  test("an issue without the marker is not the monitor's", () => {
    expect(issueCheck("Monitor: rest is failing, written by hand")).toBeNull();
    const plan = planAlerts(parseRun(run(`${at} OK rest 200`)), [
      { number: 9, body: "rest broke" },
    ]);
    expect(plan.toClose).toEqual([]);
  });

  test("the issue names the check, its detail and the run, and mentions the owner", () => {
    const { title, body } = issueFor(
      {
        check: "freshness",
        detail: "16_of_18_collected_channels_stale_48h_7_never_collected",
      },
      { runUrl: "https://github.com/o/r/actions/runs/1", owner: "o" },
    );
    expect(title).toBe("Monitor: freshness is failing");
    expect(issueCheck(body)).toBe("freshness");
    expect(body).toContain(
      "16_of_18_collected_channels_stale_48h_7_never_collected",
    );
    expect(body).toContain("https://github.com/o/r/actions/runs/1");
    expect(body).toContain("@o");
  });
});

// The monitor exists to see what the machine running the worker cannot, so it
// must never run there (2026-10-16: a crontab on the owner's Mac never ran).
const workflow = readFileSync(".github/workflows/monitor.yml", "utf8");

describe("the monitor workflow", () => {
  test("runs on the hosted runner by name, never on CI_RUNNER or DEPLOY_RUNNER", () => {
    expect(workflow).toMatch(/^ {4}runs-on: ubuntu-latest$/m);
    expect(workflow).not.toContain("vars.CI_RUNNER");
    expect(workflow).not.toContain("vars.DEPLOY_RUNNER");
  });

  test("runs on a schedule with least privilege", () => {
    expect(workflow).toMatch(/^ {2}schedule:$/m);
    expect(workflow).toMatch(
      /^permissions:\n {2}contents: read\n {2}issues: write\n/m,
    );
    expect(workflow).toMatch(/^ {4}timeout-minutes: \d+$/m);
    expect(workflow).toMatch(/^concurrency:$/m);
  });

  test("takes its secrets from the monitor environment, never from .env.local", () => {
    expect(workflow).toMatch(/^ {4}environment: monitor$/m);
    expect(workflow).toContain('MONITOR_ENV_FILE: ""');
  });

  test("pins its one action by SHA and keeps no credentials in the checkout", () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses).toEqual([
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    ]);
    expect(workflow).toContain("persist-credentials: false");
  });

  test("reports through issues, so a failing check is not a failed run every 30 minutes", () => {
    expect(workflow).toContain("node scripts/monitor-alerts.mjs");
    expect(workflow).not.toContain("continue-on-error");
  });

  // 2026-10-17: GitHub's `bash -e` ended the step on monitor.sh's exit 2,
  // before the output was printed, and the alert step never ran.
  test("a failing probe still prints its output and reaches the alert step", () => {
    expect(workflow).toContain(
      'sh scripts/monitor.sh > "$output" 2>&1 || code=$?',
    );
    expect(workflow).not.toMatch(/monitor\.sh > "\$output" 2>&1\n/);
    expect(workflow).toMatch(
      /- name: Open or close one issue per failing check\n {8}if: \$\{\{ !cancelled\(\) \}\}\n/,
    );
    expect(workflow).toContain(
      "MONITOR_EXIT_CODE: ${{ steps.probe.outputs.code }}",
    );
  });
});
