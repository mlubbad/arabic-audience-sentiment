import { z } from "zod";
import { supabase } from "../supabase";

const nullableRatio = z.number().nullable();
const intervalSchema = z.object({ low: nullableRatio, high: nullableRatio });
export const availabilitySchema = z.object({
  switch_on: z.boolean(),
  plan_allows: z.boolean(),
});
const otherSchema = z.object({
  channel_id: z.string(),
  title: z.string().nullable(),
  handle: z.string().nullable(),
  platform: z.string(),
  audience_size: z.number().nullable(),
  below_threshold: z.boolean(),
  shared: z.number().nullable(),
  share_of_mine: nullableRatio,
  share_of_mine_ci: intervalSchema.nullable(),
  share_of_theirs: nullableRatio,
  overlap_coefficient: nullableRatio,
  affinity: nullableRatio,
});
export const overlapSchema = z.object({
  status: z.enum(["pending", "ready"]),
  computed_at: z.string().nullable(),
  universe_size: z.number().nullable(),
  thresholds: z.object({ min_audience: z.number(), min_shared: z.number() }),
  channel: z.object({
    id: z.string(),
    title: z.string().nullable(),
    platform: z.string(),
    audience_size: z.number().nullable(),
  }),
  others: z.array(otherSchema),
});
const videoSchema = z.object({
  video_id: z.string(),
  external_video_id: z.string().nullable(),
  title: z.string().nullable(),
  published_at: z.string().nullable(),
  shared_commenters: z.number(),
  video_audience: z.number(),
  affinity: z.number(),
});
export const sharedVideosSchema = z.object({
  status: z.enum(["below_threshold", "ready"]),
  videos: z.array(videoSchema),
});
export type Overlap = z.infer<typeof overlapSchema>;
export type OverlapOther = z.infer<typeof otherSchema>;
export type SharedVideos = z.infer<typeof sharedVideosSchema>;
export const audienceKeys = {
  all: ["audience"] as const,
  availability: (workspace: string) =>
    ["audience", "availability", workspace] as const,
  overlap: (channel: string) => ["audience", "overlap", channel] as const,
  videos: (channel: string, other: string, limit: number) =>
    ["audience", "videos", channel, other, limit] as const,
  channels: (workspace: string) => ["audience", "channels", workspace] as const,
};
function raise(error: { message: string }): never {
  const code = error.message.match(
    /forbidden|feature_unavailable|plan_feature_unavailable|invalid_input/,
  )?.[0];
  throw new Error(code ?? "audience_request_failed");
}
export async function loadAvailability(workspace: string) {
  if (!supabase) throw new Error("live_unavailable");
  const { data, error } = await supabase.rpc("audience_overlap_available", {
    p_workspace: workspace,
  });
  if (error) raise(error);
  return availabilitySchema.parse(data);
}
export async function loadOverlap(channel: string, signal?: AbortSignal) {
  if (!supabase) throw new Error("live_unavailable");
  const { data, error } = await supabase
    .rpc("audience_overlap", { p_channel: channel })
    .abortSignal(signal ?? new AbortController().signal);
  if (error) raise(error);
  return overlapSchema.parse(data);
}
export async function loadSharedVideos(
  channel: string,
  other: string,
  limit: number,
  signal?: AbortSignal,
) {
  if (!supabase) throw new Error("live_unavailable");
  const { data, error } = await supabase
    .rpc("audience_shared_videos", {
      p_channel: channel,
      p_other: other,
      p_limit: limit,
    })
    .abortSignal(signal ?? new AbortController().signal);
  if (error) raise(error);
  return sharedVideosSchema.parse(data);
}
export async function loadAudienceChannels(workspace: string) {
  if (!supabase) throw new Error("live_unavailable");
  const { data, error } = await supabase
    .from("channels")
    .select("id,title,platform")
    .eq("workspace_id", workspace);
  if (error) raise(error);
  return data;
}
