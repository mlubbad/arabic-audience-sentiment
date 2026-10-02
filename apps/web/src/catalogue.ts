/**
 * The catalogue as the operations page reads it, in either mode.
 *
 * Live: two RLS-scoped table reads (`videos`, `video_selections`) — not a
 * rewrite of `dashboard_snapshot`. The stored comment count per video comes
 * from the source the page already holds, so this module never re-reads the
 * comments. Fixture: one JSON file.
 */
import {
  CatalogueVideoSchema,
  type CatalogueVideo,
  type Comment,
} from "@sentiment/contracts";
import type { DataMode } from "./data";
import { supabase } from "./supabase";

export type RawVideo = {
  id: string;
  external_video_id: string;
  title: string;
  kind: string;
  published_at: string | null;
  thumbnail_url: string | null;
  reported_comment_count: number | null;
  comments_state: string;
  platform?: string | null;
};
export type RawSelection = {
  video_id: string;
  last_collected_at: string | null;
  last_outcome: string | null;
  next_check_at: string | null;
};
export type RawCatalogue = { videos: RawVideo[]; selections: RawSelection[] };
export type CatalogueRead = RawCatalogue & {
  channelId: string | null;
  cataloguedAt: string | null;
  platform?: string | null;
  handle?: string | null;
};

/** How many rows of a video are in the database. */
export type StoredCount = { id: string; total: number; analysed?: number };

/**
 * Rows stored per video, from the source's comments.
 *
 * Deliberately NOT the snapshot's `videos` aggregate. That aggregate is taken
 * downstream of `filteredRows`, which drops the channel's own replies before
 * any denominator — right for every percentage on the dashboard, wrong here.
 * "Collected" is what `select_videos` subtracts from YouTube's reported count
 * to price a selection, and it counts every row (`count(*) from comments
 * where video_id = …`), the owner's replies included, because YouTube's
 * count includes them too. Reading the aggregate instead reported one fewer
 * for a video with an owner reply in it and priced its re-collection one unit
 * too high — the browser's estimate and the server's refusal disagreeing
 * about the same video. Same shape as `channel_own_comments`: counted from
 * the unfiltered input, on purpose, and said so.
 */
export function storedPerVideo(
  comments: Comment[],
  workspaceId: string,
): StoredCount[] {
  const seen = new Set<string>();
  const totals = new Map<string, number>();
  for (const c of comments) {
    if (c.workspace_id !== workspaceId || seen.has(c.id)) continue;
    seen.add(c.id);
    totals.set(c.video_id, (totals.get(c.video_id) ?? 0) + 1);
  }
  return [...totals].map(([id, total]) => ({ id, total }));
}

export function mergeCatalogue(
  raw: RawCatalogue,
  collected: StoredCount[],
): CatalogueVideo[] {
  const stored = new Map(collected.map((v) => [v.id, v]));
  const chosen = new Map(raw.selections.map((s) => [s.video_id, s]));
  return raw.videos.map((v) => {
    const s = chosen.get(v.id);
    const countInfo = stored.get(v.id);
    return CatalogueVideoSchema.parse({
      ...v,
      collected: countInfo?.total ?? 0,
      analysed: countInfo?.analysed ?? 0,
      selected: !!s,
      last_collected_at: s?.last_collected_at ?? null,
      last_outcome: s?.last_outcome ?? null,
      next_check_at: s?.next_check_at ?? null,
    });
  });
}

async function readFixture(signal?: AbortSignal): Promise<CatalogueRead> {
  const r = await fetch("/fixtures/catalogue.json", { signal });
  if (!r.ok) throw new Error("catalogue_unavailable");
  return (await r.json()) as CatalogueRead;
}

/** PostgREST answers at most `max-rows` (1,000 on Supabase) per request and
 *  says nothing when it stops short. The pilot channel catalogued 4,456 videos
 *  on its first discovery; a single read showed 1,000 of them and no error. So
 *  every list is paged by a stable key until a page comes back short. */
const PAGE = 1000;
async function readAll<T>(
  table: string,
  columns: string,
  key: string,
  workspaceId: string,
): Promise<T[]> {
  const db = supabase!;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await db
      .from(table)
      .select(columns)
      .eq("workspace_id", workspaceId)
      .order(key)
      .range(from, from + PAGE - 1);
    if (page.error) throw new Error("catalogue_unavailable");
    const got = (page.data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE) return rows;
  }
}

async function readLive(workspaceId: string): Promise<CatalogueRead> {
  const db = supabase!;
  const [videos, selections, channel] = await Promise.all([
    readAll<RawVideo>(
      "videos",
      "id,external_video_id,title,kind,published_at,thumbnail_url,reported_comment_count,comments_state,platform",
      "id",
      workspaceId,
    ),
    readAll<RawSelection>(
      "video_selections",
      "video_id,last_collected_at,last_outcome,next_check_at",
      "video_id",
      workspaceId,
    ),
    db
      .from("connection_status")
      .select("channel_id,status,catalogued_at,platform,handle")
      .eq("workspace_id", workspaceId),
  ]);
  if (channel.error) throw new Error("catalogue_unavailable");
  const connected = (channel.data ?? []).find(
    (c) => c.status === "connected" || c.status === "public_unverified",
  );
  return {
    videos,
    selections,
    channelId: connected?.channel_id ?? null,
    cataloguedAt: connected?.catalogued_at ?? null,
    platform: (connected?.platform as string | undefined) ?? null,
    handle: (connected?.handle as string | undefined) ?? null,
  };
}

export async function loadCatalogue(
  mode: DataMode,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<CatalogueRead> {
  return mode === "live" ? readLive(workspaceId) : readFixture(signal);
}

/** A page of a list, clamped: asking past the end gives the last page, and
 *  an empty list is one empty page rather than none. */
export const PAGE_SIZE = 50;
export function pageOf<T>(
  rows: T[],
  page: number,
  size = PAGE_SIZE,
): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (current - 1) * size;
  return { rows: rows.slice(start, start + size), page: current, pages };
}

/** Where a video lives on YouTube/Telegram, and where it embeds. The privacy-enhanced
 *  host sets no cookies until the viewer presses play. */
export function videoLinks(
  external_video_id: string,
  kind: string,
  platform?: string | null,
  handle?: string | null,
) {
  if (platform === "telegram") {
    const clean = (handle ?? "").replace(/^@/, "");
    return {
      watch: clean
        ? `https://t.me/${clean}/${external_video_id}`
        : `https://t.me/c/${external_video_id}`,
      embed: clean
        ? `https://t.me/${clean}/${external_video_id}?embed=1`
        : null,
    };
  }
  if (platform === "x") {
    const clean = (handle ?? "").replace(/^@/, "");
    const id = encodeURIComponent(external_video_id);
    return {
      watch: clean
        ? `https://x.com/${clean}/status/${id}`
        : `https://x.com/i/status/${id}`,
      embed: `https://platform.twitter.com/embed/Tweet.html?id=${id}`,
    };
  }
  if (platform === "tiktok") {
    const clean = (handle ?? "").replace(/^@/, "");
    return {
      watch: clean
        ? `https://www.tiktok.com/@${clean}/video/${external_video_id}`
        : `https://www.tiktok.com/video/${external_video_id}`,
      embed: null,
    };
  }
  const id = encodeURIComponent(external_video_id);
  return {
    watch:
      kind === "short"
        ? `https://www.youtube.com/shorts/${id}`
        : `https://www.youtube.com/watch?v=${id}`,
    embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
  };
}
