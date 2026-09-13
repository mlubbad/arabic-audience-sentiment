/** Comments, model predictions and human corrections. */
import { z } from "zod";
import { LabelSchema, timestamp, type Label } from "./primitives";

export const PredictionSchema = z
  .object({
    status: z.enum(["succeeded", "skipped", "failed", "unsupported"]),
    label: LabelSchema.nullable(),
    content_hash: z.string().min(1),
    analysis_key: z.string().min(1),
    model_id: z.string().min(1),
    revision: z.string().min(1),
    preprocessing_version: z.string().min(1),
    predicted_at: timestamp,
    class_scores: z.record(LabelSchema, z.number().min(0).max(1)),
  })
  .strict()
  .refine(
    (v) => (v.status === "succeeded" ? v.label !== null : v.label === null),
    "Only successful predictions have labels",
  );
export const ReviewSchema = z.object({
  label: LabelSchema,
  content_hash: z.string(),
  created_at: timestamp,
  origin: z.enum(["human", "legacy_unverified"]),
});
export const CommentSchema = z
  .object({
    id: z.string().min(1),
    workspace_id: z.string().uuid(),
    client_id: z.string(),
    channel_id: z.string(),
    video_id: z.string(),
    video_kind: z.enum(["video", "short", "stream"]),
    author_channel_id: z.string().nullable(),
    author_name: z.string(),
    text_raw: z.string(),
    content_hash: z.string().min(1),
    published_at: timestamp.nullable(),
    published_time_raw: z.string().nullable(),
    timestamp_precision: z.enum([
      "second",
      "minute",
      "day",
      "approximate",
      "unknown",
    ]),
    is_reply: z.boolean(),
    parent_comment_id: z.string().nullable(),
    parent_source: z.enum(["api", "extractor", "inferred_id", "unknown"]),
    source: z.enum([
      "sanitized_fixture",
      "youtube_data_api_public",
      "youtube_public_scrape",
      "youtube_oauth",
      "legacy_import",
    ]),
    field_provenance: z.record(z.unknown()),
    comment_type: z.string().nullable(),
    prediction: PredictionSchema.nullable(),
    reviews: z.array(ReviewSchema),
  })
  .strict();
export type Comment = z.infer<typeof CommentSchema>;

export const CommentReviewInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    comment_id: z.string().min(1),
    // The hash of the text the reviewer actually read. Optimistic concurrency:
    // a verdict is only valid for the version it was formed against.
    content_hash: z.string().min(1),
    label: LabelSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type CommentReviewInput = z.infer<typeof CommentReviewInputSchema>;

/**
 * Appends a human correction. Pure and non-mutating, so a rejected correction
 * cannot leave a half-applied list behind. The server RPC enforces the same
 * rules; this is the shared reference implementation, not a substitute for it.
 */
export function applyReview(
  comments: Comment[],
  raw: CommentReviewInput,
  now: string,
): Comment[] {
  const input = CommentReviewInputSchema.parse(raw);
  const target = comments.find(
    (c) => c.id === input.comment_id && c.workspace_id === input.workspace_id,
  );
  if (!target) throw new Error("invalid_comment");
  if (target.content_hash !== input.content_hash)
    throw new Error("stale_comment_text");
  const review = {
    label: input.label,
    content_hash: input.content_hash,
    created_at: now,
    origin: "human" as const,
  };
  return comments.map((c) =>
    c === target ? { ...c, reviews: [...c.reviews, review] } : c,
  );
}

export function effectiveLabel(
  comment: Comment,
  activeKey: string,
): { label: Label | null; reviewed: boolean } {
  const review = comment.reviews
    .filter(
      (r) => r.origin === "human" && r.content_hash === comment.content_hash,
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (review) return { label: review.label, reviewed: true };
  const p = comment.prediction;
  return {
    label:
      p?.status === "succeeded" &&
      p.content_hash === comment.content_hash &&
      p.analysis_key === activeKey
        ? p.label
        : null,
    reviewed: false,
  };
}
