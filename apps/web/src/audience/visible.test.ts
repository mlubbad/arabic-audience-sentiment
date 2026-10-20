import { describe, expect, it } from "vitest";
import { audienceVisible } from "./useAudience";

describe("audienceVisible", () => {
  it("needs both the switch and the plan", () => {
    expect(audienceVisible(undefined)).toBe(false);
    expect(audienceVisible({ switch_on: true, plan_allows: false })).toBe(
      false,
    );
    expect(audienceVisible({ switch_on: false, plan_allows: true })).toBe(
      false,
    );
    expect(audienceVisible({ switch_on: true, plan_allows: true })).toBe(true);
  });
});
