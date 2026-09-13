/**
 * Collection health as the dashboard reads it.
 *
 * This is a read projection aggregated over sync runs and the job queue, not a
 * table row and not part of the worker↔server batch protocol. The server side
 * must produce this shape; the classification of it into a severity is
 * presentation and lives in the app.
 */
import { z } from "zod";
import { timestamp } from "./primitives";

export const RunStatusSchema = z.enum([
  "running",
  "succeeded",
  "partial",
  "failed",
  "blocked",
]);

export const SyncCoverageSchema = z
  .object({
    videos_seen: z.number().int().nonnegative(),
    comments_collected: z.number().int().nonnegative(),
    // Whether the source was traversed to its end. Never a claim that every
    // comment that exists was retrieved.
    complete: z.boolean(),
  })
  .strict();

export const SyncRunSchema = z
  .object({
    started_at: timestamp,
    ended_at: timestamp.nullable(),
    status: RunStatusSchema,
    source: z.string().min(1),
    error_code: z.string().nullable(),
    coverage: SyncCoverageSchema,
  })
  .strict()
  .refine(
    (r) => r.status !== "running" || r.ended_at === null,
    "a run still in progress cannot have ended",
  );

export const SyncStateSchema = z
  .object({
    worker: z
      .object({
        connected: z.boolean(),
        last_heartbeat_at: timestamp.nullable(),
      })
      .strict(),
    queued_jobs: z.number().int().nonnegative(),
    last_run: SyncRunSchema.nullable(),
  })
  .strict();

export type SyncState = z.infer<typeof SyncStateSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
