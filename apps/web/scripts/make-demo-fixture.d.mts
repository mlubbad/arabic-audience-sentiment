/** Types for make-demo-fixture.mjs — the generator itself lives there, in
 *  plain ESM, so `npm run demo:fixture` and this project's tests read one
 *  file. Return types are deliberately `unknown`: callers either feed the
 *  result straight to `JSON.stringify` for a byte-identical comparison, or
 *  parse the committed JSON file through `FixtureSchema` instead of trusting
 *  this shape. */
export function buildDemo(): unknown;
export function buildE2E(): unknown;
export function buildCatalogue(): unknown;
