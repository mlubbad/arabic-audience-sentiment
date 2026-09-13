/** One filtered read, shared by every panel and by the export. */
import { z } from "zod";
import { FiltersSchema, type Filters } from "./filters";
import { effectiveLabel, type Comment } from "./comments";
import { type Label } from "./primitives";

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
      return `${c.text_raw} ${c.author_name} ${c.author_channel_id ?? ""}`
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
export function snapshot(input: Comment[], raw: Filters, activeKey: string) {
  const f = FiltersSchema.parse(raw);
  const rows = filteredRows(input, f, activeKey);
  const sentiments: Record<Label, number> = {
    positive: 0,
    negative: 0,
    neutral: 0,
    mixed: 0,
  };
  const videos = new Map<string, number>(),
    timeline = new Map<string, number>();
  for (const c of rows) {
    if (c.label) sentiments[c.label]++;
    videos.set(c.video_id, (videos.get(c.video_id) ?? 0) + 1);
    const day = c.published_at
      ? new Date(c.published_at).toISOString().slice(0, 10)
      : "unknown";
    timeline.set(day, (timeline.get(day) ?? 0) + 1);
  }
  const analysed = Object.values(sentiments).reduce((a, b) => a + b, 0);
  const cursorIndex = f.cursor ? rows.findIndex((c) => c.id === f.cursor) : -1;
  if (f.cursor && cursorIndex < 0) throw new Error("invalid_cursor");
  const comments = rows.slice(cursorIndex + 1, cursorIndex + 1 + f.limit);
  return {
    mode: "sanitized_fixture" as const,
    total: rows.length,
    analysed,
    unanalysed: rows.length - analysed,
    sentiments,
    replies: rows.filter((c) => c.is_reply).length,
    unknown_dates: rows.filter((c) => !c.published_at).length,
    unique_authors: new Set(
      rows.flatMap((c) => (c.author_channel_id ? [c.author_channel_id] : [])),
    ).size,
    videos: [...videos].map(([id, total]) => ({ id, total })),
    timeline: [...timeline].map(([date, total]) => ({ date, total })),
    comments,
    next_cursor:
      cursorIndex + 1 + comments.length < rows.length
        ? comments.at(-1)!.id
        : null,
  };
}
