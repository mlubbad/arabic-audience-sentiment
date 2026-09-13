import { describe, expect, it } from "vitest";
import {
  CommentReviewInputSchema,
  ReviewSchema,
  FiltersSchema,
  PredictionSchema,
  applyReview,
  effectiveLabel,
  snapshot,
  type Comment,
} from "./index";
const workspace = "00000000-0000-4000-8000-000000000001";
const base = {
  workspace_id: workspace,
  client_id: "client",
  channel_id: "channel",
  video_id: "v1",
  video_kind: "video" as const,
  author_channel_id: "author",
  author_name: "كاتب تجريبي",
  text_raw: "تعليق تجريبي",
  content_hash: "current",
  published_at: "2026-09-01T00:00:00Z",
  published_time_raw: "2026-09-01T00:00:00Z",
  timestamp_precision: "second" as const,
  is_reply: false,
  parent_comment_id: null,
  parent_source: "unknown" as const,
  source: "sanitized_fixture" as const,
  field_provenance: {},
  comment_type: null,
  reviews: [],
  prediction: null,
};
const pred = (label: "positive" | "mixed", hash = "current") => ({
  status: "succeeded" as const,
  label,
  content_hash: hash,
  analysis_key: "fixture-v1",
  model_id: "sanitized-fixture",
  revision: "fixture-v1",
  preprocessing_version: "fixture-v1",
  predicted_at: "2026-09-02T00:00:00Z",
  class_scores: {
    positive: label === "positive" ? 1 : 0,
    negative: 0,
    neutral: 0,
    mixed: label === "mixed" ? 1 : 0,
  },
});
const rows: Comment[] = [
  { ...base, id: "1", prediction: pred("positive") },
  { ...base, id: "2", is_reply: true, prediction: pred("mixed") },
  { ...base, id: "3", prediction: pred("positive", "old") },
  {
    ...base,
    id: "4",
    published_at: null,
    timestamp_precision: "unknown",
    author_channel_id: null,
  },
  { ...base, id: "5", workspace_id: "00000000-0000-4000-8000-000000000002" },
];
describe("dashboard contract", () => {
  it("scopes before counting and excludes stale/unanalysed sentiment", () => {
    const s = snapshot(rows, { workspace_id: workspace }, "fixture-v1");
    expect(s.total).toBe(4);
    expect(s.analysed).toBe(2);
    expect(s.unanalysed).toBe(2);
    expect(s.sentiments).toEqual({
      positive: 1,
      negative: 0,
      neutral: 0,
      mixed: 1,
    });
    expect(s.replies).toBe(1);
    expect(s.unknown_dates).toBe(1);
    expect(s.unique_authors).toBe(1);
  });
  it("uses half-open dates and explicitly selected unknown dates", () => {
    expect(
      snapshot(
        rows,
        {
          workspace_id: workspace,
          from: "2026-09-01T00:00:00Z",
          to: "2026-09-02T00:00:00Z",
        },
        "fixture-v1",
      ).total,
    ).toBe(3);
    expect(
      snapshot(
        rows,
        { workspace_id: workspace, to: "2026-09-01T00:00:00Z" },
        "fixture-v1",
      ).total,
    ).toBe(0);
    expect(
      snapshot(
        rows,
        { workspace_id: workspace, date_mode: "unknown" },
        "fixture-v1",
      ).total,
    ).toBe(1);
  });
  it("uses current review then active prediction; old reviews do not override", () => {
    const r = {
      ...rows[0],
      reviews: [
        {
          label: "negative" as const,
          content_hash: "old",
          created_at: "2026-09-03T00:00:00Z",
          origin: "human" as const,
          reviewer_id: "reviewer-1",
          reason: "تصنيف خاطئ",
        },
      ],
    };
    expect(
      snapshot([r], { workspace_id: workspace }, "fixture-v1").sentiments
        .positive,
    ).toBe(1);
    r.reviews[0].content_hash = "current";
    expect(
      snapshot([r], { workspace_id: workspace }, "fixture-v1").sentiments
        .negative,
    ).toBe(1);
  });
  it("searches all rows before pagination and filters every aggregation", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...rows[0],
      id: String(i),
      author_name: i === 39 ? "مؤلف نادر" : "عام",
    }));
    const s = snapshot(
      many,
      { workspace_id: workspace, q: "نادر", limit: 1 },
      "fixture-v1",
    );
    expect(s.total).toBe(1);
    expect(s.comments[0].id).toBe("39");
    expect(s.videos[0].total).toBe(1);
  });
  it("pagination is stable and never changes aggregate counts", () => {
    const s = snapshot(
      rows,
      { workspace_id: workspace, limit: 2 },
      "fixture-v1",
    );
    const t = snapshot(
      rows,
      { workspace_id: workspace, limit: 2, cursor: s.next_cursor! },
      "fixture-v1",
    );
    expect(t.total).toBe(4);
    expect(new Set([...s.comments, ...t.comments].map((c) => c.id)).size).toBe(
      4,
    );
  });
  it("rejects backwards dates, oversized pages and success without label", () => {
    expect(
      FiltersSchema.safeParse({
        workspace_id: workspace,
        from: "2026-09-03T00:00:00Z",
        to: "2026-09-02T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      FiltersSchema.safeParse({ workspace_id: workspace, limit: 1001 }).success,
    ).toBe(false);
    expect(
      PredictionSchema.safeParse({ ...pred("positive"), label: null }).success,
    ).toBe(false);
  });
  it("does not treat legacy amendments as human truth or failed models as neutral", () => {
    const r = {
      ...rows[0],
      reviews: [
        {
          label: "negative" as const,
          content_hash: "current",
          created_at: "2026-09-03T00:00:00Z",
          origin: "legacy_unverified" as const,
          reviewer_id: null,
          reason: null,
        },
      ],
      prediction: {
        ...pred("positive"),
        status: "failed" as const,
        label: null,
      },
    };
    expect(
      snapshot([r], { workspace_id: workspace }, "fixture-v1").analysed,
    ).toBe(0);
  });
  it("walks every page exactly once and ends with a null cursor", () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    for (;;) {
      const page = snapshot(
        rows,
        { workspace_id: workspace, limit: 1, cursor },
        "fixture-v1",
      );
      expect(page.total).toBe(4);
      seen.push(...page.comments.map((c) => c.id));
      cursor = page.next_cursor ?? undefined;
      if (!cursor) break;
      if (++guard > 10) throw new Error("cursor walk did not terminate");
    }
    expect(seen).toEqual([...new Set(seen)]);
    expect(seen).toHaveLength(4);
  });
  it("rejects a cursor that the current filters no longer contain", () => {
    const first = snapshot(
      rows,
      { workspace_id: workspace, limit: 1 },
      "fixture-v1",
    );
    // The same cursor under a narrower filter points at a row that is gone.
    expect(() =>
      snapshot(
        rows,
        {
          workspace_id: workspace,
          limit: 1,
          cursor: first.next_cursor!,
          sentiments: ["mixed"],
        },
        "fixture-v1",
      ),
    ).toThrow("invalid_cursor");
  });
});

describe("human corrections", () => {
  const review = {
    workspace_id: workspace,
    comment_id: "1",
    content_hash: "current",
    label: "negative" as const,
    reason: "تصنيف خاطئ",
  };
  const at = "2026-09-05T00:00:00Z";

  it("appends rather than replacing, and the newest current review wins", () => {
    const once = applyReview(rows, review, at, "reviewer-1");
    const twice = applyReview(
      once,
      { ...review, label: "mixed" },
      "2026-09-06T00:00:00Z",
      "reviewer-1",
    );
    const target = twice.find((c) => c.id === "1")!;
    expect(target.reviews).toHaveLength(2);
    expect(target.reviews.map((r) => r.label)).toEqual(["negative", "mixed"]);
    expect(effectiveLabel(target, "fixture-v1")).toEqual({
      label: "mixed",
      reviewed: true,
    });
    // The input array is untouched, so a failed round trip cannot half-apply.
    expect(rows.find((c) => c.id === "1")!.reviews).toHaveLength(0);
  });

  it("moves the comment between buckets without changing the total", () => {
    const before = snapshot(rows, { workspace_id: workspace }, "fixture-v1");
    const after = snapshot(
      applyReview(rows, review, at, "reviewer-1"),
      { workspace_id: workspace },
      "fixture-v1",
    );
    expect(after.total).toBe(before.total);
    expect(before.sentiments).toEqual({
      positive: 1,
      negative: 0,
      neutral: 0,
      mixed: 1,
    });
    expect(after.sentiments).toEqual({
      positive: 0,
      negative: 1,
      neutral: 0,
      mixed: 1,
    });
    expect(after.analysed).toBe(before.analysed);
  });

  it("makes a previously unanalysed comment count once it is reviewed", () => {
    const after = snapshot(
      applyReview(rows, { ...review, comment_id: "4" }, at, "reviewer-1"),
      { workspace_id: workspace },
      "fixture-v1",
    );
    expect(after.analysed).toBe(3);
    expect(after.unanalysed).toBe(1);
    expect(after.sentiments.negative).toBe(1);
  });

  it("is visible to the review_status filter through the same snapshot", () => {
    const reviewed = applyReview(rows, review, at, "reviewer-1");
    expect(
      snapshot(
        reviewed,
        { workspace_id: workspace, review_status: "reviewed" },
        "fixture-v1",
      ).total,
    ).toBe(1);
    expect(
      snapshot(
        reviewed,
        { workspace_id: workspace, review_status: "unreviewed" },
        "fixture-v1",
      ).total,
    ).toBe(3);
  });

  it("refuses a verdict written against text that has since changed", () => {
    expect(() =>
      applyReview(rows, { ...review, content_hash: "old" }, at, "reviewer-1"),
    ).toThrow("stale_comment_text");
  });

  it("refuses an unknown comment, another workspace, and an empty reason", () => {
    expect(() =>
      applyReview(rows, { ...review, comment_id: "404" }, at, "reviewer-1"),
    ).toThrow("invalid_comment");
    // Row 5 exists but belongs to another workspace.
    expect(() =>
      applyReview(rows, { ...review, comment_id: "5" }, at, "reviewer-1"),
    ).toThrow("invalid_comment");
    expect(
      CommentReviewInputSchema.safeParse({ ...review, reason: "   " }).success,
    ).toBe(false);
    expect(
      CommentReviewInputSchema.safeParse({ ...review, label: "angry" }).success,
    ).toBe(false);
  });
  it("records who reviewed and why, taking the identity from the caller", () => {
    const applied = applyReview(rows, review, at, "reviewer-7");
    const entry = applied.find((c) => c.id === "1")!.reviews[0];
    expect(entry.reviewer_id).toBe("reviewer-7");
    expect(entry.reason).toBe("تصنيف خاطئ");
    // The identity must not be forgeable through the payload, matching the RPC
    // which takes it from the session rather than from the caller's fields.
    expect(
      CommentReviewInputSchema.safeParse({
        ...review,
        reviewer_id: "someone-else",
      }).success,
    ).toBe(false);
  });

  it("requires a human verdict to state a reason, but not a legacy amendment", () => {
    const human = {
      label: "negative" as const,
      content_hash: "current",
      created_at: at,
      origin: "human" as const,
      reviewer_id: "reviewer-7",
      reason: "سبب",
    };
    expect(ReviewSchema.safeParse(human).success).toBe(true);
    expect(ReviewSchema.safeParse({ ...human, reason: null }).success).toBe(
      false,
    );
    expect(ReviewSchema.safeParse({ ...human, reason: "   " }).success).toBe(
      false,
    );
    // An imported amendment has no reviewer and no stated reason, and that is
    // exactly why it is not human-reviewed truth.
    expect(
      ReviewSchema.safeParse({
        ...human,
        origin: "legacy_unverified",
        reviewer_id: null,
        reason: null,
      }).success,
    ).toBe(true);
  });
  it("offers the comment types present in the workspace, not in the page", () => {
    const typed: Comment[] = [
      { ...base, id: "t1", comment_type: "سؤال" },
      { ...base, id: "t2", comment_type: "اقتراح", video_id: "v2" },
      { ...base, id: "t3", comment_type: "سؤال" },
      { ...base, id: "t4", comment_type: null },
      {
        ...base,
        id: "t5",
        comment_type: "نوع آخر",
        workspace_id: "00000000-0000-4000-8000-000000000002",
      },
    ];
    const all = snapshot(typed, { workspace_id: workspace }, "fixture-v1");
    // Distinct, sorted, nulls dropped, and another workspace never leaks in.
    expect(all.comment_types).toEqual(["اقتراح", "سؤال"]);

    // The list must not narrow with the filters, or a type that is currently
    // filtered out could never be selected again.
    const narrowed = snapshot(
      typed,
      { workspace_id: workspace, comment_type: "سؤال", limit: 1 },
      "fixture-v1",
    );
    expect(narrowed.total).toBe(2);
    expect(narrowed.comments).toHaveLength(1);
    expect(narrowed.comment_types).toEqual(["اقتراح", "سؤال"]);

    // Same when a video filter excludes the only comment of a type.
    const oneVideo = snapshot(
      typed,
      { workspace_id: workspace, video_ids: ["v2"] },
      "fixture-v1",
    );
    expect(oneVideo.total).toBe(1);
    expect(oneVideo.comment_types).toEqual(["اقتراح", "سؤال"]);
  });
});
