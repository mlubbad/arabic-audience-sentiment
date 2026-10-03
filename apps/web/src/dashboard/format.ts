import type { Locale } from "../locale";

/** Numerals pinned: "ar" renders different digits per browser ICU build. */
export const n = (v: number) => v.toLocaleString("en-US");

export type FormatPercentOptions = {
  /** If true, prefixes positive numbers with "+". */
  sign?: boolean;
};

/**
 * Locale-aware percentage formatter:
 * - "ar" uses "٪" (U+066A)
 * - "en" uses "%" (U+0025)
 * - null, undefined, or NaN returns "—"
 * - optional sign prefixes positive values with "+"
 */
export function formatPercent(
  value: number | null | undefined,
  lang: Locale = "ar",
  options?: FormatPercentOptions,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const symbol = lang === "ar" ? "٪" : "%";
  const numStr = n(value);
  const prefix = options?.sign && value > 0 ? "+" : "";
  return `${prefix}${numStr}${symbol}`;
}
