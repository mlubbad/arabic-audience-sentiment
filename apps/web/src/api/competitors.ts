import { z } from "zod";
import { supabase } from "../supabase";

const nullableNumber = z.number().nullable();
const channelSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    handle: z.string().nullable(),
    subscriber_count: nullableNumber,
    subscriber_count_hidden: z.boolean(),
    view_count: nullableNumber.optional(),
    video_count: nullableNumber.optional(),
    country: z.string().nullable(),
    default_language: z.string().nullable(),
    profile_observed_at: z.string().nullable(),
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
    profile_observed_at: z.string().nullable(),
    score: nullableNumber,
    tier: z.string().nullable(),
    reasons: z.array(z.object({ kind: z.string() }).passthrough()),
  })
  .passthrough();
export const suggestionsSchema = z.object({
  channel: channelSchema,
  limit: z.number().nullable(),
  tracked_count: z.number(),
  candidates: z.array(candidateSchema),
});
export type Suggestions = z.infer<typeof suggestionsSchema>;
export const competitorKeys = {
  all: ["competitors"] as const,
  channel: (id: string) => ["competitors", id] as const,
};
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
