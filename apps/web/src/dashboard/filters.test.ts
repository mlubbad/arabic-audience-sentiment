import { describe, expect, it } from "vitest";
import { ar } from "../strings/ar";
import { EMPTY_FILTERS, chipsFor, extraCount } from "./filters";

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
