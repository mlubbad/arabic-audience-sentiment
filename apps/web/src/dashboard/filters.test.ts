import { describe, expect, it } from "vitest";
import type { Filters } from "@sentiment/contracts";
import { ar } from "../strings/ar";
import {
  EMPTY_FILTERS,
  appliedValues,
  chipsFor,
  extraCount,
  withoutChip,
  withoutUnmeasurable,
} from "./filters";

const topicName = (key: string) => key;

describe("extraCount", () => {
  it("is zero for the empty filters", () => {
    expect(extraCount(EMPTY_FILTERS)).toBe(0);
  });

  it("counts topic, replies and limit as three", () => {
    expect(
      extraCount({
        ...EMPTY_FILTERS,
        topic: "x",
        replies: "replies",
        limit: 50,
      }),
    ).toBe(3);
  });
});

describe("chipsFor", () => {
  it("is empty for the empty filters", () => {
    expect(
      chipsFor(EMPTY_FILTERS, { S: ar, labels: ar.labels, topicName }),
    ).toEqual([]);
  });

  it("orders query, sentiment then period", () => {
    const chips = chipsFor(
      {
        ...EMPTY_FILTERS,
        query: "صوت",
        sentiment: "negative",
        from: "2026-01-01",
      },
      { S: ar, labels: ar.labels, topicName },
    );
    expect(chips).toEqual([
      { key: "query", label: ar.chipSearch("صوت") },
      { key: "sentiment", label: ar.chipSentiment(ar.labels.negative) },
      { key: "period", label: ar.chipPeriod },
    ]);
  });
});

const workspace_id = "00000000-0000-4000-8000-000000000001";
const ctx = { S: ar, labels: ar.labels, topicName };

describe("appliedValues", () => {
  it("makes no chip for the unfiltered read, whatever the bar holds", () => {
    // The dashboard's draft can hold «تعليقات أصلية فقط» before «تطبيق
    // الفلاتر» is pressed; the chips come from this, the applied state.
    expect(chipsFor(appliedValues({ workspace_id }, 25), ctx)).toEqual([]);
  });

  it("reads every applied condition back as the chip it makes", () => {
    const applied: Filters = {
      workspace_id,
      q: "صوت",
      video_ids: ["v1"],
      sentiments: ["negative"],
      topics: ["t1"],
      video_kind: "short",
      platform: "telegram",
      comment_type: "question",
      replies: "comments",
      review_status: "reviewed",
      date_mode: "known",
      from: new Date("2026-01-01T00:00:00+03:00").toISOString(),
      to: new Date("2026-02-01T00:00:00+03:00").toISOString(),
    };
    const values = appliedValues(applied, 50);
    expect(values).toEqual({
      query: "صوت",
      video: "v1",
      sentiment: "negative",
      topic: "t1",
      videoKind: "short",
      platform: "telegram",
      replies: "comments",
      commentType: "question",
      reviewStatus: "reviewed",
      dateMode: "known",
      // The day that was picked, not the UTC day the bound falls on.
      from: "2026-01-01",
      to: "2026-02-01",
      limit: 50,
    });
    expect(chipsFor(values, ctx).map((c) => c.key)).toEqual([
      "query",
      "video",
      "sentiment",
      "topic",
      "videoKind",
      "platform",
      "commentType",
      "replies",
      "reviewStatus",
      "dateMode",
      "period",
    ]);
  });

  it("has no period chip when no bound was sent", () => {
    // `date_mode: "unknown"` drops the range before the read, so a range
    // left in the (disabled) date inputs narrows nothing and says nothing.
    const chips = chipsFor(
      appliedValues({ workspace_id, date_mode: "unknown" }, 25),
      ctx,
    );
    expect(chips.map((c) => c.key)).toEqual(["dateMode"]);
  });
});

describe("withoutChip", () => {
  const applied: Filters = {
    workspace_id,
    video_ids: ["v1"],
    replies: "comments",
    from: new Date("2026-01-01T00:00:00+03:00").toISOString(),
    to: new Date("2026-02-01T00:00:00+03:00").toISOString(),
  };

  it("removes one condition and leaves every other applied one", () => {
    expect(withoutChip(applied, "video")).toEqual({
      ...applied,
      video_ids: [],
    });
    expect(withoutChip(applied, "replies")).toEqual({
      ...applied,
      replies: "all",
    });
  });

  it("removes both bounds of the period together", () => {
    const next = withoutChip(applied, "period");
    expect(next.from).toBeUndefined();
    expect(next.to).toBeUndefined();
    expect(chipsFor(appliedValues(next, 25), ctx).map((c) => c.key)).toEqual([
      "video",
      "replies",
    ]);
  });
});

describe("withoutUnmeasurable", () => {
  // A three-class model (CAMeLBERT-DA) cannot say Mixed at all.
  const threeClass = new Set(["positive", "negative", "neutral"]);

  it("drops an applied sentiment the active model cannot measure", () => {
    const applied: Filters = {
      workspace_id,
      sentiments: ["mixed"],
      replies: "comments",
    };
    // Only the sentiment goes: the other applied condition stays, and
    // nothing from the bar's draft is involved.
    expect(withoutUnmeasurable(applied, threeClass)).toEqual({
      ...applied,
      sentiments: [],
    });
  });

  it("changes nothing when every applied sentiment is measurable", () => {
    expect(
      withoutUnmeasurable(
        { workspace_id, sentiments: ["negative"] },
        threeClass,
      ),
    ).toBeNull();
    expect(withoutUnmeasurable({ workspace_id }, threeClass)).toBeNull();
  });
});
