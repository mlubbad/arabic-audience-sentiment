/** Comments, model predictions and human corrections. */
import { z } from "zod";
import { LabelSchema, timestamp, type Label } from "./primitives";
import { TopicPredictionSchema, TopicReviewSchema } from "./topics";

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
export const ReviewSchema = z
  .object({
    label: LabelSchema,
    content_hash: z.string(),
    created_at: timestamp,
    origin: z.enum(["human", "legacy_unverified"]),
    // Null for an imported amendment, which has no reviewer by definition.
    reviewer_id: z.string().min(1).nullable(),
    reason: z.string().nullable(),
  })
  .strict()
  .refine(
    (v) =>
      v.origin !== "human" || (v.reason !== null && v.reason.trim().length > 0),
    "a human review must state a reason",
  );
export const CommentSchema = z
  .object({
    id: z.string().min(1),
    workspace_id: z.string().uuid(),
    client_id: z.string(),
    channel_id: z.string(),
    video_id: z.string(),
    // The video's own title. Null only for a row whose video is unknown; the
    // dashboard fell back to printing the raw id because this was never
    // carried, which reads as a database key where a person expects a name.
    video_title: z.string().nullable().default(null),
    video_kind: z.enum(["video", "short", "stream"]),
    author_channel_id: z.string().nullable(),
    // Written by the channel itself rather than by its audience. Derived from
    // the author's channel id and the channel's own, never stored: a derived
    // fact cannot drift away from the thing it was derived from.
    by_channel_owner: z.boolean().default(false),
    // Null once the retention purge has run. The author is personal data
    // belonging to someone who is not the customer, so it does not outlive the
    // text it came with.
    author_name: z.string().nullable(),
    // Null once the retention purge has run. Absent is not empty: the comment
    // existed and was analysed, and only its text is gone. Anything rendering
    // this must say which of the two it is.
    text_raw: z.string().nullable(),
    content_hash: z.string().min(1),
    // What the source displayed, e.g. "1.2K", kept verbatim. Null when the
    // source showed nothing.
    likes_raw: z.string().nullable(),
    // The parsed count. Null means unknown, which is not the same as zero: a
    // scraped "1.2K" that could not be parsed must not become a number we made
    // up. Likes never weight sentiment (spec 11).
    likes_value: z.number().int().nonnegative().nullable(),
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
    // When the text was removed under the retention rule; null while retained.
    content_purged_at: timestamp.nullable().default(null),
    prediction: PredictionSchema.nullable(),
    reviews: z.array(ReviewSchema),
    // The topic dimension, kept apart from sentiment (handoff §A5). Defaults
    // so a fixture or a server that predates topics still parses; the
    // dashboard then shows "no topic classification has run yet".
    topic_prediction: TopicPredictionSchema.nullable().default(null),
    topic_reviews: z.array(TopicReviewSchema).default([]),
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
  // Supplied by the caller's own context, never read from the payload. The RPC
  // takes it from the session for the same reason: a reviewer must not be able
  // to attribute a verdict to somebody else.
  reviewerId: string | null,
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
    reviewer_id: reviewerId,
    reason: input.reason,
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
