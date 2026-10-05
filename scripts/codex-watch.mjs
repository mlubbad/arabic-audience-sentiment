// Watch a `codex exec --json` event log while Codex runs.
//
// Prints a compact, line-per-event view (agent messages, every command Codex
// runs, errors) and stops Codex the moment it starts a forbidden command:
// a git write (the dispatcher owns those), anything that reads credentials,
// a deploy or remote migration, or a git repository outside the workspace.
//
// Usage: node scripts/codex-watch.mjs --log <file.jsonl> [--pid <codex pid>]
// Exit codes: 0 clean, 3 a forbidden command was seen (Codex was killed if --pid).
//
// Matching is done on Codex's own `command_execution` items, never on file
// contents it prints, so a work order that *mentions* `git push` is not a hit.
import { openSync, readSync, closeSync, statSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Order matters: the first match names the reason, so the more specific
// hazard (a second repository) is listed before the generic git write.
export const FORBIDDEN_PATTERNS = [
  {
    reason: "git repository outside the workspace",
    re: /\bGIT_DIR=|\bgit\s+init\b|\bgit\s+clone\b|--git-dir[= ]|--work-tree[= ]/,
  },
  {
    reason: "git write (the dispatcher commits and pushes)",
    re: /\bgit\s+(push|commit|merge|rebase|reset\s+--hard|switch\s+-[cC]|checkout\s+-b|branch\s+-[dD]|tag|remote\s+add)\b/,
  },
  {
    reason: "credential access",
    re: /\bgit\s+credential\b|\bsecurity\s+(find|dump|unlock)|\.ssh\/|keychain|\bprintenv\b|\bgh\s+auth\s+token\b/i,
  },
  {
    reason: "deploy or remote migration",
    re: /db:migrate:remote|deploy:preview|supabase\s+db\s+push|supabase\s+functions\s+deploy|apply-migrations-remote|wrangler\s+deploy/,
  },
  {
    reason: "merge or push via gh",
    re: /\bgh\s+pr\s+merge\b|\bgh\s+repo\s+sync\b/,
  },
];

/** Classify one JSONL line from `codex exec --json`. Returns null for lines to ignore. */
export function classifyLine(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  const item = event.item ?? {};
  if (event.type === "item.started" && item.type === "command_execution") {
    const command = String(item.command ?? "");
    const hit = FORBIDDEN_PATTERNS.find((p) => p.re.test(command));
    if (hit) return { kind: "forbidden", reason: hit.reason, text: command };
    return { kind: "command", text: command };
  }
  if (event.type === "item.completed") {
    if (item.type === "agent_message")
      return { kind: "message", text: String(item.text ?? "") };
    if (
      item.type === "command_execution" &&
      item.exit_code != null &&
      item.exit_code !== 0
    ) {
      return {
        kind: "exit",
        text: `exit ${item.exit_code}: ${String(item.command ?? "")}`,
      };
    }
    if (item.type === "error")
      return { kind: "error", text: String(item.message ?? "") };
    if (item.type === "mcp_tool_call") {
      return {
        kind: "tool",
        text: `${item.server ?? ""}/${item.tool ?? ""} ${JSON.stringify(item.arguments ?? {})}`,
      };
    }
  }
  if (event.type === "turn.failed")
    return { kind: "error", text: JSON.stringify(event.error ?? event) };
  if (event.type === "turn.completed")
    return { kind: "done", text: "turn completed" };
  return null;
}

export function formatEvent(ev) {
  const oneLine = ev.text.replace(/\s+/g, " ").trim();
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
  switch (ev.kind) {
    case "forbidden":
      return `!! FORBIDDEN (${ev.reason}): ${clip(oneLine, 300)}`;
    case "command":
      return `$ ${clip(oneLine, 160)}`;
    case "exit":
      return `   ${clip(oneLine, 160)}`;
    case "message":
      return `>> ${clip(oneLine, 400)}`;
    case "tool":
      return `~~ ${clip(oneLine, 200)}`;
    case "error":
      return `!! ERROR: ${clip(oneLine, 300)}`;
    case "done":
      return "== turn completed";
    default:
      return oneLine;
  }
}

function parseArgs(argv) {
  const args = { log: null, pid: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--log") args.log = argv[++i];
    else if (argv[i] === "--pid") args.pid = Number(argv[++i]);
  }
  if (!args.log) {
    console.error(
      "usage: node scripts/codex-watch.mjs --log <file.jsonl> [--pid <pid>]",
    );
    process.exit(2);
  }
  return args;
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { log, pid } = parseArgs(process.argv.slice(2));
  let offset = 0;
  let pending = "";
  let forbidden = false;
  let finished = false;
  // Poll the file: `codex exec` writes JSONL as it goes and macOS has no tail --pid.
  while (!finished) {
    let size = 0;
    try {
      size = statSync(log).size;
    } catch {
      size = 0;
    }
    if (size > offset) {
      const fd = openSync(log, "r");
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      closeSync(fd);
      offset = size;
      pending += buf.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const ev = classifyLine(line);
        if (!ev) continue;
        console.log(formatEvent(ev));
        if (ev.kind === "forbidden") {
          forbidden = true;
          if (pid && processAlive(pid)) {
            console.log(`!! stopping codex (pid ${pid})`);
            process.kill(pid, "SIGTERM");
          }
        }
        if (ev.kind === "done") finished = true;
      }
    } else if (pid ? !processAlive(pid) : false) {
      finished = true;
    } else if (!pid && size > 0 && offset === size) {
      // No pid to track: stop once the log stops growing for a while.
      await sleep(2000);
      let later = 0;
      try {
        later = statSync(log).size;
      } catch {
        later = 0;
      }
      if (later === size) finished = true;
      continue;
    }
    if (!finished) await sleep(500);
  }
  process.exit(forbidden ? 3 : 0);
}

// realpath on both sides: /tmp is a symlink to /private/tmp on macOS, and
// node resolves import.meta.url through it while argv[1] keeps the typed path.
if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) ===
    realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
