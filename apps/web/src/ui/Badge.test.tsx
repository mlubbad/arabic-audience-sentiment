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
 *  used only to check that the *mix itself* clears the 4.5:1 this badge's
 *  text needs. No hex from this ever reaches an assertion against ui.css:
 *  the stylesheet keeps the live `color-mix()` expression (see its own
 *  comment on why), so the arithmetic below is checked against the token
 *  read from brand.css, not against a literal in the CSS. */
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
    "the %s tone's CSS reads brand.css's %s token, not a re-typed value",
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
      expect(rule).toContain(`var(${tokenName})`);
      // And never a bare hex triplet standing in for that token.
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      // The token itself only clears the 3:1 a mark needs (a dot, a bar);
      // set as this badge's own 14px text it needs 4.5:1 — checked here as
      // arithmetic on the token, since the CSS above is the live
      // `color-mix()` expression and carries no hex to read a value from.
      const hex = token(tokenName);
      const expectedBg = mix(hex, "#ffffff", 14);
      const expectedFg = mix(hex, "#000000", 90);
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
