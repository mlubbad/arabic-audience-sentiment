import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  MIGRATIONS_DIR,
  mergedProblems,
  versionProblems,
} from "./check-migrations.mjs";

// 2026-10-18: #167 reused 20261112000000, which #166 had just applied in
// production, so the Deploy runner would have skipped the fix silently.
describe("migration versions", () => {
  test("a version used by two files is refused, naming both", () => {
    const problems = versionProblems([
      "20261112000000_genre_taxonomy_v2.sql",
      "20261112000000_unblock_one_job_per_channel.sql",
      "20261111010000_dashboard_aggregates_cache.sql",
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("version 20261112000000 is used by 2 files");
    expect(problems[0]).toContain("20261112000000_genre_taxonomy_v2.sql");
    expect(problems[0]).toContain(
      "20261112000000_unblock_one_job_per_channel.sql",
    );
  });

  test("a name without a 14-digit version or with capitals is refused", () => {
    expect(versionProblems(["2026111200_short.sql"])).toHaveLength(1);
    expect(versionProblems(["20261112000000-dash.sql"])).toHaveLength(1);
    expect(versionProblems(["20261112000000_Upper.sql"])).toHaveLength(1);
  });

  test("distinct versions pass, and files that are not .sql are ignored", () => {
    expect(
      versionProblems([
        "20261112000000_a.sql",
        "20261112010000_b.sql",
        "README.md",
      ]),
    ).toEqual([]);
  });

  test("the repository's migrations pass", () => {
    expect(versionProblems(readdirSync(MIGRATIONS_DIR))).toEqual([]);
  });
});

describe("merged migrations", () => {
  const base = new Map([
    ["20261111000000_a.sql", "select 1;\n"],
    ["20261112000000_b.sql", "select 2;\n"],
  ]);

  test("unchanged, with new files added, passes", () => {
    const head = new Map([...base, ["20261113000000_c.sql", "select 3;\n"]]);
    expect(mergedProblems(base, head)).toEqual([]);
  });

  test("an edited, a deleted and a renamed migration are each refused", () => {
    const edited = new Map(base).set("20261112000000_b.sql", "select 22;\n");
    expect(mergedProblems(base, edited)).toEqual([
      expect.stringContaining("20261112000000_b.sql: merged migrations"),
    ]);
    const deleted = new Map(base);
    deleted.delete("20261111000000_a.sql");
    expect(mergedProblems(base, deleted)[0]).toContain("must not be deleted");
    const renamed = new Map(base);
    renamed.delete("20261112000000_b.sql");
    renamed.set("20261112010000_b.sql", "select 2;\n");
    expect(mergedProblems(base, renamed)[0]).toContain("renamed");
  });
});

describe("the check runs where it matters", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  test("npm run check and CI's static job run it", () => {
    expect(pkg.scripts["check:migrations"]).toBe(
      "node scripts/check-migrations.mjs",
    );
    expect(pkg.scripts.check).toContain("npm run check:migrations");
    expect(ci).toMatch(/^\s+- run: npm run check:migrations$/m);
  });

  test("on a pull request CI also compares against the base branch, without interpolating it into the shell", () => {
    expect(ci).toContain(
      'node scripts/check-migrations.mjs --base "origin/$BASE_REF"',
    );
    expect(ci).toContain("BASE_REF: ${{ github.base_ref }}");
    expect(ci).not.toMatch(/run:.*\$\{\{ github\.base_ref \}\}/);
  });

  test("the Deploy runner refuses to apply when two files share a version", () => {
    const runner = readFileSync("scripts/apply-migrations-remote.mjs", "utf8");
    expect(runner).toContain("versionProblems");
  });

  test("the script exits non-zero on a duplicate in a real tree", () => {
    const root = mkdtempSync(join(tmpdir(), "migrations-"));
    const dir = join(root, MIGRATIONS_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "20261112000000_a.sql"), "select 1;\n");
    writeFileSync(join(dir, "20261112000000_b.sql"), "select 2;\n");
    const script = resolve("scripts/check-migrations.mjs");
    let status = 0;
    let stderr = "";
    try {
      execFileSync("node", [script], { cwd: root, stdio: "pipe" });
    } catch (error) {
      const failed = error as { status: number; stderr: Buffer };
      status = failed.status;
      stderr = failed.stderr.toString();
    }
    rmSync(root, { recursive: true, force: true });
    expect(status).toBe(1);
    expect(stderr).toContain("version 20261112000000 is used by 2 files");
  });
});
