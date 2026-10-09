/**
 * The filter values the bar edits, and the pure functions over them.
 *
 * This is the same logic that used to live inline in `Dashboard.tsx`
 * (`activeFilters`, ~line 563) — moved here so `FilterBar` and
 * `ActiveFilters` can both read it without either owning it. `Dashboard.tsx`
 * keeps the twelve `useState`s as the source of truth for the *draft* the bar
 * edits; `FilterValues` is a view over them, built fresh each render. The
 * applied state is the `Filters` object the read is keyed on, and the chips
 * are built from that (`appliedValues`), never from the draft.
 */
import { UNCLASSIFIED } from "@sentiment/contracts";
import type { Filters, Label } from "@sentiment/contracts";
import type { Strings } from "../strings";

export type FilterValues = {
  query: string;
  video: string;
  sentiment: string;
  topic: string;
  videoKind: string;
  platform: string;
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
  platform: "",
  replies: "all",
  commentType: "",
  reviewStatus: "all",
  dateMode: "all",
  from: "",
  to: "",
  limit: 25,
};

/** How many of the six "more" controls are set — the count `S.moreFilters`
 *  shows, so a reader with the popover closed still knows a control in
 *  there is set. Called on the draft: the trigger describes the controls
 *  behind it, including one chosen but not yet applied. What is applied is
 *  the chips' job (see `appliedValues`). */
export function extraCount(v: FilterValues): number {
  return (
    [v.topic, v.videoKind, v.platform, v.commentType].filter(Boolean).length +
    (v.replies !== "all" ? 1 : 0) +
    (v.reviewStatus !== "all" ? 1 : 0) +
    (v.limit !== 25 ? 1 : 0)
  );
}

// "limit" is deliberately excluded: `extraCount` counts a non-default page
// size toward the "more" button's badge, but no chip is ever emitted for it
// below, so `onClear` (Dashboard.tsx) never has to handle clearing one.
export type Chip = {
  key: Exclude<keyof FilterValues, "limit"> | "period";
  label: string;
};

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
  if (v.platform) {
    const pNames: Record<string, string> = {
      youtube: S.platformYouTube,
      telegram: S.platformTelegram,
      x: S.platformX,
      tiktok: S.platformTikTok,
      facebook: S.platformFacebook,
      instagram: S.platformInstagram,
    };
    out.push({
      key: "platform",
      label: S.chipPlatform(pNames[v.platform] ?? v.platform),
    });
  }
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

/** The offset `Dashboard`'s `filtersFrom` reads a picked day in
 *  (`T00:00:00+03:00`); undone here so an applied bound maps back to the
 *  day that was picked. */
const PICKED_DAY_OFFSET_MS = 3 * 60 * 60 * 1000;

function pickedDay(iso: string | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + PICKED_DAY_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The applied filters, read back as the bar's values — what the chips are
 * built from. A chip is the applied state itself: built from the draft, it
 * said «مُصفّى: التعليقات فقط» the moment a control was picked, while every
 * figure still described the unfiltered set.
 *
 * Read from `Filters` rather than from a second copy of the draft taken at
 * apply time, so there is one applied state and nothing to drift from it.
 * A range sent with no bound (`date_mode: "unknown"` drops both) has no
 * period chip, because nothing is narrowed by it. `limit` is not a filter
 * and never makes a chip; the caller passes the page size it has.
 */
export function appliedValues(f: Filters, limit: number): FilterValues {
  return {
    query: f.q ?? "",
    video: f.video_ids?.[0] ?? "",
    sentiment: f.sentiments?.[0] ?? "",
    topic: f.topics?.[0] ?? "",
    videoKind: f.video_kind ?? "",
    platform: f.platform ?? "",
    replies: f.replies ?? "all",
    commentType: f.comment_type ?? "",
    reviewStatus: f.review_status ?? "all",
    dateMode: f.date_mode ?? "all",
    from: pickedDay(f.from),
    to: pickedDay(f.to),
    limit,
  };
}

/**
 * The applied filters with one chip's condition removed and nothing else
 * changed. Removing a chip edits what is applied; it is not an apply of the
 * bar, so a control chosen but not yet applied stays a draft rather than
 * slipping into the read alongside.
 */
export function withoutChip(f: Filters, key: Chip["key"]): Filters {
  switch (key) {
    case "query":
      return { ...f, q: "" };
    case "video":
      return { ...f, video_ids: [] };
    case "sentiment":
      return { ...f, sentiments: [] };
    case "topic":
      return { ...f, topics: [] };
    case "videoKind":
      return { ...f, video_kind: undefined };
    case "platform":
      return { ...f, platform: undefined };
    case "commentType":
      return { ...f, comment_type: undefined };
    case "replies":
      return { ...f, replies: "all" };
    case "reviewStatus":
      return { ...f, review_status: "all" };
    case "dateMode":
      return { ...f, date_mode: "all" };
    case "period":
      return { ...f, from: undefined, to: undefined };
    // `chipsFor` emits one "period" chip for the range, never these two;
    // the key type admits them, so each clears only its own bound.
    case "from":
      return { ...f, from: undefined };
    case "to":
      return { ...f, to: undefined };
  }
}
