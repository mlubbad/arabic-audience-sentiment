/**
 * Worker-facing surface. Coordinated between lanes on purpose: a unilateral
 * change here breaks the other side rather than merely inconveniencing it.
 */
import { z } from "zod";
import { timestamp } from "./primitives";

export const JobSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  channel_id: z.string().uuid(),
  type: z.enum(["discover", "collect", "analyse", "import", "export"]),
  dedupe_key: z.string().min(1).max(200),
  status: z.enum([
    "queued",
    "running",
    "succeeded",
    "partial",
    "failed",
    "blocked",
    "cancelled",
  ]),
  attempt: z.number().int().nonnegative(),
  not_before: timestamp,
  lease_expires_at: timestamp.nullable(),
  checkpoint: z.record(z.unknown()),
  counters: z.record(z.number().int().nonnegative()),
  error_code: z.string().nullable(),
}); // Public job DTO deliberately excludes lease tokens and credentials.
export const ErrorSchema = z.object({
  code: z.enum([
    "invalid_input",
    "unauthenticated",
    "forbidden",
    "conflict",
    "unsupported_import",
    "quota_exceeded",
    "worker_unavailable",
  ]),
  message: z.string(),
  request_id: z.string().uuid(),
  retryable: z.boolean(),
});
