import { z } from "zod";
import { LabelSchema } from "./primitives";

export const SpikeCitationSchema = z
  .object({
    url: z.string().url(),
    published_date: z.string().nullable().optional(),
    snippet: z.string().nullable().optional(),
  })
  .strict();

export const SpikeAttributionSchema = z
  .object({
    id: z.string().uuid(),
    channel_id: z.string().uuid(),
    from_date: z.string(),
    to_date: z.string(),
    dominant_sentiment: LabelSchema,
    query: z.string().min(1).max(300),
    scope: z.enum(["news", "web"]),
    status: z.enum(["succeeded", "empty", "failed"]),
    headline_ar: z.string().nullable(),
    summary_ar: z.string().nullable(),
    citations: z.array(SpikeCitationSchema),
    error_code: z.string().nullable(),
    computed_at: z.string(),
  })
  .strict();

export const SpikeAttributionListSchema = z.array(SpikeAttributionSchema);

export type SpikeCitation = z.infer<typeof SpikeCitationSchema>;
export type SpikeAttribution = z.infer<typeof SpikeAttributionSchema>;
