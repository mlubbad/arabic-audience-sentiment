/**
 * Lightweight operational status for a workspace: sync health, quota usage,
 * and comments stored per video.
 *
 * Used by the left rail and /sync pages to stay responsive without loading the
 * full comments dataset.
 */
import { z } from "zod";
import { SyncStateSchema } from "./sync";
import { UsageSummarySchema } from "./usage";

export const OpsVideoCountSchema = z
  .object({
    id: z.string().min(1),
    total: z.number().int().nonnegative(),
    analysed: z.number().int().nonnegative().optional(),
  })
  .strict();

export const CatalogueSummarySchema = z
  .object({
    total_comments_collected: z.number().int().nonnegative(),
    total_comments_analysed: z.number().int().nonnegative(),
    videos_with_comments: z.number().int().nonnegative(),
  })
  .strict();

export const OpsSnapshotSchema = z
  .object({
    sync: SyncStateSchema.nullable(),
    plan: UsageSummarySchema.nullable(),
    video_counts: z.array(OpsVideoCountSchema),
    catalogue_summary: CatalogueSummarySchema.optional(),
  })
  .strict();

export type OpsVideoCount = z.infer<typeof OpsVideoCountSchema>;
export type CatalogueSummary = z.infer<typeof CatalogueSummarySchema>;
export type OpsSnapshot = z.infer<typeof OpsSnapshotSchema>;
