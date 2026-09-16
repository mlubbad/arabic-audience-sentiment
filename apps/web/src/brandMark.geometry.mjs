/**
 * The four-bar mark's geometry — the one table the component, the favicon
 * and the OAuth logo are all drawn from.
 *
 * Plain ESM, not TypeScript, on purpose: `scripts/render-brand-assets.mjs`
 * runs under Node and cannot import a `.tsx` file, and a JS copy of this table
 * in the script would be exactly the second implementation the SVG mark was
 * introduced to remove. One file, two importers.
 *
 * Measured on the brand image at 512 square: bars 55 wide, 33 apart, heights
 * 154 / 275 / 209 / 110, vertically centred, the group turned −10° about the
 * centre. `x` values place the four bars symmetrically about x=256.
 */
export const BRAND_MARK_VIEWBOX = "0 0 512 512";

/** Frame the mark is drawn in, and the point the rotation turns about. */
export const BRAND_MARK_SIZE = 512;
export const BRAND_MARK_ROTATION = -10;

/** @type {ReadonlyArray<{x:number,y:number,w:number,h:number,rose:boolean}>} */
export const BRAND_MARK_BARS = Object.freeze([
  { x: 96, y: 179, w: 55, h: 154, rose: false },
  { x: 184, y: 118, w: 55, h: 275, rose: false },
  { x: 272, y: 151, w: 55, h: 209, rose: false },
  { x: 360, y: 201, w: 55, h: 110, rose: true },
]);

/**
 * The mark as SVG markup, for files rather than React: the favicon, the
 * PNG renders. `indigo` and `rose` are literal colours because a standalone
 * .svg file has no brand.css to read tokens from; the caller passes the
 * token values in, read from brand.css, so the file still cannot drift.
 * @param {{indigo:string, rose:string, background?:string}} colours
 */
export function brandMarkSvg({ indigo, rose, background }) {
  const bars = BRAND_MARK_BARS.map(
    (b) =>
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.w / 2}" fill="${b.rose ? rose : indigo}"/>`,
  ).join("");
  const c = BRAND_MARK_SIZE / 2;
  const bg = background
    ? `<rect width="${BRAND_MARK_SIZE}" height="${BRAND_MARK_SIZE}" rx="${BRAND_MARK_SIZE * 0.2}" fill="${background}"/>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BRAND_MARK_VIEWBOX}">` +
    bg +
    `<g transform="rotate(${BRAND_MARK_ROTATION} ${c} ${c})">${bars}</g></svg>`
  );
}
