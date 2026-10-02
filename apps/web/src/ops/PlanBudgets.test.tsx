// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "../strings/ar";
import { PlanBudgets } from "./PlanBudgets";

describe("PlanBudgets component", () => {
  it("renders unlimited budget with localized unlimited string and no progress meter", () => {
    const unlimitedPlan = {
      plan_key: "internal_unlimited",
      status: "active" as const,
      period_start: "2026-09-01T00:00:00Z",
      period_end: "2026-10-01T00:00:00Z",
      budgets: [
        {
          event_type: "comment_analysis" as const,
          used: 68353,
          allowance: -1,
          granted: 0,
          remaining: -1,
        },
      ],
      cancel_at_period_end: false,
      billing_interval: null,
      provider: null,
    };

    render(<PlanBudgets plan={unlimitedPlan} lang="ar" S={ar} />);

    // Label should be displayed
    expect(screen.getByText(ar.budgetAnalysis)).toBeInTheDocument();
    // Unlimited text should be formatted properly: e.g. "68,353 (غير محدود)"
    expect(
      screen.getByText(ar.planUsedUnlimited("68,353", ar.pricingUnlimited)),
    ).toBeInTheDocument();
    // Budget meter should not be rendered for unlimited budget
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders finite budget with allowance line and progress meter", () => {
    const finitePlan = {
      plan_key: "starter",
      status: "active" as const,
      period_start: "2026-09-01T00:00:00Z",
      period_end: "2026-10-01T00:00:00Z",
      budgets: [
        {
          event_type: "comment_analysis" as const,
          used: 500,
          allowance: 1000,
          granted: 0,
          remaining: 500,
        },
      ],
      cancel_at_period_end: false,
      billing_interval: null,
      provider: null,
    };

    render(<PlanBudgets plan={finitePlan} lang="ar" S={ar} />);

    expect(screen.getByText(ar.budgetAnalysis)).toBeInTheDocument();
    expect(
      screen.getByText(ar.opsBudgetLine(500, 1000, 500)),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});
