import { describe, expect, it } from "vitest";
import {
  FiltersSchema,
  PredictionSchema,
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
});
