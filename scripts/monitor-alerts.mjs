#!/usr/bin/env node
/**
 * Turns one run of scripts/monitor.sh into GitHub issues: a check that starts
 * failing opens one issue, and its recovery closes it.
 *
 * Why issues: the monitor runs on a schedule in a hosted workflow
 * (.github/workflows/monitor.yml), where nothing persists between runs and
 * no webhook is configured. A failing job would email on every run for as
 * long as an incident lasts; an open issue labelled `monitor` is the state
 * instead — one notification when a check breaks, one when it recovers —
 * and stays visible until it does.
 *
 * Only FAIL opens an issue. A check that is WARN, or absent from the run
 * (a run that stopped at its configuration check measured nothing else),
 * leaves its issue open: unknown is not recovered. Only OK closes one.
 *
 * The repository is public, so an issue carries the check's name and detail
 * (statuses and counts only, by monitor.sh's own rule) and the run's link.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const LABEL = "monitor";
const LINE = /^\S+ (OK|WARN|FAIL) ([a-z]+) (\S+)$/;
const marker = (check) => `<!-- monitor-check:${check} -->`;

/**
 * The checks one run reported: name → { level, detail }. `exitCode` is
 * monitor.sh's, as the workflow recorded it; empty when it was not.
 */
export function parseRun(output, exitCode = "") {
  const checks = new Map();
  for (const line of output.split("\n")) {
    const m = LINE.exec(line.trim());
    if (m) checks.set(m[2], { level: m[1], detail: m[3] });
  }
  // A run that died before its summary line proved nothing healthy.
  if (!/ DONE overall=/.test(output))
    checks.set("monitor", { level: "FAIL", detail: "no_result" });
  // monitor.sh exits 0, 1 or 2; anything else means it did not finish its
  // own way (killed, or a shell error), whatever it printed before.
  else if (!["", "0", "1", "2"].includes(exitCode))
    checks.set("monitor", { level: "FAIL", detail: `exit_${exitCode}` });
  return checks;
}

/** The check an open monitor issue is about, from its marker, or null. */
export function issueCheck(body) {
  return /<!-- monitor-check:([a-z]+) -->/.exec(body ?? "")?.[1] ?? null;
}

/**
 * What to do: open an issue for each failing check that has none, close
 * each open one whose check is now OK.
 */
export function planAlerts(checks, openIssues) {
  const open = new Map();
  for (const issue of openIssues) {
    const check = issueCheck(issue.body);
    if (check && !open.has(check)) open.set(check, issue.number);
  }
  const toOpen = [];
  for (const [check, { level, detail }] of checks)
    if (level === "FAIL" && !open.has(check)) toOpen.push({ check, detail });
  const toClose = [];
  for (const [check, number] of open) {
    const now = checks.get(check);
    if (now?.level === "OK")
      toClose.push({ check, number, detail: now.detail });
  }
  return { toOpen, toClose };
}

export function issueFor({ check, detail }, { runUrl, owner }) {
  return {
    title: `Monitor: ${check} is failing`,
    body: [
      marker(check),
      `\`${check}\` reports \`${detail}\`.`,
      "",
      `Run: ${runUrl}`,
      "",
      `This issue closes itself when the check is OK again. The checks are described at the top of \`scripts/monitor.sh\`.${owner ? ` @${owner}` : ""}`,
    ].join("\n"),
  };
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

/** The run's output, or nothing when the probe died before writing it. */
function readRun(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function main(path) {
  const checks = parseRun(readRun(path), process.env.MONITOR_EXIT_CODE ?? "");
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const owner = process.env.GITHUB_REPOSITORY_OWNER ?? "";
  const openIssues = JSON.parse(
    gh([
      "issue",
      "list",
      "--label",
      LABEL,
      "--state",
      "open",
      "--json",
      "number,body",
      "--limit",
      "100",
    ]),
  );
  const { toOpen, toClose } = planAlerts(checks, openIssues);
  if (toOpen.length > 0)
    gh([
      "label",
      "create",
      LABEL,
      "--force",
      "--color",
      "B60205",
      "--description",
      "Opened and closed by the platform monitor",
    ]);
  for (const alert of toOpen) {
    const { title, body } = issueFor(alert, { runUrl, owner });
    gh(["issue", "create", "--title", title, "--body", body, "--label", LABEL]);
    console.log(`opened: ${alert.check} (${alert.detail})`);
  }
  for (const { check, number, detail } of toClose) {
    gh([
      "issue",
      "close",
      String(number),
      "--comment",
      `Recovered: \`${check}\` reports \`${detail}\`.\n\nRun: ${runUrl}`,
    ]);
    console.log(`closed: ${check} (#${number})`);
  }
  if (toOpen.length + toClose.length === 0) console.log("no change");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv[2] ?? "monitor-output.txt");
}
