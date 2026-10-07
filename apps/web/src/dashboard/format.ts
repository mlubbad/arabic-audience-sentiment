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

/**
 * Net sentiment, whole percent: (positive − negative) ÷ (positive + negative).
 * Neutral and mixed comments are left out, the same definition the server's
 * `kpis.net_sentiment` uses (owner decision, 2026-10-07). Two cards used to
 * divide by every analysed comment instead, so 60 positive / 20 negative /
 * 120 neutral read 50% on one and 20% on another. With no positive and no
 * negative comment the score is unknown (null), not 0.
 */
export function netSentiment(
  positive: number,
  negative: number,
): number | null {
  const opinionated = positive + negative;
  if (opinionated <= 0) return null;
  return Math.round(((positive - negative) / opinionated) * 100);
}
