import { describe, expect, it } from "vitest";
import { pct } from "./format";

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
