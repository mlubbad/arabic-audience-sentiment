import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const branches = {
  worker: "codex/agent-a-worker",
  platform: "codex/agent-b-platform",
  schema: "codex/agent-c-schema",
  integration: "codex/coordination-integration",
};
export function expectedBranch(lane) {
  if (!Object.hasOwn(branches, lane)) throw new Error(`Unknown lane: ${lane}`);
  return branches[lane];
}
const coordinatedContracts = new Set([
  "packages/contracts/src/index.ts",
  "packages/contracts/src/jobs.ts",
]);
const platformOwned = ["apps/web/", "tests/e2e/", "packages/contracts/src/"];
// Database work moved out of the platform lane when the schema lane was added:
// one writer per area is the whole point, so it cannot be owned by both.
const schemaOwned = ["supabase/"];
export function violations(lane, files) {
  expectedBranch(lane);
  return files.filter((file) => {
    if (file.startsWith("/") || file.split("/").includes("..")) return true;
    if (lane === "integration") return false;
    if (file === `docs/agent-reports/${lane}.md`) return false;
    if (lane === "worker") return !file.startsWith("workers/python/");
    if (lane === "schema")
      return !schemaOwned.some((prefix) => file.startsWith(prefix));
    if (file === "apps/web/package.json") return true;
    // Platform ships application schema alongside the features that need it, so
    // a UI change no longer waits on a round trip. The barrel and any
    // worker-facing contract stay coordinated, because that is where the two
    // lanes meet and where a unilateral change would break the other one.
    if (coordinatedContracts.has(file)) return true;
    if (file.startsWith("packages/contracts/src/protocols/")) return true;
    return !platformOwned.some((prefix) => file.startsWith(prefix));
  });
}
function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trimEnd();
}
export function check(lane) {
  const branch = git(["branch", "--show-current"]);
  if (branch !== expectedBranch(lane))
    throw new Error(
      `Wrong worktree/branch: ${branch}; ${lane} requires ${expectedBranch(lane)}`,
    );
  const base = git(["merge-base", "HEAD", branches.integration]);
  const files = [
    ...new Set(
      [
        ...git([
          "diff",
          "--no-renames",
          "--name-only",
          "-z",
          base,
          "HEAD",
        ]).split("\0"),
        ...git(["diff", "--no-renames", "--name-only", "-z", "HEAD"]).split(
          "\0",
        ),
        ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split(
          "\0",
        ),
      ].filter(Boolean),
    ),
  ];
  const bad = violations(lane, files);
  if (bad.length)
    throw new Error(`Changes outside ${lane} ownership:\n${bad.join("\n")}`);
  console.log(
    `Ownership passed: ${lane}; ${files.length} changed paths; integration base ${base.slice(0, 8)}`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    check(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
