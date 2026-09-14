import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The deployment's cache policy, read from the file the host actually serves.
//
// This is tested here rather than against the live site because the failure it
// guards is unrecoverable from this repository: the preview sits behind a CDN
// with no purge credential, so a response cached wrongly stays cached for as
// long as it was told to, and the only escape is to rename every file. That
// happened on 2026-09-15 and cost a deploy.
//
// What the rules below are shaped by, measured against the deployed host
// rather than assumed from the manual:
//
//   * a plain `Header set` reaches the 401 challenge — that is how the outage
//     happened, and it is also the only way to put a header on an error here;
//   * a directive carrying an `expr` never reaches the 401, in any form that
//     was tried. A condition can withhold a header from a failure. It cannot
//     add one to it.
//
// So the refusal has to be unconditional and first, and the promise has to be
// the exception on top. The order is the guarantee.
const source = readFileSync(
  new URL("../public/.htaccess", import.meta.url),
  "utf8",
)
  // A directive continued onto the next line is still one directive.
  .replace(/\\\n\s*/g, " ");

/** Each `<FilesMatch …>` block, with its directives in source order. */
const blocks = [
  ...source.matchAll(/<FilesMatch\s+([^>]*)>([\s\S]*?)<\/FilesMatch>/g),
].map((m) => ({
  pattern: m[1],
  directives: m[2]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^Header\b/i.test(line)),
}));

/** A directive that lets a shared cache keep a copy and reuse it later. */
const stores = (d: string) =>
  /Cache-Control/i.test(d) &&
  !/no-store/i.test(d) &&
  (/immutable/i.test(d) ||
    /max-age=(?!0\b)\d+/i.test(d) ||
    /no-cache/i.test(d));

describe("the preview host's cache policy", () => {
  it("has blocks that set a cache policy, or there is nothing to check", () => {
    // Without this the rules below would pass on an empty file, which is the
    // shape of assertion that let the original bug through elsewhere in this
    // codebase: a rule about every member of an empty set.
    const withPolicy = blocks.filter((b) =>
      b.directives.some((d) => /Cache-Control/i.test(d)),
    );
    expect(withPolicy.length).toBeGreaterThan(0);
  });

  it("refuses storage unconditionally before promising anything", () => {
    // `immutable` is a promise about a body. The 401 challenge is served *for*
    // the requested filename and matches any rule that selects on it, so a
    // block that opens with the promise hands it to the error page — and a CDN
    // that believes it serves the error in place of the JavaScript for a year,
    // to authenticated and unauthenticated requests alike.
    for (const block of blocks) {
      const policy = block.directives.filter((d) => /Cache-Control/i.test(d));
      if (policy.length === 0) continue;
      const refusal = policy.findIndex(
        (d) => /no-store/i.test(d) && !/expr=/.test(d),
      );
      expect(
        refusal,
        `${block.pattern} never refuses storage unconditionally`,
      ).toBeGreaterThanOrEqual(0);
      policy.forEach((directive, i) => {
        if (stores(directive)) {
          expect(
            i,
            `${block.pattern}: ${directive} comes before the refusal`,
          ).toBeGreaterThan(refusal);
        }
      });
    }
  });

  it("only ever lets a success be stored", () => {
    for (const block of blocks) {
      for (const directive of block.directives.filter(stores)) {
        expect(directive).toMatch(/expr=%\{REQUEST_STATUS\}\s*==\s*200/);
      }
    }
  });

  it("does not state a condition in a form this host ignores", () => {
    // `Header always set` with an `expr` never fires here, and neither does
    // `>=`, which is Apache's string comparison rather than its numeric one.
    // Two versions of the refusal were lost to those before anyone read a
    // response header. A rule that never runs is indistinguishable from a rule
    // that ran and had nothing to do, which is why this is worth a test.
    for (const directive of source
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^Header\b/i.test(l) && /expr=/.test(l))) {
      expect(directive).not.toMatch(/Header\s+always\s+set/i);
    }
    expect(source).not.toMatch(/%\{REQUEST_STATUS\}\s*>=/);
  });

  it("keeps the password on the deployment", () => {
    // The same file carries the only thing making this preview private. A
    // rewrite of it for cache reasons must not quietly drop that.
    expect(source).toMatch(/^Require valid-user$/m);
    expect(source).toMatch(/^AuthType Basic$/m);
  });
});
