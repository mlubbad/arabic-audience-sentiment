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
        // Alive with nothing to do is not alive and working, and an operator
        // waiting on a collection needs them apart.
        //
        // Defaulted rather than required, because the two halves of this
        // contract deploy separately: the database gained the field the moment
        // its migration was applied, while the browser keeps running whatever
        // bundle was last shipped. A required field would make the old bundle
        // reject the new payload; `.strict()` on this object had already made
        // the new payload unreadable to it, and since `sync` falls back with
        // `.catch(null)`, the panel did not error — it quietly reported the
        // sync state as unknown. A default is what lets either side move first.
        busy: z.boolean().default(false),
      })
      .strict(),
    queued_jobs: z.number().int().nonnegative(),
    last_run: SyncRunSchema.nullable(),
  })
  .strict();

export type SyncState = z.infer<typeof SyncStateSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
