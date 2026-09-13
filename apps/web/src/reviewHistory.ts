import type { Comment } from "@sentiment/contracts";

export type Review = Comment["reviews"][number];
export type ReviewState =
  | "in_force"
  | "superseded_by_review"
  | "superseded_by_edit"
  | "legacy_unverified";

/**
 * Orders a comment's verdicts newest first and says what each one is doing now.
 *
 * effectiveLabel silently discards a verdict that no longer applies, so without
 * this a reviewer cannot tell that their correction stopped counting — either
 * because the comment was edited afterwards, or because someone reviewed it
 * again. The precedence rule here is deliberately the same one effectiveLabel
 * uses: the newest human verdict whose hash matches the current text wins.
 */
export function reviewHistory(
  comment: Pick<Comment, "reviews" | "content_hash">,
): { review: Review; state: ReviewState }[] {
  const newestFirst = [...comment.reviews].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  let inForceFound = false;
  return newestFirst.map((review) => {
    // A legacy amendment is never human-reviewed truth, whatever its date.
    if (review.origin !== "human")
      return { review, state: "legacy_unverified" as const };
    if (review.content_hash !== comment.content_hash)
      return { review, state: "superseded_by_edit" as const };
    if (inForceFound) return { review, state: "superseded_by_review" as const };
    inForceFound = true;
    return { review, state: "in_force" as const };
  });
}
