/** One filtered read, shared by every panel and by the export. */
import { z } from "zod";
import { FiltersSchema, type Filters } from "./filters";
import { effectiveLabel, type Comment } from "./comments";
import { type Label } from "./primitives";

export type VideoAggregate = {
  id: string;
  /** Null when no row carried one; never replaced with the id. */
  title: string | null;
  total: number;
  analysed: number;
  replies: number;
  sentiments: Record<Label, number>;
};

export type LabelledComment = Comment & {
  label: Label | null;
  reviewed: boolean;
};

/**
 * The single filter implementation. Views and exports both go through it, so an
 * export can never be a differently filtered version of what was on screen.
 */
function filteredRows(
  input: Comment[],
  f: z.output<typeof FiltersSchema>,
  activeKey: string,
): LabelledComment[] {
  const unique = new Map(
    input
      .filter((c) => c.workspace_id === f.workspace_id)
      .map((c) => [c.id, c]),
  );
  return [...unique.values()]
    .map((c) => ({ ...c, ...effectiveLabel(c, activeKey) }))
    .filter((c) => {
      if (
        (f.client_id && c.client_id !== f.client_id) ||
        (f.channel_id && c.channel_id !== f.channel_id)
      )
        return false;
      if (
        (f.video_ids.length && !f.video_ids.includes(c.video_id)) ||
        (f.video_kind && c.video_kind !== f.video_kind)
      )
        return false;
      if (
        (f.date_mode === "unknown" && c.published_at !== null) ||
        (f.date_mode === "known" && c.published_at === null)
      )
        return false;
      if (f.from || f.to) {
        if (!c.published_at) return false;
        const t = Date.parse(c.published_at);
        if (
          (f.from && t < Date.parse(f.from)) ||
          (f.to && t >= Date.parse(f.to))
        )
          return false;
      }
      if (f.sentiments.length && (!c.label || !f.sentiments.includes(c.label)))
        return false;
      if (f.comment_type && c.comment_type !== f.comment_type) return false;
      if (
        (f.replies === "comments" && c.is_reply) ||
        (f.replies === "replies" && !c.is_reply)
      )
        return false;
      if (
        (f.review_status === "reviewed" && !c.reviewed) ||
        (f.review_status === "unreviewed" && c.reviewed)
      )
        return false;
      // A purged row has nothing to search. Coercing null to "" would make it
      // match every empty-ish query and none of the real ones, which reads as
      // a result rather than as an absence.
      return `${c.text_raw ?? ""} ${c.author_name ?? ""} ${c.author_channel_id ?? ""}`
        .toLocaleLowerCase()
        .includes(f.q.trim().toLocaleLowerCase());
    })
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
}

/**
 * Every row the filters select, never a page of them. An export that silently
 * stopped at the page size would understate the answer it claims to give.
 */
export function exportRows(
  input: Comment[],
  raw: Filters,
  activeKey: string,
): LabelledComment[] {
  return filteredRows(input, FiltersSchema.parse(raw), activeKey);
}

/** Pure fixture/reference implementation. Server queries must separately enforce RLS. */
/** How many engaged negatives the dashboard shows. */
const ENGAGEMENT_LIMIT = 5;

export function snapshot(input: Comment[], raw: Filters, activeKey: string) {
  const f = FiltersSchema.parse(raw);
  const rows = filteredRows(input, f, activeKey);
  // Offered filter values come from the data, so a channel's own vocabulary
  // drives the control instead of a hard-coded per-customer list. Scoped to the
  // workspace but deliberately not to the other filters: narrowing this with
  // the current selection would make a filtered-out type unselectable.
  const comment_types = [
    ...new Set(
      input
        .filter((c) => c.workspace_id === f.workspace_id && c.comment_type)
        .map((c) => c.comment_type as string),
    ),
  ].sort((a, b) => a.localeCompare(b, "ar"));
  // The videos the filter control may offer, on the same principle as the
  // comment types above: scoped to the workspace and to nothing else. Taking
  // them from the filtered result instead would leave the chosen video as the
  // only option the moment it was chosen, with no way back to the others.
  const video_options = [
    ...new Map(
      input
        .filter((c) => c.workspace_id === f.workspace_id)
        .map((c) => [c.video_id, c.video_title] as const),
    ),
  ]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => (a.title ?? a.id).localeCompare(b.title ?? b.id, "ar"));
  const sentiments: Record<Label, number> = {
    positive: 0,
    negative: 0,
    neutral: 0,
    mixed: 0,
  };
  // Per-video figures accumulate in the same pass as the overall ones, which is
  // what a server would do with a single GROUP BY. Computing them by re-running
  // the whole snapshot once per video would not survive a channel with 194.
  const videos = new Map<string, VideoAggregate>(),
    timeline = new Map<string, number>();
  for (const c of rows) {
    if (c.label) sentiments[c.label]++;
    let video = videos.get(c.video_id);
    if (!video) {
      video = {
        id: c.video_id,
        title: c.video_title,
        total: 0,
        analysed: 0,
        replies: 0,
        sentiments: { positive: 0, negative: 0, neutral: 0, mixed: 0 },
      };
      videos.set(c.video_id, video);
    }
    video.title ??= c.video_title;
    video.total++;
    if (c.is_reply) video.replies++;
    // Each video counts on its own denominator: a comment with no usable label
    // is inside total and outside analysed, exactly as for the whole set.
    if (c.label) {
      video.analysed++;
      video.sentiments[c.label]++;
    }
    const day = c.published_at
      ? new Date(c.published_at).toISOString().slice(0, 10)
      : "unknown";
    timeline.set(day, (timeline.get(day) ?? 0) + 1);
  }
  const analysed = Object.values(sentiments).reduce((a, b) => a + b, 0);
  const cursorIndex = f.cursor ? rows.findIndex((c) => c.id === f.cursor) : -1;
  if (f.cursor && cursorIndex < 0) throw new Error("invalid_cursor");
  const comments = rows.slice(cursorIndex + 1, cursorIndex + 1 + f.limit);
  // Negatives the audience engaged with most. Ranked on the effective label, so
  // a human correction counts here too. A row with unknown engagement is left
  // out rather than sorted as zero, and the exclusion is reported instead of
  // being hidden.
  const negatives = rows.filter((c) => c.label === "negative");
  const rankable = negatives.filter((c) => c.likes_value !== null);
  const most_engaged_negative = rankable
    .slice()
    .sort(
      (a, b) =>
        (b.likes_value ?? 0) - (a.likes_value ?? 0) ||
        a.id.localeCompare(b.id, "en"),
    )
    .slice(0, ENGAGEMENT_LIMIT);
  return {
    // No mode here. This aggregates rows and cannot know where they came from;
    // asserting "sanitized_fixture" was a claim about provenance made by the
    // one function with no access to it, and it stayed true only because there
    // was no live read. The data layer owns that answer.
    comment_types,
    video_options,
    most_engaged_negative,
    // How many could be ranked, so a shown five is never mistaken for all five.
    negative_ranked: rankable.length,
    negative_unranked: negatives.length - rankable.length,
    total: rows.length,
    analysed,
    unanalysed: rows.length - analysed,
    sentiments,
    replies: rows.filter((c) => c.is_reply).length,
    unknown_dates: rows.filter((c) => !c.published_at).length,
    unique_authors: new Set(
      rows.flatMap((c) => (c.author_channel_id ? [c.author_channel_id] : [])),
    ).size,
    // Busiest first, ties broken by id so the order does not wobble.
    videos: [...videos.values()].sort(
      (a, b) => b.total - a.total || a.id.localeCompare(b.id, "en"),
    ),
    timeline: [...timeline].map(([date, total]) => ({ date, total })),
    // Every row the filters admit, not just the page on screen. The panels
    // that chart behaviour — hour of day, day of week, who is talking — are
    // asking about the whole filtered set, and paging is a reading aid that
    // must not change the answer. Same array, no copy: the export and the
    // charts are looking at the identical rows by construction.
    filtered: rows,
    comments,
    next_cursor:
      cursorIndex + 1 + comments.length < rows.length
        ? comments.at(-1)!.id
        : null,
  };
}
