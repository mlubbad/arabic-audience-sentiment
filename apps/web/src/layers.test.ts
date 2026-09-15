/**
 * The layers above the tokens, measured.
 *
 * `brand.css` and `glass.css` are the source of truth for colour. The audit's
 * seventh finding was that four layers write over them with values of their
 * own; the honest measure of that is not the line count but how many raw
 * colours those layers carry, and of those, how many are a token's value
 * written out again — one meaning, implemented twice — or a drift of one
 * (`#f3f0ff` beside `--ml-indigo-50: #f4f2fe`, ΔE 0.6).
 *
 * Measured before anything was changed: `style.css` 0 raw colours,
 * `report.css` 7 (all `#fff`), `app.css` 56 uses of 37 distinct values, of
 * which 14 repeated a token and 34 distinct did not. `landing.css` carries 95
 * and is out of scope here: it is the marketing page's, loaded only by it,
 * and it is being edited in another session.
 *
 * Two rules, and a backlog:
 * 1. A raw colour in these layers never repeats a token's value. Where the
 *    meaning matches, the token is used; where it does not — white ink is
 *    not `--bg-card` — a token is added for the meaning.
 * 2. No new raw colour enters `app.css`. The ones there are listed below as
 *    the backlog, each to be snapped to a token or promoted to one; an entry
 *    that disappears from the stylesheet must be struck from the list, so
 *    the list is always the true remainder.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) =>
  readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const norm = (h: string) => {
  h = h.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h))
    h = "#" + [...h.slice(1)].map((c) => c + c).join("");
  return h;
};
const hexes = (css: string) =>
  [...strip(css).matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)].map((m) =>
    norm(m[0]),
  );

const tokens = new Map<string, string>();
for (const f of ["brand.css", "glass.css"])
  for (const m of read(f).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\b/g))
    if (!tokens.has(norm(m[2]))) tokens.set(norm(m[2]), `--${m[1]}`);

/** app.css's raw colours, each with the token it stands nearest to (ΔE,
 *  palette.ts). 34 on 2026-09-15; the work of the audit's third phase is to
 *  empty this list. Struck so far: six indigo tints within ΔE 3 whose meaning
 *  matched the token's (a hover, a focus border, four pale grounds); then
 *  three families that had no token and got one — the dark chrome, the
 *  warning strip, the "done" tint — and two inks the brand already named
 *  (--ml-indigo-300 on the dark plane, --fg-on-brand for the kicker). */
const APP_BACKLOG = new Set([
  "#c4b8ff", // --ml-indigo-300 ΔE 4.4 — the rail's brand-mark gradient only
  "#ff5c67", // --ml-rose ΔE 3.0
  "#312e81", // --ml-indigo-800 ΔE 5.0
  "#ded7fd", // --ml-indigo-100 ΔE 3.0
  "#22203a", // --text-1 ΔE 5.6
  "#ddd5ff", // --ml-indigo-100 ΔE 3.6
  "#4338ca", // --ml-indigo ΔE 4.4
  "#4f46e5", // --ml-indigo-500 ΔE 6.2
  "#3730a3", // --ml-indigo ΔE 3.9
  "#cbbeff", // --ml-indigo-300 ΔE 6.2
  "#ddd7fa", // --ml-indigo-100 ΔE 3.0
  "#826df8", // --ml-indigo-500 ΔE 6.4
  "#ff8f98", // --ml-rose-300 ΔE 5.6
  "#9584ff", // --ml-indigo-300 ΔE 11.6
]);

describe("the layers above the tokens", () => {
  it("never write a token's value out again", () => {
    for (const f of ["style.css", "app.css", "report.css"]) {
      const repeats = hexes(read(f)).filter((h) => tokens.has(h));
      expect(
        repeats.map((h) => `${h} is ${tokens.get(h)}`),
        `${f} repeats a token`,
      ).toEqual([]);
    }
  });

  it("style.css and report.css carry no raw colour at all", () => {
    for (const f of ["style.css", "report.css"])
      expect(hexes(read(f)), f).toEqual([]);
  });

  it("app.css gains no raw colour, and the backlog is the true remainder", () => {
    const present = new Set(hexes(read("app.css")));
    const newcomers = [...present].filter((h) => !APP_BACKLOG.has(h));
    expect(newcomers, "a raw colour entered app.css").toEqual([]);
    const struck = [...APP_BACKLOG].filter((h) => !present.has(h));
    expect(struck, "gone from app.css — strike it from the backlog").toEqual(
      [],
    );
  });
});
