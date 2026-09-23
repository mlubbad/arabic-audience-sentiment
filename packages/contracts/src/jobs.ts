/**
 * Worker-facing surface. Coordinated between lanes on purpose: a unilateral
 * change here breaks the other side rather than merely inconveniencing it.
 */
import { z } from "zod";
import { LabelSchema, timestamp } from "./primitives";

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

/* ------------------------------------------------------------------ *
 * I1 — the worker to server batch contract.
 *
 * The worker addresses rows by their platform identifier; the server owns
 * every internal id, so the two sides cannot drift apart over surrogate keys.
 * The workspace is derived server-side from the job and the worker credential
 * and is deliberately absent from the payload: a workspace field here would be
 * a privilege-escalation vector.
 * ------------------------------------------------------------------ */

export const OutcomeSchema = z.enum([
  "partial",
  "exhausted",
  "blocked",
  "failed",
]);

export const BatchCommentSchema = z
  .object({
    external_comment_id: z.string().min(1).max(200),
    external_parent_id: z.string().min(1).max(200).nullable(),
    is_reply: z.boolean(),
    parent_source: z.enum(["api", "extractor", "inferred_id", "unknown"]),
    author_channel_id: z.string().nullable(),
    author_name: z.string(),
    text_raw: z.string(),
    text_plain: z.string(),
    content_hash: z.string().min(1),
    published_time_raw: z.string().nullable(),
    published_at: timestamp.nullable(),
    timestamp_precision: z.enum([
      "second",
      "minute",
      "day",
      "approximate",
      "unknown",
    ]),
    likes_raw: z.string().nullable(),
    likes_value: z.number().int().nonnegative().nullable(),
    source: z.string().min(1),
    field_provenance: z.record(z.unknown()),
    author_profile_image_url: z.string().nullable().optional(),
    author_channel_url: z.string().nullable().optional(),
    reply_count: z.number().int().nonnegative().optional(),
    updated_at: timestamp.nullable().optional(),
  })
  .strict()
  .refine(
    (c) => c.is_reply || c.external_parent_id === null,
    "a top-level comment cannot name a parent",
  );

export const BatchPredictionSchema = z
  .object({
    external_comment_id: z.string().min(1).max(200),
    // Which text this verdict is about. A prediction for older text is stored
    // but is not the effective label, so the hash travels with it.
    content_hash: z.string().min(1),
    analysis_key: z.string().min(1),
    status: z.enum(["succeeded", "skipped", "failed", "unsupported"]),
    label: LabelSchema.nullable(),
    class_scores: z.record(LabelSchema, z.number().min(0).max(1)),
    model_id: z.string().min(1),
    revision: z.string().min(1),
    preprocessing_version: z.string().min(1),
    // The inference settings this verdict was produced under. Section 9 makes
    // the fingerprint model, revision, preprocessing *and* settings; the
    // column and its unique index already named this, and nothing wrote it. An
    // adapter with no settings sends {}, which is a statement, not an absence.
    parameters: z.record(z.unknown()),
  })
  .strict()
  .refine(
    (p) => (p.status === "succeeded") === (p.label !== null),
    "only a successful prediction carries a label",
  )
  .refine(
    (p) => p.status !== "succeeded" || Object.keys(p.class_scores).length > 0,
    "a successful prediction must record the class scores it was based on",
  );

/**
 * What travels as `payload`, and what the payload hash is computed over.
 *
 * Kept separate from the envelope on purpose. The two are hashed and routed
 * differently: the envelope names the job and the lease so the server can
 * authorise the call, and the payload is the content whose digest makes a
 * replay recognisable. Folding them into one object — which this contract used
 * to do — produced a schema that described neither, so nothing could be
 * validated against it.
 */
export const BatchPayloadSchema = z
  .object({
    // A batch covers one video. The job names the channel; the server resolves
    // the video under it, so the worker never sends a server id.
    external_video_id: z.string().min(1).max(64),
    // Null when the source did not give one; the server falls back to the id
    // rather than inventing a title.
    video_title: z.string().nullable(),
    checkpoint: z.record(z.unknown()),
    outcome: OutcomeSchema,
    comments: z.array(BatchCommentSchema).max(500),
    predictions: z.array(BatchPredictionSchema).max(500),
  })
  .strict()
  .refine((b) => {
    const ids = new Set(b.comments.map((c) => c.external_comment_id));
    // A prediction for a row the worker never delivered would be analysis of
    // something the server cannot show, so the whole batch is refused. The
    // database enforces this too, and must: the handler cannot reach a schema
    // the worker is free to ignore, and metering happens server-side.
    return b.predictions.every((p) => ids.has(p.external_comment_id));
  }, "every prediction must belong to a comment in the same batch")
  .refine(
    (b) =>
      new Set(b.comments.map((c) => c.external_comment_id)).size ===
      b.comments.length,
    "a batch cannot carry the same comment twice",
  );

/**
 * The commit-batch request exactly as it goes over the wire.
 *
 * This is the message `ControlPlane.commit_batch` posts — envelope around
 * payload, not one flat object. The golden fixture records a real one and the
 * seam test parses it here without reshaping, which is the only way this schema
 * can keep describing what is actually sent.
 */
export const CommitBatchSchema = z
  .object({
    job_id: z.string().uuid(),
    // Fencing token. Never logged, never echoed back.
    lease_token: z.string().uuid(),
    batch_key: z.string().min(1).max(200),
    // Fingerprint of the whole payload. batch_key alone is not enough: the same
    // key carrying different rows must be a conflict, not a silent overwrite.
    payload_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "expected a sha256 hex digest"),
    payload: BatchPayloadSchema,
  })
  .strict();

export type CommitBatch = z.infer<typeof CommitBatchSchema>;
export type BatchPayload = z.infer<typeof BatchPayloadSchema>;
export type BatchComment = z.infer<typeof BatchCommentSchema>;
export type BatchPrediction = z.infer<typeof BatchPredictionSchema>;

/**
 * The billable event key for one analysed comment.
 *
 * Keyed on the comment alone, not on its text. One unique comment costs one
 * unit in a workspace once and for all: a retry, a reimport, a likes refresh
 * and a re-analysis after an edit are all free. Including the content hash
 * would bill every edit, which can surprise a customer for work they did not
 * ask for. This is the pricing decision recorded in the lane report.
 */
export function usageEventKey(platform: string, externalCommentId: string) {
  return `analysis:${platform}:${externalCommentId}`;
}
