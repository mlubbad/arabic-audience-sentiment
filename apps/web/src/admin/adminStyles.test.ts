import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Each admin page is its own lazy chunk; a stylesheet imported by only one of
// them reaches the others only after that one has loaded. /admin/services,
// opened directly, painted without its layout (2026-10-06).
describe("admin styles", () => {
  const dir = new URL(".", import.meta.url);
  const read = (f: string) => readFileSync(new URL(f, dir), "utf8");

  it("travel with the shell every admin page renders through", () => {
    const shell = read("AdminShell.tsx");
    expect(shell).toMatch(/import "\.\/admin\.css";/);
    expect(shell).toMatch(/import "\.\.\/pages\.css";/);
  });

  // At 390px the import card ran 23px past the screen: a native file input's
  // own width set the grid column's floor (owner console review, finding 21;
  // measured in a browser, 413 → 390 px with this rule). jsdom lays nothing
  // out, so the rule itself is what is held here.
  it("lets the import column shrink below the file input's own width", () => {
    const css = read("admin.css");
    const rule = (selector: string) =>
      css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule("\\.admin-import")).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(rule('\\.admin-import-file input\\[type="file"\\]')).toMatch(
      /max-width:\s*100%/,
    );
  });

  it("every admin page renders through the shell", () => {
    const pages = readdirSync(dir).filter(
      (f) => /^Admin\w*Page\.tsx$/.test(f) && f !== "AdminShell.tsx",
    );
    expect(pages.length).toBeGreaterThanOrEqual(7);
    for (const page of pages)
      expect(read(page)).toMatch(/useAdminShell|AdminShell/);
  });
});
