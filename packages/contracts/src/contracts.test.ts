import { describe, expect, it } from "vitest";
import {
  CommentSchema,
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
  video_title: "حلقة تجريبية",
  video_kind: "video" as const,
  author_channel_id: "author",
  by_channel_owner: false,
  author_name: "كاتب تجريبي",
  text_raw: "تعليق تجريبي",
  content_hash: "current",
  likes_raw: "0",
  likes_value: 0,
  published_at: "2026-09-01T00:00:00Z",
  published_time_raw: "2026-09-01T00:00:00Z",
  timestamp_precision: "second" as const,
  is_reply: false,
  parent_comment_id: null,
  parent_source: "unknown" as const,
  source: "sanitized_fixture" as const,
  field_provenance: {},
  comment_type: null,
  content_purged_at: null,
  reviews: [],
  prediction: null,
};
const predNeg = () => ({ ...pred("positive"), label: "negative" as const });
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
  it("reports a class the analysis cannot express as absent, not as zero", () => {
    const rows: Comment[] = [
      { ...base, id: "m1", prediction: pred("positive") },
      { ...base, id: "m2", prediction: predNeg() },
    ];
    // A three-class analysis: Mixed is not in its vocabulary.
    const three = snapshot(rows, { workspace_id: workspace }, "fixture-v1", [
      "positive",
      "negative",
      "neutral",
    ]);
    expect(three.measurable.has("mixed")).toBe(false);
    // The count is still zero — what changes is that the view can now tell
    // "none were found" apart from "this model has nowhere to put them".
    expect(three.sentiments.mixed).toBe(0);

    const four = snapshot(rows, { workspace_id: workspace }, "fixture-v1", [
      "positive",
      "negative",
      "neutral",
      "mixed",
    ]);
    expect(four.measurable.has("mixed")).toBe(true);
  });
  it("treats an analysis that produced nothing as measuring nothing", () => {
    const s = snapshot([], { workspace_id: workspace }, "fixture-v1");
    // Not "everything is zero": no analysis has run, so no class has been
    // measured and none of the four may be reported as counted.
    expect([...s.measurable]).toEqual([]);
  });
  it("keeps the channel's own replies out of every denominator", () => {
    const rows: Comment[] = [
      { ...base, id: "a1", prediction: pred("positive") },
      { ...base, id: "a2", prediction: predNeg() },
      // The brand answering its followers, not the audience answering it.
      {
        ...base,
        id: "own",
        by_channel_owner: true,
        is_reply: true,
        author_channel_id: "the-channel",
        prediction: pred("positive"),
      },
    ];
    const s = snapshot(rows, { workspace_id: workspace }, "fixture-v1");
    expect(s.total).toBe(2);
    expect(s.analysed).toBe(2);
    // One positive of two, not two of three: including the channel's own
    // reply would move the figure by a third on this sample.
    expect(s.sentiments.positive).toBe(1);
    expect(s.comments.map((c) => c.id)).not.toContain("own");
    // Counted, not deleted. A total that quietly differs from what the owner
    // sees on YouTube is one they will not trust twice.
    expect(s.channel_own_comments).toBe(1);
    expect(s.videos[0].total).toBe(2);
  });
  it("counts the channel's own replies within the workspace only", () => {
    const rows: Comment[] = [
      { ...base, id: "mine", by_channel_owner: true },
      {
        ...base,
        id: "theirs",
        by_channel_owner: true,
        workspace_id: "00000000-0000-4000-8000-000000000002",
      },
    ];
    expect(
      snapshot(rows, { workspace_id: workspace }, "fixture-v1")
        .channel_own_comments,
    ).toBe(1);
  });
  it("offers every video the workspace has, whichever one is selected", () => {
    const rows: Comment[] = [
      { ...base, id: "o1", video_id: "v1", video_title: "الحلقة الأولى" },
      { ...base, id: "o2", video_id: "v2", video_title: "الحلقة الثانية" },
      // No title carried: the id stands in rather than a made-up name.
      { ...base, id: "o3", video_id: "v3", video_title: null },
      {
        ...base,
        id: "o4",
        video_id: "v9",
        video_title: "قناة أخرى",
        workspace_id: "00000000-0000-4000-8000-000000000002",
      },
    ];
    const all = snapshot(rows, { workspace_id: workspace }, "fixture-v1");
    expect(all.video_options.map((v) => v.id)).toEqual(["v1", "v2", "v3"]);
    expect(all.video_options[0].title).toBe("الحلقة الأولى");
    expect(all.video_options.find((v) => v.id === "v3")!.title).toBeNull();

    // The bug this guards: choosing a video left it as the only option in the
    // control, so there was no way back to the others without a full reset.
    const one = snapshot(
      rows,
      { workspace_id: workspace, video_ids: ["v1"] },
      "fixture-v1",
    );
    expect(one.total).toBe(1);
    expect(one.videos.map((v) => v.id)).toEqual(["v1"]);
    expect(one.video_options.map((v) => v.id)).toEqual(["v1", "v2", "v3"]);
  });
  it("names a video by its own title in the per-video figures", () => {
    const rows: Comment[] = [
      { ...base, id: "n1", video_id: "v1", video_title: null },
      { ...base, id: "n2", video_id: "v1", video_title: "الحلقة الأولى" },
    ];
    const s = snapshot(rows, { workspace_id: workspace }, "fixture-v1");
    // A later row supplies what the first lacked, rather than the aggregate
    // being stuck with the null it happened to see first.
    expect(s.videos[0].title).toBe("الحلقة الأولى");
  });
  it("ranks the most engaged negatives without letting likes touch the label", () => {
    const liked: Comment[] = [
      { ...base, id: "e1", likes_value: 500, prediction: pred("positive") },
      { ...base, id: "e2", likes_value: 90, prediction: predNeg() },
      { ...base, id: "e3", likes_value: 400, prediction: predNeg() },
      {
        ...base,
        id: "e4",
        likes_value: null,
        likes_raw: null,
        prediction: predNeg(),
      },
    ];
    const s = snapshot(liked, { workspace_id: workspace }, "fixture-v1");
    // Highest engagement first, and the heavily liked positive stays out.
    expect(s.most_engaged_negative.map((c) => c.id)).toEqual(["e3", "e2"]);
    // Unknown engagement is not zero engagement, so it is not ranked last —
    // it is not ranked at all, and the exclusion is reported.
    expect(s.negative_unranked).toBe(1);

    // Likes must never weight sentiment: a creator's heart is not a vote.
    const unliked = liked.map((c) => ({
      ...c,
      likes_value: null,
      likes_raw: null,
    }));
    const without = snapshot(
      unliked,
      { workspace_id: workspace },
      "fixture-v1",
    );
    expect(without.sentiments).toEqual(s.sentiments);
    expect(without.analysed).toBe(s.analysed);
    expect(without.most_engaged_negative).toHaveLength(0);
    expect(without.negative_unranked).toBe(3);
  });

  it("ranks by the effective label, and follows the filters", () => {
    const liked: Comment[] = [
      {
        ...base,
        id: "e5",
        likes_value: 10,
        prediction: pred("positive"),
        reviews: [
          {
            label: "negative" as const,
            content_hash: "current",
            created_at: "2026-09-05T00:00:00Z",
            origin: "human" as const,
            reviewer_id: "reviewer-1",
            reason: "تصنيف خاطئ",
          },
        ],
      },
      {
        ...base,
        id: "e6",
        likes_value: 99,
        video_id: "v2",
        prediction: predNeg(),
      },
    ];
    const all = snapshot(liked, { workspace_id: workspace }, "fixture-v1");
    // A corrected comment is negative for ranking too, not only in the table.
    expect(all.most_engaged_negative.map((c) => c.id)).toEqual(["e6", "e5"]);
    const oneVideo = snapshot(
      liked,
      { workspace_id: workspace, video_ids: ["v1"] },
      "fixture-v1",
    );
    expect(oneVideo.most_engaged_negative.map((c) => c.id)).toEqual(["e5"]);
  });

  it("refuses a negative like count", () => {
    expect(
      CommentSchema.safeParse({ ...base, id: "x", likes_value: -1 }).success,
    ).toBe(false);
    expect(
      CommentSchema.safeParse({ ...base, id: "x", likes_value: 1.5 }).success,
    ).toBe(false);
    // Unknown engagement is legitimate; a scraped "1.2K" that could not be
    // parsed keeps its raw form with no invented number.
    expect(
      CommentSchema.safeParse({
        ...base,
        id: "x",
        likes_raw: "1.2K",
        likes_value: null,
      }).success,
    ).toBe(true);
  });
  it("aggregates each video in the same pass, on its own denominator", () => {
    const across: Comment[] = [
      { ...base, id: "v1a", video_id: "v1", prediction: pred("positive") },
      { ...base, id: "v1b", video_id: "v1", prediction: predNeg() },
      {
        ...base,
        id: "v1c",
        video_id: "v1",
        is_reply: true,
        prediction: pred("positive"),
      },
      { ...base, id: "v2a", video_id: "v2", prediction: pred("positive") },
      // No usable prediction: counted, but outside its video's denominator.
      { ...base, id: "v2b", video_id: "v2" },
      {
        ...base,
        id: "v3a",
        video_id: "v3",
        prediction: pred("positive", "old"),
      },
    ];
    const s = snapshot(across, { workspace_id: workspace }, "fixture-v1");

    // Busiest first, ties broken by id so the order is deterministic.
    expect(s.videos.map((v) => v.id)).toEqual(["v1", "v2", "v3"]);

    const v1 = s.videos.find((v) => v.id === "v1")!;
    expect(v1).toMatchObject({ total: 3, analysed: 3, replies: 1 });
    expect(v1.sentiments).toEqual({
      positive: 2,
      negative: 1,
      neutral: 0,
      mixed: 0,
    });

    // v2 is 1 of 2 analysed, so its share is 100% while the whole set is 4 of 6.
    const v2 = s.videos.find((v) => v.id === "v2")!;
    expect(v2).toMatchObject({ total: 2, analysed: 1, replies: 0 });
    expect(v2.sentiments.positive).toBe(1);
    expect(s.analysed).toBe(4);

    // A video whose only prediction is stale has nothing to divide by.
    expect(s.videos.find((v) => v.id === "v3")).toMatchObject({
      total: 1,
      analysed: 0,
    });

    // Per-video totals reconcile with the overall total.
    expect(s.videos.reduce((n, v) => n + v.total, 0)).toBe(s.total);
    expect(s.videos.reduce((n, v) => n + v.analysed, 0)).toBe(s.analysed);
  });

  it("drops a video entirely when the filters exclude all of its comments", () => {
    const across: Comment[] = [
      { ...base, id: "f1", video_id: "v1", is_reply: true },
      { ...base, id: "f2", video_id: "v2" },
    ];
    const replies = snapshot(
      across,
      { workspace_id: workspace, replies: "replies" },
      "fixture-v1",
    );
    expect(replies.videos.map((v) => v.id)).toEqual(["v1"]);
  });
  it("says how many engaged negatives it ranked, not just the ones it shows", () => {
    const many: Comment[] = Array.from({ length: 8 }, (_, i) => ({
      ...base,
      id: `n${i}`,
      likes_value: 100 - i,
      prediction: predNeg(),
    }));
    const s = snapshot(many, { workspace_id: workspace }, "fixture-v1");
    // Only the busiest few are listed, but the total is reported so five of
    // forty cannot be mistaken for all of them.
    expect(s.most_engaged_negative).toHaveLength(5);
    expect(s.negative_ranked).toBe(8);
    expect(s.most_engaged_negative[0].id).toBe("n0");

    // Below the limit the two agree, so no truncation is implied.
    const few = snapshot(
      many.slice(0, 3),
      { workspace_id: workspace },
      "fixture-v1",
    );
    expect(few.most_engaged_negative).toHaveLength(3);
    expect(few.negative_ranked).toBe(3);
  });
});

describe("searching a corpus that contains purged comments", () => {
  const purged = {
    ...base,
    id: "p1",
    text_raw: null,
    author_name: null,
    content_purged_at: "2026-10-15T00:00:00Z",
  };

  it("never matches a purged row on text, and never crashes on one", () => {
    // Coercing a missing text to "" would make it match loosely and read as a
    // result. There is nothing there to search; it must simply not match.
    const withPurged = [...rows, purged];
    const hit = snapshot(
      withPurged,
      { workspace_id: base.workspace_id, q: "تعليق" },
      "fixture-v1",
    );
    expect(hit.comments.some((c) => c.id === "p1")).toBe(false);
    expect(hit.comments.length).toBeGreaterThan(0);
  });

  it("still counts a purged comment in the totals it belongs to", () => {
    // Its text is gone; the fact that it existed and was analysed is not.
    const before = snapshot(
      rows,
      { workspace_id: base.workspace_id },
      "fixture-v1",
    );
    const after = snapshot(
      [...rows, purged],
      { workspace_id: base.workspace_id },
      "fixture-v1",
    );
    expect(after.total).toBe(before.total + 1);
  });
});
