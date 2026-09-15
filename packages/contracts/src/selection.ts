/**
 * What a video costs to select, and how the catalogue is narrowed.
 *
 * The arithmetic here is the same the database enforces in select_videos; the
 * browser shows it live, the server refuses on it. Two implementations of one
 * rule, on purpose and asserted against each other in the SQL tests: the UI's
 * number is advisory, the RPC's is the one that spends.
 */
import { z } from "zod";

export const CatalogueVideoSchema = z
  .object({
    id: z.string().min(1),
    external_video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    title: z.string(),
    kind: z.enum(["video", "short", "stream"]),
    published_at: z.string().nullable(),
    thumbnail_url: z.string().nullable(),
    // Null is unknown. Never 0 for unknown.
    reported_comment_count: z.number().int().nonnegative().nullable(),
    comments_state: z.enum(["unknown", "open", "disabled"]),
    collected: z.number().int().nonnegative(),
    selected: z.boolean(),
    last_collected_at: z.string().nullable(),
    last_outcome: z.string().nullable(),
    next_check_at: z.string().nullable(),
  })
  .strict();
export type CatalogueVideo = z.infer<typeof CatalogueVideoSchema>;

const cost = (r: CatalogueVideo) =>
  r.reported_comment_count === null
    ? null
    : Math.max(0, r.reported_comment_count - r.collected);

export function selectionEstimate(
  videos: CatalogueVideo[],
  adding: Set<string>,
  remaining: number | null,
) {
  let estimate = 0;
  let unknownCount = 0;
  for (const r of videos) {
    if (!adding.has(r.id) || r.selected) continue;
    const c = cost(r);
    if (c === null) unknownCount++;
    else estimate += c;
  }
  const remainingAfter = remaining === null ? null : remaining - estimate;
  return {
    estimate,
    unknownCount,
    remainingAfter,
    exceeds: remainingAfter !== null && remainingAfter < 0,
  };
}

export type CatalogueKind = "all" | CatalogueVideo["kind"];
export type CatalogueSort = "newest" | "oldest" | "most_commented";

const time = (r: CatalogueVideo) =>
  r.published_at ? Date.parse(r.published_at) : null;

/** Unknown sorts last whichever way the known values go. */
const byNullableDesc =
  (key: (r: CatalogueVideo) => number | null, direction: 1 | -1) =>
  (a: CatalogueVideo, b: CatalogueVideo) => {
    const x = key(a),
      y = key(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (y - x) * direction;
  };

export function filterCatalogue(
  videos: CatalogueVideo[],
  q: { search: string; kind: CatalogueKind; sort: CatalogueSort },
): CatalogueVideo[] {
  const needle = q.search.trim().toLocaleLowerCase();
  const rows = videos.filter(
    (r) =>
      (q.kind === "all" || r.kind === q.kind) &&
      (needle === "" || r.title.toLocaleLowerCase().includes(needle)),
  );
  const order =
    q.sort === "newest"
      ? byNullableDesc(time, 1)
      : q.sort === "oldest"
        ? byNullableDesc(time, -1)
        : byNullableDesc((r) => r.reported_comment_count, 1);
  return [...rows].sort(order);
}

/** Newest first, while the estimate still fits. Unknown counts are skipped:
 *  a video that cannot be priced cannot be fitted. */
export function fitNewest(
  videos: CatalogueVideo[],
  remaining: number,
): string[] {
  const chosen: string[] = [];
  let left = remaining;
  for (const r of filterCatalogue(videos, {
    search: "",
    kind: "all",
    sort: "newest",
  })) {
    if (r.selected || r.comments_state === "disabled") continue;
    const c = cost(r);
    if (c === null || c > left) continue;
    chosen.push(r.id);
    left -= c;
  }
  return chosen;
}
