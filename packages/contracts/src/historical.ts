import { z } from "zod";

export const HistoricalPostImportSchema = z
  .object({
    external_video_id: z.string().min(1),
    title: z.string().default(""),
    kind: z.string().default("post"),
    published_at: z.string().nullable().default(null),
    duration_sec: z.number().int().nonnegative().nullable().default(null),
    thumbnail_url: z.string().nullable().default(null),
    reported_comment_count: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .default(null),
  })
  .strict();

export const HistoricalCommentImportSchema = z
  .object({
    external_video_id: z.string().min(1),
    external_comment_id: z.string().min(1),
    external_parent_id: z.string().nullable().default(null),
    is_reply: z.boolean().default(false),
    text_raw: z.string().min(1),
    text_plain: z.string().default(""),
    author_name: z.string().default(""),
    author_channel_id: z.string().nullable().default(null),
    published_at: z.string().nullable().default(null),
    likes_value: z.number().int().nonnegative().default(0),
  })
  .strict();

export const HistoricalImportPayloadSchema = z
  .object({
    posts: z.array(HistoricalPostImportSchema).default([]),
    comments: z.array(HistoricalCommentImportSchema).default([]),
  })
  .strict();

export const HistoricalImportResultSchema = z
  .object({
    ok: z.boolean(),
    posts_count: z.number().int().nonnegative(),
    comments_count: z.number().int().nonnegative(),
    backfill_units_used: z.number().int().nonnegative(),
    backfill_units_remaining: z.number().int().min(-1),
  })
  .strict();

export const HistoricalSyncRequestSchema = z
  .object({
    workspace_id: z.string().uuid(),
    channel_id: z.string().uuid(),
    since_date: z.string().min(1),
    max_items: z.number().int().positive().default(500),
  })
  .strict();

export const PlanLimitsUpdateSchema = z
  .object({
    backfill_units: z.number().int().min(-1).optional(),
    historical_days_limit: z.number().int().min(-1).optional(),
    analysis_units: z.number().int().min(-1).optional(),
    topic_units: z.number().int().min(-1).optional(),
    allow_public_channels: z.boolean().optional(),
  })
  .strict();

export type HistoricalPostImport = z.infer<typeof HistoricalPostImportSchema>;
export type HistoricalCommentImport = z.infer<
  typeof HistoricalCommentImportSchema
>;
export type HistoricalImportPayload = z.infer<
  typeof HistoricalImportPayloadSchema
>;
export type HistoricalImportResult = z.infer<
  typeof HistoricalImportResultSchema
>;
export type HistoricalSyncRequest = z.infer<typeof HistoricalSyncRequestSchema>;
export type PlanLimitsUpdate = z.infer<typeof PlanLimitsUpdateSchema>;
