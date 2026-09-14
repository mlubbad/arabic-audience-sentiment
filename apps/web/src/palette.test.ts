/** The palette's gates, asserted against brand.css itself.
 *
 * The tokens are read out of the stylesheet rather than repeated here. A test
 * that carries its own copy of the hexes passes for ever while the interface
 * drifts away from it — it would assert that some colours are legible, not
 * that these ones are.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrast, deltaE } from "./palette";

const css = readFileSync(
  fileURLToPath(new URL("./brand.css", import.meta.url)),
  "utf8",
);
const token = (name: string) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`brand.css no longer defines --${name}`);
  return m[1];
};

/** The two grounds these colours are actually read on. */
const CARD = "#ffffff";
const MUTED = "#f3f2f8";

const SENTIMENT = ["positive", "negative", "neutral", "mixed"] as const;
const STATUS = ["success", "warning", "danger"] as const;

describe("sentiment scale", () => {
  // Every one of these is worn as chip text at 11.5px before it is ever a
  // swatch, so the text threshold is the binding one — the mark threshold of
  // 3:1 comes free once it is met.
  it.each(SENTIMENT)("%s is legible as a label on the card", (name) => {
    expect(contrast(token(`sentiment-${name}`), CARD)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each(SENTIMENT)("%s is legible as a label on the muted panel", (name) => {
    expect(contrast(token(`sentiment-${name}`), MUTED)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  // The whole product is the distinction between these two. A palette that
  // merges them for a red-green reader has removed the answer, not the decor.
  it.each(["protan", "deutan"] as const)(
    "keeps positive and negative apart under %s vision",
    (kind) => {
      const separation = deltaE(
        token("sentiment-positive"),
        token("sentiment-negative"),
        kind,
      );
      expect(separation).toBeGreaterThanOrEqual(8);
    },
  );

  // Slices that touch, in the order the donut draws them — the last wraps
  // round to the first, so that pair is checked too. Only touching pairs:
  // two colours separated by a labelled slice are told apart by the label.
  // A pair a full-colour reader cannot separate is the harder failure, so
  // this floor sits above the colourblind one.
  it("keeps every touching pair apart, for normal and for colourblind sight", () => {
    const ring = SENTIMENT.map((s) => token(`sentiment-${s}`));
    for (let i = 0; i < ring.length; i++) {
      const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
      expect(deltaE(a, b), `${a} touches ${b}`).toBeGreaterThanOrEqual(15);
      for (const kind of ["protan", "deutan"] as const)
        expect(
          deltaE(a, b, kind),
          `${a} touches ${b} (${kind})`,
        ).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("status scale", () => {
  it.each(STATUS)("%s is legible as text on both surfaces", (name) => {
    expect(contrast(token(`color-${name}`), CARD)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(`color-${name}`), MUTED)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("focus ring", () => {
  // One ring colour cannot survive both a white card and an indigo button;
  // the pair has to, because focus is the only thing telling a keyboard user
  // where they are. Each tone is checked on the ground it is there to cover.
  const PALE = [CARD, MUTED, "#fbfafe"];
  const DARK = ["#3b27ba", "#292541"];

  it("carries on pale surfaces", () => {
    for (const bg of PALE)
      expect(contrast(token("focus-ring"), bg)).toBeGreaterThanOrEqual(3);
  });

  it("carries on the brand's dark surfaces", () => {
    for (const bg of DARK)
      expect(contrast(token("focus-halo"), bg)).toBeGreaterThanOrEqual(3);
  });
});
