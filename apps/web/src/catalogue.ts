/**
 * The catalogue as the operations page reads it, in either mode.
 *
 * Live: two RLS-scoped table reads (`videos`, `video_selections`) — not a
 * rewrite of `dashboard_snapshot`. The stored comment count per video comes
 * from the snapshot the page already holds (its `videos` aggregate), so this
 * module never re-reads the comments. Fixture: one JSON file.
 */
import {
  CatalogueVideoSchema,
  type CatalogueVideo,
  type VideoAggregate,
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
};

export function mergeCatalogue(
  raw: RawCatalogue,
  collected: VideoAggregate[],
): CatalogueVideo[] {
  const stored = new Map(collected.map((v) => [v.id, v.total]));
  const chosen = new Map(raw.selections.map((s) => [s.video_id, s]));
  return raw.videos.map((v) => {
    const s = chosen.get(v.id);
    return CatalogueVideoSchema.parse({
      ...v,
      collected: stored.get(v.id) ?? 0,
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

async function readLive(workspaceId: string): Promise<CatalogueRead> {
  const db = supabase!;
  const [videos, selections, channel] = await Promise.all([
    db
      .from("videos")
      .select(
        "id,external_video_id,title,kind,published_at,thumbnail_url,reported_comment_count,comments_state",
      )
      .eq("workspace_id", workspaceId),
    db
      .from("video_selections")
      .select("video_id,last_collected_at,last_outcome,next_check_at")
      .eq("workspace_id", workspaceId),
    db
      .from("connection_status")
      .select("channel_id,status,catalogued_at")
      .eq("workspace_id", workspaceId),
  ]);
  if (videos.error || selections.error || channel.error)
    throw new Error("catalogue_unavailable");
  const connected = (channel.data ?? []).find((c) => c.status === "connected");
  return {
    videos: (videos.data ?? []) as RawVideo[],
    selections: (selections.data ?? []) as RawSelection[],
    channelId: connected?.channel_id ?? null,
    cataloguedAt: connected?.catalogued_at ?? null,
  };
}

export async function loadCatalogue(
  mode: DataMode,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<CatalogueRead> {
  return mode === "live" ? readLive(workspaceId) : readFixture(signal);
}
