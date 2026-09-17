/** The landing page and the product must speak one language.
 *
 * A visitor learns words and colours here and then crosses into the dashboard.
 * When the two surfaces each keep their own copy, the crossing teaches them
 * that they were wrong about what they just learned — and nothing fails, so
 * nobody finds out.
 *
 * The landing page used to be one file (`Landing.tsx`); the 2026-09-17
 * cut-over split it into `landing/*.tsx`, so the checks below read every
 * non-test source file in that directory rather than a single path.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SENTIMENT } from "./chartTheme";
import { labels } from "./i18n";
import { contrast } from "./palette";

const landingDir = fileURLToPath(new URL("./landing", import.meta.url));
const sourceFiles = readdirSync(landingDir)
  .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
  .sort();
const cssFiles = readdirSync(landingDir).filter((f) => f.endsWith(".css"));

const raw = sourceFiles
  .map((f) => readFileSync(`${landingDir}/${f}`, "utf8"))
  .join("\n");
/** Comments stripped. This file explains what it replaced, quoting the old
 *  hexes — and the first run of the colour test below matched that explanation
 *  and reported it as the defect. The same trap caught `glass.test.ts`. */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const css = cssFiles
  .map((f) => readFileSync(`${landingDir}/${f}`, "utf8"))
  .join("\n");

describe("the landing speaks the product's language", () => {
  it("writes no sentiment word of its own", () => {
    // It used to carry a `name` per demo comment — "إيجابي", "مختلط",
    // "محايد", "سلبي" — beside the shared table that already held them.
    const body = src.slice(src.indexOf("const examples"));
    for (const word of Object.values(labels)) {
      expect(body.includes(`"${word}"`), word).toBe(false);
    }
    // The shared strings, through the same hook the product reads them with
    // — so the landing's four words are the dashboard's four words in either
    // language, not a copy that happens to match today.
    expect(raw).toContain('from "../strings"');
    expect(src).toContain("S.labels");
  });

  it("writes no sentiment colour of its own", () => {
    // And its own map: positive a purple #8470e9, negative a pink #eb819a. A
    // visitor learned one colour language here and met another the moment they
    // reached the dashboard, where positive is teal and negative is red.
    expect(src).not.toMatch(/#8470e9|#eb819a|#a5b1c6|#efbb65/);
    expect(css).not.toMatch(/#8470e9|#eb819a|#a5b1c6|#efbb65/);
    // The colour now comes from the same custom properties the dashboard
    // paints with (asserted byte-identical to `chartTheme.SENTIMENT` by
    // `chartTheme.test.ts`), rather than a JS map of its own.
    expect(css).toContain("var(--sentiment-positive)");
    expect(css).toContain("var(--sentiment-negative)");
  });

  it("uses marks that clear the floor it now inherits", () => {
    // The reason the dashboard's set won rather than the landing's: the
    // landing's four marks measured 3.84, 2.58, 2.60 and 1.83 on white, and a
    // mark carries meaning at 3:1.
    for (const [name, hex] of Object.entries(SENTIMENT)) {
      expect(contrast(hex, "#ffffff"), name).toBeGreaterThanOrEqual(3);
    }
  });
});
