import { examples, SENTIMENTS, type Sentiment } from "./demoData";

/* What the intro's stage draws. Its comments are the demo's four authored
   ones (demoData.ts), so the intro and the demo below it tell one story;
   the figures are examples, and the section's caption says so. */

/** The platforms a channel can be connected from, in the order the first
 *  scene lights them. */
export const INTRO_PLATFORMS = [
  "youtube",
  "facebook",
  "instagram",
  "x",
  "tiktok",
  "telegram",
] as const;

/** The mixed comment the second scene reads, cut where the feeling turns:
 *  a positive word, then a negative one, in one sentence. */
export const INTRO_READ: readonly { text: string; tone?: Sentiment }[] = [
  { text: "المحتوى " },
  { text: "مليح", tone: "positive" },
  { text: " بصح المقدمة " },
  { text: "طويلة", tone: "negative" },
  { text: " شوية" },
];

/** The demo's comments, each with the index of its dialect in
 *  `lpIntroDialects` (Gulf, Maghrebi, Egyptian, Levantine — the order the
 *  comments are written in). */
export const INTRO_COMMENTS = examples.map((c, dialect) => ({ ...c, dialect }));

/** Three example videos, each its share per sentiment in `SENTIMENTS`
 *  order (positive, mixed, neutral, negative); each row sums to 100. */
export const INTRO_VIDEOS: readonly (readonly number[])[] = [
  [48, 22, 18, 12],
  [62, 14, 14, 10],
  [35, 20, 15, 30],
];

/** One row's segments, laid end to end on a 0–100 track. */
export function segmentsOf(shares: readonly number[]) {
  let x = 0;
  return SENTIMENTS.map((label, i) => {
    const seg = { label, x, width: shares[i] ?? 0 };
    x += seg.width;
    return seg;
  });
}
