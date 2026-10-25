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

export const competitorIntelEntrySchema = z
  .object({
    external_id: z.string(),
    title: z.string(),
    handle: z.string().nullable().optional(),
    status: z.string(),
    tier: z.string().nullable().optional(),
    analysis_source: z.string().optional(),
    connection_between_platforms: z.string().optional(),
    primary_platform: z.string().nullable().optional(),
    subscribers: nullableNumber.optional(),
    subscribers_change: nullableNumber.optional(),
    size_ratio: nullableNumber.optional(),
    country: z.string().nullable().optional(),
    default_language: z.string().nullable().optional(),
    videos: nullableNumber.optional(),
    videos_per_week: nullableNumber.optional(),
    capacity_state: z.string().optional(),
    views: nullableNumber.optional(),
    views_per_video: nullableNumber.optional(),
    views_per_video_ratio_vs_own: nullableNumber.optional(),
    dominant_format: z.string().optional(),
    funnel_stage: z.string().optional(),
    next_funnel_stage: z.string().optional(),
    topics_covered: z.array(z.string()).optional(),
    shared_topics: z.array(z.string()).optional(),
    topic_gaps: z.array(z.string()).optional(),
    tone_of_voice: z.string().optional(),
    cta_pattern: z.string().nullable().optional(),
    conversion_channel: z.string().nullable().optional(),
    visual_style: z.string().nullable().optional(),
    strengths: z.array(z.string()).optional(),
    weaknesses: z.array(z.string()).optional(),
    opportunity_gap: z.string().nullable().optional(),
    threat_level: z.string().nullable().optional(),
  })
  .passthrough();

export const competitorIntelligenceSchema = z
  .object({
    days: z.number(),
    tracked_count: z.number(),
    own: z
      .object({
        id: z.string(),
        external_id: z.string(),
        title: z.string(),
        handle: z.string().nullable().optional(),
        platform: z.string().optional(),
        country: z.string().nullable().optional(),
        default_language: z.string().nullable().optional(),
        connected_platforms: z.array(z.string()).optional(),
        connection_strategy: z.string().optional(),
        subscribers: nullableNumber.optional(),
        subscribers_change: nullableNumber.optional(),
        views: nullableNumber.optional(),
        videos: nullableNumber.optional(),
        videos_per_week: nullableNumber.optional(),
        views_per_video: nullableNumber.optional(),
        avg_comments_per_video: nullableNumber.optional(),
        avg_likes_per_video: nullableNumber.optional(),
        dominant_format: z.string().optional(),
        format_mix: z
          .object({
            video: z.number(),
            short: z.number(),
            stream: z.number(),
            post: z.number(),
          })
          .optional(),
        funnel_stage: z.string().optional(),
        funnel_mix: z
          .object({
            awareness: z.number(),
            consideration: z.number(),
            engagement: z.number(),
            decision: z.number(),
          })
          .optional(),
        sentiment_mix: z
          .object({
            positive: z.number(),
            negative: z.number(),
            neutral: z.number(),
            mixed: z.number(),
          })
          .optional(),
        topics_covered: z.array(z.string()).optional(),
        tone_of_voice: z.string().optional(),
      })
      .passthrough(),
    competitors: z.array(competitorIntelEntrySchema),
    pacing_plan: z
      .object({
        current_weekly_posts: nullableNumber.optional(),
        benchmark_weekly_posts: nullableNumber.optional(),
        recommended_weekly_posts: nullableNumber.optional(),
        week_1_schedule: z.array(z.number()),
        week_2_schedule: z.array(z.number()),
      })
      .optional(),
  })
  .passthrough();

export type CompetitorIntelEntry = z.infer<typeof competitorIntelEntrySchema>;
export type CompetitorIntelligence = z.infer<
  typeof competitorIntelligenceSchema
>;
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
export async function loadCompetitorIntelligence(
  channel: string,
  days: number,
  signal?: AbortSignal,
) {
  if (!supabase) throw new Error("live_unavailable");
  const { data, error } = await supabase
    .rpc("competitor_intelligence_matrix", {
      p_channel: channel,
      p_days: days,
    })
    .abortSignal(signal ?? new AbortController().signal);
  if (error)
    throw new Error(
      error.message.match(/forbidden|invalid_input/)?.[0] ??
        "competitor_intelligence_failed",
    );
  return competitorIntelligenceSchema.parse(data);
}
export async function upsertCompetitorIntelligence(
  channel: string,
  candidateExternalId: string,
  profile: {
    connection_between_platforms?: string;
    primary_platform?: string | null;
    dominant_format?: string;
    funnel_stage?: string;
    tone_of_voice?: string;
    cta_pattern?: string | null;
    conversion_channel?: string | null;
    visual_style?: string | null;
    strengths?: string[];
    weaknesses?: string[];
    opportunity_gap?: string | null;
    threat_level?: string | null;
  },
) {
  if (!supabase) throw new Error("live_unavailable");
  const { error } = await supabase.rpc(
    "upsert_competitor_intelligence_profile",
    {
      p_channel: channel,
      p_candidate_external_id: candidateExternalId,
      p_profile: profile,
    },
  );
  if (error)
    throw new Error(
      error.message.match(/forbidden|invalid_input/)?.[0] ??
        "competitor_intelligence_save_failed",
    );
}
