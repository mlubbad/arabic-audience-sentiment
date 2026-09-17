/**
 * `report.css` is gone, and stays gone.
 *
 * It was the analytical report's sheet; by the end of phase 4 the dashboard,
 * the operations page and the admin page each carry their own db-* rules
 * beside them, and the account page — its last reader — took the rules it
 * used into a verbatim `account.css` until phase 5 recomposed it under
 * `account/` with rules of its own, and task 7 struck the last `rp-*` blocks
 * from `app.css` itself. These read the source as text so the old sheet
 * cannot creep back in: not as a file, not through one import, not through
 * one leftover `rp-*` class on a page that was rebuilt without it, and not
 * through one `.rp-*` selector re-declared in any stylesheet. The guard now
 * has no exceptions — no allow-list, no page still owed a pass.
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
const styles = files.filter((f) => f.endsWith(".css"));

describe("report.css is gone", () => {
  it("walks the whole source tree", () => {
    expect(components.length).toBeGreaterThan(50);
    expect(components).toContain("account/Account.tsx");
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

  it("the account page loads its own account/account.css in its place", () => {
    expect(read("account/Account.tsx")).toContain('import "./account.css"');
    expect(existsSync(join(src, "account/account.css"))).toBe(true);
    // The verbatim copy of report.css's account rules is gone with phase 5.
    expect(existsSync(join(src, "account.css"))).toBe(false);
    expect(existsSync(join(src, "Account.tsx"))).toBe(false);
  });

  it("no component paints with an rp-* class", () => {
    // Class names only: the dashboard's sections legitimately keep `rp-*`
    // as element ids and anchors (`id="rp-videos"`, `#rp-comments-title`),
    // which are addresses, not paint. No file is exempt from this any more —
    // `account/Account.tsx` (task 5) and `SetupPath.tsx` were the last two
    // to carry the class, and neither does now.
    for (const f of components) {
      const s = read(f);
      expect(s, f).not.toContain('className="rp-');
      expect(s, f).not.toContain("className={`rp-");
      expect(s, f).not.toMatch(/className=\{[^}]*["'`]rp-/);
      expect(s, f).not.toMatch(/\brp-(card|section|page)\b/);
    }
  });

  it("no stylesheet declares an rp-* selector", () => {
    // app.css's last `.rp-*` blocks (the hero, the filters, the section and
    // card rules) went with task 7. This is the remainder guard: a `.rp-`
    // selector — or a comment naming one — may not creep back into any sheet
    // under src, in app.css or anywhere else.
    for (const f of styles) {
      expect(read(f), f).not.toContain(".rp-");
    }
  });

  it("main.tsx loads the page from ./dashboard/Dashboard", () => {
    const main = read("main.tsx");
    expect(main).toContain('import("./dashboard/Dashboard")');
    expect(main).not.toContain('import("./Dashboard")');
  });
});
