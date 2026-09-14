/** The canvas copy of the palette must equal the stylesheet's. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrast } from "./palette";
import { AXIS_TEXT, SENTIMENT, VOLUME } from "./chartTheme";

const css = readFileSync(
  fileURLToPath(new URL("./brand.css", import.meta.url)),
  "utf8",
);
const token = (name: string) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`brand.css no longer defines --${name}`);
  return m[1];
};

describe("chart theme", () => {
  it.each(Object.keys(SENTIMENT))("%s matches brand.css", (label) => {
    expect(SENTIMENT[label as keyof typeof SENTIMENT]).toBe(
      token(`sentiment-${label}`),
    );
  });

  // Axis labels are the smallest type in the interface and the easiest place
  // to lose a reader, so they are held to the text threshold like any label.
  it("axis text is legible on the card", () => {
    expect(contrast(AXIS_TEXT, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  // Bars are marks, not text: 3:1 is the bar, and a fill that drops below it
  // disappears into the card for anyone reading on a dim or glare-lit screen.
  it("the volume fill holds against the card", () => {
    expect(contrast(VOLUME, "#ffffff")).toBeGreaterThanOrEqual(3);
  });
});
