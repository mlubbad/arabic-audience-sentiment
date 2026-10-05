/** Numerals pinned: "ar" renders different digits per browser ICU build. */
export const n = (v: number) => v.toLocaleString("en-US");

/**
 * A percentage in the reader's language: "٪" in Arabic, "%" in English, with
 * the numerals pinned like `n`. Unknown (null, undefined, not finite) is "—",
 * never "0%": a ratio over nothing measured is not zero, it is absent.
 */
export function pct(
  v: number | null | undefined,
  lang: "ar" | "en",
  opts: { signed?: boolean } = {},
): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = opts.signed && v > 0 ? "+" : "";
  return `${sign}${n(v)}${lang === "ar" ? "٪" : "%"}`;
}
