/** Topics: the taxonomy, model verdicts and human corrections. Mirrors comments.ts. */
import { z } from "zod";
import { timestamp } from "./primitives";
import type { Comment } from "./comments";

/** The filter value that selects rows with no effective topic. */
export const UNCLASSIFIED = "__unclassified";

export const TopicSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    name_ar: z.string().min(1).max(80),
    name_en: z.string().min(1).max(80),
    description: z.string().min(1).max(400),
    position: z.number().int(),
    retired: z.boolean().default(false),
  })
  .strict();
export type Topic = z.infer<typeof TopicSchema>;

export const TopicPredictionSchema = z
  .object({
    status: z.enum(["succeeded", "skipped", "failed", "unsupported"]),
    topic_key: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    content_hash: z.string().min(1),
    classification_key: z.string().min(1),
    model_id: z.string().min(1),
    prompt_version: z.string().min(1),
    predicted_at: timestamp,
    error_code: z.string().nullable().default(null),
  })
  .strict()
  .refine(
    (v) =>
      v.status === "succeeded" ? v.topic_key !== null : v.topic_key === null,
    "Only successful predictions have a topic",
  );

export const TopicReviewSchema = z
  .object({
    topic_key: z.string().min(1),
    content_hash: z.string(),
    created_at: timestamp,
    origin: z.enum(["human"]),
    reviewer_id: z.string().min(1).nullable(),
    reason: z.string().nullable(),
  })
  .strict();

export const TopicReviewInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    comment_id: z.string().min(1),
    content_hash: z.string().min(1),
    topic_key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type TopicReviewInput = z.infer<typeof TopicReviewInputSchema>;

/**
 * The same rule as effectiveLabel, on the topic fields: the newest human
 * review on the current text wins; else a succeeded verdict on the current
 * text under the active key; else nothing. One rule, so the two cannot drift.
 */
export function effectiveTopic(
  comment: Comment,
  activeTopicKey: string,
): { topic: string | null; topic_reviewed: boolean } {
  const review = comment.topic_reviews
    .filter(
      (r) => r.origin === "human" && r.content_hash === comment.content_hash,
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (review) return { topic: review.topic_key, topic_reviewed: true };
  const p = comment.topic_prediction;
  return {
    topic:
      p?.status === "succeeded" &&
      p.content_hash === comment.content_hash &&
      p.classification_key === activeTopicKey
        ? p.topic_key
        : null,
    topic_reviewed: false,
  };
}

/** Appends a topic correction; pure, as applyReview is. */
export function applyTopicReview(
  comments: Comment[],
  raw: TopicReviewInput,
  now: string,
  reviewerId: string | null,
): Comment[] {
  const input = TopicReviewInputSchema.parse(raw);
  const target = comments.find(
    (c) => c.id === input.comment_id && c.workspace_id === input.workspace_id,
  );
  if (!target) throw new Error("invalid_comment");
  if (target.content_hash !== input.content_hash)
    throw new Error("stale_comment_text");
  const review = {
    topic_key: input.topic_key,
    content_hash: input.content_hash,
    created_at: now,
    origin: "human" as const,
    reviewer_id: reviewerId,
    reason: input.reason,
  };
  return comments.map((c) =>
    c === target ? { ...c, topic_reviews: [...c.topic_reviews, review] } : c,
  );
}
