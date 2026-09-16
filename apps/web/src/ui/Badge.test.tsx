// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const css = readFileSync(path.join(__dirname, "ui.css"), "utf8");

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
    (tone, token) => {
      render(<Badge tone={tone}>x</Badge>);
      expect(screen.getByText("x")).toHaveClass(`ui-badge--${tone}`);
      // The rule under test is about the stylesheet, not computed pixels —
      // jsdom applies no stylesheet, so this reads ui.css's own source
      // rather than assuming a computed color reflects it.
      const rule = css.match(
        new RegExp(`\\.ui-badge--${tone}\\s*{[^}]*}`, "s"),
      )?.[0];
      expect(rule).toBeDefined();
      expect(rule).toContain(`var(${token})`);
      // And never a bare hex triplet standing in for that token.
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}/);
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
