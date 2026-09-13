import { describe, expect, it } from "vitest";
import { UsageSummarySchema, budgetState } from "./index";

const budget = (used: number, allowance: number) => ({
  event_type: "comment_analysis" as const,
  used,
  allowance,
  remaining: Math.max(allowance - used, 0),
});

describe("plan usage", () => {
  it("warns before the limit is reached, not only when it is hit", () => {
    expect(budgetState(budget(0, 100))).toBe("ok");
    expect(budgetState(budget(69, 100))).toBe("ok");
    expect(budgetState(budget(70, 100))).toBe("warning");
    expect(budgetState(budget(84, 100))).toBe("warning");
    expect(budgetState(budget(85, 100))).toBe("critical");
    expect(budgetState(budget(99, 100))).toBe("critical");
    expect(budgetState(budget(100, 100))).toBe("exhausted");
  });

  it("treats a zero allowance as exhausted rather than dividing by zero", () => {
    expect(budgetState(budget(0, 0))).toBe("exhausted");
    // An over-spend recorded by an older period must not read as healthy.
    expect(budgetState({ ...budget(0, 0), used: 3 })).toBe("exhausted");
  });

  it("rejects a summary whose remaining does not follow from used and allowance", () => {
    const valid = {
      plan_key: "pilot",
      status: "active" as const,
      period_start: "2026-09-01T00:00:00Z",
      period_end: "2026-10-01T00:00:00Z",
      budgets: [budget(2, 5)],
    };
    expect(UsageSummarySchema.safeParse(valid).success).toBe(true);
    // A server that miscounts should fail loudly rather than render a wrong bar.
    expect(
      UsageSummarySchema.safeParse({
        ...valid,
        budgets: [{ ...budget(2, 5), remaining: 99 }],
      }).success,
    ).toBe(false);
    expect(
      UsageSummarySchema.safeParse({
        ...valid,
        budgets: [{ ...budget(2, 5), used: -1 }],
      }).success,
    ).toBe(false);
    expect(
      UsageSummarySchema.safeParse({ ...valid, status: "expired" }).success,
    ).toBe(false);
  });
});
