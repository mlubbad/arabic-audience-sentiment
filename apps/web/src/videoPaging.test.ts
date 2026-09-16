import { describe, expect, it } from "vitest";
import { pageSlice } from "./videoPaging";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `v${i + 1}`);

describe("pageSlice", () => {
  it("returns the first 25 of 60 as page one of three", () => {
    const p = pageSlice(ids(60), 0, 25);
    expect(p.items).toEqual(ids(25));
    expect(p).toMatchObject({ page: 0, pages: 3, from: 1, to: 25 });
  });

  it("returns the remainder on the last page", () => {
    const p = pageSlice(ids(60), 2, 25);
    expect(p.items).toEqual([
      "v51",
      "v52",
      "v53",
      "v54",
      "v55",
      "v56",
      "v57",
      "v58",
      "v59",
      "v60",
    ]);
    expect(p).toMatchObject({ page: 2, pages: 3, from: 51, to: 60 });
  });

  it("clamps a page index past the end to the last page", () => {
    // A filter change shrank the list while the reader sat on page 4.
    const p = pageSlice(ids(30), 7, 25);
    expect(p.items).toEqual(["v26", "v27", "v28", "v29", "v30"]);
    expect(p).toMatchObject({ page: 1, pages: 2, from: 26, to: 30 });
  });

  it("never asks for a negative page", () => {
    const p = pageSlice(ids(3), -2, 25);
    expect(p).toMatchObject({ page: 0, pages: 1, from: 1, to: 3 });
  });

  it("is one empty page for an empty list, not zero pages", () => {
    const p = pageSlice([], 0, 25);
    expect(p.items).toEqual([]);
    expect(p).toMatchObject({ page: 0, pages: 1, from: 0, to: 0 });
  });

  it("a list of exactly one page size is one page", () => {
    expect(pageSlice(ids(25), 0, 25).pages).toBe(1);
    expect(pageSlice(ids(26), 0, 25).pages).toBe(2);
  });
});
