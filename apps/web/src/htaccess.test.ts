import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The deployment's cache policy, read from the file the host actually serves.
//
// This is tested here rather than against the live site because the failure it
// guards is unrecoverable from this repository: the preview sits behind a CDN
// with no purge credential, so a response cached wrongly stays cached for as
// long as it was told to, and the only escape is to rename every file. That
// happened on 2026-09-15 and cost a deploy.
const source = readFileSync(
  new URL("../public/.htaccess", import.meta.url),
  "utf8",
)
  // A directive continued onto the next line is still one directive.
  .replace(/\\\n\s*/g, " ");

const headerDirectives = source
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => /^Header\b/i.test(line));

/** Directives that let a shared cache keep a copy and reuse it later. */
const storing = headerDirectives.filter(
  (d) =>
    /Cache-Control/i.test(d) &&
    (/immutable/i.test(d) || /max-age=(?!0\b)\d+/i.test(d)),
);

describe("the preview host's cache policy", () => {
  it("has a rule that caches the bundle, or there is nothing to check", () => {
    // Without this the two tests below would pass on an empty file, which is
    // the shape of assertion that let the original bug through elsewhere in
    // this codebase: a rule about every member of an empty set.
    expect(storing.length).toBeGreaterThan(0);
  });

  it("never lets a cache store a response that is not the file asked for", () => {
    // `immutable` is a promise about a body. The 401 challenge is served *for*
    // the requested filename and matches any rule that selects on it, so an
    // unguarded rule hands that promise to the error page — and a CDN that
    // believes it will serve the error in place of the JavaScript for a year,
    // to authenticated and unauthenticated requests alike.
    for (const directive of storing) {
      expect(directive).toMatch(/expr=%\{REQUEST_STATUS\}\s*==\s*200/);
    }
  });

  it("marks anything that went wrong as unstorable, whatever matched it", () => {
    // The guard above protects the rules that exist today. This one survives
    // the next `FilesMatch` somebody adds without thinking about failures.
    //
    // `-ge`, not `>=`: Apache's `>=` is a string comparison, and the first
    // version of this rule used it, never fired, and left the 401 with no
    // Cache-Control for the CDN to fill in with a default. Rejecting the
    // string form here is the point of the test, not pedantry about syntax.
    const refusals = headerDirectives.filter(
      (d) =>
        /always\s+set\s+Cache-Control/i.test(d) &&
        /no-store/i.test(d) &&
        /expr=%\{REQUEST_STATUS\}\s*(?:-ge\s*400|!=\s*200)/.test(d),
    );
    expect(refusals.length).toBeGreaterThan(0);
    expect(source).not.toMatch(/%\{REQUEST_STATUS\}\s*>=/);
  });

  it("refuses to store a failure for the bundle specifically", () => {
    // The blanket rule above is the safety net. The rule inside the pattern
    // that caused the outage is the one that has to hold on its own, because
    // it is the only one written in an operator this host was measured
    // evaluating.
    const bundleRule = headerDirectives.find(
      (d) =>
        /always\s+set\s+Cache-Control/i.test(d) &&
        /no-store/i.test(d) &&
        /expr=%\{REQUEST_STATUS\}\s*!=\s*200/.test(d),
    );
    expect(bundleRule).toBeDefined();
  });

  it("keeps the password on the deployment", () => {
    // The same file carries the only thing making this preview private. A
    // rewrite of it for cache reasons must not quietly drop that.
    expect(source).toMatch(/^Require valid-user$/m);
    expect(source).toMatch(/^AuthType Basic$/m);
  });
});
