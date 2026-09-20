import { describe, expect, it } from "vitest";
import {
  CatalogueVideoSchema,
  filterCatalogue,
  fitNewest,
  selectionEstimate,
  type CatalogueVideo,
} from "./selection";

const v = (o: Partial<CatalogueVideo> & { id: string }): CatalogueVideo => ({
  external_video_id: "x".repeat(11),
  title: o.id,
  kind: "video",
  published_at: "2026-01-01T00:00:00Z",
  thumbnail_url: null,
  reported_comment_count: 10,
  comments_state: "open",
  collected: 0,
  selected: false,
  last_collected_at: null,
  last_outcome: null,
  next_check_at: null,
  ...o,
});

describe("selectionEstimate", () => {
  it("sums what is not yet stored and reports unknowns apart", () => {
    const rows = [
      v({ id: "a", reported_comment_count: 25, collected: 1 }),
      v({ id: "b", reported_comment_count: null }),
      v({ id: "c", reported_comment_count: 5, collected: 9 }),
    ];
    expect(selectionEstimate(rows, new Set(["a", "b", "c"]), 30)).toEqual({
      estimate: 24,
      unknownCount: 1,
      outstanding: 0,
      remainingAfter: 6,
      unlimited: false,
      exceeds: false,
    });
  });
  it("prices what is already selected and not yet stored as outstanding, not as the estimate", () => {
    // Selected with 100 reported and 90 stored: 10 still to come, spoken for
    // before this selection is priced. The same rule select_videos refuses on.
    const rows = [
      v({
        id: "a",
        selected: true,
        reported_comment_count: 100,
        collected: 90,
      }),
      v({ id: "b", reported_comment_count: 31 }),
    ];
    expect(selectionEstimate(rows, new Set(["a", "b"]), 50)).toMatchObject({
      estimate: 31,
      outstanding: 10,
      exceeds: false,
      remainingAfter: 9,
    });
    // 31 alone would fit 40; beside the 10 outstanding it does not.
    expect(selectionEstimate(rows, new Set(["a", "b"]), 40)).toMatchObject({
      estimate: 31,
      outstanding: 10,
      exceeds: true,
      remainingAfter: -1,
    });
    // A selection being removed is not outstanding; an unknown count is 0.
    const withUnknown = [
      ...rows,
      v({ id: "c", selected: true, reported_comment_count: null }),
    ];
    expect(
      selectionEstimate(withUnknown, new Set(["b"]), 40, new Set(["a"])),
    ).toMatchObject({ estimate: 31, outstanding: 0, remainingAfter: 9 });
    expect(
      selectionEstimate(withUnknown, new Set(["a", "b", "c"]), 40),
    ).toMatchObject({ outstanding: 10, unknownCount: 0 });
  });
  it("with no plan, nothing is known about the remainder", () => {
    expect(
      selectionEstimate([v({ id: "a" })], new Set(["a"]), null),
    ).toMatchObject({ remainingAfter: null, exceeds: false });
  });
  it("a plan with no ceiling — -1, as BudgetSchema spells it — never exceeds and has no remainder to report", () => {
    // The owner's plan: analysis_remaining answers the largest int for it in
    // SQL, so select_videos never refuses; here the remainder is not a number.
    const rows = [
      v({
        id: "a",
        selected: true,
        reported_comment_count: 100,
        collected: 90,
      }),
      v({ id: "b", reported_comment_count: 31 }),
    ];
    expect(selectionEstimate(rows, new Set(["a", "b"]), -1)).toEqual({
      estimate: 31,
      unknownCount: 0,
      outstanding: 10,
      remainingAfter: null,
      unlimited: true,
      exceeds: false,
    });
  });
});

describe("filterCatalogue", () => {
  const rows = [
    v({
      id: "1",
      title: "شرح الإحصاء",
      kind: "video",
      published_at: "2026-03-01T00:00:00Z",
      reported_comment_count: 3,
    }),
    v({
      id: "2",
      title: "مقطع قصير",
      kind: "short",
      published_at: "2026-04-01T00:00:00Z",
      reported_comment_count: 9,
    }),
    v({
      id: "3",
      title: "بث مباشر",
      kind: "stream",
      published_at: null,
      reported_comment_count: null,
    }),
  ];
  it("searches the title, case-insensitively", () => {
    expect(
      filterCatalogue(rows, {
        search: "إحصاء",
        kind: "all",
        sort: "newest",
      }).map((r) => r.id),
    ).toEqual(["1"]);
    expect(
      filterCatalogue(rows, { search: "  ", kind: "all", sort: "newest" }),
    ).toHaveLength(3);
  });
  it("filters by kind", () => {
    expect(
      filterCatalogue(rows, { search: "", kind: "short", sort: "newest" }).map(
        (r) => r.id,
      ),
    ).toEqual(["2"]);
  });
  it("sorts newest with unknown dates last, and most-commented with unknown counts last", () => {
    expect(
      filterCatalogue(rows, { search: "", kind: "all", sort: "newest" }).map(
        (r) => r.id,
      ),
    ).toEqual(["2", "1", "3"]);
    expect(
      filterCatalogue(rows, { search: "", kind: "all", sort: "oldest" }).map(
        (r) => r.id,
      ),
    ).toEqual(["1", "2", "3"]);
    expect(
      filterCatalogue(rows, {
        search: "",
        kind: "all",
        sort: "most_commented",
      }).map((r) => r.id),
    ).toEqual(["2", "1", "3"]);
  });
});

describe("fitNewest", () => {
  it("takes the newest videos while the estimate fits, skipping disabled and selected ones", () => {
    const rows = [
      v({
        id: "old",
        published_at: "2026-01-01T00:00:00Z",
        reported_comment_count: 5,
      }),
      v({
        id: "new",
        published_at: "2026-05-01T00:00:00Z",
        reported_comment_count: 20,
      }),
      v({
        id: "mid",
        published_at: "2026-03-01T00:00:00Z",
        reported_comment_count: 8,
      }),
      v({
        id: "off",
        published_at: "2026-06-01T00:00:00Z",
        comments_state: "disabled",
      }),
      v({ id: "have", published_at: "2026-06-02T00:00:00Z", selected: true }),
    ];
    expect(fitNewest(rows, 26)).toEqual(["new", "old"]);
  });
  it("with no ceiling, every video that can be priced fits", () => {
    const rows = [
      v({
        id: "old",
        published_at: "2026-01-01T00:00:00Z",
        reported_comment_count: 5,
      }),
      v({
        id: "new",
        published_at: "2026-05-01T00:00:00Z",
        reported_comment_count: 20,
      }),
      v({
        id: "off",
        published_at: "2026-06-01T00:00:00Z",
        comments_state: "disabled",
      }),
      v({ id: "have", published_at: "2026-06-02T00:00:00Z", selected: true }),
      v({
        id: "blank",
        published_at: "2026-06-03T00:00:00Z",
        reported_comment_count: null,
      }),
    ];
    expect(fitNewest(rows, Infinity)).toEqual(["new", "old"]);
  });
});

describe("CatalogueVideoSchema", () => {
  it("refuses a zero standing in for unknown only where the source said null", () => {
    expect(
      CatalogueVideoSchema.safeParse(
        v({ id: "a", reported_comment_count: null }),
      ).success,
    ).toBe(true);
    expect(
      CatalogueVideoSchema.safeParse({ ...v({ id: "a" }), kind: "clip" })
        .success,
    ).toBe(false);
    expect(
      CatalogueVideoSchema.safeParse({
        ...v({ id: "tg_1" }),
        kind: "channel_post",
        external_video_id: "msg_12345",
      }).success,
    ).toBe(true);
    expect(
      CatalogueVideoSchema.safeParse({
        ...v({ id: "tw_1" }),
        kind: "tweet",
        external_video_id: "182938491029384",
      }).success,
    ).toBe(true);
  });
});
