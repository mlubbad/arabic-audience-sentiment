// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { budgetState } from "@sentiment/contracts";
import { BudgetMeter } from "./BudgetMeter";

describe("BudgetMeter", () => {
  it("fills to the used share and carries budgetState's state on the bar and the sentence", () => {
    const state = budgetState({
      event_type: "comment_analysis",
      used: 74,
      allowance: 100,
      granted: 0,
      remaining: 26,
    });
    expect(state).toBe("warning");
    render(
      <BudgetMeter
        used={74}
        allowance={100}
        state={state}
        label="تحليل التعليقات"
        sentence="74٪ — اقترب الاستهلاك من الحد"
        testId="budget-comment_analysis"
      />,
    );
    const meter = screen.getByTestId("budget-comment_analysis");
    const bar = within(meter).getByRole("progressbar", {
      name: "تحليل التعليقات",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "74");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");

    const fill = bar.querySelector("i");
    expect(fill).toHaveStyle({ width: "74%" });
    expect(fill).toHaveAttribute("data-state", "warning");

    const small = meter.querySelector("small");
    expect(small).toHaveAttribute("data-state", "warning");
    expect(small).toHaveTextContent("74٪ — اقترب الاستهلاك من الحد");
  });

  it("shows an empty bar rather than NaN when there is no allowance", () => {
    render(
      <BudgetMeter
        used={0}
        allowance={0}
        state="exhausted"
        label="استيراد تاريخي"
        sentence="نفد الحد"
        testId="budget-historical_backfill"
      />,
    );
    const meter = screen.getByTestId("budget-historical_backfill");
    const bar = within(meter).getByRole("progressbar", {
      name: "استيراد تاريخي",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "0");

    const fill = bar.querySelector("i");
    expect(fill).toHaveStyle({ width: "0%" });
    expect(fill?.getAttribute("style") ?? "").not.toMatch(/NaN/);
    expect(fill).toHaveAttribute("data-state", "exhausted");
  });
});
