/**
 * The dashboard is its own page now: every section is styled by the db-*
 * rules beside it, and `report.css` (still loaded by /sync, /account and
 * the admin page) never reaches it. These read the source as text so the
 * old sheet cannot creep back in through one import or one leftover class.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
const sources = readdirSync(here)
  .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
  .sort();

describe("the dashboard no longer loads report.css", () => {
  it("scans every section file", () => {
    expect(sources.length).toBeGreaterThan(5);
    expect(sources).toContain("Dashboard.tsx");
  });

  it("no dashboard file imports report.css", () => {
    for (const f of sources) {
      expect(read(`./${f}`), f).not.toContain("report.css");
    }
  });

  it("no dashboard file paints with an rp-* class", () => {
    for (const f of sources) {
      const src = read(`./${f}`);
      expect(src, f).not.toContain('className="rp-');
      expect(src, f).not.toContain("className={`rp-");
      expect(src, f).not.toMatch(/\brp-(card|section|page)\b/);
    }
  });

  it("main.tsx loads the page from ./dashboard/Dashboard", () => {
    const main = read("../main.tsx");
    expect(main).toContain('import("./dashboard/Dashboard")');
    expect(main).not.toContain('import("./Dashboard")');
  });
});
