/**
 * «اصطناع» (synthetic/artificial) is retired from every reader-facing and
 * test-facing surface in favour of «توضيحية» (illustrative) — see
 * docs/superpowers/sdd/2026-09-17-demo-data. This scans the source rather
 * than asserting on individual strings, so the word cannot creep back in
 * through a new file or a copy-pasted sentence that nobody thought to check
 * against this list.
 *
 * `apps/web/src/legal/*` is excluded: the legal texts are out of scope for
 * this wording pass and are not touched by it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url)); // apps/web/src/
const repoRoot = join(here, "..", "..", "..");

const WORD = "اصطناع";

function walk(
  dir: string,
  exts: string[],
  exclude: (p: string) => boolean = () => false,
) {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (exclude(full)) continue;
    if (entry.isDirectory()) {
      out.push(...walk(full, exts, exclude));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const self = fileURLToPath(import.meta.url); // this file names the word it forbids
// Unit tests may legitimately assert the word's *absence* (e.g.
// demoFixture.test.ts, Dashboard.identity.test.ts) — a substring scan cannot
// tell that assertion from an offending sentence, so, as noReportCss.test.ts
// does for its own scan, `.test.ts`/`.test.tsx` files are not source here.
// `tests/e2e/*.ts` is scanned separately below and is not exempted: those are
// the quoted strings a real e2e spec reads off the rendered page.
const srcFiles = walk(
  here,
  [".ts", ".tsx"],
  (p) =>
    p.includes(`${join(here, "legal")}`) ||
    p === self ||
    p.endsWith(".test.ts") ||
    p.endsWith(".test.tsx"),
);

const fixtureFiles = walk(join(repoRoot, "apps/web/public/fixtures"), [
  ".json",
]);

const e2eDir = join(repoRoot, "tests/e2e");
const e2eFiles = readdirSync(e2eDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => join(e2eDir, f));

function assertClean(files: string[], label: string) {
  const offenders = files
    .map((f) => ({ f, hit: readFileSync(f, "utf8").includes(WORD) }))
    .filter((r) => r.hit)
    .map((r) => relative(repoRoot, r.f));
  expect(
    offenders,
    `${label} contains «${WORD}»: ${offenders.join(", ")}`,
  ).toEqual([]);
}

describe("no reader- or test-facing text uses «اصطناع» any more", () => {
  it("scans a non-trivial number of files in each group", () => {
    expect(srcFiles.length).toBeGreaterThan(20);
    expect(fixtureFiles.length).toBeGreaterThan(0);
    expect(e2eFiles.length).toBeGreaterThan(0);
  });

  it("apps/web/src/**/*.{ts,tsx} (excluding legal/)", () => {
    assertClean(srcFiles, "apps/web/src");
  });

  it("apps/web/public/fixtures/*.json", () => {
    assertClean(fixtureFiles, "apps/web/public/fixtures");
  });

  it("tests/e2e/*.ts", () => {
    assertClean(e2eFiles, "tests/e2e");
  });
});
