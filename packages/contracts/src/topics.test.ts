import { describe, expect, it } from "vitest";
import { applyTopicReview, effectiveTopic, UNCLASSIFIED } from "./topics";
import { CommentSchema, type Comment } from "./comments";
import { FiltersSchema } from "./filters";
import { exportRows, snapshot } from "./snapshot";
import { CSV_COLUMNS, toCsv } from "./csv";

const W = "00000000-0000-4000-8000-000000000001";
const KEY = "topics:v1+gemini-2.5-flash+p1";
const base = (over: Partial<Comment> = {}): Comment =>
  CommentSchema.parse({
    id: "c1",
    workspace_id: W,
    client_id: "cl",
    channel_id: "ch",
    video_id: "v",
    video_kind: "video",
    author_channel_id: "a",
    author_name: "مؤلف",
    text_raw: "نص",
    content_hash: "h1",
    likes_raw: null,
    likes_value: null,
    published_at: null,
    published_time_raw: null,
    timestamp_precision: "unknown",
    is_reply: false,
    parent_comment_id: null,
    parent_source: "unknown",
    source: "sanitized_fixture",
    field_provenance: {},
    comment_type: null,
    prediction: null,
    reviews: [],
    ...over,
  });
const pred = (topic_key: string, over: Record<string, unknown> = {}) => ({
  status: "succeeded" as const,
  topic_key,
  confidence: 0.8,
  content_hash: "h1",
  classification_key: KEY,
  model_id: "gemini-2.5-flash",
  prompt_version: "p1",
  predicted_at: "2026-09-15T10:00:00Z",
  error_code: null,
  ...over,
});
const review = (topic_key: string, over: Record<string, unknown> = {}) => ({
  topic_key,
  content_hash: "h1",
  created_at: "2026-09-15T11:00:00Z",
  origin: "human" as const,
  reviewer_id: "u1",
  reason: "سبب",
  ...over,
});

describe("effectiveTopic", () => {
  it("takes the model verdict on the current text under the active key", () => {
    expect(
      effectiveTopic(base({ topic_prediction: pred("praise") }), KEY),
    ).toEqual({ topic: "praise", topic_reviewed: false });
  });
  it("discards a verdict on other text, under another key, or that did not succeed", () => {
    expect(
      effectiveTopic(
        base({ topic_prediction: pred("praise", { content_hash: "h0" }) }),
        KEY,
      ).topic,
    ).toBeNull();
    expect(
      effectiveTopic(
        base({ topic_prediction: pred("praise") }),
        "topics:v2+x+p1",
      ).topic,
    ).toBeNull();
    expect(
      effectiveTopic(
        base({
          topic_prediction: pred("praise", {
            status: "failed",
            topic_key: null,
          }),
        }),
        KEY,
      ).topic,
    ).toBeNull();
  });
  it("lets the newest human review on the current text win", () => {
    const c = base({
      topic_prediction: pred("praise"),
      topic_reviews: [
        review("request"),
        review("question", { created_at: "2026-09-15T12:00:00Z" }),
        review("humour", { content_hash: "old" }),
      ],
    });
    expect(effectiveTopic(c, KEY)).toEqual({
      topic: "question",
      topic_reviewed: true,
    });
  });
});

describe("applyTopicReview", () => {
  it("appends and refuses a stale hash", () => {
    const [c] = applyTopicReview(
      [base()],
      {
        workspace_id: W,
        comment_id: "c1",
        content_hash: "h1",
        topic_key: "request",
        reason: "سبب",
      },
      "2026-09-15T12:00:00Z",
      "u1",
    );
    expect(c.topic_reviews).toHaveLength(1);
    expect(() =>
      applyTopicReview(
        [base()],
        {
          workspace_id: W,
          comment_id: "c1",
          content_hash: "h9",
          topic_key: "request",
          reason: "سبب",
        },
        "2026-09-15T12:00:00Z",
        "u1",
      ),
    ).toThrow("stale_comment_text");
  });
});

describe("the topics filter and counts", () => {
  const rows = [
    base({ id: "a", topic_prediction: pred("praise") }),
    base({ id: "b", topic_prediction: pred("question") }),
    base({ id: "c" }),
  ];
  it("narrows every figure by topic, and offers the unclassified", () => {
    const s = snapshot(
      rows,
      { workspace_id: W, topics: ["praise"] },
      "",
      [],
      KEY,
    );
    expect(s.total).toBe(1);
    expect(s.filtered.map((c) => c.id)).toEqual(["a"]);
    expect(
      snapshot(
        rows,
        { workspace_id: W, topics: [UNCLASSIFIED] },
        "",
        [],
        KEY,
      ).filtered.map((c) => c.id),
    ).toEqual(["c"]);
    expect(
      snapshot(rows, { workspace_id: W }, "", [], KEY).topic_counts,
    ).toEqual({ praise: 1, question: 1, [UNCLASSIFIED]: 1 });
  });
  it("counts on the same filtered rows as everything else", () => {
    const s = snapshot(
      rows,
      { workspace_id: W, q: "نص", topics: ["question"] },
      "",
      [],
      KEY,
    );
    expect(s.topic_counts).toEqual({ question: 1, [UNCLASSIFIED]: 0 });
  });
  it("parses the filter", () => {
    expect(FiltersSchema.parse({ workspace_id: W }).topics).toEqual([]);
  });
});

describe("the export", () => {
  it("carries the topic key, its source and the key it came from", () => {
    const i = CSV_COLUMNS.indexOf("analysis_key");
    expect(CSV_COLUMNS.slice(i + 1, i + 4)).toEqual([
      "effective_topic",
      "topic_source",
      "classification_key",
    ]);
    const rows = exportRows(
      [
        base({
          topic_prediction: pred("praise"),
          topic_reviews: [review("request")],
        }),
      ],
      { workspace_id: W },
      "",
      KEY,
    );
    const line = toCsv(rows).split("\r\n")[1].split(",");
    expect(line.slice(i + 1, i + 4)).toEqual(["request", "human_review", KEY]);
  });
});
