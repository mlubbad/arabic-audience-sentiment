import { describe, expect, it } from "vitest";
import { UsageSummarySchema, budgetState } from "./index";

const budget = (used: number, allowance: number) => ({
  event_type: "comment_analysis" as const,
  used,
  allowance,
  granted: 0,
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

  it("an unlimited budget is always ok", () => {
    expect(
      budgetState({
        event_type: "comment_analysis",
        used: 999999,
        allowance: -1,
        granted: 0,
        remaining: -1,
      }),
    ).toBe("ok");
    // -1 on one side alone is a miscount, not a ceiling.
    const summary = {
      plan_key: "owner",
      status: "active" as const,
      period_start: "2026-09-01T00:00:00Z",
      period_end: "2026-10-01T00:00:00Z",
      budgets: [{ ...budget(0, -1), remaining: -1 }],
    };
    expect(UsageSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      UsageSummarySchema.safeParse({
        ...summary,
        budgets: [{ ...budget(0, -1), remaining: 0 }],
      }).success,
    ).toBe(false);
    // A row from before packs existed parses with nothing granted.
    const older: Partial<ReturnType<typeof budget>> = budget(2, 5);
    delete older.granted;
    expect(
      UsageSummarySchema.parse({ ...summary, budgets: [older] }).budgets[0]
        .granted,
    ).toBe(0);
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
