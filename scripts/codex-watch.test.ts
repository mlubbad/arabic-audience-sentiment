import { describe, expect, it } from "vitest";
import { classifyLine, formatEvent } from "./codex-watch.mjs";

const started = (command: string) =>
  JSON.stringify({
    type: "item.started",
    item: { id: "x", type: "command_execution", command },
  });
const completed = (item: Record<string, unknown>) =>
  JSON.stringify({ type: "item.completed", item: { id: "x", ...item } });

describe("codex-watch classifyLine", () => {
  it("flags the fake-repo workaround Codex used on 2026-10-04 (GIT_DIR under /tmp)", () => {
    // Verbatim from the first WO-13 run: a bare repo in /tmp pointed at the workspace.
    const cmd =
      '/bin/zsh -lc \'task_git_dir=/tmp/wo13-git-root; mkdir "$task_git_dir"; git init --bare "$task_git_dir"; ' +
      'GIT_DIR="$task_git_dir" git remote add origin https://github.com/mlubbad/arabic-audience-sentiment.git\'';
    const ev = classifyLine(started(cmd));
    expect(ev?.kind).toBe("forbidden");
    expect(ev?.reason).toContain("outside the workspace");
  });

  it("flags git writes, which the dispatcher owns", () => {
    for (const cmd of [
      "/bin/zsh -lc 'git push -u origin codex/wo-13-collection-freshness'",
      "/bin/zsh -lc 'git commit -m \"feat: x\"'",
      "/bin/zsh -lc 'git switch -c codex/wo-13-x origin/main'",
      "/bin/zsh -lc 'git push origin HEAD:main'",
      "/bin/zsh -lc 'git merge --no-edit origin/main'",
      "/bin/zsh -lc 'git status && git merge origin/main'",
    ]) {
      expect(classifyLine(started(cmd))?.kind, cmd).toBe("forbidden");
    }
  });

  it("flags credential reads, deploys and remote migrations", () => {
    for (const cmd of [
      "git credential fill",
      "security find-generic-password -s github",
      "cat ~/.ssh/id_ed25519",
      "npm run db:migrate:remote",
      "supabase db push",
      "gh pr merge 74",
    ]) {
      expect(classifyLine(started(`/bin/zsh -lc '${cmd}'`))?.kind, cmd).toBe(
        "forbidden",
      );
    }
  });

  it("does not flag reads, tests or gh reads", () => {
    for (const cmd of [
      "/bin/zsh -lc 'git status --short --branch && git diff --stat'",
      "/bin/zsh -lc 'git fetch origin main && git log -1 origin/main'",
      "/bin/zsh -lc 'npm run test:db && npm run db:snapshot:check'",
      "/bin/zsh -lc 'gh issue view 72 --json title,body'",
      "/bin/zsh -lc 'gh pr view 74 --json state'",
      // WO-22 round 3 (2026-10-19) was killed for this read.
      "/bin/zsh -lc 'git log -5 --oneline && git merge-base --is-ancestor origin/main HEAD'",
    ]) {
      expect(classifyLine(started(cmd))?.kind, cmd).toBe("command");
    }
  });

  it("matches commands only, never text Codex prints", () => {
    // The first watcher grepped the raw log and fired on the PLAYBOOK's own
    // wording when Codex ran `cat docs/engineering/PLAYBOOK.md`.
    const catDocs = classifyLine(
      started("/bin/zsh -lc 'cat docs/engineering/PLAYBOOK.md'"),
    );
    expect(catDocs?.kind).toBe("command");
    const output = completed({
      type: "command_execution",
      command: "/bin/zsh -lc 'cat AGENTS.md'",
      aggregated_output:
        "Never push to `main`, never merge, never deploy. git push --force is banned.",
      exit_code: 0,
    });
    expect(classifyLine(output)).toBeNull();
    const message = completed({
      type: "agent_message",
      text: "I will not run git push; the dispatcher does.",
    });
    expect(classifyLine(message)?.kind).toBe("message");
  });

  it("surfaces errors, non-zero exits, tool calls and completion", () => {
    expect(
      classifyLine(
        completed({ type: "error", message: "Exceeded skills context budget" }),
      )?.kind,
    ).toBe("error");
    expect(
      classifyLine(
        completed({
          type: "command_execution",
          command: "gh issue view 72",
          exit_code: 127,
        }),
      )?.text,
    ).toContain("exit 127");
    expect(
      classifyLine(
        completed({
          type: "mcp_tool_call",
          server: "cua_repl",
          tool: "js",
          arguments: {},
        }),
      )?.kind,
    ).toBe("tool");
    expect(classifyLine(JSON.stringify({ type: "turn.completed" }))?.kind).toBe(
      "done",
    );
    expect(classifyLine("not json")).toBeNull();
    expect(
      classifyLine(
        JSON.stringify({
          type: "item.updated",
          item: { type: "command_execution" },
        }),
      ),
    ).toBeNull();
  });

  it("formats one line per event, clipped", () => {
    const ev = classifyLine(started(`/bin/zsh -lc '${"x".repeat(500)}'`));
    const line = formatEvent(ev!);
    expect(line.startsWith("$ ")).toBe(true);
    expect(line.length).toBeLessThan(200);
    expect(
      formatEvent({ kind: "forbidden", reason: "r", text: "git push" }),
    ).toBe("!! FORBIDDEN (r): git push");
  });
});
