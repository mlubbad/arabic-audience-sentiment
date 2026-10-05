// The dispatcher runs every git write outside Codex's sandbox, in a workspace
// Codex could write. These tests pin that no repository hook runs there: a hook
// resolves tools from that workspace (node_modules/.bin, eslint.config.*), so it
// would execute Codex-planted code as the owner (PR #75 review, 2026-10-04).
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = readFileSync(
  new URL("./codex-dispatch.sh", import.meta.url),
  "utf8",
);
const code = script
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"));

const gitWrites = code.filter((line) =>
  /^\s*git\b(?:\s+-c\s+\S+)*\s+(commit|push)\b/.test(line),
);

describe("codex-dispatch git writes", () => {
  it("never enables the repository hooks in the workspace", () => {
    expect(code.join("\n")).not.toMatch(
      /config\s+core\.hooksPath\s+\.githooks/,
    );
    expect(code.join("\n")).toMatch(/config --unset core\.hooksPath/);
  });

  it("runs commit and push with hooks disabled", () => {
    expect(gitWrites).toHaveLength(2);
    for (const line of gitWrites) {
      expect(line).toContain("-c core.hooksPath=/dev/null");
      expect(line).toContain("--no-verify");
    }
  });

  describe("against a workspace left with hooks enabled by an earlier run", () => {
    let dir: string | undefined;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    });

    it("does not execute a hook Codex could have planted", () => {
      dir = mkdtempSync(join(tmpdir(), "codex-dispatch-"));
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: dir, stdio: "pipe" });
      git("init", "--quiet");
      git("config", "user.email", "test@example.invalid");
      git("config", "user.name", "test");
      mkdirSync(join(dir, ".githooks"));
      const marker = join(dir, "HOOK_RAN");
      const hook = join(dir, ".githooks", "pre-commit");
      writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\n`);
      chmodSync(hook, 0o755);
      git("add", "-A");
      git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "init");
      git("config", "core.hooksPath", ".githooks");

      mkdirSync(join(dir, ".codex-handoff"));
      writeFileSync(join(dir, ".codex-handoff", "commit.txt"), "wo: change\n");
      writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
      git("add", "a.ts");

      const commit = gitWrites.find((line) => /\bcommit\b/.test(line));
      expect(commit).toBeDefined();
      execFileSync("bash", ["-c", commit!.trim()], { cwd: dir, stdio: "pipe" });

      expect(existsSync(marker)).toBe(false);
      expect(git("log", "--format=%s", "-1").toString().trim()).toBe(
        "wo: change",
      );
    });
  });
});

// A follow-up round must continue the work-order branch, not recreate it from
// main: recreating it dropped Codex's earlier commits and made the push a
// non-fast-forward (PR #78, 2026-10-05).
describe("codex-dispatch base selection", () => {
  const block = script.slice(
    script.indexOf("# BEGIN base selection"),
    script.indexOf("# END base selection"),
  );
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const setup = (withBranch: boolean) => {
    dir = mkdtempSync(join(tmpdir(), "codex-base-"));
    const run = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
    const origin = join(dir, "origin.git");
    const seed = join(dir, "seed");
    run(dir, "init", "--quiet", "--bare", "-b", "main", origin);
    run(dir, "clone", "--quiet", origin, seed);
    run(seed, "config", "user.email", "test@example.invalid");
    run(seed, "config", "user.name", "test");
    run(seed, "commit", "--quiet", "--allow-empty", "-m", "main");
    run(seed, "push", "--quiet", "origin", "HEAD:main");
    const mainSha = run(seed, "rev-parse", "HEAD");
    let branchSha = "";
    if (withBranch) {
      run(seed, "switch", "--quiet", "-c", "codex/wo-1-x");
      run(seed, "commit", "--quiet", "--allow-empty", "-m", "codex work");
      run(seed, "push", "--quiet", "origin", "codex/wo-1-x");
      branchSha = run(seed, "rev-parse", "HEAD");
    }
    const workspace = join(dir, "workspace");
    run(dir, "clone", "--quiet", origin, workspace);
    const out = execFileSync(
      "bash",
      ["-c", `set -euo pipefail\n${block}\necho "$round $base_ref"`],
      {
        cwd: dir,
        env: { ...process.env, workspace, branch: "codex/wo-1-x" },
        stdio: "pipe",
      },
    )
      .toString()
      .trim();
    return {
      out,
      head: run(workspace, "rev-parse", "HEAD"),
      mainSha,
      branchSha,
    };
  };

  it("continues an existing branch from its own tip", () => {
    const r = setup(true);
    expect(r.out).toBe("follow-up origin/codex/wo-1-x");
    expect(r.head).toBe(r.branchSha);
  });

  it("starts a new branch from origin/main", () => {
    const r = setup(false);
    expect(r.out).toBe("first origin/main");
    expect(r.head).toBe(r.mainSha);
  });
});
