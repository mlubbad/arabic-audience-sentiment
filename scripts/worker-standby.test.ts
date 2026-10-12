import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

// The Mac's standby for the Oracle worker (owner's request, 2026-10-12): the
// local worker service stays installed and disabled, starts after the primary
// has been down two checks in a row, and stops after two good ones. These
// tests drive scripts/worker-standby.sh with a fake probe and a fake launchctl
// that records its calls and keeps a "loaded" flag the way launchd would.
const SCRIPT = join(process.cwd(), "scripts/worker-standby.sh");

let dir: string;
const calls = () =>
  existsSync(join(dir, "calls"))
    ? readFileSync(join(dir, "calls"), "utf8").trim().split("\n")
    : [];
const state = () => readFileSync(join(dir, "standby.state"), "utf8").trim();
const loaded = () => existsSync(join(dir, "loaded"));

function tick(primary: "up" | "down" | "restarting") {
  const answer =
    primary === "up"
      ? "echo true false"
      : primary === "restarting"
        ? "echo true true"
        : "exit 255";
  execFileSync("sh", [SCRIPT], {
    env: {
      ...process.env,
      STANDBY_DIR: dir,
      STANDBY_PROBE: answer,
      STANDBY_LAUNCHCTL: join(dir, "launchctl"),
      STANDBY_WORKER_PLIST: join(dir, "worker.plist"),
      STANDBY_NOTIFY: "0",
    },
    stdio: "pipe",
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "standby-"));
  writeFileSync(join(dir, "standby.env"), "ORACLE_HOST=192.0.2.10\n");
  // print: loaded or not; bootstrap/bootout: set or clear "loaded".
  writeFileSync(
    join(dir, "launchctl"),
    `#!/bin/sh
d="${dir}"
echo "$*" >> "$d/calls"
case "$1" in
  print) [ -f "$d/loaded" ] ;;
  bootstrap) [ -f "$d/loaded" ] && exit 5; touch "$d/loaded" ;;
  bootout) rm -f "$d/loaded" ;;
  *) exit 0 ;;
esac
`,
    { mode: 0o755 },
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the Mac standby", () => {
  test("stays on standby while the primary is up, and never starts the local worker", () => {
    tick("up");
    tick("up");
    tick("up");
    expect(loaded()).toBe(false);
    expect(calls().some((c) => c.startsWith("bootstrap"))).toBe(false);
    expect(state()).toBe("standby 0 3");
  });

  test("one failed check does not fail over; a good one resets the count", () => {
    tick("down");
    expect(loaded()).toBe(false);
    expect(state()).toBe("standby 1 0");
    tick("up");
    tick("down");
    expect(loaded()).toBe(false);
    expect(state()).toBe("standby 1 0");
  });

  test("two failed checks in a row enable and start the local worker", () => {
    tick("down");
    tick("down");
    expect(loaded()).toBe(true);
    expect(calls()).toContain(
      `enable gui/${process.getuid!()}/com.skydevelop.sentiment-worker`,
    );
    expect(calls().filter((c) => c.startsWith("bootstrap"))).toHaveLength(1);
    expect(state()).toBe("active 2 0");
  });

  test("a container in a restart loop counts as down", () => {
    tick("restarting");
    tick("restarting");
    expect(loaded()).toBe(true);
    expect(state()).toMatch(/^active /);
  });

  test("after failover, two good checks stop and disable the local worker", () => {
    tick("down");
    tick("down");
    tick("up");
    expect(loaded()).toBe(true);
    tick("up");
    expect(loaded()).toBe(false);
    expect(calls()).toContain(
      `bootout gui/${process.getuid!()}/com.skydevelop.sentiment-worker`,
    );
    expect(calls().at(-1)).toBe(
      `disable gui/${process.getuid!()}/com.skydevelop.sentiment-worker`,
    );
    expect(state()).toBe("standby 0 2");
  });

  test("while active, a local worker that stopped is started again", () => {
    tick("down");
    tick("down");
    rmSync(join(dir, "loaded"));
    tick("down");
    expect(loaded()).toBe(true);
    expect(calls().filter((c) => c.startsWith("bootstrap"))).toHaveLength(2);
  });

  test("on standby with the primary up, a stray local worker is stopped", () => {
    writeFileSync(join(dir, "loaded"), "");
    tick("up");
    expect(loaded()).toBe(false);
    expect(state()).toBe("standby 0 1");
  });

  test("does nothing without its configuration", () => {
    rmSync(join(dir, "standby.env"));
    tick("down");
    tick("down");
    expect(calls()).toEqual([]);
    expect(existsSync(join(dir, "standby.state"))).toBe(false);
  });
});

describe("the standby's wiring", () => {
  const update = readFileSync("scripts/worker-service-update.sh", "utf8");
  const plist = readFileSync(
    "scripts/com.skydevelop.sentiment-standby.plist",
    "utf8",
  );
  const probe = readFileSync(SCRIPT, "utf8");

  test("an update does not start the worker while on standby", () => {
    expect(update).toContain('[ "$standby_mode" = standby ]');
    expect(update.indexOf("not started (standby decides)")).toBeLessThan(
      update.lastIndexOf('launchctl bootstrap "gui/$(id -u)" "$PLIST"'),
    );
  });

  test("the agent checks every five minutes, and the probe never prompts", () => {
    expect(plist).toMatch(
      /<key>StartInterval<\/key>\s*<integer>300<\/integer>/,
    );
    expect(probe).toContain("-o BatchMode=yes");
    expect(probe).toContain("-o ConnectTimeout=10");
  });
});
