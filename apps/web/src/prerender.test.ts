/** The two files the prerender depends on and cannot check at build time:
 *  the template it fills and the host rules that serve what it wrote. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");

describe("the template", () => {
  const html = read("../index.html");
  it("carries no title, description or robots of its own", () => {
    // Every public page renders these (PageHead.tsx) and the prerender
    // writes them into this head. A static copy here would be a second
    // title on every page, a description that contradicts the page's, and —
    // for robots — a `noindex` that wins over the page's `index` on the day
    // the flag is flipped.
    expect(html).not.toMatch(/<title>/);
    expect(html).not.toMatch(/name="description"/);
    expect(html).not.toMatch(/name="robots"/);
  });
  it("has the one empty root the prerender fills and the shell renders into", () => {
    expect(html.match(/<div id="root"><\/div>/g)).toHaveLength(1);
  });
});

describe("the host rules", () => {
  const rules = read("../public/.htaccess");
  it("serve a prerendered page for its bare address before falling back", () => {
    const prerendered = rules.indexOf("/$1/index.html");
    const fallback = rules.indexOf("/app.html");
    expect(prerendered).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(prerendered);
  });
  it("fall back to the empty template, never to the prerendered landing", () => {
    // `RewriteRule . /index.html` would hand the landing's markup to
    // /dashboard, which the shell would hydrate against and discard.
    expect(rules).not.toMatch(/RewriteRule\s+\.\s+\/index\.html/);
    expect(rules).toMatch(/RewriteRule\s+\.\s+\/app\.html\s+\[L\]/);
  });
  it("still refuse indexing until the build removes the line", () => {
    expect(rules).toMatch(/X-Robots-Tag "noindex, nofollow"/);
  });
});
