import { describe, expect, it } from "vitest";
import { netSentiment, pct } from "./format";

describe("pct", () => {
  it("uses the reader's percent sign", () => {
    expect(pct(42, "ar")).toBe("42٪");
    expect(pct(42, "en")).toBe("42%");
  });
  it("renders unknown as an em dash, never 0%", () => {
    for (const v of [null, undefined, Number.NaN, Infinity])
      expect(pct(v, "en")).toBe("—");
  });
  it("signs positive values only when asked", () => {
    expect(pct(5, "en", { signed: true })).toBe("+5%");
    expect(pct(-5, "en", { signed: true })).toBe("-5%");
    expect(pct(0, "en", { signed: true })).toBe("0%");
    expect(pct(5, "en")).toBe("5%");
  });
});

describe("netSentiment", () => {
  it("divides by positive plus negative, leaving neutral out", () => {
    expect(netSentiment(60, 20)).toBe(50);
    expect(netSentiment(10, 50)).toBe(-67);
    expect(netSentiment(5, 0)).toBe(100);
  });

  it("is unknown, not 0, with no positive and no negative comment", () => {
    expect(netSentiment(0, 0)).toBeNull();
  });
});
