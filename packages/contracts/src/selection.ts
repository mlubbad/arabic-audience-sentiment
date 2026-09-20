/**
 * What a video costs to select, and how the catalogue is narrowed.
 *
 * The arithmetic here is the same the database enforces in select_videos; the
 * browser shows it live, the server refuses on it. Two implementations of one
 * rule, on purpose and asserted against each other in the SQL tests: the UI's
 * number is advisory, the RPC's is the one that spends.
 */
import { z } from "zod";

export const SOURCE_PLATFORMS = [
  "youtube",
  "telegram",
  "x",
  "tiktok",
  "facebook",
  "instagram",
] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const CONTENT_KINDS = [
  "video",
  "short",
  "stream",
  "channel_post",
  "tweet",
  "status",
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const CatalogueVideoSchema = z
  .object({
    id: z.string().min(1),
    external_video_id: z.string().min(1).max(100),
    title: z.string(),
    kind: z.enum(CONTENT_KINDS),
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
    platform: z.string().optional().nullable(),
  })
  .strict();
export type CatalogueVideo = z.infer<typeof CatalogueVideoSchema>;

const cost = (r: CatalogueVideo) =>
  r.reported_comment_count === null
    ? null
    : Math.max(0, r.reported_comment_count - r.collected);

/**
 * `estimate` is what the additions would cost; `outstanding` is what the
 * selections already stored and not yet collected still will. The units left
 * have to cover both — two selections that each fit alone were both accepted
 * against the same remainder before the server counted the second. A
 * selection being removed is not outstanding; an unknown count is nothing
 * here, as it is in the estimate, and is reported apart there.
 *
 * `remaining` is the budget's own figure: null with no plan, and -1 for a
 * plan with no ceiling (`BudgetSchema` in usage.ts, `unlimited()`), which is
 * how the owner's plan arrives. The database answers the largest int for
 * that plan in analysis_remaining, so select_videos never refuses it; here
 * there is no remainder to report and nothing to exceed. Subtracting from
 * the -1 as if it were a count is what once refused the owner every video.
 */
export function selectionEstimate(
  videos: CatalogueVideo[],
  adding: Set<string>,
  remaining: number | null,
  removing: Set<string> = new Set(),
) {
  const unlimited = remaining === -1;
  let estimate = 0;
  let unknownCount = 0;
  let outstanding = 0;
  for (const r of videos) {
    if (r.selected) {
      if (!removing.has(r.id)) outstanding += cost(r) ?? 0;
      continue;
    }
    if (!adding.has(r.id)) continue;
    const c = cost(r);
    if (c === null) unknownCount++;
    else estimate += c;
  }
  const remainingAfter =
    remaining === null || unlimited ? null : remaining - outstanding - estimate;
  return {
    estimate,
    unknownCount,
    outstanding,
    remainingAfter,
    unlimited,
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
