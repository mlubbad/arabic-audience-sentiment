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
