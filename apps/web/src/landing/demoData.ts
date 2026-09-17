import type { Locale } from "../locale";

/* The demo's four comments. Their labels come from the shared strings rather
   than being written again here: a visitor who learns a word on this page
   meets the same word inside the product. The comments stay Arabic in every
   interface language — they are the data the product reads, not something
   it says — and carry their own `lang` where they render. */
export const SENTIMENTS = ["positive", "mixed", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];
export type Filter = "all" | Sentiment;

export const examples: readonly { text: string; label: Sentiment }[] = [
  { text: "شرحك واضح، استفدت من الأمثلة كثير 👏", label: "positive" }, // Gulf
  { text: "المحتوى باهي بصح المقدمة طويلة شوية", label: "mixed" }, // Maghrebi (Algerian)
  { text: "ممكن توضح المصادر في الحلقة الجاية؟", label: "neutral" }, // Egyptian
  { text: "الصوت مش واضح بهالمقطع", label: "negative" }, // Levantine
];

export function shownFor(filter: Filter) {
  return examples.filter((c) => filter === "all" || c.label === filter);
}

/** Each label's share of the comments in the selection — 25% × 4 for `all`,
 *  100% of one colour for a single label. The same arithmetic the page has
 *  always shown. */
export function sharesFor(filter: Filter) {
  const shown = shownFor(filter);
  return SENTIMENTS.map((label) => ({
    label,
    percent:
      (shown.filter((c) => c.label === label).length / shown.length) * 100,
  }));
}

/* Arabic-Indic digits on the Arabic page — the one surface that uses them,
   as a landing does — and Western digits in English. */
export const numerals: Record<Locale, Intl.NumberFormat> = {
  ar: new Intl.NumberFormat("ar", { numberingSystem: "arab" }),
  en: new Intl.NumberFormat("en"),
};

export const percentOf = (locale: Locale, v: number) =>
  `${numerals[locale].format(v)}${locale === "ar" ? "٪" : "%"}`;
