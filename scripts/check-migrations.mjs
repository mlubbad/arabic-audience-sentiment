#!/usr/bin/env node
// A migration's version is its identity in production. The Deploy runner
// (scripts/apply-migrations-remote.mjs) applies a file only when its version
// is missing from supabase_migrations.schema_migrations, so:
//
//  - a second file with a version already used is skipped there silently,
//    while the PGlite suites, which apply every file by name, still pass;
//  - a migration already merged is already applied, so editing, renaming or
//    deleting it changes the repository and never the database.
//
// Both happened: #133/#129, #134/#135, #139/#140 reused a version, and #167
// reused #166's on 2026-10-18. This check fails the build instead.
//
//   node scripts/check-migrations.mjs                  # versions in the tree
//   node scripts/check-migrations.mjs --base <git-ref> # and nothing merged changed
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const MIGRATIONS_DIR = "supabase/migrations";
const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

/** What is wrong with a set of migration file names: a name without a
 *  14-digit version, or a version carried by more than one file. */
export function versionProblems(files) {
  const problems = [];
  const byVersion = new Map();
  for (const file of files.filter((f) => f.endsWith(".sql")).sort()) {
    const match = NAME.exec(file);
    if (!match) {
      problems.push(
        `${file}: name must be <14-digit version>_<lowercase_words>.sql`,
      );
      continue;
    }
    byVersion.set(match[1], [...(byVersion.get(match[1]) ?? []), file]);
  }
  for (const [version, named] of byVersion)
    if (named.length > 1)
      problems.push(
        `version ${version} is used by ${named.length} files (${named.join(", ")}); production applies only the first it meets and skips the rest. Give the newer file a version above every merged and claimed one.`,
      );
  return problems;
}

/** What changed in migrations already on the base branch: each one there
 *  must still exist, under the same name, with the same bytes, and every new
 *  one must sort after them. `base` and `head` map a file name to its
 *  content. */
export function mergedProblems(base, head) {
  const problems = [];
  for (const [file, content] of base) {
    if (!head.has(file))
      problems.push(
        `${file}: merged migrations are applied in production and must not be deleted or renamed; add a new migration instead`,
      );
    else if (head.get(file) !== content)
      problems.push(
        `${file}: merged migrations are applied in production and must not be edited; add a new migration instead`,
      );
  }
  // A new migration must sort after every merged one. The Deploy runner
  // applies any missing version, so a lower one still runs in production, but
  // after the newer merged files, while PGlite applies every file by name.
  // The two orders then differ.
  const newest = [...base.keys()]
    .map((f) => NAME.exec(f)?.[1])
    .filter(Boolean)
    .sort()
    .at(-1);
  if (newest)
    for (const file of head.keys()) {
      const version = NAME.exec(file)?.[1];
      if (!base.has(file) && version && version <= newest)
        problems.push(
          `${file}: a new migration must have a version above ${newest}, the newest merged one; production would apply it after that one while the tests apply it before`,
        );
    }
  return problems;
}

function readTree() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  return new Map(
    files.map((f) => [f, readFileSync(join(MIGRATIONS_DIR, f), "utf8")]),
  );
}

function readRef(ref) {
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20 });
  const files = git("ls-tree", "--name-only", `${ref}:${MIGRATIONS_DIR}`)
    .split("\n")
    .filter((f) => f.endsWith(".sql"));
  return new Map(
    files.map((f) => [f, git("show", `${ref}:${MIGRATIONS_DIR}/${f}`)]),
  );
}

function main(argv) {
  const at = argv.indexOf("--base");
  const baseRef = at === -1 ? null : argv[at + 1];
  if (at !== -1 && !baseRef) throw new Error("--base needs a git ref");
  const head = readTree();
  const problems = [
    ...versionProblems([...head.keys()]),
    ...(baseRef ? mergedProblems(readRef(baseRef), head) : []),
  ];
  if (problems.length) {
    for (const p of problems) console.error(`migration check: ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Migration check passed: ${head.size} files, every version used once` +
      (baseRef ? `, nothing merged into ${baseRef} changed.` : "."),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(process.argv.slice(2));
