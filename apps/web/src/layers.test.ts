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
 * `report.css` 7 (all `#fff`; the sheet is gone since 2026-09-17, its
 * verbatim remnant `account.css` went with phase 5, and the account page's
 * own `account/account.css` — tokens only — stands in its place below),
 * `app.css` 56 uses of 37 distinct values, of
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

/** app.css's raw colours. 34 on 2026-09-15, listed here by value with the
 *  token each stood nearest to (ΔE, palette.ts), and worked down to none in
 *  four steps: 21 repeats of a token's value; six indigo tints within ΔE 3
 *  whose meaning matched; three families that had no token and got one (the
 *  dark chrome, the warning strip, the "done" tint); and the rest, which were
 *  decisions — a primary button painted in another framework's indigo, the
 *  rail's brand mark, five pale borders, two inks. The set stays as the
 *  mechanism: a raw colour that has to enter app.css is added here with its
 *  reason, and the empty set is the state to keep. */
const APP_BACKLOG = new Set<string>([]);

describe("the layers above the tokens", () => {
  it("never write a token's value out again", () => {
    for (const f of ["style.css", "app.css", "account/account.css"]) {
      const repeats = hexes(read(f)).filter((h) => tokens.has(h));
      expect(
        repeats.map((h) => `${h} is ${tokens.get(h)}`),
        `${f} repeats a token`,
      ).toEqual([]);
    }
  });

  it("style.css and account/account.css carry no raw colour at all", () => {
    for (const f of ["style.css", "account/account.css"])
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
