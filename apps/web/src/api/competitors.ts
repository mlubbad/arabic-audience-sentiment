import { z } from "zod";
import { supabase } from "../supabase";
import { lookupCode } from "../account/channelLookupError";

const nullableNumber = z.number().nullable();
const channelSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable().optional(),
    handle: z.string().nullable().optional(),
    subscriber_count: nullableNumber.optional(),
    subscriber_count_hidden: z.boolean().nullable().optional(),
    country: z.string().nullable().optional(),
    default_language: z.string().nullable().optional(),
    topic_categories: z.array(z.string()).nullable().optional(),
    channel_published_at: z.string().nullable().optional(),
    profile_observed_at: z.string().nullable().optional(),
    stats_observed_at: z.string().nullable().optional(),
  })
  .passthrough();
const candidateSchema = z
  .object({
    external_id: z.string(),
    title: z.string().nullable(),
    handle: z.string().nullable(),
    sources: z.array(z.string()),
    status: z.string().nullable(),
    subscriber_count: nullableNumber,
    view_count: nullableNumber,
    video_count: nullableNumber,
    country: z.string().nullable().optional(),
    default_language: z.string().nullable().optional(),
    profile_observed_at: z.string().nullable(),
    components: z
      .object({
        content: nullableNumber.optional(),
        locale: nullableNumber.optional(),
        size: nullableNumber.optional(),
      })
      .optional(),
    score: nullableNumber,
    tier: z.string().nullable(),
    reasons: z.array(
      z
        .object({ kind: z.string(), value: z.number().optional() })
        .passthrough(),
    ),
  })
  .passthrough();
export const suggestionsSchema = z.object({
  channel: channelSchema,
  limit: z.number().nullable(),
  tracked_count: z.number(),
  candidates: z.array(candidateSchema),
});
export type Suggestions = z.infer<typeof suggestionsSchema>;
const benchmarkPointSchema = z.object({
  day: z.string(),
  subscriber_count: nullableNumber,
  view_count: nullableNumber,
  video_count: nullableNumber,
});
const benchmarkKpisSchema = z.object({
  subscribers: nullableNumber,
  views: nullableNumber,
  subscribers_change: nullableNumber,
  views_change: nullableNumber,
  videos_per_week: nullableNumber,
  views_per_video: nullableNumber,
});
export const competitorBenchmarkSchema = z.object({
  days: z.number(),
  series: z.array(
    z.object({
      kind: z.enum(["own", "competitor"]),
      external_id: z.string(),
      title: z.string(),
      points: z.array(benchmarkPointSchema),
      kpis: benchmarkKpisSchema,
    }),
  ),
});
export type CompetitorBenchmark = z.infer<typeof competitorBenchmarkSchema>;
export const competitorKeys = {
  all: ["competitors"] as const,
  channel: (id: string) => ["competitors", id] as const,
  channels: (workspaceId: string) =>
    ["competitors", "channels", workspaceId] as const,
  role: (workspaceId: string) => ["competitors", "role", workspaceId] as const,
  lookup: (workspaceId: string, input: string) =>
    ["competitors", "lookup", workspaceId, input] as const,
};
export async function loadMyRole(workspaceId: string) {
  if (!supabase) throw new Error("live_unavailable");
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  if (sessionError) throw new Error("membership_session_failed");
  const userId = sessionData.session?.user.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("membership_role_failed");
  return data?.role ?? null;
}
export async function lookupChannel(workspaceId: string, input: string) {
  if (!supabase) throw new Error("live_unavailable");
  const { data, error } = await supabase.functions.invoke("channel-lookup", {
    body: { workspace_id: workspaceId, query: input, platform: "youtube" },
  });
  if (error)
    throw new Error((await lookupCode(error)) || "channel_lookup_failed");
  const candidate = (
    data as {
      candidates?: {
        external_id: string;
        title: string;
        handle?: string | null;
      }[];
    } | null
  )?.candidates?.[0];
  if (!candidate) throw new Error("channel_lookup_empty");
  return {
    id: candidate.external_id,
    title: candidate.title,
    handle: candidate.handle ?? null,
  };
}
export async function loadChannels(workspaceId: string) {
  if (!supabase) throw new Error("live_unavailable");
  const { data, error } = await supabase
    .from("channels")
    .select("id,title,subscriber_count,platform")
    .eq("workspace_id", workspaceId)
    .eq("platform", "youtube");
  if (error) throw new Error("channels_failed");
  return data;
}
export async function addCompetitorCandidate(
  channel: string,
  candidate: { id: string; title: string; handle: string | null },
) {
  if (!supabase) throw new Error("live_unavailable");
  const { error } = await supabase.rpc("competitor_candidate_add", {
    p_channel: channel,
    p_external: candidate.id,
    p_title: candidate.title,
    p_handle: candidate.handle,
  });
  if (error)
    throw new Error(
      error.message.match(
        /forbidden|invalid_candidate|invalid_input|candidate_limit_reached/,
      )?.[0] ?? "competitor_candidate_add_failed",
    );
}
export async function loadCompetitors(channel: string, signal?: AbortSignal) {
  if (!supabase) throw new Error("live_unavailable");
  const { data, error } = await supabase
    .rpc("competitor_suggestions", { p_channel: channel })
    .abortSignal(signal ?? new AbortController().signal);
  if (error)
    throw new Error(
      error.message.match(
        /no_active_plan|competitor_limit_reached|forbidden|invalid_input/,
      )?.[0] ?? "competitor_suggestions_failed",
    );
  return suggestionsSchema.parse(data);
}
export async function loadCompetitorBenchmark(
  channel: string,
  days: number,
  signal?: AbortSignal,
) {
  if (!supabase) throw new Error("live_unavailable");
  const { data, error } = await supabase
    .rpc("competitor_benchmark", { p_channel: channel, p_days: days })
    .abortSignal(signal ?? new AbortController().signal);
  if (error)
    throw new Error(
      error.message.match(/forbidden|invalid_input/)?.[0] ??
        "competitor_benchmark_failed",
    );
  return competitorBenchmarkSchema.parse(data);
}
export async function decideCompetitor(
  channel: string,
  candidate: string,
  decision: "tracked" | "dismissed" | "clear",
) {
  if (!supabase) throw new Error("live_unavailable");
  const { data, error } = await supabase.rpc("competitor_decide", {
    p_channel: channel,
    p_candidate_external_id: candidate,
    p_decision: decision,
  });
  if (error)
    throw new Error(
      error.message.match(
        /no_active_plan|competitor_limit_reached|forbidden|invalid_input/,
      )?.[0] ?? "competitor_decide_failed",
    );
  return z
    .object({
      status: z.string(),
      tracked_count: z.number(),
      limit: z.number().nullable(),
    })
    .parse(data);
}
