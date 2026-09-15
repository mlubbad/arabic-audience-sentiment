import { describe, expect, it } from "vitest";
import { ar } from "./strings/ar";
import type { LabelledComment } from "@sentiment/contracts";
import { byHour, byWeek, byWeekday, commenters, plottable } from "./analytics";

const c = (over: Partial<LabelledComment> = {}): LabelledComment =>
  ({
    id: "c1",
    workspace_id: "w",
    client_id: "cl",
    channel_id: "ch",
    video_id: "v1",
    video_kind: "video",
    author_channel_id: "a1",
    author_name: "قارئ",
    text_raw: "نص",
    content_hash: "h",
    likes_raw: null,
    likes_value: null,
    published_at: "2026-09-14T13:30:00Z",
    published_time_raw: null,
    timestamp_precision: "second",
    is_reply: false,
    parent_comment_id: null,
    parent_source: "api",
    source: "youtube_oauth",
    field_provenance: {},
    comment_type: null,
    content_purged_at: null,
    prediction: null,
    reviews: [],
    label: null,
    reviewed: false,
    ...over,
  }) as LabelledComment;

describe("timing", () => {
  it("refuses to place a coarse timestamp at an hour, and says how many", () => {
    const rows = [
      c({ id: "1", timestamp_precision: "second" }),
      c({ id: "2", timestamp_precision: "day" }),
      c({ id: "3", timestamp_precision: "approximate" }),
      c({ id: "4", published_at: null, timestamp_precision: "unknown" }),
    ];
    const h = byHour(rows);
    // "منذ ٣ أشهر" carries no hour. Placing it at midnight would manufacture a
    // busiest hour out of a rounding artefact.
    expect(h.unplaceable).toBe(3);
    expect(h.buckets.reduce((n, b) => n + b.count, 0)).toBe(1);
    expect(h.buckets).toHaveLength(24);
  });

  it("lets a day-precision row answer the weekly question it can answer", () => {
    const rows = [
      c({ id: "1", timestamp_precision: "day" }),
      c({ id: "2", published_at: null, timestamp_precision: "unknown" }),
    ];
    const w = byWeek(rows);
    // The two charts legitimately disagree about how much data they had.
    expect(w.unplaceable).toBe(1);
    expect(w.buckets.reduce((n, b) => n + b.count, 0)).toBe(1);
    expect(byHour(rows).unplaceable).toBe(2);
  });

  it("keeps every weekday on the axis, including the silent ones", () => {
    const d = byWeekday([c()], ar.weekdays);
    // A missing Friday must read as a quiet Friday, not as no Friday.
    expect(d.buckets).toHaveLength(7);
    expect(d.buckets.filter((b) => b.count === 0)).toHaveLength(6);
  });
});

describe("commenters", () => {
  it("does not merge purged authors into one giant commenter", () => {
    const rows = [
      c({ id: "1", author_name: null, author_channel_id: null }),
      c({ id: "2", author_name: null, author_channel_id: null }),
      c({ id: "3", author_name: "سالم", author_channel_id: "a2" }),
    ];
    const { ranked, anonymous } = commenters(rows);
    expect(anonymous).toBe(2);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].name).toBe("سالم");
  });

  it("separates two people who share a display name", () => {
    const rows = [
      c({ id: "1", author_name: "أبو محمد", author_channel_id: "a1" }),
      c({ id: "2", author_name: "أبو محمد", author_channel_id: "a2" }),
    ];
    expect(commenters(rows).ranked).toHaveLength(2);
  });

  it("keeps unknown likes unknown instead of counting them as none", () => {
    const unknown = commenters([c({ id: "1", likes_value: null })]).ranked[0];
    const zero = commenters([c({ id: "2", likes_value: 0 })]).ranked[0];
    expect(unknown.likes).toBeNull();
    expect(zero.likes).toBe(0);
  });

  it("ranks by the question asked", () => {
    const rows = [
      c({ id: "1", author_channel_id: "loud", likes_value: 1 }),
      c({ id: "2", author_channel_id: "loud", likes_value: 1 }),
      c({ id: "3", author_channel_id: "liked", likes_value: 50 }),
    ];
    expect(commenters(rows, "comments").ranked[0].key).toBe("loud");
    expect(commenters(rows, "likes").ranked[0].key).toBe("liked");
  });
});

describe("plottable", () => {
  const bucketed = (...counts: number[]) => ({
    buckets: counts.map((count, i) => ({
      key: String(i),
      label: String(i),
      count,
    })),
    unplaceable: 0,
  });

  it("refuses to draw a claim out of one point", () => {
    // An axis with a single filled bucket reads as a measured flat line.
    expect(plottable(bucketed(0, 0, 5))).toBe(false);
    expect(plottable(bucketed(0, 0, 0))).toBe(false);
  });

  it("draws once there is a shape to see", () => {
    expect(plottable(bucketed(1, 4))).toBe(true);
    expect(plottable(bucketed(3, 0, 9, 2))).toBe(true);
  });

  it("lets the caller ask for more before it will plot", () => {
    expect(plottable(bucketed(1, 4), 3)).toBe(false);
    expect(plottable(bucketed(1, 4, 2), 3)).toBe(true);
  });
});
