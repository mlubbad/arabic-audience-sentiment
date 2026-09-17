/**
 * The mark is drawn once, and every file that carries it is drawn from that.
 *
 * Before this, the four bars were painted by CSS in three places with two
 * different roses. Each of these reads a file as text and asserts the shape
 * cannot come back: no stylesheet draws bars, the component and the favicon
 * share one geometry, and the rose is the brand's token on every surface.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BRAND_MARK_BARS,
  BRAND_MARK_ROTATION,
  brandMarkSvg,
} from "./brandMark.geometry.mjs";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
const brand = read("./brand.css");
const token = (name: string) =>
  brand.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))![1];

describe("the brand mark has one drawing", () => {
  it("no stylesheet paints the bars any more", () => {
    for (const css of [
      "./app.css",
      "./landing/landing.css",
      "./landing/product-window.css",
      "./landing/closing.css",
      "./public/public.css",
      "./report.css",
      "./style.css",
    ]) {
      expect(read(css), css).not.toMatch(/\.lp-mark\s+i\b/);
    }
  });

  it("the component draws every bar from the shared table, rose from the token", () => {
    const src = read("./BrandMark.tsx");
    expect(src).toContain('from "./brandMark.geometry.mjs"');
    expect(src).toContain('"var(--ml-rose)"');
    // Not a literal anywhere in the component: the token is the only rose.
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("the favicon is the same geometry with brand.css's own colours", () => {
    const favicon = read("../public/favicon.svg");
    expect(favicon).toBe(
      brandMarkSvg({ indigo: token("--ml-indigo"), rose: token("--ml-rose") }),
    );
    for (const b of BRAND_MARK_BARS) {
      expect(favicon).toContain(
        `x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"`,
      );
    }
    expect(favicon).toContain(`rotate(${BRAND_MARK_ROTATION} 256 256)`);
  });

  it("exactly one bar is rose, and it is the last", () => {
    expect(BRAND_MARK_BARS.map((b) => b.rose)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("index.html links the icon set", () => {
    const html = read("../index.html");
    expect(html).toContain(
      'rel="icon" href="/favicon.svg" type="image/svg+xml"',
    );
    expect(html).toContain(
      'rel="apple-touch-icon" href="/apple-touch-icon.png"',
    );
    expect(html).toContain('rel="manifest" href="/site.webmanifest"');
  });
});
