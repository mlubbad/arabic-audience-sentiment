/** The canvas tooltip cannot read a CSS custom property, so its background is
 *  a literal rgba() copy of `--text-1`. This pins the copy to brand.css the
 *  same way `chartTheme.test.ts` pins the sentiment palette. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { barOptions, doughnutOptions, tooltip } from "./chartOptions";

const css = readFileSync(
  fileURLToPath(new URL("../brand.css", import.meta.url)),
  "utf8",
);
const token = (name: string) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`brand.css no longer defines --${name}`);
  return m[1];
};
const channels = (hex: string) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

describe("chart options", () => {
  it("the tooltip background equals --text-1", () => {
    const [r, g, b] = channels(token("text-1"));
    expect(tooltip().backgroundColor).toBe(`rgba(${r}, ${g}, ${b}, 0.92)`);
  });

  it("the shared axes always start the y scale at zero", () => {
    expect(barOptions.scales.y.beginAtZero).toBe(true);
  });

  it("the doughnut keeps its ring", () => {
    expect(doughnutOptions.cutout).toBe("62%");
  });
});
