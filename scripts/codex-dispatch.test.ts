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
  /^\s*(?:if\s+!\s+)?git\b(?:\s+-[cC]\s+\S+)*\s+(commit|push|merge(?!\s+--abort))(?![-\w])/.test(
    line,
  ),
);

describe("codex-dispatch sandbox caches", () => {
  // workspace-write lets Codex write only inside the workspace; a cache under ~
  // fails the first `uv run` (WO-18, 2026-10-17).
  it("points uv and npm caches inside the workspace before Codex runs", () => {
    const body = code.join("\n");
    const exported = body.indexOf(
      'export UV_CACHE_DIR="$workspace/.cache/uv" npm_config_cache="$workspace/.cache/npm"',
    );
    expect(exported).toBeGreaterThan(-1);
    expect(exported).toBeLessThan(body.indexOf('codex_cmd=("$codex_bin" exec'));
  });

  it("keeps those caches out of every commit", () => {
    const ignore = readFileSync(
      new URL("../.gitignore", import.meta.url),
      "utf8",
    );
    expect(ignore.split("\n")).toContain(".cache/");
  });
});

describe("codex-dispatch git writes", () => {
  it("never enables the repository hooks in the workspace", () => {
    expect(code.join("\n")).not.toMatch(
      /config\s+core\.hooksPath\s+\.githooks/,
    );
    expect(code.join("\n")).toMatch(/config --unset core\.hooksPath/);
  });

  it("runs commit, push and the main merge with hooks disabled", () => {
    expect(gitWrites).toHaveLength(3);
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

  type Options = {
    resume?: boolean;
    dirty?: boolean;
    onBranch?: boolean;
    originAhead?: boolean;
  };
  const setup = (withBranch: boolean, opts: Options = {}) => {
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
    if (opts.onBranch) {
      run(workspace, "switch", "--quiet", "-c", "codex/wo-1-x");
      if (withBranch)
        run(workspace, "reset", "--quiet", "--hard", "origin/codex/wo-1-x");
    }
    if (opts.originAhead) {
      run(seed, "commit", "--quiet", "--allow-empty", "-m", "pushed elsewhere");
      run(seed, "push", "--quiet", "origin", "codex/wo-1-x");
    }
    if (opts.dirty) writeFileSync(join(workspace, "unfinished.txt"), "work\n");
    let out = "";
    let error = "";
    try {
      out = execFileSync(
        "bash",
        [
          "-c",
          `set -euo pipefail\ndie() { echo "die: $*" >&2; exit 1; }\n${block}\necho "$round $base_ref"`,
        ],
        {
          cwd: dir,
          env: {
            ...process.env,
            workspace,
            branch: "codex/wo-1-x",
            CODEX_RESUME: opts.resume ? "1" : "0",
          },
          stdio: "pipe",
        },
      )
        .toString()
        .trim();
    } catch (failure) {
      error = (failure as { stderr: Buffer }).stderr.toString();
    }
    return {
      out,
      error,
      head: run(workspace, "rev-parse", "HEAD"),
      kept: existsSync(join(workspace, "unfinished.txt")),
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

  // 2026-10-18: three stopped runs (WO-23 twice, WO-22 once) left the owner
  // with `git reset --hard`, which deletes Codex's work, or a manual commit.
  it("refuses a dirty workspace and names the resume switch, keeping the work", () => {
    const r = setup(false, { dirty: true });
    expect(r.out).toBe("");
    expect(r.error).toContain("CODEX_RESUME=1");
    expect(r.kept).toBe(true);
  });

  it("resumes a stopped first run in place, keeping its uncommitted work", () => {
    const r = setup(false, { resume: true, onBranch: true, dirty: true });
    expect(r.out).toBe("resume codex/wo-1-x, resumed");
    expect(r.kept).toBe(true);
    expect(r.head).toBe(r.mainSha);
  });

  it("resumes on top of a branch already on origin", () => {
    const r = setup(true, { resume: true, onBranch: true, dirty: true });
    expect(r.out).toBe("resume codex/wo-1-x, resumed");
    expect(r.head).toBe(r.branchSha);
  });

  it("refuses to resume from another branch", () => {
    const r = setup(false, { resume: true, dirty: true });
    expect(r.error).toContain("resume: the workspace is on 'main'");
  });

  it("refuses to resume when origin has commits the workspace lacks", () => {
    const r = setup(true, {
      resume: true,
      onBranch: true,
      dirty: true,
      originAhead: true,
    });
    expect(r.error).toContain("has commits this workspace lacks");
  });
});

// 2026-10-19: #178 merged with the migration version #176 used, and the review
// asked Codex to merge main, a git write its sandbox forbids.
describe("codex-dispatch main merge", () => {
  const block = script.slice(
    script.indexOf("# BEGIN main merge"),
    script.indexOf("# END main merge"),
  );
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const setup = (round: string, conflict = false) => {
    dir = mkdtempSync(join(tmpdir(), "codex-merge-"));
    const run = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
    const origin = join(dir, "origin.git");
    const seed = join(dir, "seed");
    run(dir, "init", "--quiet", "--bare", "-b", "main", origin);
    run(dir, "clone", "--quiet", origin, seed);
    run(seed, "config", "user.email", "test@example.invalid");
    run(seed, "config", "user.name", "test");
    writeFileSync(join(seed, "m.sql"), "base\n");
    run(seed, "add", "-A");
    run(seed, "commit", "--quiet", "-m", "main");
    run(seed, "push", "--quiet", "origin", "HEAD:main");
    run(seed, "switch", "--quiet", "-c", "codex/wo-1-x");
    writeFileSync(join(seed, conflict ? "m.sql" : "b.sql"), "branch\n");
    run(seed, "add", "-A");
    run(seed, "commit", "--quiet", "-m", "codex work");
    run(seed, "push", "--quiet", "origin", "codex/wo-1-x");
    const branchSha = run(seed, "rev-parse", "HEAD");
    run(seed, "switch", "--quiet", "main");
    writeFileSync(join(seed, "m.sql"), "main moved on\n");
    run(seed, "commit", "--quiet", "-am", "main moved");
    run(seed, "push", "--quiet", "origin", "main");
    const mainSha = run(seed, "rev-parse", "HEAD");
    const workspace = join(dir, "workspace");
    run(dir, "clone", "--quiet", origin, workspace);
    run(workspace, "config", "user.email", "test@example.invalid");
    run(workspace, "config", "user.name", "test");
    run(workspace, "switch", "--quiet", "codex/wo-1-x");
    // A hook left enabled by an earlier run must not fire on the merge.
    mkdirSync(join(workspace, ".githooks"));
    const marker = join(dir, "HOOK_RAN");
    for (const name of ["pre-merge-commit", "commit-msg", "post-merge"]) {
      const hook = join(workspace, ".githooks", name);
      writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\n`);
      chmodSync(hook, 0o755);
    }
    run(workspace, "config", "core.hooksPath", ".githooks");
    let out = "";
    let error = "";
    try {
      out = execFileSync(
        "bash",
        [
          "-c",
          `set -euo pipefail\ndie() { echo "die: $*" >&2; exit 1; }\n${block}\necho "merged=$merged_main"`,
        ],
        {
          cwd: dir,
          env: {
            ...process.env,
            workspace,
            branch: "codex/wo-1-x",
            round,
            CODEX_MERGE_MAIN: "1",
          },
          stdio: "pipe",
        },
      )
        .toString()
        .trim();
    } catch (failure) {
      error = (failure as { stderr: Buffer }).stderr.toString();
    }
    return {
      out,
      error,
      run,
      workspace,
      branchSha,
      mainSha,
      hookRan: existsSync(marker),
    };
  };

  it("merges origin/main on top of the branch, so the push stays a fast-forward", () => {
    const r = setup("follow-up");
    expect(r.error).toBe("");
    const short = r.out.replace(/^merged=/, "");
    expect(short.length).toBeGreaterThanOrEqual(7);
    expect(r.mainSha.startsWith(short)).toBe(true);
    const parents = r.run(r.workspace, "log", "-1", "--format=%P").split(" ");
    expect(parents).toEqual([r.branchSha, r.mainSha]);
    expect(r.hookRan).toBe(false);
  });

  it("aborts a conflicting merge and leaves the branch as it was", () => {
    const r = setup("follow-up", true);
    expect(r.error).toContain("conflicts; resolve it by hand");
    expect(r.run(r.workspace, "rev-parse", "HEAD")).toBe(r.branchSha);
    expect(
      r.run(r.workspace, "status", "--porcelain", "--untracked-files=no"),
    ).toBe("");
  });

  it("refuses outside a follow-up round", () => {
    const r = setup("first");
    expect(r.error).toContain("follow-up round only");
    expect(r.run(r.workspace, "rev-parse", "HEAD")).toBe(r.branchSha);
  });
});
