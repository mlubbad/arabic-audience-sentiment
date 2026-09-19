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
  })
  .strict();

export const OpsSnapshotSchema = z
  .object({
    sync: SyncStateSchema.nullable(),
    plan: UsageSummarySchema.nullable(),
    video_counts: z.array(OpsVideoCountSchema),
  })
  .strict();

export type OpsVideoCount = z.infer<typeof OpsVideoCountSchema>;
export type OpsSnapshot = z.infer<typeof OpsSnapshotSchema>;
