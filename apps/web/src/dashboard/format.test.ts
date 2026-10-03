import { describe, expect, it } from "vitest";
import { formatPercent, n } from "./format";

describe("formatPercent", () => {
  it("formats positive percentages with Arabic percent sign by default", () => {
    expect(formatPercent(63)).toBe("63٪");
    expect(formatPercent(63, "ar")).toBe("63٪");
  });

  it("formats positive percentages with English percent sign in English locale", () => {
    expect(formatPercent(63, "en")).toBe("63%");
  });

  it("adds a plus sign when sign option is enabled for positive numbers", () => {
    expect(formatPercent(63, "ar", { sign: true })).toBe("+63٪");
    expect(formatPercent(63, "en", { sign: true })).toBe("+63%");
  });

  it("keeps the minus sign for negative numbers regardless of sign option", () => {
    expect(formatPercent(-50, "ar", { sign: true })).toBe("-50٪");
    expect(formatPercent(-50, "en", { sign: true })).toBe("-50%");
  });

  it("does not add a plus sign to zero even when sign option is enabled", () => {
    expect(formatPercent(0, "ar", { sign: true })).toBe("0٪");
    expect(formatPercent(0, "en", { sign: true })).toBe("0%");
  });

  it("returns em-dash for null, undefined, or NaN", () => {
    expect(formatPercent(null, "ar")).toBe("—");
    expect(formatPercent(undefined, "en")).toBe("—");
    expect(formatPercent(NaN, "ar")).toBe("—");
  });

  it("supports floating-point values", () => {
    expect(formatPercent(4.2, "ar")).toBe("4.2٪");
    expect(formatPercent(4.2, "en")).toBe("4.2%");
  });
});

describe("n (number formatting)", () => {
  it("formats numbers pinned to en-US numerals", () => {
    expect(n(1000)).toBe("1,000");
  });
});
