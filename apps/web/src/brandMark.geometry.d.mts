/** Types for brandMark.geometry.mjs — the table itself lives there, in plain
 *  ESM, so Node scripts and the React component read one file. */
export const BRAND_MARK_VIEWBOX: string;
export const BRAND_MARK_SIZE: number;
export const BRAND_MARK_ROTATION: number;
export interface BrandMarkBar {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rose: boolean;
}
export const BRAND_MARK_BARS: ReadonlyArray<BrandMarkBar>;
export function brandMarkSvg(colours: {
  indigo: string;
  rose: string;
  background?: string;
}): string;
