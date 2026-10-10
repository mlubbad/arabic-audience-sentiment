import { describe, expect, it } from "vitest";
import type { AdminCompareChannel } from "@sentiment/contracts";
import {
  MIN_SAMPLE,
  compareCsv,
  compared,
  highlights,
  netSentiment,
  readCompareFilter,
  visibleCompare,
  writeCompareFilter,
  type CompareFilter,
} from "./compareChannels";

const zero = { analysed: 0, positive: 0, negative: 0 };
const row = (
  over: Partial<AdminCompareChannel> & Pick<AdminCompareChannel, "id">,
): AdminCompareChannel => ({
  workspace_id: "00000000-0000-4000-8000-000000000001",
  workspace_name: "ws",
  mine: true,
  owner_email: "owner@example.com",
  platform: "youtube",
  external_channel_id: `UC${over.id}`,
  title: null,
  handle: null,
  copies: 1,
  analysed: 0,
  positive: 0,
  negative: 0,
  neutral: 0,
  mixed: 0,
  week: zero,
  previous_week: zero,
  top_topic: null,
  refreshed_at: "2026-10-09T12:00:00+00:00",
  ...over,
});

// Warm: +60. Cold: −50, and much colder this week. Small: too few to rank.
// Shop: a customer's, +20.
const ROWS = [
  row({
    id: "warm",
    title: "أنور المحبوب",
    analysed: 120,
    positive: 80,
    negative: 20,
    neutral: 20,
  }),
  row({
    id: "cold",
    title: "Cold",
    analysed: 300,
    positive: 50,
    negative: 150,
    neutral: 100,
    week: { analysed: 60, positive: 5, negative: 45 },
    previous_week: { analysed: 50, positive: 20, negative: 20 },
  }),
  row({ id: "small", title: "Small", analysed: 500, positive: 5, negative: 4 }),
  row({
    id: "shop",
    title: "Shop",
    mine: false,
    owner_email: "customer@example.com",
    analysed: 40,
    positive: 24,
    negative: 16,
  }),
];
const DEFAULT: CompareFilter = { owner: "all", query: "", sort: "best" };
const ids = (f: Partial<CompareFilter>) =>
  visibleCompare(ROWS, { ...DEFAULT, ...f }).map((c) => c.id);

describe("netSentiment", () => {
  it("is the dashboard's: (positive − negative) ÷ (positive + negative), one decimal", () => {
    expect(netSentiment(80, 20)).toBe(60);
    expect(netSentiment(1, 2)).toBe(-33.3);
    expect(netSentiment(0, 0)).toBeNull();
  });
});

describe("a compared channel", () => {
  it("is ranked only from MIN_SAMPLE positive-or-negative comments", () => {
    expect(compared(ROWS[0]!).ranked).toBe(true);
    expect(compared(ROWS[2]!).ranked).toBe(false);
    expect(
      compared(row({ id: "edge", positive: MIN_SAMPLE - 1, negative: 1 }))
        .ranked,
    ).toBe(true);
  });

  it("carries a weekly change only when both weeks are large enough", () => {
    // This week −80, the week before 0.
    expect(compared(ROWS[1]!).change).toBe(-80);
    expect(compared(ROWS[0]!).change).toBeNull();
  });
});

describe("the comparison filter", () => {
  it("reads the address, and falls back to the default for anything unknown", () => {
    expect(
      readCompareFilter(new URLSearchParams("owner=mine&q=x&sort=worst")),
    ).toEqual({ owner: "mine", query: "x", sort: "worst" });
    expect(
      readCompareFilter(new URLSearchParams("owner=nobody&sort=loudest")),
    ).toEqual(DEFAULT);
  });

  it("writes only what differs from the default", () => {
    expect(writeCompareFilter(DEFAULT).toString()).toBe("");
    expect(writeCompareFilter({ ...DEFAULT, sort: "change" }).toString()).toBe(
      "sort=change",
    );
  });

  it("ranks the warmest first, the small samples last", () => {
    expect(ids({})).toEqual(["warm", "shop", "cold", "small"]);
    expect(ids({ sort: "worst" })).toEqual(["cold", "shop", "warm", "small"]);
  });

  it("orders by the biggest change, by volume, and by name", () => {
    expect(ids({ sort: "change" })[0]).toBe("cold");
    expect(ids({ sort: "volume" })).toEqual(["small", "cold", "warm", "shop"]);
    expect(ids({ sort: "name" })).toEqual(["cold", "shop", "small", "warm"]);
  });

  it("keeps one kind of account, and the channels a folded search names", () => {
    expect(ids({ owner: "customers" })).toEqual(["shop"]);
    expect(ids({ owner: "mine" })).not.toContain("shop");
    expect(ids({ query: "انور" })).toEqual(["warm"]);
    expect(ids({ query: "customer@" })).toEqual(["shop"]);
  });
});

describe("highlights", () => {
  it("names the warmest, the coldest, and the biggest mover among the ranked", () => {
    const top = highlights(visibleCompare(ROWS, DEFAULT));
    expect(top.best?.id).toBe("warm");
    expect(top.worst?.id).toBe("cold");
    expect(top.mover?.id).toBe("cold");
  });

  it("names none when no channel has a large enough sample", () => {
    expect(highlights(visibleCompare([ROWS[2]!], DEFAULT))).toEqual({
      best: null,
      worst: null,
      mover: null,
    });
  });
});

describe("compareCsv", () => {
  it("writes the rows as shown, ranked ones numbered, opening as Arabic in a spreadsheet", () => {
    const csv = compareCsv(visibleCompare(ROWS, DEFAULT));
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]!.split(",")).toEqual([
      "rank",
      "name",
      "handle",
      "channel_id",
      "workspace",
      "owner",
      "copies",
      "analysed",
      "positive",
      "negative",
      "neutral",
      "mixed",
      "net_sentiment",
      "week_net",
      "previous_week_net",
      "change_points",
      "top_topic",
    ]);
    expect(lines[1]).toBe(
      "1,أنور المحبوب,,UCwarm,ws,owner@example.com,1,120,80,20,20,0,60,,,,",
    );
    // The small sample comes last, with no rank.
    expect(lines[4]!.startsWith(",Small,")).toBe(true);
  });
});
