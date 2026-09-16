import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const uiDir = new URL(".", import.meta.url).pathname;

function letterSpacingDeclarations(text: string): string[] {
  return [...text.matchAll(/letter-spacing\s*:\s*([^;]+);/g)].map((m) =>
    m[1].trim(),
  );
}

describe("no component under apps/web/src/ui sets a non-zero letter-spacing", () => {
  it("ui.css", () => {
    const css = readFileSync(join(uiDir, "ui.css"), "utf8");
    const declarations = letterSpacingDeclarations(css);
    for (const value of declarations) {
      expect(["0", "0px"]).toContain(value);
    }
  });

  it("every .tsx component file (inline styles, style props)", () => {
    const files = readdirSync(uiDir).filter((f) => f.endsWith(".tsx"));
    for (const file of files) {
      const source = readFileSync(join(uiDir, file), "utf8");
      const declarations = letterSpacingDeclarations(source);
      expect(declarations, `${file} sets letter-spacing`).toHaveLength(0);
    }
  });
});
