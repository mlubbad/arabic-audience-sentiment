/**
 * The filter values the bar edits, and the pure functions over them.
 *
 * This is the same logic that used to live inline in `Dashboard.tsx`
 * (`activeFilters`, ~line 563) — moved here so `FilterBar` and
 * `ActiveFilters` can both read it without either owning it. `Dashboard.tsx`
 * keeps the twelve `useState`s as the source of truth; `FilterValues` is a
 * view over them, built fresh each render.
 */
import { UNCLASSIFIED } from "@sentiment/contracts";
import type { Label } from "@sentiment/contracts";
import type { Strings } from "../strings";

export type FilterValues = {
  query: string;
  video: string;
  sentiment: string;
  topic: string;
  videoKind: string;
  replies: "all" | "comments" | "replies";
  commentType: string;
  reviewStatus: "all" | "reviewed" | "unreviewed";
  dateMode: "all" | "known" | "unknown";
  from: string;
  to: string;
  limit: number;
};

export const EMPTY_FILTERS: FilterValues = {
  query: "",
  video: "",
  sentiment: "",
  topic: "",
  videoKind: "",
  replies: "all",
  commentType: "",
  reviewStatus: "all",
  dateMode: "all",
  from: "",
  to: "",
  limit: 25,
};

/** How many of the six "more" controls are set — the count `S.moreFilters`
 *  and `S.filtersButton` show, so a reader collapsed behind the popover or
 *  the sheet still knows something in there is narrowing the report. */
export function extraCount(v: FilterValues): number {
  return (
    [v.topic, v.videoKind, v.commentType].filter(Boolean).length +
    (v.replies !== "all" ? 1 : 0) +
    (v.reviewStatus !== "all" ? 1 : 0) +
    (v.limit !== 25 ? 1 : 0)
  );
}

export type Chip = { key: keyof FilterValues | "period"; label: string };

export function chipsFor(
  v: FilterValues,
  ctx: {
    S: Strings;
    labels: Record<Label, string>;
    topicName: (key: string) => string;
  },
): Chip[] {
  const { S, labels, topicName } = ctx;
  const out: Chip[] = [];
  if (v.query) out.push({ key: "query", label: S.chipSearch(v.query) });
  if (v.video) out.push({ key: "video", label: S.chipVideo });
  if (v.sentiment)
    out.push({
      key: "sentiment",
      label: S.chipSentiment(labels[v.sentiment as Label] ?? v.sentiment),
    });
  if (v.topic)
    out.push({
      key: "topic",
      label: S.chipTopic(
        v.topic === UNCLASSIFIED
          ? S.topicUnclassifiedOption
          : topicName(v.topic),
      ),
    });
  if (v.videoKind) out.push({ key: "videoKind", label: S.chipVideoKind });
  if (v.commentType) out.push({ key: "commentType", label: S.chipCommentType });
  if (v.replies !== "all")
    out.push({
      key: "replies",
      label: v.replies === "replies" ? S.chipRepliesOnly : S.chipCommentsOnly,
    });
  if (v.reviewStatus !== "all")
    out.push({
      key: "reviewStatus",
      label:
        v.reviewStatus === "reviewed"
          ? S.chipReviewedOnly
          : S.chipUnreviewedOnly,
    });
  if (v.dateMode !== "all")
    out.push({
      key: "dateMode",
      label: v.dateMode === "known" ? S.chipDatedOnly : S.chipUndatedOnly,
    });
  if (v.from || v.to) out.push({ key: "period", label: S.chipPeriod });
  return out;
}
