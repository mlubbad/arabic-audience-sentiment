/**
 * The `.ui-split` bar's data: which segments to draw and how to describe
 * them out loud.
 *
 * A segment's width is always the share of the row's TOTAL comments, never
 * of the analysed subset — a video half analysed draws half a bar, the rest
 * left to the track's own muted background rather than stretched to fill
 * it. That rule was fixed for the per-video cards in `ed74413` (`Videos.tsx`
 * originally computed `pct` against `total` there too); lifted out here so
 * `Compare.tsx` draws the same widths from the same function instead of
 * re-deriving them from `analysed`, which was the exact defect that commit
 * fixed for the cards.
 */
import type { Label } from "@sentiment/contracts";
import type { Strings } from "../strings";
import { n } from "./format";

export const SENTIMENT_CLASSES: readonly Label[] = [
  "positive",
  "negative",
  "neutral",
  "mixed",
];

export type SplitSegment = { key: Label; count: number; pct: number };

/** Only the segments that hold something, each sized to its share of
 *  `total`. Empty when nothing is analysed — that is "no bar", not a
 *  full-width unknown segment. */
export function splitSegments(
  sentiments: Record<Label, number>,
  total: number,
): SplitSegment[] {
  const pct = (x: number) => (total ? (x / total) * 100 : 0);
  return SENTIMENT_CLASSES.map((key) => ({
    key,
    count: sentiments[key],
    pct: pct(sentiments[key]),
  })).filter((seg) => seg.count > 0);
}

/** The spoken form of a set of segments: each measured class reads its
 *  count and share, a class the active model cannot produce reads as such,
 *  and no segments at all reads as "nothing analysed" rather than silence. */
export function splitAriaLabel(
  segments: SplitSegment[],
  measurable: Set<string>,
  labels: Record<Label, string>,
  S: Pick<
    Strings,
    "legendMeasured" | "legendUnmeasured" | "noAnalysedInFilters"
  >,
): string {
  return segments.length > 0
    ? segments
        .map((seg) =>
          measurable.has(seg.key)
            ? S.legendMeasured(
                labels[seg.key],
                n(seg.count),
                Math.round(seg.pct),
              )
            : S.legendUnmeasured(labels[seg.key]),
        )
        .join("، ")
    : S.noAnalysedInFilters;
}
