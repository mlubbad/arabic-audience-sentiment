// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";
import { contrast } from "../palette";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const css = readFileSync(path.join(__dirname, "ui.css"), "utf8");
const brand = readFileSync(path.join(__dirname, "../brand.css"), "utf8");

const token = (name: string) =>
  brand.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))![1];

/** The same linear interpolation `color-mix(in srgb, a p%, b)` performs —
 *  used to check the badge's two literal hexes are that token computed, not
 *  a value of their own. See ui.css's comment on why they are literals
 *  rather than the live `color-mix()` expression. */
const mix = (a: string, b: string, pctA: number) => {
  const rgb = (h: string) =>
    [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const f = pctA / 100;
  return (
    "#" +
    [ar * f + br * (1 - f), ag * f + bg * (1 - f), ab * f + bb * (1 - f)]
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("")
  );
};

describe("Badge", () => {
  it("defaults to the neutral UI tone", () => {
    render(<Badge>جديد</Badge>);
    expect(screen.getByText("جديد")).toHaveClass(
      "ui-badge",
      "ui-badge--neutral",
    );
  });

  it.each([
    ["positive", "--sentiment-positive"],
    ["negative", "--sentiment-negative"],
    ["sentiment-mixed", "--sentiment-mixed"],
    ["sentiment-neutral", "--sentiment-neutral"],
  ] as const)(
    "the %s tone's CSS is brand.css's %s token, computed — never re-typed",
    (tone, tokenName) => {
      render(<Badge tone={tone}>x</Badge>);
      expect(screen.getByText("x")).toHaveClass(`ui-badge--${tone}`);
      // The rule under test is about the stylesheet, not computed pixels —
      // jsdom applies no stylesheet, so this reads ui.css's own source
      // rather than assuming a computed color reflects it.
      const rule = css.match(
        new RegExp(`\\.ui-badge--${tone}\\s*{[^}]*}`, "s"),
      )?.[0];
      expect(rule).toBeDefined();
      const hex = token(tokenName);
      // Written as the literal `color-mix()` would produce, not the live
      // expression — this build serializes a `color-mix()` result (on
      // either `color` or `background`) as `color(srgb 0..1 0..1 0..1)`,
      // which the e2e contrast-floor test's rgb(0-255) parser cannot read.
      // So the two values below are asserted as arithmetic, not text: each
      // must equal that token mixed by the documented ratio, which fails
      // the moment someone hand-picks a colour instead of recomputing.
      const expectedBg = mix(hex, "#ffffff", 14);
      const expectedFg = mix(hex, "#000000", 90);
      expect(rule?.toLowerCase()).toContain(`background: ${expectedBg}`);
      expect(rule?.toLowerCase()).toContain(`color: ${expectedFg}`);
      // And the pairing actually clears the 4.5:1 this text needs, not just
      // the 3:1 the token alone is measured to as a mark.
      expect(contrast(expectedFg, expectedBg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("marks a numeric badge with the numeral face", () => {
    render(
      <Badge numeric tone="danger">
        7
      </Badge>,
    );
    expect(screen.getByText("7")).toHaveClass("ui-num");
  });
});
