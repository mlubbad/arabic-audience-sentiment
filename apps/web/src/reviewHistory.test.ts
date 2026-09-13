import { describe, expect, it } from "vitest";
import { reviewHistory } from "./reviewHistory";

const at = (d: string) => `2026-09-${d}T00:00:00Z`;
const review = (
  over: Partial<{
    label: "positive" | "negative" | "mixed";
    content_hash: string;
    created_at: string;
    origin: "human" | "legacy_unverified";
  }> = {},
) => ({
  label: "negative" as const,
  content_hash: "current",
  created_at: at("01"),
  origin: "human" as const,
  ...over,
});

describe("review history", () => {
  it("puts the newest first and marks exactly one verdict in force", () => {
    const states = reviewHistory({
      content_hash: "current",
      reviews: [
        review({ created_at: at("01"), label: "negative" }),
        review({ created_at: at("03"), label: "mixed" }),
        review({ created_at: at("02"), label: "positive" }),
      ],
    });
    expect(states.map((s) => s.review.created_at)).toEqual([
      at("03"),
      at("02"),
      at("01"),
    ]);
    expect(states.map((s) => s.state)).toEqual([
      "in_force",
      "superseded_by_review",
      "superseded_by_review",
    ]);
  });

  it("marks a verdict on older text as superseded by the edit, not in force", () => {
    const states = reviewHistory({
      content_hash: "current",
      reviews: [review({ content_hash: "older", created_at: at("05") })],
    });
    expect(states[0].state).toBe("superseded_by_edit");
  });

  it("does not let a newer stale verdict hide an older applicable one", () => {
    // The edit came after the older verdict, so the older one is not in force
    // either — but the rule must not silently promote the stale newer one.
    const states = reviewHistory({
      content_hash: "current",
      reviews: [
        review({ content_hash: "older", created_at: at("09") }),
        review({ content_hash: "current", created_at: at("04") }),
      ],
    });
    expect(states.map((s) => s.state)).toEqual([
      "superseded_by_edit",
      "in_force",
    ]);
  });

  it("never counts a legacy amendment as human truth", () => {
    const states = reviewHistory({
      content_hash: "current",
      reviews: [
        review({ origin: "legacy_unverified", created_at: at("09") }),
        review({ created_at: at("02") }),
      ],
    });
    expect(states.map((s) => s.state)).toEqual([
      "legacy_unverified",
      "in_force",
    ]);
  });

  it("returns nothing for a comment that was never reviewed", () => {
    expect(reviewHistory({ content_hash: "current", reviews: [] })).toEqual([]);
  });
});
