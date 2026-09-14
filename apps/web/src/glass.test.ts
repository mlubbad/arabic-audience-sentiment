/** Glass costs contrast, so the contrast is asserted rather than hoped for.
 *
 * A translucent surface has the colour of whatever is behind it. That is the
 * whole appeal of the material and the whole danger: the text on it has no
 * fixed contrast at all unless the ground is fixed too. The system fixes the
 * ground; this proves the arithmetic works out for the worst one the page can
 * actually present.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrast, over } from "./palette";

const read = (f: string) =>
  readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
const glass = read("./glass.css");
const brand = read("./brand.css");

const token = (css: string, name: string, pattern = "[^;]+") => {
  const m = css.match(new RegExp(`--${name}:\\s*(${pattern});`));
  if (!m) throw new Error(`token --${name} is gone`);
  return m[1].trim();
};

/** The darkest the page ground gets: the ground itself under its own wash. */
const GROUND = token(glass, "glass-ground", "#[0-9a-fA-F]{6}");
const WASH_INDIGO = "rgba(107, 89, 232, 0.14)";
const DARKEST_GROUND = over(WASH_INDIGO, GROUND);

const INKS = {
  "fg-1": token(brand, "fg-1", "#[0-9a-fA-F]{6}"),
  "fg-2": token(brand, "fg-2", "#[0-9a-fA-F]{6}"),
  "fg-3": token(brand, "fg-3", "#[0-9a-fA-F]{6}"),
  "sentiment-positive": token(brand, "sentiment-positive", "#[0-9a-fA-F]{6}"),
  "sentiment-negative": token(brand, "sentiment-negative", "#[0-9a-fA-F]{6}"),
  "sentiment-neutral": token(brand, "sentiment-neutral", "#[0-9a-fA-F]{6}"),
  "sentiment-mixed": token(brand, "sentiment-mixed", "#[0-9a-fA-F]{6}"),
};

describe.each(["glass-1-tint", "glass-2-tint", "glass-3-tint"])(
  "%s over the darkest ground",
  (level) => {
    const surface = over(token(glass, level), DARKEST_GROUND);

    it.each(Object.entries(INKS))(`keeps %s legible`, (_name, ink) => {
      expect(contrast(ink, surface)).toBeGreaterThanOrEqual(4.5);
    });
  },
);

describe("the tinted pane", () => {
  it("keeps white text legible over the page", () => {
    // The brand pane carries white text, so its floor runs the other way:
    // the tint has to be opaque enough that the ground cannot lighten it.
    const surface = over(token(glass, "glass-brand-tint"), "#ffffff");
    expect(contrast("#ffffff", surface)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the material's own rules", () => {
  it("declares a solid before every blur", () => {
    // A pane that reaches for backdrop-filter without a background behind it
    // is invisible wherever the filter is unavailable or switched off.
    // Comments are stripped first: this file explains the rule in prose more
    // than once, and the first run of this test was reading the explanation
    // and reporting it as a violation.
    const rules = glass.replace(/\/\*[\s\S]*?\*\//g, "");
    const blocks = rules
      .split("}")
      .filter((b) => b.includes("backdrop-filter"));
    expect(blocks.length).toBeGreaterThan(3);
    for (const block of blocks) {
      expect(block, block.trim().slice(0, 70)).toMatch(/background:/);
    }
  });

  it("collapses to solid when transparency is reduced", () => {
    // Apple ships the switch because the material genuinely costs some people
    // legibility. A thinner blur is not honouring it.
    expect(glass).toMatch(/prefers-reduced-transparency: reduce/);
    expect(glass).toMatch(/prefers-contrast: more/);
    const guard = glass.slice(glass.indexOf("prefers-reduced-transparency"));
    expect(guard).toMatch(/backdrop-filter: none/);
  });
});
