/**
 * `report.css` is gone, and stays gone.
 *
 * It was the analytical report's sheet; by the end of phase 4 the dashboard,
 * the operations page and the admin page each carry their own db-* rules
 * beside them, and the account page — its last reader — took the rules it
 * uses into `account.css`, verbatim, pending phase 5. These read the source
 * as text so the old sheet cannot creep back in: not as a file, not through
 * one import, and not through one leftover `rp-*` class on a page that was
 * rebuilt without it.
 *
 * The guard used to sit in `dashboard/` and cover that directory alone; it
 * now walks all of `apps/web/src`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL(".", import.meta.url));

/** Every file under `src`, as a path relative to it, in a stable order. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(relative(src, full));
  }
  return out;
}
const files = walk(src);
const read = (rel: string) => readFileSync(join(src, rel), "utf8");
const code = files.filter((f) => /\.(tsx?|mjs|css)$/.test(f));
const components = files.filter(
  (f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"),
);

/**
 * The account page and the components it renders keep their `rp-*` classes
 * until phase 5 recomposes it on `ui/`; `account.css` carries the rules they
 * match. `DeleteWorkspaceDialog.tsx` is the admin page's, not this page's,
 * and wears none. `PlanPanel.tsx` moved to `account/PlanPanel.tsx` on `ui/`
 * (task 2) and paints no `rp-*` class any more, so it is off this list; of
 * the rest, only `Account.tsx` still paints with `rp-*` today — the other
 * two are listed as the page's children so a class moved between them
 * during phase 5 does not trip the guard mid-move.
 */
const KEEPS_RP_UNTIL_PHASE_5 = new Set([
  "Account.tsx",
  "WorkspaceCard.tsx",
  "SetupPath.tsx",
]);

describe("report.css is gone", () => {
  it("walks the whole source tree", () => {
    expect(components.length).toBeGreaterThan(50);
    expect(components).toContain("Account.tsx");
    expect(components).toContain("dashboard/Dashboard.tsx");
    expect(components).toContain("admin/AdminPage.tsx");
    expect(components).toContain("ops/Sync.tsx");
  });

  it("the file does not exist", () => {
    expect(existsSync(join(src, "report.css"))).toBe(false);
  });

  it("no file imports it", () => {
    for (const f of code) {
      // A comment may still name the old sheet as history; an import may not.
      const imports = read(f)
        .split("\n")
        .filter((line) => /^\s*(import\b|@import\b)/.test(line));
      expect(imports.join("\n"), f).not.toContain("report.css");
    }
  });

  it("the account page loads account.css in its place", () => {
    expect(read("Account.tsx")).toContain('import "./account.css"');
    expect(existsSync(join(src, "account.css"))).toBe(true);
  });

  it("no component outside the account page paints with an rp-* class", () => {
    // Class names only: the dashboard's sections legitimately keep `rp-*`
    // as element ids and anchors (`id="rp-videos"`, `#rp-comments-title`),
    // which are addresses, not paint.
    for (const f of components) {
      if (KEEPS_RP_UNTIL_PHASE_5.has(f)) continue;
      const s = read(f);
      expect(s, f).not.toContain('className="rp-');
      expect(s, f).not.toContain("className={`rp-");
      expect(s, f).not.toMatch(/className=\{[^}]*["'`]rp-/);
      expect(s, f).not.toMatch(/\brp-(card|section|page)\b/);
    }
  });

  it("the allow-list is the true remainder", () => {
    // A file struck from the page's rp-* wardrobe is struck from the list
    // too, so the list never quietly covers more than it has to.
    for (const f of KEEPS_RP_UNTIL_PHASE_5) expect(components).toContain(f);
    const painting = [...KEEPS_RP_UNTIL_PHASE_5].filter((f) =>
      /className="rp-/.test(read(f)),
    );
    expect(painting.sort()).toEqual(["Account.tsx"]);
  });

  it("main.tsx loads the page from ./dashboard/Dashboard", () => {
    const main = read("main.tsx");
    expect(main).toContain('import("./dashboard/Dashboard")');
    expect(main).not.toContain('import("./Dashboard")');
  });
});
