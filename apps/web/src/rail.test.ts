/**
 * The rail is the one dark plane in the product, and until now nothing
 * measured it.
 *
 * Every other surface's ink is a token in `brand.css`, composited and checked
 * in `palette.test.ts` and `glass.test.ts`. The rail's is not: it is written
 * inline as `rgba(255, 255, 255, α)` against a ground that appears nowhere
 * else, so the whole contrast argument this interface spent a review earning
 * stops at its edge. A caption at α 0.38 sat at about 3.1:1 and nothing said
 * so — which is how it got there.
 *
 * These read the alphas out of `app.css` rather than repeating them, so an
 * edit to the stylesheet is what this test sees.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, over } from "./palette";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");
const brand = readFileSync(new URL("./brand.css", import.meta.url), "utf8");

/** The darkest point of the rail's own background — the plane the ink sits on.
 *  The radial wash on top of it only lightens, so this is the worst case.
 *  Read from the token, not copied: a copy here measured against a value that
 *  app.css could have moved away from. */
const RAIL_GROUND = brand.match(/--plane-dark:\s*(#[0-9a-fA-F]{6})/)![1];

function alphaOf(selector: string, prop = "color"): number {
  const block = css.slice(css.indexOf(selector));
  const decl = block.slice(0, block.indexOf("}"));
  const m = decl.match(
    new RegExp(`${prop}:\\s*rgba\\(255,\\s*255,\\s*255,\\s*([0-9.]+)\\)`),
  );
  if (!m) throw new Error(`no white ${prop} found in ${selector}`);
  return Number(m[1]);
}

const ink = (a: number) =>
  contrast(over(`rgba(255,255,255,${a})`, RAIL_GROUND), RAIL_GROUND);

describe("the rail's ink on its own dark plane", () => {
  it("holds 4.5:1 for every piece of text written on it", () => {
    // Each of these is text, and none of it is large: the owner line is 11px
    // and the caption 10.5px, which is exactly where 3:1 is not enough.
    expect(ink(alphaOf(".app-rail .app-brand small"))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(ink(alphaOf(".app-rail-caption"))).toBeGreaterThanOrEqual(4.5);
    expect(
      ink(alphaOf(".app-shell .app-rail .app-nav a", "color")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("holds 3:1 for the icon beside a destination", () => {
    // An icon is not text, but it is the thing that distinguishes one row
    // from the next before the label is read, so it carries meaning.
    expect(ink(alphaOf(".app-nav-mark"))).toBeGreaterThanOrEqual(3);
  });

  it("marks the current destination by more than colour", () => {
    // Fill alone fails anyone who cannot see the fill. The bar is the shape.
    const active = css.slice(
      css.indexOf('.app-shell .app-rail .app-nav a[aria-current="page"]::befo'),
    );
    expect(active.slice(0, active.indexOf("}"))).toContain(
      "inset-inline-start",
    );
  });

  it("puts every destination's icon on one vertical line", () => {
    // Two columns, the first fixed. The defect this replaces was a row layout
    // left behind by the top bar, under which each link sized itself to its
    // own label and no two icons shared an edge.
    const link = css.slice(css.indexOf(".app-shell .app-rail .app-nav a {"));
    const decl = link.slice(0, link.indexOf("}"));
    expect(decl).toMatch(/grid-template-columns:\s*20px/);
  });
});
